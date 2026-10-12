import test from 'node:test';import assert from 'node:assert/strict';
import {retrieveCandidates,rankCandidates} from '../src/agent/retrieval.js';
test('zero-result query broadens within the topic with identical run and exclusions',async()=>{
 const seen=[],pair={month:1},exclude=['read'];const provider={search:async(p,q,e)=>{seen.push({p,q,e});return q==='vaccine'?[{id:'relevant'}]:[];}};
 const result=await retrieveCandidates(provider,pair,'coronavirus vaccine prevention',exclude);assert.equal(result.candidates[0].id,'relevant');assert.deepEqual(seen.map(x=>x.q),['coronavirus vaccine prevention','vaccine']);assert.ok(seen.every(x=>x.p===pair&&x.e===exclude));
});
test('unresolved topic does not silently fall back to all literature',async()=>{const seen=[];await retrieveCandidates({search:async(p,q)=>{seen.push(q);return [];}},{},'coronavirus vaccine prevention');assert.deepEqual(seen,['coronavirus vaccine prevention','vaccine']);});
test('recursive recency orders by actual dates within the full-text preference',()=>{const data=[{id:'older',contentScope:'full_text',availableAt:'2020-03-01'},{id:'newest-abstract',contentScope:'abstract',availableAt:'2020-06-01'},{id:'newer',contentScope:'full_text',availableAt:'2020-05-01'}];assert.deepEqual(rankCandidates(data,{prioritizeRecent:true}).map(p=>p.id),['newer','older','newest-abstract']);assert.equal(data[0].id,'older');});
