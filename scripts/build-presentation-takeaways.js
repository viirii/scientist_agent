import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {loadLocalEnv} from '../src/mongo/config.js';
import {OpenAIModel} from '../src/agent/model.js';
loadLocalEnv();
const {pair}=JSON.parse(await readFile(new URL('../web/presentation/run-snapshot.json',import.meta.url),'utf8'));
const summaries=JSON.parse(await readFile(new URL('../web/presentation/summaries.json',import.meta.url),'utf8'));
const path=new URL('../web/presentation/takeaways.json',import.meta.url);
let entries=[];try{entries=JSON.parse(await readFile(path,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
const cache=new URL('../data/presentation/',import.meta.url);await mkdir(cache,{recursive:true});
const model=new OpenAIModel({apiKey:process.env.OPENAI_API_KEY,model:process.env.OPENAI_MODEL});
for(const cp of pair.checkpoints){for(const arm of cp.snapshots){
 const sourceKnowledge=arm.memory.filter(note=>note.month===cp.month).map(note=>note.text).join('\n');
 const sourceNext=(arm.researchRequests||[]).filter(plan=>plan.month===cp.month).map(plan=>JSON.stringify({question:plan.question,goal:plan.goal_connection,evidence:plan.evidence_needed,outcomes:plan.discriminating_outcomes})).join('\n');
 const sourceReview=pair.monthlyReviews?.[cp.month]?.arms[arm.arm]?.summary||'';
 if(entries.some(e=>e.sourceKnowledge===sourceKnowledge&&e.sourceNext===sourceNext&&e.sourceReview===sourceReview))continue;
 const existing=summaries.find(e=>e.sourceKnowledge===sourceKnowledge&&e.sourceNext===sourceNext);
 const context={task:'Write a short ELI5 takeaway for each of three research dashboard sections. One complete sentence per field, ideally 12–22 words, no jargon or ellipses. Pick the most meaningful point, not generic filler. Use only the supplied text; preserve uncertainty and essential qualifications. review: what changed or remains open about earlier ideas, never score unanswered questions as failure. knowledge: the main takeaway from this month’s reviewed literature, not an exhaustive corpus claim. next: the main proposed study direction; never say it was performed. No novel methods or operational protocols. If review is missing and firstMonth is true, say this is our starting point; otherwise say the review is not available. If knowledge or next is empty, say no findings or studies recorded yet.',firstMonth:cp.month===1,review:sourceReview,knowledge:existing?.knowledge||sourceKnowledge,next:existing?.next||sourceNext};
 const key=createHash('sha256').update(JSON.stringify(context)).digest('hex');
 const result=await model.complete({name:'eli5_takeaways',schema:{type:'object',properties:{review:{type:'string',maxLength:240},knowledge:{type:'string',maxLength:240},next:{type:'string',maxLength:240}},required:['review','knowledge','next'],additionalProperties:false},context,maxOutputTokens:600,onResponse:raw=>writeFile(new URL(`${key}.takeaways.raw.json`,cache),JSON.stringify(raw,null,2))});
 await writeFile(new URL(`${key}.takeaways.json`,cache),JSON.stringify(result,null,2));
 entries.push({sourceKnowledge,sourceNext,sourceReview,...result.value});await writeFile(path,JSON.stringify(entries,null,2)+'\n');
 console.log(`Cached takeaways: ${arm.arm}, month ${cp.month}`);
}}
