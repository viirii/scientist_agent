import { MongoClient } from 'mongodb';
import { loadLocalEnv, mongoConfig, safeMongoError } from '../src/mongo/config.js';
import { MongoCorpusReader } from '../src/corpus/mongo.js';
import { cutoffFor } from '../src/fixtures.js';
let client;
try {
  loadLocalEnv();const config=mongoConfig();
  const version=process.argv[2] || 'cord19-2020-starter-v1';
  client=new MongoClient(process.env.MONGODB_CORPUS_READ_URI || config.uri,{serverSelectionTimeoutMS:10000,appName:'scientist-agent-corpus-audit'});await client.connect();
  const db=client.db(config.database);const monthly=[];
  for(let month=1;month<=12;month++)monthly.push({month,...await new MongoCorpusReader(db,version,new Date(cutoffFor(month))).counts()});
  const jan=new MongoCorpusReader(db,version,new Date(cutoffFor(1)));
  const december=new MongoCorpusReader(db,version,new Date(cutoffFor(12)));
  const sample=(await december.search('',1))[0];
  let denied=false;
  if(sample){try{await jan.read(sample.version_id);}catch(error){if(error.message==='Evidence unavailable')denied=true;else throw error;}}
  const chunks=await db.collection('chunks').find({corpus_version:version}).limit(1).toArray();
  let chunkDenied=false;
  if(chunks[0]){try{await jan.readChunk(chunks[0].chunk_id);}catch(error){if(error.message==='Evidence unavailable')chunkDenied=true;else throw error;}}
  console.log(JSON.stringify({corpus_version:version,monthly,checks:{january_future_paper_denied:denied,january_future_chunk_denied:chunkDenied},mode:'operator audit; agent integration pending'},null,2));
  if(!denied||!chunkDenied)process.exitCode=1;
}catch(error){console.error(safeMongoError(error));process.exitCode=1;}finally{if(client)await client.close();}
