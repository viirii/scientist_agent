import assert from 'node:assert/strict';
import { MongoClient } from 'mongodb';
import { loadLocalEnv,mongoConfig,safeMongoError } from '../src/mongo/config.js';
import { MongoCorpusReader } from '../src/corpus/mongo.js';
import { MongoEvidenceProvider } from '../src/mongo/provider.js';
loadLocalEnv();const config=mongoConfig();const version=process.env.REPLAY_CORPUS_VERSION;const client=new MongoClient(config.uri,{serverSelectionTimeoutMS:10000});
try{
 await client.connect();const db=client.db(config.database);
 const paper=await db.collection('papers').findOne({corpus_version:version,content_scope:'full_text'});assert.ok(paper);
 const chunk=await db.collection('chunks').findOne({corpus_version:version,version_id:paper.version_id});assert.ok(chunk);
 const march=new MongoCorpusReader(db,version,new Date('2020-03-31T23:59:59.999Z'));
 await assert.rejects(()=>march.read(paper.version_id),/Evidence unavailable/);await assert.rejects(()=>march.readChunk(chunk.chunk_id),/Evidence unavailable/);
 const may=new MongoCorpusReader(db,version,new Date('2020-05-31T23:59:59.999Z'));const full=await may.read(paper.version_id);await may.readChunk(chunk.chunk_id);assert.ok(full.paragraphs.length);
 const provider=new MongoEvidenceProvider(db,version);const evidence=await provider.read({month:5,corpusVersion:version},paper.version_id);assert.ok(evidence.text.length>evidence.abstract.length);assert.equal(evidence.paragraphs.length,full.paragraphs.length);
 console.log(JSON.stringify({corpusVersion:version,fullTextVersions:await db.collection('papers').countDocuments({corpus_version:version,content_scope:'full_text'}),march:await march.counts(),may:await may.counts(),checked:'March direct paper/chunk blocked; May full paper/chunk and provider read succeed.'}));
}catch(error){console.error(safeMongoError(error));process.exitCode=1;}finally{await client.close();}
