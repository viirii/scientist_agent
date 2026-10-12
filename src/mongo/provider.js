import { MongoCorpusReader } from '../corpus/mongo.js';
import { cutoffFor } from '../fixtures.js';
import { ReplayError } from '../errors.js';
import { safeMongoError } from './config.js';
export class MongoEvidenceProvider {
  constructor(db,corpusVersion,baselineCorpusVersion) { this.db=db;this.corpusVersion=corpusVersion;this.baselineCorpusVersion=baselineCorpusVersion; }
  reader(pair) { return new MongoCorpusReader(this.db,pair.corpusVersion,new Date(cutoffFor(pair.month))); }
  readers(pair) { return [this.reader(pair),...(pair.baselineCorpusVersion?[new MongoCorpusReader(this.db,pair.baselineCorpusVersion,new Date(cutoffFor(pair.month)))]:[])]; }
  async fromReaders(pair,method,id) { for(const reader of this.readers(pair)){try{return await reader[method](id);}catch(error){if(error.message!=='Evidence unavailable')throw error;}}throw new Error('Evidence unavailable'); }
  async guarded(fn) {
    try{return await fn();}catch(error){
      if(error instanceof ReplayError)throw error;
      if(error.message==='Evidence unavailable')throw new ReplayError('Evidence unavailable',404);
      if(error.message==='Invalid search request')throw new ReplayError(error.message);
      if(error.message==='Corpus is unavailable')throw new ReplayError('The frozen Mongo corpus is unavailable.',503);
      throw new ReplayError(safeMongoError(error),503);
    }
  }
  async ready() { return this.guarded(async()=>{await new MongoCorpusReader(this.db,this.corpusVersion,new Date(cutoffFor(1))).requireFrozen();if(this.baselineCorpusVersion)await new MongoCorpusReader(this.db,this.baselineCorpusVersion,new Date(cutoffFor(1))).requireFrozen();}); }
  async counts(pair) {return this.guarded(async()=>{const counts=await Promise.all(this.readers(pair).map(r=>r.counts()));return {papers:counts.reduce((n,c)=>n+c.papers,0),chunks:counts.reduce((n,c)=>n+c.chunks,0),baselinePapers:counts[1]?.papers||0};});}
  async previewBytes(pair,papers){const full=papers.filter(p=>p.content_scope==='full_text');const bytes=new Map();if(full.length){const rows=await this.db.collection('papers').aggregate([{$match:{corpus_version:{$in:[pair.corpusVersion,...(pair.baselineCorpusVersion?[pair.baselineCorpusVersion]:[])]},version_id:{$in:full.map(p=>p.version_id)},admitted:true,available_at:{$lte:new Date(cutoffFor(pair.month))}}},{$project:{version_id:1,textBytes:{$add:[100,{$strLenBytes:{$ifNull:['$abstract','']}},{$reduce:{input:{$ifNull:['$paragraphs',[]]},initialValue:0,in:{$add:['$$value',64,{$strLenBytes:'$$this.text'},{$strLenBytes:'$$this.section'}]}}},{$reduce:{input:{$objectToArray:{$ifNull:['$reference_entries',{}]}},initialValue:0,in:{$add:['$$value',64,{$strLenBytes:{$ifNull:['$$this.v.text','']}}]}}}]}}}]).toArray();for(const row of rows)bytes.set(row.version_id,row.textBytes);}return papers.map(p=>({...toEvidence(p,false),textBytes:bytes.get(p.version_id)}));}
  async search(pair,query='',exclude=[]) {return this.guarded(async()=>this.previewBytes(pair,(await Promise.all(this.readers(pair).map(r=>r.search(query,20,exclude)))).flat().slice(0,20)));}
  async searchAbstracts(pair,query,exclude=[]){return this.guarded(async()=>{const papers=[];for(const reader of this.readers(pair)){reader.filter.content_scope='abstract';papers.push(...await reader.search(query,20,exclude));}return papers.slice(0,20).map(p=>toEvidence(p,false));});}
  async searchWindow(pair,query,after) {return this.guarded(async()=>{const results=[];for(const reader of this.readers(pair)){reader.filter.available_at.$gt=new Date(after);results.push(...await reader.search(query,20));}return results.map(p=>toEvidence(p,false));});}
  async read(pair,id) {return this.guarded(async()=>toEvidence(await this.fromReaders(pair,'read',id)));}
  async chunk(pair,id) {return this.guarded(()=>this.fromReaders(pair,'readChunk',id));}
}
function toEvidence(paper,includeBody=true) {
  return {id:paper.version_id,title:paper.title,text:includeBody&&paper.content_scope==='full_text'?[`Abstract\n${paper.abstract}`, ...paper.paragraphs.map(p=>`${p.section}\n${p.text}`), ...Object.values(paper.reference_entries||{}).filter(r=>r.text).map(r=>`${r.type||'Caption'}\n${r.text}`)].join('\n\n'):paper.abstract,abstract:paper.abstract,paragraphs:includeBody?paper.paragraphs:undefined,referenceEntries:includeBody?paper.reference_entries:undefined,bibliography:includeBody?paper.bibliography:undefined,tableSupport:paper.table_support,availableAt:paper.available_at.toISOString(),
    paperId:paper.paper_id,doi:paper.doi||null,contentHash:paper.content_hash,availabilityPolicy:paper.availability_policy,
    dateEvidence:paper.date_evidence,contentScope:paper.content_scope,sourceRefs:paper.source_refs,source:'cord19_mongo'};
}
