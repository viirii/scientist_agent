import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildPlan, sha256 } from '../src/corpus/importer.js';
import { addFullText } from '../src/corpus/fulltext.js';

test('full text is separately versioned, archive-bound and hash verified; absent parses remain abstracts',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'fulltext-'));
 try{
  const sha='a'.repeat(40);const archive=join(dir,'archive');await writeFile(archive,'test archive');
  const parsed={paper_id:sha,body_text:[{section:'Results',text:'Historical result. '.repeat(30),cite_spans:[{ref_id:'BIB1'}],ref_spans:[{ref_id:'TAB1'}]}],ref_entries:{TAB1:{type:'table',text:'Caption only'}},bib_entries:{BIB1:{title:'Prior evidence'}}};
  const raw=JSON.stringify(parsed);await writeFile(join(dir,`${sha}.json`),raw);
  await writeFile(join(dir,'archive-index.json'),JSON.stringify({archive_sha256:sha256('test archive'),parses:{[sha]:{sha256:sha256(raw)}}}));
  const snapshot={release:'2020-03-13',observed_at:'2020-03-16T17:30:08Z',metadata_file:'unused',source_url:'https://ai2-semanticscholar-cord-19.s3-us-west-2.amazonaws.com/2020-03-13/metadata.csv',date_evidence:'metadata timestamp',full_text:{archive_file:archive,parse_directory:dir,source_url:'https://ai2-semanticscholar-cord-19.s3-us-west-2.amazonaws.com/historical_releases/cord-19_2020-03-13.tar.gz',observed_at:'2020-05-19T01:45:26Z',date_evidence:'archive timestamp'}};
  const config={corpus_version:'fulltest',selection_policy:'topic-balanced-abstracts-v1',per_month:2,background_limit:2,quarantine_limit:2,chunk_characters:200,snapshots:[snapshot]};
  const row={sha,doi:'10.1/test',title:'Coronavirus response',abstract:'Earlier abstract',publish_time:'2020-01-01'};
  const selections=[{snapshot,rows:[{row,rowHash:sha256(row)},{row:{...row,doi:'10.1/missing',sha:'b'.repeat(40)},rowHash:'missing'}],quarantined:[],stats:{}}];
  const plan=await addFullText(buildPlan(config,selections),selections,config);
  assert.equal(plan.papers.length,3);assert.equal(plan.manifest.full_text.missing_selected,1);
  const full=plan.papers.find(p=>p.content_scope==='full_text');
  assert.equal(full.available_at.toISOString(),'2020-05-19T01:45:26.000Z');
  assert.equal(plan.papers.find(p=>p.version_id!==full.version_id&&p.paper_id===full.paper_id).available_at.toISOString(),'2020-03-16T17:30:08.000Z');
  assert.deepEqual(full.paragraphs[0].cite_spans,parsed.body_text[0].cite_spans);
  assert.deepEqual(full.reference_entries,parsed.ref_entries);
  assert.ok(plan.chunks.filter(c=>c.version_id===full.version_id).every(c=>c.available_at.getTime()===full.available_at.getTime()&&c.paragraph_index===0));
  await writeFile(join(dir,`${sha}.json`),JSON.stringify({...parsed,body_text:[]}));
  await assert.rejects(()=>addFullText(buildPlan(config,selections),selections,config),/parse hash/);
  snapshot.full_text.observed_at='2020-01-01T00:00:00Z';
  await assert.rejects(()=>addFullText(buildPlan(config,selections),selections,config),/provenance/);
 }finally{await rm(dir,{recursive:true,force:true});}
});
