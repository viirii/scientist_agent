import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { publicationBound, buildPlan, selectSnapshot, validateCuration, sha256 } from '../src/corpus/importer.js';
import { persistPlan, MongoCorpusReader } from '../src/corpus/mongo.js';
const source = (release,observed_at)=>({release,observed_at,metadata_file:'unused.csv',source_url:`https://ai2-semanticscholar-cord-19.s3-us-west-2.amazonaws.com/${release}/metadata.csv`,date_evidence:'Historical snapshot observation; conservative bound',metadata_sha256:'hash'});
const early=source('2020-03-13','2020-03-16T17:30:08.000Z');const late=source('2020-12-31','2020-12-31T23:11:21.000Z');
const config={corpus_version:'test-v1',selection_policy:'topic-balanced-abstracts-v1',per_month:2,background_limit:2,quarantine_limit:2,chunk_characters:200,snapshots:[early,late]};
const row={cord_uid:'abc',doi:'10.1/example',title:'SARS-CoV-2 immune response',abstract:'Historical evidence with uncertainty. '.repeat(15),publish_time:'2020-01-15',license:'cc-by'};
const selection=(snapshot,rows)=>({snapshot,rows:rows.map(row=>({row,rowHash:sha256(row)})),quarantined:[],stats:{scanned:rows.length,relevant:rows.length,selected:rows.length,quarantine_selected:0}});
test('publication bounds handle partial dates conservatively and reject invalid dates',()=>{
  assert.equal(publicationBound('2020-02').date.toISOString(),'2020-02-29T23:59:59.999Z');
  assert.equal(publicationBound('2019').date.toISOString(),'2019-12-31T23:59:59.999Z');
  for(const value of ['',undefined,'2020-02-30','2020-13-01','2020-00-01','2020-01-00'])assert.equal(publicationBound(value),null);
});
test('metadata publication date never backdates an observed abstract revision',()=>{
  const changed={...row,abstract:'A later revised abstract. '.repeat(12)};
  const plan=buildPlan(config,[selection(early,[row]),selection(late,[row,changed])]);
  assert.equal(plan.papers.length,2);
  const original=plan.papers.find(p=>p.abstract===row.abstract.trim());
  const revision=plan.papers.find(p=>p.abstract===changed.abstract.trim());
  assert.equal(original.available_at.toISOString(),early.observed_at);
  assert.equal(original.source_refs.length,2);
  assert.equal(revision.available_at.toISOString(),late.observed_at);
  assert.equal(revision.eligible_for_precise_timing,false);
  for(const chunk of plan.chunks)assert.equal(chunk.available_at.getTime(),plan.papers.find(p=>p.version_id===chunk.version_id).available_at.getTime());
  assert.equal(plan.manifestHash,buildPlan(config,[selection(early,[row]),selection(late,[row,changed])]).manifestHash);
});
test('snapshot provenance must be valid and inside the replay window',()=>{
  validateCuration(config);
  for(const sourceChange of [{observed_at:'invalid'},{observed_at:'2021-01-01T00:00:00Z'},{source_url:'https://untrusted.example/metadata.csv'},{observed_at:'2020-01-01T00:00:00Z'}])assert.throws(()=>validateCuration({...config,snapshots:[{...early,...sourceChange}]}));
});
test('streaming CSV selection handles multiline quotes, excludes unrelated rows, quarantines invalid dates',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'cord19-test-'));
  try {
    const file=join(dir,'metadata.csv');
    await writeFile(file,'cord_uid,title,abstract,publish_time,doi\na,"SARS-CoV-2 immune response","A quoted ""result"", with\na second line.",2020-01-15,10.1/a\nb,Unrelated ecology,Not relevant.,2020-01-15,10.1/b\nc,Coronavirus immune response,Unknown date.,,10.1/c\nd,Coronavirus receptor evidence,Future publication.,2021-01-01,10.1/d\n');
    const result=await selectSnapshot({...early,metadata_file:file},config);
    assert.equal(result.stats.scanned,4);assert.equal(result.rows.length,1);assert.match(result.rows[0].row.abstract,/second line/);
    assert.deepEqual(result.quarantined.map(q=>q.reason).sort(),['missing_or_invalid_publication_date','publication_after_replay_end']);
    assert.equal(result.snapshot.metadata_sha256.length,64);
    await assert.rejects(()=>selectSnapshot({...early,metadata_file:join(dir,'missing')},config));
  }finally{await rm(dir,{recursive:true,force:true});}
});
function fakeDb() {
  const collections=new Map();
  const matches=(doc,query)=>Object.entries(query).every(([key,value])=>value?.$lte?doc[key]<=value.$lte:doc[key]===value);
  return {collection(name){if(!collections.has(name))collections.set(name,[]);const records=collections.get(name);
    return {findOne:async query=>structuredClone(records.find(d=>matches(d,query))),insertOne:async doc=>records.push(structuredClone(doc)),
      updateOne:async(query,update)=>{const item=records.find(d=>matches(d,query));if(item)Object.assign(item,structuredClone(update.$set));},
      bulkWrite:async actions=>{for(const {updateOne:action} of actions)if(!records.some(d=>matches(d,action.filter)))records.push(structuredClone(action.update.$setOnInsert));},
      find(query){let found=records.filter(d=>matches(d,query));return{toArray:async()=>structuredClone(found),sort(){return this;},limit(n){found=found.slice(0,n);return this;}};},countDocuments:async query=>records.filter(d=>matches(d,query)).length,
      records};}};
}
test('import resumes, freezes only verified content and refuses changed manifest or tampered data',async()=>{
  const db=fakeDb();const plan=buildPlan(config,[selection(early,[row])]);
  const first=await persistPlan(db,plan);assert.equal(first.status,'frozen');
  assert.equal((await persistPlan(db,plan)).status,'already_frozen');
  const changed=buildPlan(config,[selection(early,[{...row,abstract:'changed'}])]);
  await assert.rejects(()=>persistPlan(db,changed),/different manifest/);
  db.collection('papers').records[0].title='tampered';
  await assert.rejects(()=>persistPlan(db,plan),/differs from the manifest/);
});
test('reader rejects staging corpus and future direct paper/chunk reads',async()=>{
  const db=fakeDb();const plan=buildPlan(config,[selection(early,[row])]);
  const january=new MongoCorpusReader(db,'test-v1',new Date('2020-01-31T23:59:59.999Z'));
  await assert.rejects(()=>january.search(),/unavailable/);
  await persistPlan(db,plan);
  assert.deepEqual(await january.counts(),{papers:0,chunks:0});
  await assert.rejects(()=>january.read(plan.papers[0].version_id),/Evidence unavailable/);
  await assert.rejects(()=>january.readChunk(plan.chunks[0].chunk_id),/Evidence unavailable/);
  const march=new MongoCorpusReader(db,'test-v1',new Date('2020-03-31T23:59:59.999Z'));
  assert.equal((await march.read(plan.papers[0].version_id)).content_hash,plan.papers[0].content_hash);
  assert.equal((await march.readChunk(plan.chunks[0].chunk_id)).hash,plan.chunks[0].hash);
});
