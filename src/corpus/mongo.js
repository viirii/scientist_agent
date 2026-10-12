import { sha256 } from './importer.js';
import { temporalFilter } from '../mongo/schema.js';

const documentHash = document => {
  const {_id,created_at,...content}=document;
  return sha256(content);
};
export async function verifyPlan(db,plan) {
  for(const [name,documents,key] of [['papers',plan.papers,'version_id'],['chunks',plan.chunks,'chunk_id'],['quarantine',plan.quarantine,'source_id']]) {
    const stored=await db.collection(name).find({corpus_version:plan.manifest.curation.corpus_version}).toArray();
    if(stored.length!==documents.length)throw new Error('Corpus inventory differs from the manifest');
    const expected=new Map(documents.map(doc=>[doc[key],documentHash(doc)]));
    for(const document of stored)if(expected.get(document[key])!==documentHash(document))throw new Error('Corpus content differs from the manifest');
  }
}
export async function persistPlan(db,plan) {
  if(!plan.papers.length)throw new Error('Refusing to freeze an empty corpus');
  const corpusVersion=plan.manifest.curation.corpus_version;
  const corpora=db.collection('corpora');
  let existing=await corpora.findOne({corpus_version:corpusVersion});
  if(!existing) {
    try {
      await corpora.insertOne({corpus_version:corpusVersion,status:'staging',manifest_hash:plan.manifestHash,
        manifest:plan.manifest,created_at:new Date(),source_release:plan.manifest.sources.map(s=>s.release).join(';'),document_count:plan.papers.length});
    }catch(error){if(error.code!==11000)throw error;}
    existing=await corpora.findOne({corpus_version:corpusVersion});
  }
  if(existing.manifest_hash!==plan.manifestHash)throw new Error('Corpus version already belongs to a different manifest; choose a new version');
  if(existing.status==='frozen'){await verifyPlan(db,plan);return {status:'already_frozen',papers:plan.papers.length,chunks:plan.chunks.length,quarantine:plan.quarantine.length};}
  for(const [name,documents,key] of [['papers',plan.papers,'version_id'],['chunks',plan.chunks,'chunk_id'],['quarantine',plan.quarantine,'source_id']]) {
    // Identical imports are resumable. Existing records are never overwritten.
    for(let offset=0;offset<documents.length;offset+=100) {
      const batch=documents.slice(offset,offset+100);
      await db.collection(name).bulkWrite(batch.map(doc=>({updateOne:{filter:{corpus_version:corpusVersion,[key]:doc[key]},update:{$setOnInsert:{...doc,...(name==='quarantine'?{created_at:new Date()}: {})}},upsert:true}})),{ordered:true});
    }
  }
  await verifyPlan(db,plan);
  await corpora.updateOne({corpus_version:corpusVersion,manifest_hash:plan.manifestHash,status:'staging'},{$set:{status:'frozen',frozen_at:new Date(),chunk_count:plan.chunks.length,quarantine_count:plan.quarantine.length}});
  const frozen=await corpora.findOne({corpus_version:corpusVersion});
  if(frozen.status!=='frozen')throw new Error('Corpus freeze failed');
  return {status:'frozen',papers:plan.papers.length,chunks:plan.chunks.length,quarantine:plan.quarantine.length};
}
export class MongoCorpusReader {
  constructor(db,corpusVersion,serverCutoff) { this.db=db; this.filter=temporalFilter(corpusVersion,serverCutoff); }
  async requireFrozen() {
    const corpus=await this.db.collection('corpora').findOne({corpus_version:this.filter.corpus_version,status:'frozen'},{projection:{_id:0,corpus_version:1,chunk_storage:1,search_policy:1}});
    if(!corpus)throw new Error('Corpus is unavailable');
    return corpus;
  }
  async search(query='',limit=10,excludeVersions=[]) {
    if(typeof query!=='string'||query.length>256||!Number.isInteger(limit)||limit<1||limit>20||!Array.isArray(excludeVersions)||excludeVersions.length>1000||excludeVersions.some(id=>typeof id!=='string'||id.length>500))throw new Error('Invalid search request');
    const corpus=await this.requireFrozen();
    const terms=query.trim().split(/\s+/).filter(Boolean).slice(0,10).map(term=>term.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'));
    if(corpus.chunk_storage==='virtual'&&corpus.search_policy!=='keyword'){
      const filter={...this.filter,...(excludeVersions.length?{version_id:{$nin:excludeVersions}}:{}),...(query.trim()?{$text:{$search:query.trim()}}:{})};
      return this.db.collection('papers').find(filter,{projection:{_id:0,paragraphs:0,bibliography:0,reference_entries:0,...(query.trim()?{score:{$meta:'textScore'}}:{})}}).sort({content_scope:-1,...(query.trim()?{score:{$meta:'textScore'}}:{}),available_at:1,version_id:1}).limit(limit).toArray();
    }
    const filter={...this.filter,...(excludeVersions.length?{version_id:{$nin:excludeVersions}}:{}),...(terms.length?{$and:terms.map(term=>({$or:[{title:{$regex:term,$options:'i'}},{abstract:{$regex:term,$options:'i'}},{'paragraphs.text':{$regex:term,$options:'i'}}]}))}:{})};
    return this.db.collection('papers').find(filter,{projection:{_id:0,paragraphs:0,bibliography:0,reference_entries:0}}).sort({content_scope:-1,available_at:1,version_id:1}).limit(limit).toArray();
  }
  async read(versionId) {
    if(typeof versionId!=='string'||versionId.length>500)throw new Error('Evidence unavailable');
    await this.requireFrozen();
    const paper=await this.db.collection('papers').findOne({...this.filter,version_id:versionId},{projection:{_id:0}});
    if(!paper)throw new Error('Evidence unavailable');
    if(paper.record_hash){const {record_hash,...content}=paper;if(sha256(content)!==record_hash)throw new Error('Evidence unavailable');}
    return paper;
  }
  async readChunk(chunkId) {
    if(typeof chunkId!=='string'||chunkId.length>500)throw new Error('Evidence unavailable');
    const corpus=await this.requireFrozen();
    if(corpus.chunk_storage==='virtual'){
      const match=chunkId.match(/^([a-f0-9]{64}):(abstract|body):(\d+):(\d+)$/);
      if(!match)throw new Error('Evidence unavailable');
      const parent=await this.db.collection('papers').findOne({...this.filter,chunk_key:match[1]},{projection:{_id:0}});
      if(!parent)throw new Error('Evidence unavailable');
      if(parent.record_hash){const {record_hash,...content}=parent;if(sha256(content)!==record_hash)throw new Error('Evidence unavailable');}
      const paragraph=Number(match[3]);const offset=Number(match[4]);
      const source=match[2]==='body'?parent.paragraphs?.[paragraph]:paragraph===0?{text:parent.abstract,section:'abstract'}:null;
      if(!source||offset%1600!==0||offset>=source.text.length)throw new Error('Evidence unavailable');
      const text=source.text.slice(offset,offset+1600);
      return {chunk_id:chunkId,version_id:parent.version_id,corpus_version:parent.corpus_version,available_at:parent.available_at,admitted:true,text,section:source.section,paragraph_index:paragraph,offset,hash:sha256(text)};
    }
    const chunk=await this.db.collection('chunks').findOne({...this.filter,chunk_id:chunkId},{projection:{_id:0}});
    if(!chunk)throw new Error('Evidence unavailable');
    const parent=await this.read(chunk.version_id);
    if(parent.available_at.getTime()!==chunk.available_at.getTime())throw new Error('Evidence provenance mismatch');
    return chunk;
  }
  async counts() { const corpus=await this.requireFrozen();if(corpus.chunk_storage==='virtual'){const rows=await this.db.collection('papers').aggregate([{$match:this.filter},{$group:{_id:null,papers:{$sum:1},chunks:{$sum:'$chunk_count'}}}],{hint:'complete_covered_counts'}).toArray();return {papers:rows[0]?.papers||0,chunks:rows[0]?.chunks||0};}return {papers:await this.db.collection('papers').countDocuments(this.filter),chunks:await this.db.collection('chunks').countDocuments(this.filter)}; }
}
