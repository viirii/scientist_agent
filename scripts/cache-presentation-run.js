import {MongoClient} from 'mongodb';
import {writeFile} from 'node:fs/promises';
import {loadLocalEnv,mongoConfig} from '../src/mongo/config.js';
loadLocalEnv();
const id='c52cf13c-c662-47da-90b9-70f806080a2b';
const client=new MongoClient(process.env.MONGODB_STATE_URI||mongoConfig().uri,{serverSelectionTimeoutMS:15000});
try {
 await client.connect();const db=client.db(process.env.MONGODB_STATE_DB||'scientist_state');
 const root=await db.collection('state_meta').findOne({_id:'root'}),entry=root.pairs.find(p=>p.id===id);
 if(!entry)throw new Error('Run not found');
 const parts=await db.collection('state_parts').find({pairId:id,generation:entry.generation}).sort({index:1}).toArray();
 const pair=JSON.parse(parts.map(p=>p.text).join(''));
 await writeFile(new URL('../web/presentation/run-snapshot.json',import.meta.url),JSON.stringify({savedAt:new Date().toISOString(),pair}));
 console.log(`Cached committed display snapshot: month ${pair.month}, ${pair.checkpoints.length} checkpoints`);
} finally {await client.close();}
