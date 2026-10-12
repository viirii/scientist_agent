import {passageCatalog,passageSchema,resolvePassages} from './passages.js';
import {retrieveCandidates,rankCandidates} from './retrieval.js';
import { longTermGoal } from '../mission.js';
import { randomUUID } from 'node:crypto';
import { cutoffFor } from '../fixtures.js';
import { ReplayError } from '../errors.js';
import { querySchema,selectionSchema,cycleSchema,validate,validateCitations,anchorCitations } from './contracts.js';
import { promptHash } from './model.js';
import { resolveRequests } from './historical.js';
export const reasoningBudget={callsPerMonth:12,tokenUnitsPerMonth:1100000,contextBytes:80000,outputTokens:4096,readPapersPerCycle:2};
const briefRefs=refs=>(refs||[]).map(({version_id,relation})=>({version_id,relation}));
const promptHypothesis=h=>({...h,citations:briefRefs(h.citations)});
const promptMemory=m=>({...m,citations:briefRefs(m.citations)});
const promptProposal=r=>({...r,evidence_refs:briefRefs(r.evidence_refs),...(r.result?{result:{status:r.result.status,interpretation:r.result.interpretation,checkedCutoff:r.result.checkedCutoff,observations:r.result.observations.map(o=>({observation:o.observation,limitations:o.limitations,sourceId:o.citation.version_id}))}}:{})});
export async function runReasoningCycle(pair,arm,provider,model,record,persist=async()=>{},resolver) {
 arm.agenda||=[];arm.researchRequests||=[];arm.modelBudget||={};arm.readings||=[];
 const budget=arm.modelBudget[pair.month]||={calls:0,reservedTokenUnits:0};
 const context={cutoff:cutoffFor(pair.month),goal:longTermGoal,runFocus:pair.goal,arm:arm.name,harness:arm.harness,
  hypotheses:arm.hypotheses.slice(-12).map(promptHypothesis),memory:arm.memory.slice(-12).map(promptMemory),agenda:arm.agenda};
 async function call(name,schema,extra){
  const input={...context,...extra};const bytes=Buffer.byteLength(JSON.stringify(input)+JSON.stringify(schema));
  const reserved=bytes+Buffer.byteLength('instructions')+4000+reasoningBudget.outputTokens;
  if(bytes>reasoningBudget.contextBytes)throw new ReplayError('Research context exceeds the 80KB limit; no call made.',429);
  if(budget.calls>=reasoningBudget.callsPerMonth||budget.reservedTokenUnits+reserved>reasoningBudget.tokenUnitsPerMonth)throw new ReplayError('Monthly model budget exhausted. Advance only after completing the checkpoint, or start a new run.',429);
  budget.calls++;budget.reservedTokenUnits+=reserved;
  record(arm,pair,'model_request',{stage:name,promptHash,model:pair.modelConfig.model,reservedTokenUnits:reserved,context:structuredClone(input),schema:structuredClone(schema),maxOutputTokens:reasoningBudget.outputTokens});
  await persist(); // Charge/reserve before the network call; a crash cannot erase this attempt.
  let rawRecorded=false;
  const result=await model.complete({name,schema,context:input,maxOutputTokens:reasoningBudget.outputTokens,onResponse:async response=>{
   rawRecorded=true;record(arm,pair,'raw_model_response',{stage:name,format:'openai_response',response:structuredClone(response)});await persist();
  }});
  if(!rawRecorded){record(arm,pair,'raw_model_response',{stage:name,format:'parsed_adapter_output',response:structuredClone(result)});await persist();}
  validate(schema,result.value);
  arm.usage.modelTokens+=result.tokens;record(arm,pair,'model_response',{stage:name,responseId:result.responseId||null,tokens:result.tokens,model:result.model||pair.modelConfig.model});return result.value;
 }
 try {
  await resolveRequests(pair,arm,provider,resolver,record);
  context.memory=arm.memory.slice(-12).map(promptMemory);
  context.researchProposals=arm.researchRequests.slice(-6).map(promptProposal);
  await persist();
  if(!(await provider.counts(pair)).papers){record(arm,pair,'no_new_evidence',{summary:'No eligible evidence. Reasoning skipped; no model call or hypothesis generated.'});arm.cycles++;record(arm,pair,'cycle_completed',{});return true;}
  const {query}=await call('research_query',querySchema,{task:'Choose a short keyword search to advance the goal or test an unresolved hypothesis. Empty query is allowed.'});
  const retrieved=await retrieveCandidates(provider,pair,query,arm.readings.map(r=>r.id));
  let candidates=rankCandidates(retrieved.candidates,arm.harness.config);arm.usage.retrievalCalls+=retrieved.searches.length;
  const baseBytes=Buffer.byteLength(JSON.stringify(context))+Buffer.byteLength(JSON.stringify(cycleSchema))+6000;
  candidates=candidates.filter(p=>!p.textBytes||p.textBytes*1.4+baseBytes<=reasoningBudget.contextBytes);
  if(!candidates.length&&retrieved.candidates.length&&provider.searchAbstracts){candidates=await provider.searchAbstracts(pair,retrieved.searches.at(-1).query,arm.readings.map(r=>r.id));arm.usage.retrievalCalls++;record(arm,pair,'reading_budget_fallback',{reason:'Available full papers exceed the context budget; select eligible abstracts instead.'});}
  record(arm,pair,'retrieval',{query,searches:retrieved.searches,evidenceRefs:candidates.map(p=>p.id)});
  if(!candidates.length){arm.cycles++;record(arm,pair,'cycle_completed',{summary:'No unread eligible source found.'});return true;}
  const choices=candidates.slice(0,10);
  const {read_ids}=await call('select_papers',selectionSchema,{task:'Prefer an eligible full-text paper over an abstract. Select one paper for a complete reading, or two short papers. Full text cannot be accessed before its own availability date. Return only the short listed IDs P0, P1, etc.',candidates:choices.map((p,index)=>({id:`P${index}`,title:p.title,abstract:p.text.slice(0,600),contentScope:p.contentScope,availableAt:p.availableAt,textBytes:p.textBytes}))});
  if(!read_ids.length||new Set(read_ids).size!==read_ids.length||read_ids.some(id=>!/^P[0-9]$/.test(id)||!choices[Number(id.slice(1))]))throw new ReplayError('Model selected an unavailable paper',422);
  const sources=[];const readEvents=[];
  for(const choice of read_ids){const id=choices[Number(choice.slice(1))].id;const paper=await provider.read(pair,id);if(paper.id!==id||!Number.isFinite(new Date(paper.availableAt).getTime())||new Date(paper.availableAt)>new Date(cutoffFor(pair.month)))throw new ReplayError('Evidence violates historical cutoff',422);
   const source={id:paper.id,title:paper.title,text:paper.text,availableAt:paper.availableAt,contentHash:paper.contentHash,contentScope:paper.contentScope,truncated:false,readingCoverage:paper.contentScope==='full_text'?'complete_extracted_text':'abstract_only',sections:[...new Set((paper.paragraphs||[]).map(p=>p.section).filter(Boolean))],textCharacters:paper.text.length};
   const projected={...context,sources:[...sources,source]};
   if(Buffer.byteLength(JSON.stringify(projected))+Buffer.byteLength(JSON.stringify(cycleSchema))+6000>reasoningBudget.contextBytes){if(sources.length){record(arm,pair,'paper_deferred',{id,reason:'Full text does not fit with the first paper; leave unread for a later cycle.'});continue;}throw new ReplayError('Complete paper exceeds this run’s context limit; no truncated reading or scientific update accepted.',422);}
   sources.push(source);
   readEvents.push(record(arm,pair,'paper_read',{...source,text:undefined,evidenceRefs:[id]}));
  }
  const catalog=passageCatalog(sources);
  const output=resolvePassages(await call('research_cycle',passageSchema(catalog),{task:'Keep the response concise: one or two hypotheses and memory notes, with exact passage citations. Update cited findings and hypotheses, ask next questions and propose high-level discriminating published-evidence checks. All research must serve the supplied long-term goal. Each proposal must state goal_connection explaining how answering it advances understanding of human disease, treatment or prevention without claiming a treatment or vaccine is proven. Each proposal must state why it matters, at least two competing explanations and two possible discriminating outcomes, evidence needed, priority and limitations, citing the papers that motivate it. These are scientist-review proposals, not executable wet-lab instructions; no protocols, doses, sequences, pathogen manipulation or invented results. Use previous historical observations and limitations to refine the next question; no_evidence means an unresolved gap, not a negative result. Read the entire supplied text, including methods, results, discussion and future directions when present. State when only an abstract is available; do not invent missing methods or findings. Distinguish author observations, author future directions and your own inferences. Ground every hypothesis, memory update and proposal in the provided read excerpts; evidence-backed inference does not mean experimentally established. Cite only the exact quote_id of a supplied passage. Do not type quotations or count character offsets. Each passage is exact extracted source text; cite a passage only when its content actually supports your statement. Harness proposal must be null for the fixed arm.',sources:sources.map((source,index)=>{const {text,...metadata}=source;return {...metadata,id:`S${index}`,passages:catalog.filter(p=>p.versionId===source.id).map(({id,text})=>({quote_id:id,text}))};})}),catalog,sources);
  for(const update of [...output.hypothesis_updates,...output.memory_updates,...output.lab_requests])for(const ref of update.evidence_refs){if(/^S[01]$/.test(ref.version_id)&&sources[Number(ref.version_id.slice(1))])ref.version_id=sources[Number(ref.version_id.slice(1))].id;}
  for(const h of output.hypothesis_updates)validateCitations(anchorCitations(h.evidence_refs,sources),sources);
  for(const m of output.memory_updates)validateCitations(anchorCitations(m.evidence_refs,sources),sources);
  for(const request of output.lab_requests){validateCitations(anchorCitations(request.evidence_refs,sources),sources);if(request.competing_explanations.length<2||request.discriminating_outcomes.length<2)throw new ReplayError('Research proposals require competing explanations and discriminating outcomes',422);}
  if(new Set(output.hypothesis_updates.map(h=>h.id)).size!==output.hypothesis_updates.length)throw new ReplayError('Duplicate hypothesis IDs',422);
  const known=new Set([...arm.hypotheses.map(h=>h.id),...output.hypothesis_updates.map(h=>h.id)]);
  if(output.lab_requests.some(r=>!known.has(r.hypothesis_id)))throw new ReplayError('Evidence request references unknown hypothesis',422);
  // Apply only after the whole cycle validates. Model output cannot write policy, dates or events.
  for(const source of sources)if(!arm.readings.some(r=>r.id===source.id))arm.readings.push({id:source.id,title:source.title,evidenceRefs:[source.id],firstCutoff:context.cutoff,availableAt:source.availableAt,excerpt:source.text.slice(0,400),contentScope:source.contentScope,readingCoverage:source.readingCoverage,textCharacters:source.textCharacters,sections:source.sections,provenance:'read_from_cord19'});
  for(const h of output.hypothesis_updates){const old=arm.hypotheses.find(v=>v.id===h.id);const updated={id:h.id,claim:h.claim,pTrue:h.p_true,status:h.status,rationale:h.rationale,citations:h.evidence_refs,evidenceRefs:[...new Set(h.evidence_refs.map(r=>r.version_id))],firstCutoff:old?.firstCutoff||context.cutoff,revision:(old?.revision||0)+1,provenance:'model_inference'};
   if(old)Object.assign(old,updated);else arm.hypotheses.push(updated);record(arm,pair,'hypothesis_revision',updated);
  }
  for(const m of output.memory_updates){const refs=[...new Set(m.evidence_refs.map(r=>r.version_id))];const item={month:pair.month,kind:m.kind,text:m.text,citations:m.evidence_refs,evidenceRefs:refs,sourceEventIds:readEvents.filter(e=>refs.includes(e.payload.id)).map(e=>e.id),maxSourceAvailableAt:sources.filter(p=>refs.includes(p.id)).map(p=>p.availableAt).sort().at(-1),provenance:'model_summary'};arm.memory.push(item);record(arm,pair,'memory_update',item);}
  arm.agenda=output.next_questions;
  for(const request of output.lab_requests){const item={id:randomUUID(),...request,month:pair.month,cutoff:context.cutoff,status:'pending_historical_resolver',provenance:'proposed_evidence_check',reviewStatus:'scientist_review_required'};arm.researchRequests.push(item);record(arm,pair,'research_request',item);}
  if(output.harness_proposal){if(arm.name==='fixed')record(arm,pair,'harness_rejected',{reason:'Fixed arm workflow is immutable.'});else{
   const proposal=output.harness_proposal;const parent=structuredClone(arm.harness);const config={prioritizeRecent:proposal.prioritizeRecent};
   record(arm,pair,'harness_promotion',{parent:parent.version,version:parent.version+1,config,reason:proposal.reason,validation:'Bounded ranking preference only; no scientific performance claim.',evidenceRefs:sources.map(s=>s.id)});
   arm.harness={version:parent.version+1,config,parent};
  }}
  arm.cycles++;record(arm,pair,'cycle_completed',{});return true;
 }catch(error){if(arm.name==='recursive'&&arm.harness.parent){const failed=arm.harness.version;arm.harness=arm.harness.parent;record(arm,pair,'harness_rollback',{failedVersion:failed,restoredVersion:arm.harness.version,reason:'Research cycle failed; restore prior bounded policy.'});}
  record(arm,pair,'cycle_failed',{message:error instanceof ReplayError?error.message:'Research cycle failed; no scientific update accepted.',retryable:budget.calls<reasoningBudget.callsPerMonth});return false;}
}
