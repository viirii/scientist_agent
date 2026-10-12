import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { request } from 'node:http';
import { papers, cutoffFor } from '../src/fixtures.js';
import { TemporalGateway } from '../src/gateway.js';
import { ReplayService, validateHarness } from '../src/replay.js';
import { MemoryStore, FileStore } from '../src/store.js';
import { createServer } from '../src/server.js';

test('temporal boundary: exact equality allowed; future, invalid and missing dates denied', () => {
  const cutoff = cutoffFor(1);
  const records = [
    { id: 'equal', availableAt: cutoff, title: 'fixture', text: '' },
    { id: 'future', availableAt: new Date(Date.parse(cutoff)+1).toISOString(), title: 'fixture', text: 'future' },
    { id: 'unknown', title: 'fixture' },
    { id: 'invalid', availableAt: 'invalid', title: 'fixture' },
  ];
  const gate = new TemporalGateway(records, cutoff);
  assert.deepEqual(gate.search('').map(p=>p.id), ['equal']);
  assert.equal(gate.read('equal').id,'equal');
  for (const id of ['future','unknown','invalid','missing']) assert.throws(()=>gate.read(id), /Evidence unavailable/);
  assert.deepEqual(gate.resolve('future'),gate.resolve('missing'));
  assert.throws(()=>gate.validateRefs(['future']),/Evidence unavailable/);
  assert.throws(()=>gate.search('',11),/Invalid search/);
});
test('retrieval cannot mutate corpus; independent gateways do not reuse future results', () => {
  const future = new TemporalGateway(papers,cutoffFor(12));
  const old = new TemporalGateway(papers,cutoffFor(1));
  const source = future.read('observation-12'); source.text = 'modified';
  assert.notEqual(future.read(source.id).text,source.text);
  assert.throws(()=>old.read(source.id));
  assert.equal(old.resolve(source.id).status,'no_evidence');
});
test('audit payloads are independent of mutable research state', async () => {
  class CheckingStore extends MemoryStore {
    async save(state) {
      for (const pair of state.pairs) for (const arm of pair.arms) {
        for (const event of arm.events.filter(e=>e.type==='hypothesis_revision')) {
          const hypothesis=arm.hypotheses.find(h=>h.id===event.payload.id);
          if(hypothesis) {
            assert.notStrictEqual(event.payload,hypothesis);
            assert.notStrictEqual(event.payload.evidenceRefs,hypothesis.evidenceRefs);
          }
        }
      }
      return super.save(state);
    }
  }
  const service=new ReplayService(new CheckingStore());
  const pair=await service.create();
  await service.step(pair.id,'audit-snapshot');
});
test('paired checkpoint is immutable across advance and memory survives twelve months', async () => {
  const service = new ReplayService(new MemoryStore());
  const pair = await service.create();
  await assert.rejects(()=>service.advance(pair.id), /Both frozen/);
  let first;
  for (let month=1;month<=12;month++) {
    const frozen = await service.step(pair.id,`month-${month}`);
    assert.equal(frozen.checkpoints.length,month);
    assert.equal(frozen.checkpoints.at(-1).snapshots.length,2);
    for (const snapshot of frozen.checkpoints.at(-1).snapshots) {
      const {stateHash,...content} = snapshot;
      assert.equal(createHash('sha256').update(JSON.stringify(content)).digest('hex'), stateHash);
      for (const h of snapshot.hypotheses) new TemporalGateway(papers,snapshot.cutoff).validateRefs(h.evidenceRefs);
      assert.ok(snapshot.memory.every(m=>m.maxSourceAvailableAt<=snapshot.cutoff));
      assert.equal(Object.hasOwn(snapshot,'scores'),false);
    }
    if (month===1) first = JSON.stringify(frozen.checkpoints[0]);
    assert.equal(JSON.stringify(frozen.checkpoints[0]),first);
    if (month<12) await service.advance(pair.id);
  }
  const complete = await service.get(pair.id);
  assert.equal(complete.status,'complete');
  for (const arm of complete.arms) {
    assert.equal(arm.cycles,36); assert.equal(arm.hypotheses.length,13);
    assert.equal(arm.usage.modelTokens,0);
    assert.ok(arm.memory.length>=13);
  }
  assert.equal(complete.arms[0].harness.version,1);
  assert.equal(complete.arms[1].harness.version,2);
  await assert.rejects(()=>service.advance(pair.id),/Both frozen/);
});
test('concurrent retry does not duplicate cycles or checkpoints', async () => {
  const service = new ReplayService(new MemoryStore()); const pair = await service.create();
  await Promise.all([service.step(pair.id,'same'),service.step(pair.id,'same')]);
  const frozen = await service.get(pair.id);
  assert.equal(frozen.checkpoints.length,1); assert.equal(frozen.arms[0].cycles,3);
  await assert.rejects(()=>service.step(pair.id,'different'),/Advance/);
  assert.equal((await service.get(pair.id)).checkpoints.length,1);
});
test('invalid recursive proposals cannot alter policy or budget', () => {
  assert.deepEqual(validateHarness({prioritizeRecent:true}),{prioritizeRecent:true});
  for (const config of [null,{}, {prioritizeRecent:'yes'}, {prioritizeRecent:true,cutoff:'2021'}, {prioritizeRecent:true,budget:999}]) assert.throws(()=>validateHarness(config));
});
test('disk restart resumes run and corrupted state fails visibly', async () => {
  const dir = await mkdtemp(join(tmpdir(),'research-replay-'));
  try {
    const path = join(dir,'state.json'); const service = new ReplayService(new FileStore(path));
    const pair = await service.create(); await service.step(pair.id,'january');
    const restarted = new ReplayService(new FileStore(path));
    assert.equal((await restarted.get(pair.id)).arms[0].cycles,3);
    await restarted.advance(pair.id); await restarted.step(pair.id,'february');
    assert.equal(JSON.parse(await readFile(path,'utf8')).pairs[0].checkpoints.length,2);
    await writeFile(path,'invalid JSON');
    await assert.rejects(()=>restarted.get(pair.id), SyntaxError);
  } finally { await rm(dir,{recursive:true,force:true}); }
});
test('failed persistence never advances committed state', async () => {
  const store = new MemoryStore(); const service = new ReplayService(store); const pair = await service.create();
  const original = store.save.bind(store); store.save = async ()=> { throw new Error('disk failed'); };
  await assert.rejects(()=>service.step(pair.id,'january'),/disk failed/);
  store.save = original;
  assert.equal((await service.get(pair.id)).checkpoints.length,0);
  await service.step(pair.id,'january'); assert.equal((await service.get(pair.id)).checkpoints.length,1);
});
test('HTTP local flow, idempotency, future evidence denial, host and origin protection', async () => {
  const service = new ReplayService(new MemoryStore()); const server = createServer(service);
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const home = await fetch(base); assert.equal(home.status,200); assert.match(await home.text(),/LOCAL FIXTURE MODE/);
    assert.equal((await fetch(`${base}/assets/not-built.js`)).status,404);
    const pair = await (await fetch(`${base}/api/pairs`,{method:'POST'})).json();
    assert.equal((await fetch(`${base}/api/pairs/${pair.id}/evidence?id=observation-12`)).status,404);
    assert.equal((await fetch(`${base}/api/pairs/${pair.id}/step`,{method:'POST'})).status,400);
    assert.equal((await fetch(`${base}/api/pairs/${pair.id}/step`,{method:'POST',headers:{'Idempotency-Key':'one'}})).status,200);
    assert.equal((await fetch(`${base}/api/pairs`,{method:'POST',headers:{Origin:'https://untrusted.example'}})).status,403);
    const rebindingStatus = await new Promise((resolve,reject)=>{
      const req = request(`${base}/api/pairs`,{headers:{Host:'untrusted.example'}}, res=>{ res.resume(); resolve(res.statusCode); });
      req.on('error',reject); req.end();
    });
    assert.equal(rebindingStatus,403);
    assert.equal((await fetch(`${base}/api/pairs/${pair.id}/advance`,{method:'POST'})).status,200);
    assert.equal((await fetch(`${base}/api/pairs/${pair.id}`)).status,200);
  } finally { await new Promise(resolve=>server.close(resolve)); }
});

test('new runs have separate cache identities without replacing saved fallback runs',async()=>{
 const store=new MemoryStore(),service=new ReplayService(store);
 const first=await service.create();await service.step(first.id,'january');const saved=JSON.stringify(await service.get(first.id));
 const next=await service.create();assert.notEqual(next.id,first.id);assert.notEqual(next.runHash,first.runHash);assert.equal(next.configHash,first.configHash);
 assert.equal(next.runHash,createHash('sha256').update(JSON.stringify({id:next.id,configHash:next.configHash})).digest('hex'));
 assert.equal(JSON.stringify(await service.get(first.id)),saved);assert.equal(next.checkpoints.length,0);
});
