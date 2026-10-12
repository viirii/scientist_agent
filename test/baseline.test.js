import test from 'node:test';import assert from 'node:assert/strict';
import {MongoEvidenceProvider} from '../src/mongo/provider.js';
test('baseline is pinned to each new run, leaving old run access unchanged',()=>{
 const p=new MongoEvidenceProvider({},'main-v1','baseline-v1');
 const old=p.readers({corpusVersion:'main-v1',month:1});assert.equal(old.length,1);
 const fresh=p.readers({corpusVersion:'main-v1',baselineCorpusVersion:'baseline-v1',month:1});assert.equal(fresh.length,2);assert.equal(fresh[1].filter.corpus_version,'baseline-v1');assert.equal(fresh[1].filter.available_at.$lte.toISOString(),'2020-01-31T23:59:59.999Z');
});
test('source fallback accepts only unavailable evidence errors',async()=>{
 const p=new MongoEvidenceProvider({},'main');p.readers=()=>[{read:async()=>{throw new Error('Evidence unavailable');}},{read:async()=>({id:'baseline'})}];assert.deepEqual(await p.fromReaders({},'read','baseline'),{id:'baseline'});
 p.readers=()=>[{read:async()=>{throw new Error('Corpus is unavailable');}},{read:async()=>({id:'baseline'})}];await assert.rejects(p.fromReaders({},'read','baseline'),/Corpus is unavailable/);
});
