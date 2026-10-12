import {ReplayError} from '../errors.js';
export const strategyDefaults={prioritizeRecent:false,searchApproach:'focused',readingDepth:'full_text',papersPerCycle:2,researchFocus:'balanced'};
export const strategyProperties={prioritizeRecent:{type:'boolean'},searchApproach:{type:'string',enum:['focused','broaden']},readingDepth:{type:'string',enum:['full_text','abstract_screen']},papersPerCycle:{type:'integer',minimum:1,maximum:2},researchFocus:{type:'string',enum:['balanced','challenge_hypothesis','resolve_gap']}};
export function strategyConfig(config){
 if(!config||Object.keys(config).some(k=>!Object.hasOwn(strategyProperties,k)))throw new ReplayError('Strategy contains an unsupported setting',422);
 const result={...strategyDefaults,...config};
 for(const [key,spec] of Object.entries(strategyProperties)){const value=result[key];if(spec.enum?!spec.enum.includes(value):spec.type==='boolean'?typeof value!=='boolean':!Number.isInteger(value)||value<1||value>2)throw new ReplayError('Strategy setting is outside its bounds',422);}
 return result;
}
export function strategyFeedback(arm){
 const events=arm.events.slice(-60);
 return {recentRetrievals:events.filter(e=>e.type==='retrieval').slice(-3).map(e=>({query:e.payload.query,candidates:e.payload.evidenceRefs.length})),recentDeferrals:events.filter(e=>['paper_deferred','reading_budget_fallback'].includes(e.type)).length,recentFailures:events.filter(e=>e.type==='cycle_failed').slice(-2).map(e=>e.payload.message),unresolvedHypotheses:arm.hypotheses.filter(h=>h.status==='open').length,recentReadings:arm.readings.slice(-4).map(r=>({contentScope:r.contentScope})),restriction:'Process feedback only; no evaluator scores or claims of scientific improvement.'};
}
export function strategyTask(config){return config.researchFocus==='challenge_hypothesis'?'Seek published evidence that could contradict an existing hypothesis.':config.researchFocus==='resolve_gap'?'Prioritize the oldest unresolved question or missing evidence.':'Balance new findings with unresolved hypotheses.';}
