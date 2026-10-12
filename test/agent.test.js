import test from 'node:test';
import assert from 'node:assert/strict';
import { ReplayService } from '../src/replay.js';
import { MemoryStore } from '../src/store.js';
import { OpenAIModel } from '../src/agent/model.js';
import { HistoricalResolver } from '../src/agent/historical.js';
import { cycleSchema,anchorCitations,validateCitations } from '../src/agent/contracts.js';
const paper={id:'paper-1',title:'Historical evidence',text:'Published observation remains uncertain.',availableAt:'2020-03-16T00:00:00.000Z',contentHash:'hash',contentScope:'abstract'};
const provider={corpusVersion:'test-corpus',ready:async()=>{},counts:async pair=>({papers:pair.month<3?0:1,chunks:pair.month<3?0:1}),search:async()=>[paper],read:async()=>paper};
const ref={version_id:paper.id,quote_start:0,quote_end:21,quote:paper.text.slice(0,21),relation:'context'};
function output(){return {hypothesis_updates:[{id:'h1',claim:'Evidence is uncertain.',p_true:0.5,status:'open',rationale:'Observation is provisional.',evidence_refs:[ref]}],memory_updates:[{kind:'summary',text:'Keep the uncertainty explicit.',evidence_refs:[ref]}],next_questions:['Which published observations contradict this?'],lab_requests:[{hypothesis_id:'h1',question:'Compare published observations.',why_it_matters:'Resolve uncertainty.',goal_connection:'Improve understanding of human host response to guide prevention research.',competing_explanations:['Consistent observations','Contradictory observations'],evidence_needed:'Independent published observations.',limitations:'Literature comparison only.',priority:'high',evidence_refs:[ref],evidence_category:'literature_comparison',discriminating_outcomes:['consistent','contradictory']}],harness_proposal:{prioritizeRecent:true,searchApproach:'broaden',readingDepth:'full_text',papersPerCycle:1,researchFocus:'challenge_hypothesis',reason:'Seek recent eligible evidence.',expected_benefit:'Reduce repeated narrow searches.'}};}
function adapter(transform=v=>v){const inputs=[];return{model:'test-model',inputs,async complete(request){const {onResponse,...input}=request;inputs.push(structuredClone(input));const value=structuredClone(transform(request.name==='research_query'?{query:'uncertain'}:request.name==='select_papers'?{read_ids:["P0"]}:output(),request));if(request.name==='research_cycle'){for(const item of [...value.hypothesis_updates,...value.memory_updates,...value.lab_requests])item.evidence_refs=item.evidence_refs.map(ref=>{const span=request.context.sources.flatMap(s=>s.passages).find(p=>p.text.includes(ref.quote));return {quote_id:span&&(ref.version_id===paper.id||/^S[01]$/.test(ref.version_id))?span.quote_id:'unavailable',relation:ref.relation};});}return{value,tokens:100,responseId:'test-response'};}};}
async function march(model,store=new MemoryStore(),historicalResolver){const service=new ReplayService(store,{mongoProvider:provider,modelAdapter:model,historicalResolver});let pair=await service.create();const initial=await service.store.load();initial.pairs.find(p=>p.id===pair.id).modelConfig.monthlyStrategyReview=false;await service.store.save(initial);for(let m=1;m<3;m++){await service.step(pair.id,`month-${m}`);await service.advance(pair.id);}const state=await store.load();state.pairs.find(p=>p.id===pair.id).modelConfig.monthlyStrategyReview=false;await store.save(state);return {service,pair:await service.get(pair.id),store};}
test('research loop uses only read evidence, accumulates memory, freezes agenda, and isolates arms',async()=>{
 const model=adapter();const {service,pair}=await march(model);assert.equal(model.inputs.length,0);
 const result=await service.step(pair.id,'march');assert.equal(result.status,'checkpoint');assert.ok(model.inputs.every(i=>i.context.goal.includes('including vaccines')));
 for(const arm of result.arms){assert.equal(arm.hypotheses[0].revision,3);assert.equal(arm.memory.length,3);assert.equal(arm.researchRequests.length,3);assert.equal(arm.researchRequests[0].status,'pending_historical_resolver');assert.equal(arm.usage.modelTokens,900);assert.equal(arm.usage.labRequests,0);assert.ok(arm.memory.every(m=>m.sourceEventIds.length&&m.maxSourceAvailableAt===paper.availableAt));}
 const recursiveQueries=model.inputs.filter(i=>i.context.arm==='recursive'&&i.name==='research_query');assert.equal(recursiveQueries[0].context.strategy.searchApproach,'focused');assert.equal(recursiveQueries[1].context.strategy.searchApproach,'broaden');assert.equal(recursiveQueries[1].context.strategy.papersPerCycle,1);
 assert.ok(model.inputs.filter(i=>i.name==='select_papers').every(i=>i.schema.properties.read_ids.minItems===1&&i.schema.properties.read_ids.items.enum.includes('P0')));
 assert.equal(result.arms[0].harness.version,1);assert.equal(result.arms[1].harness.version,2);assert.equal(result.checkpoints.at(-1).snapshots[0].agenda.length,1);
 assert.ok(model.inputs.filter(i=>i.context.arm==='recursive').every(i=>i.context.memory.every(m=>!result.arms[0].events.some(e=>m.sourceEventIds.includes(e.id)))));
 const previous=JSON.stringify(result.checkpoints);await service.advance(pair.id);assert.equal(JSON.stringify((await service.get(pair.id)).checkpoints),previous);
 const count=model.inputs.length;await service.step(pair.id,'march');assert.equal(model.inputs.length,count);
});
test('future and fabricated citations fail without scientific memory updates',async()=>{
 for(const bad of [{...ref,version_id:'future-id'},{...ref,quote:'invented quotation'}]){
  const model=adapter((value,request)=>request.name==='research_cycle'?{...value,memory_updates:[{kind:'summary',text:'bad',evidence_refs:[bad]}]}:value);
  const {service,pair}=await march(model);const result=await service.step(pair.id,'march');assert.equal(result.status,'ready');assert.equal(result.arms[0].hypotheses.length,0);assert.equal(result.arms[0].memory.length,0);assert.equal(result.arms[0].readings.length,0);assert.equal(result.arms[0].modelBudget[3].calls,3);assert.ok(result.arms[0].events.some(e=>e.type==='cycle_failed'));
 }
});
test('completed cycles survive failed calls and retry, with reserved budget persisted',async()=>{
 const model=adapter();const complete=model.complete.bind(model);let fail=true;model.complete=async request=>{if(model.inputs.length===3&&fail){fail=false;throw new Error('secret provider error');}return complete(request);};
 const {service,pair,store}=await march(model);const partial=await service.step(pair.id,'march');assert.equal(partial.status,'ready');assert.equal(partial.arms[0].memory.length,1);assert.equal(partial.arms[0].modelBudget[3].calls,4);assert.ok(!JSON.stringify(partial).includes('secret provider error'));
 const restarted=new ReplayService(store,{mongoProvider:provider,modelAdapter:model});const done=await restarted.step(pair.id,'march');assert.equal(done.status,'checkpoint');assert.equal(done.arms[0].hypotheses[0].revision,3);assert.equal(done.arms[0].memory.length,3);assert.equal(done.arms[0].modelBudget[3].calls,10);
});
test('repeated invalid responses exhaust the bounded monthly model budget',async()=>{
 const model=adapter(()=>({query:7}));const {service,pair}=await march(model);for(let i=0;i<14;i++)await service.step(pair.id,`retry-${i}`);const saved=await service.get(pair.id);assert.equal(saved.arms[0].modelBudget[3].calls,12);assert.equal(model.inputs.length,12);assert.equal(saved.arms[0].memory.length,0);
});
test('OpenAI adapter sends strict schema without tools, disables storage, and rejects incomplete/refused results',async()=>{
 let payload;const model=new OpenAIModel({apiKey:'test-only',model:'test-model',fetchImpl:async(url,options)=>{assert.equal(url,'https://api.openai.com/v1/responses');payload=JSON.parse(options.body);return{ok:true,json:async()=>({id:'id',status:'completed',usage:{total_tokens:100},output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(output())}]}]})};}});
 await model.complete({name:'research_cycle',schema:cycleSchema,context:{sources:[paper]}});assert.equal(payload.store,false);assert.equal(payload.text.format.strict,true);assert.equal(payload.tools,undefined);
 for(const result of [{status:'incomplete'},{status:'completed',output:[{type:'message',content:[{type:'refusal'}]}]}]){model.fetch=async()=>({ok:true,json:async()=>result});await assert.rejects(()=>model.complete({name:'cycle',schema:cycleSchema,context:{}}));}
});

test('API quota errors are actionable without exposing provider response details',async()=>{
 const model=new OpenAIModel({apiKey:'test-only',model:'test-model',fetchImpl:async()=>({ok:false,status:429,json:async()=>({error:{type:'insufficient_quota',message:'secret diagnostic'}})})});
 await assert.rejects(()=>model.complete({name:'cycle',schema:cycleSchema,context:{}}),e=>e.message.includes('Add API credits')&&!e.message.includes('secret'));
});

test('raw inputs and outputs remain unchanged after citation normalization and later cycles',async()=>{
 const model=adapter((value,request)=>{if(request.name!=='research_cycle')return value;const raw=structuredClone(value);for(const item of [...raw.hypothesis_updates,...raw.memory_updates])for(const citation of item.evidence_refs){citation.version_id='S0';citation.quote_start=2;}return raw;});
 const {service,pair}=await march(model);const result=await service.step(pair.id,'raw-cache');assert.equal(result.status,'checkpoint');
 const events=result.arms[0].events;const raw=events.find(e=>e.type==='raw_model_response'&&e.payload.stage==='research_cycle').payload.response;
 assert.equal(raw.value.hypothesis_updates[0].evidence_refs[0].quote_id,'S0.Q0');assert.equal(raw.value.hypothesis_updates[0].evidence_refs[0].quote,undefined);
 assert.equal(result.arms[0].hypotheses[0].citations[0].quote_start,0);
 assert.equal(events.find(e=>e.type==='model_request').payload.context.hypotheses.length,0);
});

test('raw API response is captured even when incomplete and rejected',async()=>{
 const raw={id:'incomplete-test',status:'incomplete',output:[],usage:{total_tokens:12}};let saved;
 const model=new OpenAIModel({apiKey:'test-only',model:'test-model',fetchImpl:async()=>({ok:true,json:async()=>raw})});
 await assert.rejects(()=>model.complete({name:'cycle',schema:cycleSchema,context:{},onResponse:async response=>{saved=structuredClone(response);}}));
 assert.deepEqual(saved,raw);assert.ok(!JSON.stringify(saved).includes('test-only'));
});

test('unique exact quotations get server-derived offsets; ambiguous or paraphrased text is rejected',()=>{
 const wrong={...ref,quote_start:2};anchorCitations([wrong],[paper]);validateCitations([wrong],[paper]);assert.equal(wrong.quote_start,0);
 assert.throws(()=>anchorCitations([{...ref,quote:'paraphrase'}],[paper]));
 assert.throws(()=>anchorCitations([{...ref,quote:'same',quote_start:1,quote_end:2}],[{...paper,text:'same same'}]));
});

test('model source handles resolve only to the current cycle eligible sources',async()=>{
 const model=adapter((value,request)=>{if(request.name!=='research_cycle')return value;for(const item of [...value.hypothesis_updates,...value.memory_updates])for(const citation of item.evidence_refs)citation.version_id='S0';return value;});
 const {service,pair}=await march(model);const result=await service.step(pair.id,'march');assert.equal(result.status,'checkpoint');assert.equal(result.arms[0].hypotheses[0].citations[0].version_id,paper.id);assert.ok(model.inputs.filter(i=>i.name==='research_cycle').every(i=>i.context.sources[0].id==='S0'));
});

const card={id:'reviewed-test',corpusVersion:'test-corpus',versionId:paper.id,contentHash:paper.contentHash,availableAt:paper.availableAt,matchAll:['published','observations'],observation:'The published observation remains uncertain.',limitations:'Test observation; does not prove the hypothesis.',quoteStart:ref.quote_start,quote:ref.quote,review:{status:'reviewed',reviewer:'test curator'}};
test('reviewed historical feedback reaches the next cycle with citations, persists, and stays arm-local',async()=>{
 const model=adapter();const resolver=new HistoricalResolver([card]);const {service,pair,store}=await march(model,new MemoryStore(),resolver);
 const result=await service.step(pair.id,'feedback');assert.equal(result.status,'checkpoint');
 for(const arm of result.arms){assert.equal(arm.researchRequests[0].status,'resolved');assert.equal(arm.researchRequests[0].reviewStatus,'scientist_review_required');assert.equal(arm.usage.labRequests,2);assert.equal(arm.memory.filter(m=>m.provenance==='reviewed_historical_observation').length,2);const note=arm.memory.find(m=>m.provenance==='reviewed_historical_observation');assert.ok(arm.events.some(e=>e.id===note.sourceEventIds[0]&&e.type==='historical_observation'));}
 assert.ok(model.inputs.some(i=>i.context.researchProposals?.some(r=>r.result?.status==='resolved')));
 const restarted=new ReplayService(store,{mongoProvider:provider,modelAdapter:model,historicalResolver:resolver});assert.deepEqual((await restarted.get(pair.id)).checkpoints,result.checkpoints);
 for(const input of model.inputs){const other=result.arms.find(a=>a.name!==input.context.arm);assert.ok(input.context.memory.every(m=>!other.events.some(e=>m.sourceEventIds.includes(e.id))));}
});
test('historical resolver gates cards and sources independently and refuses altered quotes or hashes',async()=>{
 const pair={month:3,corpusVersion:'test-corpus'};const request={question:'Compare published observations.'};let reads=0;
 const reader={read:async()=>{reads++;return paper;}};
 assert.equal((await new HistoricalResolver([{...card,availableAt:'2020-04-01T00:00:00Z'}]).resolve(pair,request,reader)).status,'no_evidence');assert.equal(reads,0);
 assert.equal((await new HistoricalResolver([card]).resolve(pair,{question:'Unrelated question'},reader)).status,'no_evidence');assert.equal(reads,0);
 for(const bad of [{...card,contentHash:'wrong'},{...card,quote:'fabricated observation'},{...card,availableAt:'2020-03-01T00:00:00Z'}])await assert.rejects(()=>new HistoricalResolver([bad]).resolve(pair,request,reader));
 await assert.rejects(()=>new HistoricalResolver([card]).resolve(pair,request,{read:async()=>({...paper,availableAt:'2020-04-01T00:00:00Z'})}));
 assert.equal((await new HistoricalResolver([card]).resolve(pair,request,{read:async()=>{const e=new Error();e.status=404;throw e;}})).status,'no_evidence');
 assert.throws(()=>new HistoricalResolver([{...card,availableAt:'invalid'}]));assert.throws(()=>new HistoricalResolver([{...card,review:{status:'pending',reviewer:'test'}}]));
});
test('no evidence adds no scientific memory and is reconsidered after the month advances',async()=>{
 const model=adapter();const resolver=new HistoricalResolver([{...card,availableAt:'2020-04-01T00:00:00Z'}]);const {service,pair}=await march(model,new MemoryStore(),resolver);
 const marchResult=await service.step(pair.id,'march-feedback');assert.equal(marchResult.arms[0].researchRequests[0].status,'no_evidence');assert.equal(marchResult.arms[0].memory.length,3);
 const frozen=JSON.stringify(marchResult.checkpoints);await service.advance(pair.id);const april=await service.step(pair.id,'april-feedback');assert.equal(april.arms[0].researchRequests[0].status,'resolved');assert.equal(JSON.stringify(april.checkpoints.slice(0,3)),frozen);
});
test('uncited or non-discriminating proposals reject the entire research update',async()=>{
 for(const field of ['evidence_refs','competing_explanations','discriminating_outcomes']){
  const model=adapter((value,request)=>{if(request.name==='research_cycle'){value=structuredClone(value);value.lab_requests[0][field]=[];}return value;});const {service,pair}=await march(model);const result=await service.step(pair.id,'bad-proposal');assert.equal(result.status,'ready');assert.equal(result.arms[0].hypotheses.length,0);assert.equal(result.arms[0].researchRequests.length,0);
 }
});

test('complete extracted paper reaches synthesis and tail citations survive beyond the old 10000-character limit',async()=>{
 const full={...paper,contentScope:'full_text',text:paper.text+'\n'+('Background text. '.repeat(900))+'\nDiscussion: uncertainty needs further study.',paragraphs:[{section:'Methods'},{section:'Discussion'}]};
 const tail='uncertainty needs further study.';const citation={...ref,quote:tail,quote_start:full.text.indexOf(tail),quote_end:full.text.indexOf(tail)+tail.length};
 const model=adapter((value,request)=>{if(request.name==='research_cycle'){value=structuredClone(value);for(const item of [...value.hypothesis_updates,...value.memory_updates,...value.lab_requests])item.evidence_refs=[citation];}return value;});
 const service=new ReplayService(new MemoryStore(),{mongoProvider:{...provider,search:async()=>[full],read:async()=>full},modelAdapter:model});let pair=await service.create();const initial=await service.store.load();initial.pairs.find(p=>p.id===pair.id).modelConfig.monthlyStrategyReview=false;await service.store.save(initial);for(let m=1;m<3;m++){await service.step(pair.id,'full-'+m);await service.advance(pair.id);}pair=await service.step(pair.id,'full-march');assert.equal(pair.status,'checkpoint');
 assert.ok(model.inputs.filter(i=>i.name==='research_cycle').every(i=>i.context.sources[0].passages.map(p=>p.text).join('')===full.text));assert.ok(pair.arms.every(a=>a.readings[0].readingCoverage==='complete_extracted_text'&&a.readings[0].textCharacters===full.text.length));assert.ok(pair.arms[0].hypotheses[0].citations[0].quote_start>10000);
});
test('oversized papers fail visibly instead of becoming truncated scientific readings',async()=>{
 const full={...paper,contentScope:'full_text',text:'x'.repeat(90000)};const model=adapter();const service=new ReplayService(new MemoryStore(),{mongoProvider:{...provider,search:async()=>[full],read:async()=>full},modelAdapter:model});let pair=await service.create();const initial=await service.store.load();initial.pairs.find(p=>p.id===pair.id).modelConfig.monthlyStrategyReview=false;await service.store.save(initial);for(let m=1;m<3;m++){await service.step(pair.id,'large-'+m);await service.advance(pair.id);}pair=await service.step(pair.id,'large-march');assert.equal(pair.status,'ready');assert.equal(pair.arms[0].readings.length,0);assert.equal(pair.arms[0].hypotheses.length,0);assert.match(pair.arms[0].events.at(-1).payload.message,/Complete paper exceeds/);assert.ok(!model.inputs.some(i=>i.name==='research_cycle'));
});

test('oversized full-text previews fall back to eligible abstracts before paid selection',async()=>{
 const large={...paper,id:'large',contentScope:'full_text',text:'x'.repeat(90000),textBytes:90000};let fallback=0;const p={...provider,search:async()=>[large],searchAbstracts:async()=>{fallback++;return[paper];},read:async(pair,id)=>id==='large'?large:paper};const model=adapter(),service=new ReplayService(new MemoryStore(),{mongoProvider:p,modelAdapter:model});let run=await service.create();const initial=await service.store.load();initial.pairs.find(p=>p.id===run.id).modelConfig.monthlyStrategyReview=false;await service.store.save(initial);for(let m=1;m<3;m++){await service.step(run.id,'fit-'+m);await service.advance(run.id);}run=await service.step(run.id,'fit-march');assert.equal(run.status,'checkpoint');assert.equal(fallback,6);assert.ok(run.arms.every(a=>a.readings.every(r=>r.id!=='large')));assert.ok(model.inputs.filter(i=>i.name==='select_papers').every(i=>i.context.candidates.every(p=>p.title===paper.title&&p.contentScope==='abstract')));
});

test('a failed execution trial restores its parent strategy without changing fixed policy',async()=>{
 const model=adapter();const complete=model.complete.bind(model);let recursiveQueries=0;
 model.complete=async request=>{if(request.context.arm==='recursive'&&request.name==='research_query'&&++recursiveQueries===2)throw new Error('trial failure');return complete(request);};
 const {service,pair}=await march(model);const result=await service.step(pair.id,'trial');
 assert.equal(result.arms[0].harness.version,1);assert.equal(result.arms[1].harness.version,1);
 assert.ok(result.arms[1].events.some(e=>e.type==='harness_rollback'));assert.equal(result.arms[1].memory.length,1);
});

test('explicit 1000-call run override retains usage and the global default',async()=>{
 const model=adapter(()=>({query:7}));const {service,pair,store}=await march(model);
 const state=await store.load();state.pairs.find(p=>p.id===pair.id).modelConfig.executionOverrides={callsPerMonth:1000};await store.save(state);
 for(let i=0;i<14;i++)await service.step(pair.id,`uncapped-${i}`);
 const saved=await service.get(pair.id);assert.equal(saved.arms[0].modelBudget[3].calls,14);assert.equal(saved.arms[0].memory.length,0);assert.equal(saved.modelConfig.budget.callsPerMonth,12);
});
