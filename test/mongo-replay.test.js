import test from 'node:test';
import assert from 'node:assert/strict';
import { ReplayService, ReplayError } from '../src/replay.js';
import { MemoryStore } from '../src/store.js';
import { createServer } from '../src/server.js';
function providerFixture() {
  const records=Array.from({length:6},(_,i)=>({id:`paper-${i}`,title:`Reader test ${i}`,text:'A test abstract, not scientific evidence.',availableAt:'2020-03-16T17:30:08.000Z',contentHash:`hash-${i}`,source:'cord19_mongo'}));
  return {corpusVersion:'reader-test-v1',ready:async()=>{},
    counts:async pair=>({papers:pair.month>=3?records.length:0,chunks:pair.month>=3?records.length:0}),
    search:async(pair,query,exclude=[])=>pair.month>=3?structuredClone(records.filter(p=>!exclude.includes(p.id))):[],
    read:async(pair,id)=>{const paper=records.find(p=>p.id===id);if(!paper||pair.month<3)throw new ReplayError('Evidence unavailable',404);return structuredClone(paper);},
    chunk:async()=>{throw new ReplayError('Evidence unavailable',404);}};
}
test('Mongo-backed reading cycles preserve temporal access and never fabricate hypothesis scores',async()=>{
  const service=new ReplayService(new MemoryStore(),{mongoProvider:providerFixture()});
  const pair=await service.create();assert.equal(pair.mode,'mongo_corpus');
  for(let month=1;month<=3;month++) {
    if(month>1)await service.advance(pair.id);
    await service.step(pair.id,`month-${month}`);
    const result=await service.get(pair.id);
    assert.deepEqual(result.checkpoints.at(-1).scores,[]);
    assert.equal(result.checkpoints.at(-1).evaluation.status,'not_configured');
    for(const arm of result.arms) {
      assert.equal(arm.hypotheses.length,0);assert.equal(arm.usage.labRequests,0);assert.equal(arm.usage.modelTokens,0);
      assert.equal(arm.readings.length,month<3?0:3);
      assert.ok(!arm.events.some(e=>e.type==='historical_evidence'||e.type==='hypothesis_revision'));
      assert.ok(arm.memory.every(m=>Date.parse(m.maxSourceAvailableAt)<=Date.parse(result.checkpoints.at(-1).cutoff)));
    }
  }
  assert.equal((await service.corpus(pair.id)).papers,6);
  assert.equal((await service.evidence(pair.id,'paper-0')).source,'cord19_mongo');
});
test('Mongo mode keeps prior fixture history intact',async()=>{
  const store=new MemoryStore();const fixtures=new ReplayService(store);const old=await fixtures.create();await fixtures.step(old.id,'one');
  const prior=await fixtures.get(old.id);
  const mongo=new ReplayService(store,{mongoProvider:providerFixture()});const current=await mongo.create();
  assert.equal(current.mode,'mongo_corpus');assert.deepEqual(await mongo.get(old.id),prior);
  assert.equal((await mongo.evidence(old.id,'observation-1')).label,true);
  assert.equal(mongo.runtime().defaultMode,'mongo_corpus');
});
test('failed Mongo cycle leaves local state unchanged and retry succeeds',async()=>{
  const provider=providerFixture();const service=new ReplayService(new MemoryStore(),{mongoProvider:provider});const pair=await service.create();
  for(let month=1;month<=2;month++){await service.step(pair.id,`month-${month}`);await service.advance(pair.id);}
  const prior=await service.get(pair.id);const read=provider.read;
  provider.read=async()=>{throw new ReplayError('Database unavailable',503);};
  await assert.rejects(()=>service.step(pair.id,'three'),/Database unavailable/);
  assert.deepEqual(await service.get(pair.id),prior);
  provider.read=read;await service.step(pair.id,'three');
  assert.equal((await service.get(pair.id)).arms[0].readings.length,3);
});
test('paper browser API uses saved cutoff; request month cannot unlock evidence',async()=>{
  const service=new ReplayService(new MemoryStore(),{mongoProvider:providerFixture()});const pair=await service.create();const server=createServer(service);
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
  try {
    const runtime=await (await fetch(`${base}/api/runtime`)).json();assert.equal(runtime.defaultMode,'mongo_corpus');
    const january=await (await fetch(`${base}/api/pairs/${pair.id}/papers?month=12&cutoff=2021-01-01`)).json();
    assert.equal(january.papers,0);assert.deepEqual(january.results,[]);assert.match(january.cutoff,/2020-01/);
    assert.equal((await fetch(`${base}/api/pairs/${pair.id}/evidence?id=paper-0`)).status,404);
    assert.equal((await fetch(`${base}/api/pairs/${pair.id}/chunks?id=chunk-0`)).status,404);
  }finally{await new Promise(resolve=>server.close(resolve));}
});
