import test from 'node:test';import assert from 'node:assert/strict';
import {basePaper,parseKeys,fullPaper} from '../src/corpus/complete.js';
import {MongoCorpusReader} from '../src/corpus/mongo.js';
import {sha256} from '../src/corpus/importer.js';
const snapshot={release:'2020-12-31',observed_at:'2020-12-31T23:11:21Z',archive_observed_at:'2020-12-31T23:11:21Z',metadata_url:'official-metadata',archive_url:'official-archive'};
const row={cord_uid:'id',title:'Unrelated astronomy paper',abstract:'An observation about stars.',publish_time:'2019-04-01',sha:'a'.repeat(40)+'; '+'b'.repeat(40),pmc_json_files:'document_parses/pmc_json/PMC123.xml.json'};
test('complete selection has no topic filter and conservatively gates every metadata version',()=>{
 const p=basePaper(row,snapshot,'whole');assert.ok(p);assert.equal(p.available_at.toISOString(),'2020-12-31T23:11:21.000Z');assert.equal(basePaper({...row,publish_time:'bad'},snapshot,'whole'),null);assert.equal(basePaper({...row,publish_time:'2021-01-01'},snapshot,'whole'),null);
});
test('complete mapping supports multiple PDF hashes and PMC XML filenames',()=>{
 const keys=parseKeys(row);assert.deepEqual(keys,['document_parses/pmc_json/PMC123.xml.json','a'.repeat(40),'b'.repeat(40)]);
});
test('full text survives missing abstract; body versions remain independently dated',()=>{
 const p=fullPaper({...row,abstract:''},{...snapshot,observed_at:'2020-03-16T00:00:00Z'},'whole',{member:'document_parses/pmc_json/PMC123.xml.json',raw_hash:'parse-hash',parsed:{body_text:[{section:'Discussion',text:'Future directions.'}]}});assert.ok(p);assert.equal(p.available_at.toISOString(),'2020-12-31T23:11:21.000Z');assert.equal(p.content_scope,'full_text');assert.equal(p.paragraphs[0].text,'Future directions.');
 assert.throws(()=>fullPaper(row,snapshot,'whole',{parsed:{body_text:[{section:'x',text:4}]}}));
});
test('virtual chunks retain exact UTF-16 offsets and independently deny future parent reads',async()=>{
 const parent={...basePaper(row,snapshot,'whole'),paragraphs:[{section:'Discussion',text:'😀'.repeat(900)}],content_scope:'full_text'};parent.chunk_key=sha256(parent.version_id);
 const db={collection:name=>({findOne:async filter=>name==='corpora'?{corpus_version:'whole',chunk_storage:'virtual'}:filter.available_at.$lte>=parent.available_at&&filter.chunk_key===parent.chunk_key?parent:null})};
 const december=new MongoCorpusReader(db,'whole',new Date('2020-12-31T23:59:59Z'));const chunk=await december.readChunk(`${parent.chunk_key}:body:0:1600`);assert.equal(chunk.text,parent.paragraphs[0].text.slice(1600,3200));assert.equal(chunk.offset,1600);
 const november=new MongoCorpusReader(db,'whole',new Date('2020-11-30T23:59:59Z'));await assert.rejects(()=>november.readChunk(chunk.chunk_id),/Evidence unavailable/);await assert.rejects(()=>december.readChunk(`${parent.chunk_key}:body:0:1`),/Evidence unavailable/);
});
test('complete keyword search is cutoff-prefiltered and does not return heavy body previews',async()=>{
 let filter,projection;const db={collection:()=>({findOne:async()=>({chunk_storage:'virtual'}),find:(f,o)=>{filter=f;projection=o.projection;return {sort:()=>({limit:()=>({toArray:async()=>[]})})};}})};
 const reader=new MongoCorpusReader(db,'whole',new Date('2020-06-30T23:59:59Z'));await reader.search('immune response',10);assert.equal(filter.corpus_version,'whole');assert.equal(filter.available_at.$lte.toISOString(),'2020-06-30T23:59:59.000Z');assert.equal(filter.$text.$search,'immune response');assert.equal(projection.paragraphs,0);
});
