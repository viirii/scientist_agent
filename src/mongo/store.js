import {randomUUID} from 'node:crypto';
import {sha256} from '../corpus/importer.js';
import {ReplayError} from '../errors.js';
import {safeMongoError} from './config.js';
const chunkSize=500000;
export class MongoStore {
  kind='mongo';
  constructor(client,db,{leaseMs=90000}={}){this.client=client;this.db=db;this.leaseMs=leaseMs;this.owner=randomUUID();this.revision=0;this.manifest=[];this.eventHashes=new Map();}
  async ready(){
    const specs={state_meta:['revision','pairs'],state_parts:['pairId','generation','index','text','hash'],state_events:['pairId','arm','seq','eventId','event','hash']};
    const names=(await this.db.listCollections({},{nameOnly:true}).toArray()).map(c=>c.name);
    for(const [name,required] of Object.entries(specs))if(!names.includes(name))await this.db.createCollection(name,{validator:{$jsonSchema:{bsonType:'object',required}},validationLevel:'strict',validationAction:'error'});
    await this.db.collection('state_parts').createIndex({pairId:1,generation:1,index:1},{unique:true});
    await this.db.collection('state_events').createIndex({pairId:1,arm:1,seq:1},{unique:true});
    await this.db.collection('state_events').createIndex({eventId:1},{unique:true});
    await this.db.collection('state_meta').updateOne({_id:'root'},{$setOnInsert:{revision:0,schemaVersion:1,pairs:[],leaseEpoch:0}},{upsert:true});
  }
  async load(forMutation=false){
    const root=await this.db.collection('state_meta').findOne({_id:'root'});if(!root)throw new ReplayError('Mongo state is not initialized.',503);
    const pairs=[],eventHashes=new Map();
    for(const entry of root.pairs){
      const parts=await this.db.collection('state_parts').find({pairId:entry.id,generation:entry.generation}).sort({index:1}).toArray();
      if(parts.length!==entry.parts||parts.some((p,i)=>p.index!==i||sha256(p.text)!==p.hash))throw new ReplayError('Mongo state integrity check failed.',503);
      const text=parts.map(p=>p.text).join('');if(sha256(text)!==entry.hash)throw new ReplayError('Mongo state integrity check failed.',503);const pair=JSON.parse(text);
      for(const arm of pair.arms){const count=entry.counts[arm.name]||0;const records=await this.db.collection('state_events').find({pairId:pair.id,arm:arm.name,seq:{$lte:count}}).sort({seq:1}).toArray();if(records.length!==count||records.some((r,i)=>r.seq!==i+1||sha256(r.event.format==='json'?JSON.parse(r.event.text):r.event)!==r.hash))throw new ReplayError('Mongo event integrity check failed.',503);arm.events=records.map(r=>{eventHashes.set(r.eventId,r.hash);return r.event.format==='json'?JSON.parse(r.event.text):r.event;});}
      pairs.push(pair);
    }
    if(forMutation){this.revision=root.revision;this.manifest=root.pairs;this.eventHashes=eventHashes;}return{schemaVersion:root.schemaVersion,pairs};
  }
  async withLease(fn){
    const now=new Date();let root;
    try{root=await this.db.collection('state_meta').findOneAndUpdate({_id:'root',$or:[{leaseExpires:{$exists:false}},{leaseExpires:{$lte:now}}]},{$set:{leaseOwner:this.owner,leaseExpires:new Date(now.getTime()+this.leaseMs)},$inc:{leaseEpoch:1}},{returnDocument:'after'});}catch(e){throw new ReplayError(safeMongoError(e),503);}
    if(!root)throw new ReplayError('Another research worker is updating state. Retry after it finishes.',409);
    this.epoch=root.leaseEpoch;this.lost=false;let renewing=Promise.resolve();
    const timer=setInterval(()=>{renewing=renewing.then(async()=>{const r=await this.db.collection('state_meta').updateOne({_id:'root',leaseOwner:this.owner,leaseEpoch:this.epoch,leaseExpires:{$gt:new Date()}},{$set:{leaseExpires:new Date(Date.now()+this.leaseMs)}});if(!r.matchedCount)this.lost=true;}).catch(()=>{this.lost=true;});},Math.floor(this.leaseMs/3));timer.unref();
    try{return await fn();}finally{clearInterval(timer);await renewing;await this.db.collection('state_meta').updateOne({_id:'root',leaseOwner:this.owner,leaseEpoch:this.epoch},{$unset:{leaseOwner:'',leaseExpires:''}}).catch(()=>{});this.epoch=undefined;}
  }
  async save(state){
    if(!this.epoch||this.lost)throw new ReplayError('Research worker lease expired; state was not committed.',409);
    if(this.manifest.some(p=>!state.pairs.some(v=>v.id===p.id)))throw new ReplayError('Removing saved runs is unsupported.',409);
    const manifest=[],parts=[],events=[],newHashes=new Map(this.eventHashes);
    for(const pair of state.pairs){
      const previous=this.manifest.find(p=>p.id===pair.id);const metadata={...pair,arms:pair.arms.map(a=>{const {events,...rest}=a;return rest;})};const text=JSON.stringify(metadata),hash=sha256(text);const counts={};
      for(const arm of pair.arms){const oldCount=previous?.counts[arm.name]||0;if(arm.events.length<oldCount)throw new ReplayError('Removing audit events is unsupported.',409);counts[arm.name]=arm.events.length;
        for(const [i,event] of arm.events.entries()){if(event.seq!==i+1)throw new ReplayError('Audit event sequence is invalid.',409);const eventHash=sha256(event);if(i<oldCount){if(this.eventHashes.get(event.id)!==eventHash)throw new ReplayError('Existing audit events cannot change.',409);}else{events.push({pairId:pair.id,arm:arm.name,seq:event.seq,eventId:event.id,event:{format:'json',text:JSON.stringify(event)},hash:eventHash});newHashes.set(event.id,eventHash);}}
      }
      if(previous?.hash===hash){manifest.push({...previous,counts});continue;}
      const generation=randomUUID();let index=0;for(let offset=0;offset<text.length;){let end=Math.min(offset+chunkSize,text.length);if(end<text.length&&/[\uD800-\uDBFF]/.test(text[end-1]))end--;const piece=text.slice(offset,end);parts.push({pairId:pair.id,generation,index:index++,text:piece,hash:sha256(piece)});offset=end;}manifest.push({id:pair.id,generation,parts:index,hash,counts});
    }
    const session=this.client.startSession();
    try{await session.withTransaction(async()=>{
      if(this.lost)throw new ReplayError('Research worker lease expired.',409);
      // Fence ownership and revision in the same transaction as data and budget updates.
      const result=await this.db.collection('state_meta').updateOne({_id:'root',revision:this.revision,leaseOwner:this.owner,leaseEpoch:this.epoch,leaseExpires:{$gt:new Date()}},{$set:{pairs:manifest,schemaVersion:state.schemaVersion},$inc:{revision:1}},{session});if(!result.matchedCount)throw new ReplayError('State changed or lease expired; commit rejected.',409);
      if(parts.length)await this.db.collection('state_parts').insertMany(parts,{session});if(events.length)await this.db.collection('state_events').insertMany(events,{session});
    },{readConcern:{level:'snapshot'},writeConcern:{w:'majority'}});this.revision++;this.manifest=manifest;this.eventHashes=newHashes;
    }catch(e){throw e instanceof ReplayError?e:new ReplayError(safeMongoError(e),503);}finally{await session.endSession();}
  }
}
