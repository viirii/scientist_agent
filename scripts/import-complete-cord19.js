import {readFile,writeFile,mkdir,stat} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {createInterface} from 'node:readline';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {parse} from 'csv-parse';
import {MongoClient,BSON} from 'mongodb';
import {sha256,fileHash} from '../src/corpus/importer.js';
import {basePaper,fullPaper,parseKeys} from '../src/corpus/complete.js';
import {prepareCorpus} from '../src/mongo/schema.js';
import {loadLocalEnv,mongoConfig,safeMongoError} from '../src/mongo/config.js';

const path=process.argv[2]||'curation/cord19-complete-2020.json';
const config=JSON.parse(await readFile(path,'utf8'));const version=config.corpus_version;let client,child;
loadLocalEnv();
const storageLimitBytes=Number(process.env.CORPUS_STORAGE_LIMIT_BYTES||7000000000);
if(!Number.isSafeInteger(storageLimitBytes)||storageLimitBytes!==0&&storageLimitBytes<7000000000)throw new Error('Invalid corpus storage limit');
try {
 if(!/^[a-z0-9_-]+$/.test(version)||!config.snapshots?.length)throw new Error('Invalid complete import configuration');
 const sources=[];
 for(const s of config.snapshots){
  for(const [url,date] of [[s.metadata_url,s.observed_at],...(s.archive_file?[[s.archive_url,s.archive_observed_at]]:[])]){
   if(new URL(url).hostname!=='ai2-semanticscholar-cord-19.s3-us-west-2.amazonaws.com'||!Number.isFinite(Date.parse(date))||Date.parse(date)>Date.parse('2020-12-31T23:59:59.999Z')||Date.parse(date)<Date.parse(s.release))throw new Error('Invalid official source provenance');
  }
  const bytes=s.archive_file?(await stat(s.archive_file)).size:0;if(s.archive_bytes&&bytes!==s.archive_bytes)throw new Error('Archive download is incomplete');
  console.log(`Hashing source files for ${s.release}…`);
  sources.push({...s,metadata_sha256:await fileHash(s.metadata_file),archive_sha256:s.archive_file?await fileHash(s.archive_file):null});
 }
 const manifest={format_version:2,scope:config.scope,sources,chunk_policy:config.chunk_policy,limitations:['No January/February source versions verified.','Year-end-only full text remains December-gated. Intermediate monthly full-text archives remain to be imported.','All metadata rows retained in hashed source CSVs; invalid dates/text and unmatched parses are quarantined rather than admitted.','Extracted captions do not contain reliable structured table cells.']};const manifestHash=sha256(manifest);
 loadLocalEnv();const mongo=mongoConfig();client=new MongoClient(mongo.uri,{serverSelectionTimeoutMS:15000,appName:'cord19-complete-import'});await client.connect();const db=client.db(mongo.database);await prepareCorpus(db);
 await db.collection('papers').createIndex({corpus_version:1,chunk_key:1},{name:'complete_virtual_chunk_key'});await db.collection('papers').createIndex({corpus_version:1,admitted:1,content_scope:-1,available_at:1,version_id:1},{name:'complete_fulltext_order'});
 await db.collection('papers').createIndex({corpus_version:1,admitted:1,available_at:1,chunk_count:1},{name:'complete_covered_counts'});
 const corpora=db.collection('corpora');let existing=await corpora.findOne({corpus_version:version});
 if(existing&&existing.manifest_hash!==manifestHash)throw new Error('Manifest changed; choose a new corpus version');
 if(existing?.status==='frozen'){console.log('Complete corpus is already frozen; no writes performed.');process.exitCode=0;}
 else {
  if(!existing)await corpora.insertOne({corpus_version:version,status:'staging',manifest_hash:manifestHash,manifest,created_at:new Date(),chunk_storage:'virtual'});
  const expectedRecords=new Map();let operations=[],batchBytes=0,insertAttempts=0;const totals=[];
  async function flush(){if(!operations.length)return;await db.collection('papers').bulkWrite(operations,{ordered:true});operations=[];batchBytes=0;if(insertAttempts%10000===0){const storage=await db.stats();if(storageLimitBytes>0&&storage.storageSize+storage.indexSize>storageLimitBytes)throw new Error('Corpus storage safety threshold reached; staging remains resumable.');}}
  async function put(paper){paper.chunk_key=sha256(paper.version_id);paper.chunk_count=paper.content_scope==='full_text'?paper.paragraphs.reduce((n,p)=>n+Math.ceil(p.text.length/1600),0):Math.ceil(paper.abstract.length/1600);const previous=expectedRecords.get(paper.version_id);if(previous&&previous.available<=paper.available_at.getTime())return;const recordHash=sha256(paper);expectedRecords.set(paper.version_id,{hash:recordHash,available:paper.available_at.getTime()});const bytes=BSON.calculateObjectSize(paper);if(bytes>15000000)throw new Error('Paper exceeds BSON size limit');operations.push({updateOne:{filter:{corpus_version:version,version_id:paper.version_id},update:{$set:{...paper,record_hash:recordHash}},upsert:true}});batchBytes+=bytes;insertAttempts++;if(operations.length>=100||batchBytes>4000000)await flush();}
  let quarantines=[];async function quarantine(id,reason,detail){quarantines.push({updateOne:{filter:{corpus_version:version,source_id:id},update:{$setOnInsert:{corpus_version:version,source_id:id,reason,detail,created_at:new Date()}},upsert:true}});if(quarantines.length>=100)await flushQuarantine();}
  async function flushQuarantine(){if(quarantines.length){await db.collection('quarantine').bulkWrite(quarantines,{ordered:true});quarantines=[];}}
  for(const snapshot of sources){
   console.log(`Scanning all metadata rows for ${snapshot.release} (no topic filter)…`);const refs=new Map();let rows=0,abstracts=0,parsed=0,matched=0,unmatched=0;
   const parser=createReadStream(snapshot.metadata_file).pipe(parse({columns:true,bom:true,skip_empty_lines:true,max_record_size:2000000}));
   for await(const row of parser){rows++;if(rows===1&&!['title','abstract','publish_time'].every(k=>Object.hasOwn(row,k)))throw new Error('Invalid metadata headers');const base=basePaper(row,snapshot,version);
    if(!base){await quarantine(`${snapshot.release}:row:${rows}`,'invalid_title_or_publication_date',{source_row_hash:sha256(row),publish_time:row.publish_time||'',title:row.title||''});continue;}
    if(snapshot.archive_file)for(const key of parseKeys(row)){const list=refs.get(key)||[];list.push(row);refs.set(key,list);}
    if(base.abstract){await put(base);abstracts++;}else await quarantine(`${snapshot.release}:row:${rows}`,'abstract_unavailable',{source_row_hash:sha256(row),paper_id:base.paper_id});
    if(rows%10000===0){await flush();console.log(JSON.stringify({release:snapshot.release,stage:'metadata',rows,abstracts}));}
   }
   if(!rows)throw new Error('Invalid empty metadata source');await flush();await flushQuarantine();
   if(!snapshot.archive_file){totals.push({release:snapshot.release,rows,abstracts,parsed,matched,unmatched});continue;}
   console.log(`Streaming every full-text parse for ${snapshot.release}…`);
   child=spawn('python3',['scripts/stream-cord19-parses.py',snapshot.archive_file],{stdio:['ignore','pipe','inherit']});const completion=once(child,'exit');const stream=createInterface({input:child.stdout,crlfDelay:Infinity});
   for await(const line of stream){const entry=JSON.parse(line);parsed++;if(entry.error){await quarantine(`${snapshot.release}:parse:${sha256(entry.member)}`,entry.error,{member:entry.member});continue;}
    const member=entry.member.replace(/^\.\//,'');const identity=entry.parsed.paper_id;const rowsForParse=refs.get(member)||(/^[a-f0-9]{40}$/.test(identity||'')?refs.get(identity):undefined);
    if(!rowsForParse){unmatched++;await quarantine(`${snapshot.release}:parse:${sha256(entry.member)}`,'unmatched_parse',{member:entry.member,parse_sha256:entry.raw_hash});continue;}
    for(const row of rowsForParse){let paper;try{paper=fullPaper(row,snapshot,version,entry);}catch{await quarantine(`${snapshot.release}:parse:${sha256(entry.member)}`,'invalid_body',{member:entry.member});continue;}if(paper){await put(paper);matched++;}else await quarantine(`${snapshot.release}:parse:${sha256(entry.member)}`,'empty_body',{member:entry.member,parse_sha256:entry.raw_hash});}
    if(parsed%1000===0){await flush();console.log(JSON.stringify({release:snapshot.release,stage:'full_text',parsed,matched,unmatched}));const storage=await db.stats();if(storageLimitBytes>0&&storage.storageSize+storage.indexSize>storageLimitBytes)throw new Error('Corpus storage safety threshold reached; staging remains resumable.');await corpora.updateOne({corpus_version:version,status:'staging'},{$set:{progress:{release:snapshot.release,parsed,matched,unmatched}}});}
   }
   const [code]=await completion;if(code!==0||parsed===0)throw new Error('Archive parse stream failed or contained no parses');child=null;await flush();await flushQuarantine();totals.push({release:snapshot.release,rows,abstracts,parsed,matched,unmatched});
  }
  console.log('Auditing every stored paper before freeze…');const digest=createHash('sha256');let papers=0,full=0,virtualChunks=0;
  for await(const record of db.collection('papers').find({corpus_version:version}).sort({version_id:1})){const {_id,record_hash,...paper}=record;if(expectedRecords.get(paper.version_id)?.hash!==record_hash||sha256(paper)!==record_hash)throw new Error('Stored paper integrity check failed');digest.update(paper.version_id+':'+record_hash+'\n');papers++;if(paper.content_scope==='full_text'){full++;for(const p of paper.paragraphs)virtualChunks+=Math.ceil(p.text.length/1600);}else virtualChunks+=Math.ceil(paper.abstract.length/1600);}
  if(!papers||papers!==expectedRecords.size)throw new Error('Stored inventory differs from source plan');for(const source of sources){if(await fileHash(source.metadata_file)!==source.metadata_sha256||source.archive_file&&await fileHash(source.archive_file)!==source.archive_sha256)throw new Error('Source changed during import');}
  console.log('Building full-corpus text search index…');await db.collection('papers').createIndex({title:'text',abstract:'text','paragraphs.text':'text'},{name:'complete_paper_text_search',weights:{title:5,abstract:2,'paragraphs.text':1}});
  const finalStorage=await db.stats();if(storageLimitBytes>0&&finalStorage.storageSize+finalStorage.indexSize>storageLimitBytes)throw new Error('Corpus storage safety threshold reached; staging remains resumable.');const inventoryHash=digest.digest('hex');const quarantineCount=await db.collection('quarantine').countDocuments({corpus_version:version});
  const result={status:'frozen',papers,fullTextVersions:full,virtualChunks,quarantineCount,inventoryHash,totals};await corpora.updateOne({corpus_version:version,status:'staging',manifest_hash:manifestHash},{$set:{status:'frozen',frozen_at:new Date(),document_count:papers,full_text_count:full,chunk_count:virtualChunks,quarantine_count:quarantineCount,inventory_hash:inventoryHash,import_stats:totals}});
  await mkdir('data/cord19',{recursive:true});await writeFile(`data/cord19/${version}.manifest.json`,JSON.stringify({...manifest,manifest_hash:manifestHash,...result},null,2));console.log(JSON.stringify(result));
 }
}catch(error){console.error(error.message?.match(/^(Invalid|Manifest|Archive|Paper|Stored|Corpus storage safety threshold)/)?error.message:safeMongoError(error));process.exitCode=1;}finally{if(child)child.kill();if(client)await client.close();}
