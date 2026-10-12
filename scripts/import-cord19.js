import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { MongoClient } from 'mongodb';
import { validateCuration, selectSnapshot, buildPlan } from '../src/corpus/importer.js';
import { addFullText } from '../src/corpus/fulltext.js';
import { persistPlan } from '../src/corpus/mongo.js';
import { loadLocalEnv, mongoConfig, safeMongoError } from '../src/mongo/config.js';
import { prepareCorpus } from '../src/mongo/schema.js';

let client; let stage='preparation';
try {
  const args=process.argv.slice(2); const configPath=args.find(arg=>!arg.startsWith('--')) || 'curation/cord19-starter.json';
  if(args.some(arg=>arg.startsWith('--') && !['--write','--dry-run'].includes(arg)))throw new Error('Usage: npm run corpus:import -- [curation.json] [--write]');
  const config=JSON.parse(await readFile(resolve(configPath),'utf8'));validateCuration(config);
  const selections=[];
  for(const snapshot of config.snapshots){console.log(`Selecting abstracts from ${snapshot.release}…`);selections.push(await selectSnapshot(snapshot,config));}
  const plan=await addFullText(buildPlan(config,selections),selections,config);
  await mkdir('data/cord19',{recursive:true});
  await writeFile(`data/cord19/${config.corpus_version}.manifest.json`,JSON.stringify({...plan.manifest,manifest_hash:plan.manifestHash},null,2));
  console.log(`Prepared ${plan.papers.length} paper versions, ${plan.chunks.length} chunks, ${plan.quarantine.length} quarantined records.`);
  console.log('Availability uses conservative snapshot bounds; full text uses its own archive timestamp. No January/February evidence is admitted by this starter manifest.');
  if(args.includes('--write')) {
    loadLocalEnv();const mongo=mongoConfig();stage='mongo';
    client=new MongoClient(mongo.uri,{serverSelectionTimeoutMS:10000,connectTimeoutMS:10000,appName:'scientist-agent-cord19-import'});await client.connect();
    const db=client.db(mongo.database);await prepareCorpus(db);
    console.log(JSON.stringify(await persistPlan(db,plan)));
  }else console.log('Dry run only. Add --write to import and freeze this manifest in Mongo.');
}catch(error) {
  const known = /^(Invalid |Empty source |CORD-19 CSV |Source must |One to twelve |Usage: |Valid corpus |Refusing to |Corpus |Selected record |Replace the |Save MONGODB_URI|Use replay_corpus|Incompatible existing)/.test(error.message || '');
  console.error(stage==='mongo'&&!known?safeMongoError(error):known?error.message:'Corpus preparation failed. Check the metadata paths and CSV format.');process.exitCode=1;
}finally{if(client)await client.close();}
