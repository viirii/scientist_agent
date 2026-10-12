import test from 'node:test';
import assert from 'node:assert/strict';
import {strategyConfig,strategyFeedback,strategyTask} from '../src/agent/strategy.js';
import {retrieveCandidates} from '../src/agent/retrieval.js';
test('strategy settings cannot expand capabilities or budgets',()=>{
 assert.equal(strategyConfig({prioritizeRecent:false}).papersPerCycle,2);
 for(const value of [{tools:true},{papersPerCycle:3},{readingDepth:'protocol'},{researchFocus:'future_results'}])assert.throws(()=>strategyConfig(value));
 assert.match(strategyTask(strategyConfig({researchFocus:'challenge_hypothesis'})),/contradict/);
});
test('broaden strategy searches even after a hit and deduplicates results',async()=>{
 const calls=[];const provider={search:async(p,q)=>{calls.push(q);return [{id:'same'}];}};
 await retrieveCandidates(provider,{},'antibody response',[],{searchApproach:'focused'});assert.deepEqual(calls,['antibody response']);calls.length=0;
 const result=await retrieveCandidates(provider,{},'antibody response',[],{searchApproach:'broaden'});assert.deepEqual(calls,['antibody response','antibody']);assert.equal(result.candidates.length,1);
});
test('process feedback excludes evaluator scores and raw evidence',()=>{
 const feedback=strategyFeedback({events:[{type:'evaluation',payload:{score:999}},{type:'retrieval',payload:{query:'host',evidenceRefs:[]}}],hypotheses:[{status:'open'}],readings:[]});
 assert.equal(feedback.unresolvedHypotheses,1);assert.equal(feedback.recentRetrievals[0].candidates,0);assert.ok(!JSON.stringify(feedback).includes('999'));
});
