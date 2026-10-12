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
 const arms=[...pair.arms.map(a=>({...a,month:pair.month})),...pair.checkpoints.flatMap(c=>c.snapshots.map(a=>({...a,month:c.month})))];
 const claims=[...arms.flatMap(a=>a.hypotheses.map(h=>h.claim)),...Object.values(pair.monthlyReviews||{}).flatMap(r=>Object.values(r.arms).flatMap(a=>(a.hypotheses||[]).map(h=>h.subject).filter(Boolean)))];
 const targets=[...arms,...[...new Set(claims)].map(claim=>({hypotheses:[{claim,status:'open',pTrue:1}],memory:[],agenda:[],researchRequests:[]}))];
 for(const arm of targets){
  const hypothesis=[...arm.hypotheses].filter(h=>h.status!=='rejected').sort((a,b)=>b.pTrue-a.pTrue)[0];
  const sourceKnowledge=arm.month?arm.memory.filter(note=>note.month===arm.month).map(note=>note.text).join('\n'):hypothesis?.claim||'';
  const sourceNext=arm.month?(arm.researchRequests||[]).filter(plan=>plan.month===arm.month).map(plan=>JSON.stringify({question:plan.question,goal:plan.goal_connection,evidence:plan.evidence_needed,outcomes:plan.discriminating_outcomes})).join('\n'):'';
  if(!sourceKnowledge&&!sourceNext)continue;
  if(entries.some(e=>e.sourceKnowledge===sourceKnowledge&&e.sourceNext===sourceNext))continue;
  const key=createHash('sha256').update(JSON.stringify({sourceKnowledge,sourceNext,version:3,model:process.env.OPENAI_MODEL})).digest('hex');
  const rawPath=new URL(`${key}.json`,cacheDir);
  let cached;try{cached=JSON.parse(await readFile(rawPath,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
  if(!cached){
   const response=await model.complete({name:'presentation_summary',schema:{type:'object',properties:{knowledge:{type:'string'},next:{type:'string'}},required:['knowledge','next'],additionalProperties:false},maxOutputTokens:700,context:{task:(arm.month?'Summarize this month’s saved literature learning notes in knowledge, and synthesize its saved proposed studies in next. Use 2–4 concise bullet points per field separated by newlines. Cover the main distinct themes. These are findings from reviewed papers, not an exhaustive summary of all available literature. These are planned studies, not performed experiments. Preserve uncertainty. Do not add new facts or experiment methods. Explain in everyday words. ':'')+'Rewrite these two saved texts for a non-scientist. This is a presentation-only paraphrase, not research. For standalone hypothesis labels use one short sentence; for monthly summaries use the bullet instructions above. Use everyday words and simplify jargon. Prioritize the central claim; preserve essential uncertainty and limitations. For standalone hypothesis labels, write a concise plain-language claim, not a summary of researchers or studies. Preserve uncertainty, qualifications, and distinctions between hypotheses and established findings. Do not add facts from your own knowledge. For next, describe what we will investigate, never claim experiments happened. No protocols. No ellipses or cut-off sentences. Empty source means no findings or no plan yet.',sourceKnowledge,sourceNext},onResponse:async raw=>{await writeFile(new URL(`${key}.raw.json`,cacheDir),JSON.stringify(raw,null,2));}});
   cached={...response,sourceKnowledge,sourceNext};await writeFile(rawPath,JSON.stringify(cached,null,2));
  }
  entries.push({sourceKnowledge,sourceNext,knowledge:cached.value.knowledge,next:cached.value.next});
  await writeFile(output,JSON.stringify(entries,null,2)+'\n');
  console.log(`Cached presentation summary ${entries.length}`);
 }
} finally {await client.close();}
