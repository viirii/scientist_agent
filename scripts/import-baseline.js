import {readFile,writeFile} from 'node:fs/promises';
import {MongoClient} from 'mongodb';
import {sha256} from '../src/corpus/importer.js';
import {persistPlan} from '../src/corpus/mongo.js';
import {prepareCorpus} from '../src/mongo/schema.js';
import {loadLocalEnv,mongoConfig,safeMongoError} from '../src/mongo/config.js';
const version='coronavirus-pre2020-baseline-v1';
const sourcePath='data/baseline/reviews-source.json';
const source=JSON.parse(await readFile(sourcePath,'utf8'));
const selected=new Set(['25720466','31226023','30531947','30058403','29048984']);
const clean=text=>text.replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim();
const records=source.resultList.result.filter(r=>r.source==='MED'&&selected.has(r.id));
if(records.length!==selected.size)throw new Error('Baseline source inventory incomplete');
const papers=records.map(r=>{
 if(!/^20(?:0\d|1\d)-\d\d-\d\d$/.test(r.firstPublicationDate)||!r.abstractText)throw new Error('Baseline requires verified pre-2020 publication and abstract');
 const title=clean(r.title),abstract=clean(r.abstractText);
 if(/SARS[- ]CoV[- ]2|COVID[- ]?19/i.test(title+' '+abstract))throw new Error('Post-2019 content in baseline');
 const hash=sha256({title,abstract});
 return {paper_id:`pubmed:${r.id}`,version_id:`baseline:pubmed:${r.id}:${hash}`,corpus_version:version,title,abstract,content_hash:hash,available_at:new Date('2019-12-31T23:59:59.999Z'),admitted:true,date_precision:'year',date_evidence:`Curated pre-2020 baseline: original publication ${r.firstPublicationDate}, PubMed ${r.id}; conservatively available at end of 2019. Retrieved record is not a historical archive snapshot.`,publish_time_raw:r.firstPublicationDate,content_scope:'abstract',availability_policy:'curated_pre2020_publication_baseline',eligible_for_precise_timing:false,doi:r.doi||'',source_refs:[{source_url:`https://pubmed.ncbi.nlm.nih.gov/${r.id}/`,retrieved_at:new Date('2026-10-11T00:00:00Z'),source_record_hash:sha256(r)}]};
});
const chunks=papers.flatMap(p=>{const result=[];for(let offset=0;offset<p.abstract.length;offset+=1600){const text=p.abstract.slice(offset,offset+1600);result.push({chunk_id:`${p.version_id}:abstract:${offset}`,version_id:p.version_id,corpus_version:version,available_at:p.available_at,admitted:true,text,section:'Abstract',offset,hash:sha256(text)});}return result;});
const manifest={curation:{corpus_version:version},sources:[{release:'pre-2020-curated-baseline',file:sourcePath,source_sha256:sha256(source)}],limitations:['Five review abstracts, not full-paper reading.','Historical publication baseline, not an archived pre-2020 corpus capture; excluded from precise discovery timing.']};
let client;try{loadLocalEnv();const c=mongoConfig();client=new MongoClient(c.uri,{serverSelectionTimeoutMS:15000});await client.connect();const db=client.db(c.database);await prepareCorpus(db);const result=await persistPlan(db,{manifest,manifestHash:sha256(manifest),papers,chunks,quarantine:[]});await writeFile(`data/baseline/${version}.manifest.json`,JSON.stringify({...manifest,...result},null,2));console.log(JSON.stringify(result));}catch(e){console.error(safeMongoError(e));process.exitCode=1;}finally{await client?.close();}
