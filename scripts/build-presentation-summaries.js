import {MongoClient} from 'mongodb';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {loadLocalEnv,mongoConfig} from '../src/mongo/config.js';
import {OpenAIModel} from '../src/agent/model.js';
loadLocalEnv();
const runId=process.argv[2]||'c52cf13c-c662-47da-90b9-70f806080a2b';
const client=new MongoClient(process.env.MONGODB_STATE_URI||mongoConfig().uri,{serverSelectionTimeoutMS:15000});
const output=new URL('../web/presentation/summaries.json',import.meta.url);
const cacheDir=new URL('../data/presentation/',import.meta.url);
const entries=JSON.parse(await readFile(output,'utf8'));
try {
 await client.connect();
 const db=client.db(process.env.MONGODB_STATE_DB||'scientist_state');
 const root=await db.collection('state_meta').findOne({_id:'root'});
 const entry=root.pairs.find(p=>p.id===runId);if(!entry)throw new Error('Saved run not found');
 const parts=await db.collection('state_parts').find({pairId:entry.id,generation:entry.generation}).sort({index:1}).toArray();
 const pair=JSON.parse(parts.map(p=>p.text).join(''));
 await client.close();
 await mkdir(cacheDir,{recursive:true});
 const model=new OpenAIModel({apiKey:process.env.OPENAI_API_KEY,model:process.env.OPENAI_MODEL});
 const targets=[...pair.arms,...pair.checkpoints.flatMap(c=>c.snapshots)];
 for(const arm of targets){
  const hypothesis=[...arm.hypotheses].filter(h=>h.status!=='rejected').sort((a,b)=>b.pTrue-a.pTrue)[0];
  const sourceKnowledge=hypothesis?.claim||arm.memory.at(-1)?.text||'';
  const sourceNext=arm.agenda?.[0]||arm.researchRequests?.at(-1)?.question||'';
  if(!sourceKnowledge&&!sourceNext)continue;
  if(entries.some(e=>e.sourceKnowledge===sourceKnowledge&&e.sourceNext===sourceNext))continue;
  const key=createHash('sha256').update(JSON.stringify({sourceKnowledge,sourceNext,version:1,model:process.env.OPENAI_MODEL})).digest('hex');
  const rawPath=new URL(`${key}.json`,cacheDir);
  let cached;try{cached=JSON.parse(await readFile(rawPath,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
  if(!cached){
   const response=await model.complete({name:'presentation_summary',schema:{type:'object',properties:{knowledge:{type:'string'},next:{type:'string'}},required:['knowledge','next'],additionalProperties:false},maxOutputTokens:700,context:{task:'Rewrite these two saved texts for a non-scientist. This is a presentation-only paraphrase, not research. Use 1–2 short complete sentences per field, everyday words, and explain essential jargon simply. Preserve uncertainty, qualifications, and distinctions between hypotheses and established findings. Do not add facts from your own knowledge. For next, describe what we will investigate, never claim experiments happened. No protocols. No ellipses or cut-off sentences. Empty source means no findings or no plan yet.',sourceKnowledge,sourceNext},onResponse:async raw=>{await writeFile(new URL(`${key}.raw.json`,cacheDir),JSON.stringify(raw,null,2));}});
   cached={...response,sourceKnowledge,sourceNext};await writeFile(rawPath,JSON.stringify(cached,null,2));
  }
  entries.push({sourceKnowledge,sourceNext,knowledge:cached.value.knowledge,next:cached.value.next});
  await writeFile(output,JSON.stringify(entries,null,2)+'\n');
  console.log(`Cached presentation summary ${entries.length}`);
 }
} finally {await client.close();}
