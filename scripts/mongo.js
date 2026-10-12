import { MongoClient } from 'mongodb';
import { loadLocalEnv, mongoConfig, safeMongoError } from '../src/mongo/config.js';
import { prepareCorpus, corpusCollections } from '../src/mongo/schema.js';
let client;
try {
  loadLocalEnv();
  let config;
  try { config=mongoConfig(); } catch(error) { console.error(error.message); process.exitCode=1; }
  if(config) {
    client = new MongoClient(config.uri,{serverSelectionTimeoutMS:10000,connectTimeoutMS:10000,appName:'scientist-agent-corpus-setup'});
    await client.connect();
    const db=client.db(config.database);
    await db.command({ping:1});
    if(process.argv.includes('--setup')) {
      const collections=await prepareCorpus(db);
      console.log(`Mongo corpus setup complete: ${collections.join(', ')}. No papers imported and no existing records modified.`);
    } else {
      const collections=await db.listCollections({}, {nameOnly:true}).toArray();
      const missing=Object.keys(corpusCollections).filter(name=>!collections.some(c=>c.name===name));
      console.log('Mongo connection verified.');
      if(missing.length) console.log('Corpus collections are not ready yet. Run npm run mongo:setup.');
      else console.log('All four corpus collections exist. Corpus import is the next step.');
    }
  }
} catch(error) {
  console.error(safeMongoError(error)); process.exitCode=1;
} finally { if(client) await client.close(); }
