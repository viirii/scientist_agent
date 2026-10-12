import {MongoClient} from 'mongodb';
import {mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {loadLocalEnv,mongoConfig} from '../src/mongo/config.js';
import {MongoStore} from '../src/mongo/store.js';
const fallbackId='c52cf13c-c662-47da-90b9-70f806080a2b';
loadLocalEnv();const client=new MongoClient(process.env.MONGODB_STATE_URI||mongoConfig().uri,{serverSelectionTimeoutMS:15000});
const digest=p=>createHash('sha256').update(JSON.stringify(p)).digest('hex');
try{
 await client.connect();const store=new MongoStore(client,client.db(process.env.MONGODB_STATE_DB||'scientist_state'));
 const before=(await store.load()).pairs.find(p=>p.id===fallbackId);if(!before||before.checkpoints.length!==11)throw new Error('Fallback run not available');
 await mkdir('data/backups',{recursive:true});await writeFile(`data/backups/${fallbackId}.json`,JSON.stringify(before),{mode:0o600});
 const response=await fetch('http://localhost:3000/api/pairs',{method:'POST'});if(!response.ok)throw new Error('New run creation failed');const next=await response.json();
 const after=(await store.load()).pairs.find(p=>p.id===fallbackId);if(digest(before)!==digest(after))throw new Error('Fallback state changed');
 const report={fallbackId,fallbackStateHash:digest(before),fallbackUnchanged:true,newRunId:next.id,newRunHash:next.runHash,configHash:next.configHash,status:next.status,modelCalls:0};
 await writeFile('data/audits/strategy-run-identity.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await client.close();}
