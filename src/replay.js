import {reviewLastMonth} from './monthly-review.js';
import { runReasoningCycle, reasoningBudget } from './agent/loop.js';
import { promptHash } from './agent/model.js';
import { randomUUID, createHash } from 'node:crypto';
import { papers, cutoffFor, corpusVersion } from './fixtures.js';
import { TemporalGateway } from './gateway.js';
import { evaluate } from './evaluator.js';
import { ReplayError } from './errors.js';
export { ReplayError } from './errors.js';
import { longTermGoal } from './mission.js';
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function event(arm, pair, type, payload) {
  const item = { id: randomUUID(), seq: arm.events.length + 1, cycle: arm.cycles + 1,
    month: pair.month, simCutoff: cutoffFor(pair.month), createdAt: new Date().toISOString(), type, payload: structuredClone(payload) };
  arm.events.push(item); return item;
}
function runCycle(pair, arm) {
  const gateway = new TemporalGateway(papers, cutoffFor(pair.month));
  // Recorded deterministic policy is deliberately simple. Both arms get identical evidence.
  const candidates = gateway.search('fixture', 10).filter(p => !arm.hypotheses.some(h => h.id === p.id));
  candidates.sort((a, b) => a.availableAt.localeCompare(b.availableAt));
  // The recursive arm proposes recency prioritization after its first cycle, within a fixed whitelist.
  if (arm.harness.config.prioritizeRecent) candidates.reverse();
  const source = candidates[0];
  event(arm, pair, 'retrieval', { query: 'fixture', evidenceRefs: gateway.search('fixture', 10).map(p => p.id) });
  if (source) {
    const observation = gateway.resolve(source.id);
    gateway.validateRefs(observation.evidenceRefs);
    const observed = event(arm, pair, 'historical_evidence', { requestId: randomUUID(), sourceId: source.id, ...observation });
    const hypothesis = { id: source.id, claim: source.claim, pTrue: observation.status === 'supported' ? 0.85 : 0.15,
      evidenceRefs: observation.evidenceRefs, firstCutoff: cutoffFor(pair.month), revision: 1, provenance: 'read_from_fixture' };
    arm.hypotheses.push(hypothesis);
    event(arm, pair, 'hypothesis_revision', hypothesis);
    arm.memory.push({ text: `Recorded eligible evidence for ${source.id}.`, sourceEventIds: [observed.id], evidenceRefs: observation.evidenceRefs, maxSourceAvailableAt: source.availableAt });
  } else event(arm, pair, 'no_new_evidence', { summary: 'No unrecorded eligible source in bounded retrieval window.' });
  if (arm.name === 'recursive' && arm.harness.version === 1) {
    const proposal = { prioritizeRecent: true };
    const validated = validateHarness(proposal);
    event(arm, pair, 'harness_promotion', { parent: 1, version: 2, config: validated, reason: 'Fixture procedural lesson: prioritize recent eligible sources.', validation: 'Whitelist and type checks passed; no benchmark feedback.' });
    arm.harness = { version: 2, config: validated };
  }
  arm.cycles++; arm.usage.retrievalCalls++; arm.usage.labRequests += Number(Boolean(source));
}
async function runMongoCycle(pair,arm,provider) {
  arm.readings ||= [];
  const candidates=await provider.search(pair,'',arm.readings.map(item=>item.id));
  candidates.sort((a,b)=>a.availableAt.localeCompare(b.availableAt)||a.id.localeCompare(b.id));
  if(arm.harness.config.prioritizeRecent)candidates.reverse();
  event(arm,pair,'retrieval',{query:'',source:'cord19_mongo',evidenceRefs:candidates.map(p=>p.id)});
  const source=candidates[0];
  if(source) {
    // Re-read through the same gated path; never turn title/abstract ingestion into an inferred result.
    const paper=await provider.read(pair,source.id);
    const observed=event(arm,pair,'paper_read',{sourceId:paper.id,title:paper.title,evidenceRefs:[paper.id],availableAt:paper.availableAt,contentHash:paper.contentHash});
    const reading={id:paper.id,title:paper.title,evidenceRefs:[paper.id],firstCutoff:cutoffFor(pair.month),availableAt:paper.availableAt,excerpt:paper.text.slice(0,400),provenance:'read_from_cord19'};
    arm.readings.push(reading);
    arm.memory.push({text:`Read eligible CORD-19 paper: ${paper.title}`,sourceEventIds:[observed.id],evidenceRefs:[paper.id],maxSourceAvailableAt:paper.availableAt});
  } else event(arm,pair,'no_new_evidence',{summary:'No unrecorded eligible abstract in this search. The starter corpus has no January/February records.'});
  if(arm.name==='recursive'&&arm.harness.version===1&&source) {
    const config=validateHarness({prioritizeRecent:true});
    event(arm,pair,'harness_promotion',{parent:1,version:2,config,reason:'Demonstration policy: prefer recent eligible abstracts within the bounded retrieval window.',validation:'Whitelist checks only. No model-generated improvement or benchmark feedback.'});
    arm.harness={version:2,config};
  }
  arm.cycles++;arm.usage.retrievalCalls++;
}
export function validateHarness(config) {
  if (!config || Object.keys(config).length !== 1 || typeof config.prioritizeRecent !== 'boolean') throw new ReplayError('Harness config violates immutable policy');
  return { prioritizeRecent: config.prioritizeRecent };
}
export class ReplayService {
  constructor(store,{mongoProvider,modelAdapter,historicalResolver,monthlyReviewer}={}) { this.store = store; this.mongoProvider=mongoProvider; this.modelAdapter=modelAdapter; this.historicalResolver=historicalResolver;this.monthlyReviewer=monthlyReviewer; this.queue = Promise.resolve(); }
  runtime() { return {defaultMode:this.mongoProvider?'mongo_corpus':'synthetic_fixture',corpusVersion:this.mongoProvider?.corpusVersion||corpusVersion,baselineCorpusVersion:this.mongoProvider?.baselineCorpusVersion||null,agentEngine:this.modelAdapter?'model_researcher':'deterministic_reader',stateStorage:this.store.kind||'local_file',longTermGoal}; }
  provider(pair) { if(!this.mongoProvider)throw new ReplayError('Mongo evidence access is not configured.',503);return this.mongoProvider; }
  // Every mutation uses a fresh copy and persists only on success. Failed saves do not advance state.
  mutate(fn) {
    const operation = async () => { const state = await this.store.load(true); const result = await fn(state); await this.store.save(state); return structuredClone(result); };
    const work = this.queue.then(()=>this.store.withLease?this.store.withLease(operation):operation());
    this.queue = work.catch(() => {}); return work;
  }
  async list() { await this.queue; return (await this.store.load()).pairs; }
  async get(id) { const pair = (await this.list()).find(p => p.id === id); if (!pair) throw new ReplayError('Pair not found', 404); return pair; }
  create() {
    return this.mutate(async state => {
      if(this.mongoProvider)await this.mongoProvider.ready();
      const pair = { id: randomUUID(), mode: this.mongoProvider?'mongo_corpus':'synthetic_fixture', corpusVersion:this.runtime().corpusVersion, ...(this.mongoProvider?.baselineCorpusVersion?{baselineCorpusVersion:this.mongoProvider.baselineCorpusVersion}:{}), agentEngine:this.runtime().agentEngine, ...(this.modelAdapter?{modelConfig:{model:this.modelAdapter.model,reasoningEffort:this.modelAdapter.reasoningEffort||null,promptHash,budget:reasoningBudget},goal:longTermGoal}:{}), month: 1, status: 'ready', createdAt: new Date().toISOString(), checkpoints: [], requests: {},
        arms: ['fixed', 'recursive'].map(name => ({ name, cycles: 0, hypotheses: [], readings:[], memory: [], events: [], usage: { retrievalCalls: 0, labRequests: 0, modelTokens: 0 }, harness: { version: 1, config: { prioritizeRecent: false } } })) };
      state.pairs.push(pair); return pair;
    });
  }
  step(id, key) {
    if (typeof key !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(key)) throw new ReplayError('Valid Idempotency-Key required');
    return this.mutate(async state => {
      const pair = state.pairs.find(p => p.id === id); if (!pair) throw new ReplayError('Pair not found', 404);
      if (Object.hasOwn(pair.requests, key)) return pair;
      if (pair.status !== 'ready') throw new ReplayError('Advance the checkpoint before running another month', 409);
      if(pair.agentEngine==='model_researcher'&&pair.modelConfig.budget.tokenUnitsPerMonth!==reasoningBudget.tokenUnitsPerMonth){for(const arm of pair.arms)event(arm,pair,'execution_budget_update',{previous:pair.modelConfig.budget,next:reasoningBudget,reason:'Align conservative byte-based reservations with the unchanged 12-call and 80KB context ceilings; retain all prior reservations.'});pair.modelConfig.budget=structuredClone(reasoningBudget);await this.store.save(state);}
      for (const arm of pair.arms) for (let i = 0; i < 3; i++) {
        if(pair.agentEngine==='model_researcher'){
          if(!this.modelAdapter||this.modelAdapter.model!==pair.modelConfig.model||pair.modelConfig.promptHash!==promptHash)throw new ReplayError('This saved run requires its configured research model.',503);
          if(arm.events.filter(e=>e.month===pair.month&&e.type==='cycle_completed').length>=3)break;
          if(!await runReasoningCycle(pair,arm,this.provider(pair),this.modelAdapter,event,()=>this.store.save(state),this.historicalResolver))return pair;
          await this.store.save(state); // Paid successful cycles survive a later failure and retry.
        }else if(pair.mode==='mongo_corpus')await runMongoCycle(pair,arm,this.provider(pair));else runCycle(pair,arm);
      }
      const snapshots = pair.arms.map(arm => {
        const snapshot = { arm: arm.name, cutoff: cutoffFor(pair.month), month: pair.month, lastSeq: arm.events.length,
          agenda:structuredClone(arm.agenda||[]),researchRequests:structuredClone(arm.researchRequests||[]), hypotheses: structuredClone(arm.hypotheses), readings:structuredClone(arm.readings||[]), memory: structuredClone(arm.memory), harness: structuredClone(arm.harness), usage: structuredClone(arm.usage) };
        return { ...snapshot, stateHash: hash(snapshot) };
      });
      pair.checkpoints.push({ month: pair.month, cutoff: cutoffFor(pair.month), snapshots,
        scores: pair.mode==='mongo_corpus'?[]:snapshots.map(snapshot => ({ arm: snapshot.arm, ...evaluate(snapshot, papers) })),
        ...(pair.mode==='mongo_corpus'?{corpusAccess:await this.provider(pair).counts(pair),evaluation:{status:'not_configured',reason:'Reviewed historical benchmark and outcome cards are pending.'}}:{}) });
      pair.status = pair.month === 12 ? 'complete' : 'checkpoint';
      pair.requests[key] = pair.month;
      if(this.monthlyReviewer&&pair.mode==='mongo_corpus'){try{await reviewLastMonth(pair,pair.month,this.provider(pair),this.monthlyReviewer,()=>this.store.save(state));}catch(error){pair.monthlyReviews[pair.month].error=error instanceof ReplayError?error.message:'Monthly review failed; research checkpoint preserved.';}}
      return pair;
    });
  }
  review(id,month) {return this.mutate(async state=>{const pair=state.pairs.find(p=>p.id===id);if(!pair)throw new ReplayError('Pair not found',404);if(pair.mode!=='mongo_corpus'||!this.modelAdapter)throw new ReplayError('Literature review requires model and Mongo access',400);await reviewLastMonth(pair,month,this.provider(pair),this.modelAdapter,()=>this.store.save(state));return pair;});}
  advance(id) {
    return this.mutate(state => {
      const pair = state.pairs.find(p => p.id === id); if (!pair) throw new ReplayError('Pair not found', 404);
      if (pair.status !== 'checkpoint' || pair.checkpoints.at(-1)?.snapshots.length !== 2) throw new ReplayError('Both frozen checkpoints are required before advance', 409);
      pair.month++; pair.status = 'ready'; return pair;
    });
  }
  async evidence(id, sourceId) { const pair = await this.get(id); return pair.mode==='mongo_corpus'?this.provider(pair).read(pair,sourceId):new TemporalGateway(papers, cutoffFor(pair.month)).read(sourceId); }
  async corpus(id,query='') {
    const pair=await this.get(id);
    if(pair.mode!=='mongo_corpus')throw new ReplayError('Paper browsing is available for Mongo runs only.',409);
    const provider=this.provider(pair);return {cutoff:cutoffFor(pair.month),corpusVersion:pair.corpusVersion,...await provider.counts(pair),results:await provider.search(pair,query)};
  }
  async chunk(id,sourceId) { const pair=await this.get(id);if(pair.mode!=='mongo_corpus')throw new ReplayError('Evidence unavailable',404);return this.provider(pair).chunk(pair,sourceId); }
}
