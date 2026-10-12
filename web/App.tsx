import { EvidenceReader } from './components/EvidenceReader';
import { useEffect, useRef, useState } from 'react';
import { api, months } from './api';
import type { Pair, Evidence, Runtime } from './types';
import { ArmCard, CheckpointTable, AuditTrail } from './components/ReplayPanels';
import { WellPlate } from './components/WellPlate';
import { CorpusBrowser } from './components/CorpusBrowser';
import cachedRun from './presentation/run-snapshot.json';

const visibleRunIds = new Set(['c52cf13c-c662-47da-90b9-70f806080a2b','785a0b82-98d6-473a-b80b-295c7dbea0ce']);

export function App() {
  const [runtime,setRuntime]=useState<Runtime>();
  const [pairs,setPairs] = useState<Pair[]>([cachedRun.pair as unknown as Pair]); const [pair,setPair] = useState<Pair | undefined>(cachedRun.pair as unknown as Pair);
  const [cachedView,setCachedView]=useState(true);
  const [selectedMonth,setSelectedMonth] = useState<number>(); const [evidence,setEvidence] = useState<Evidence>();
  const [busy,setBusy] = useState(false); const [error,setError] = useState(''); const locked = useRef(false);
  const savedRun = () => {try{return localStorage.getItem('agent-phd-active-run');}catch{return null;}};
  useEffect(()=>{if(pair)try{localStorage.setItem('agent-phd-active-run',pair.id);}catch{}},[pair?.id]);
  const load = async (id?: string) => { const items = await api<Pair[]>('/api/pairs'); setPairs(items); setPair(items.find(p=>p.id===(id||savedRun())) || [...items].sort((a,b)=>b.checkpoints.length-a.checkpoints.length).at(0)); };
  useEffect(()=>{
    let active=true;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const fetchPairs = async () => {
      try {
        const items=await api<Pair[]>('/api/pairs');
        if(active){setCachedView(false);setPairs(items);setPair(items.find(p=>p.id==='c52cf13c-c662-47da-90b9-70f806080a2b')||items.find(p=>p.id===savedRun())||[...items].sort((a,b)=>b.checkpoints.length-a.checkpoints.length)[0]);setError('');}
      } catch(error) {
        if(active){setError(`Showing saved display snapshot while live replays reconnect. Retrying… ${error instanceof Error?error.message:'Request failed'}`);retry=setTimeout(fetchPairs,5000);}
      }
    };
    void fetchPairs();
    void api<Runtime>('/api/runtime').then(config=>{if(active)setRuntime(config);}).catch(error=>{if(active)setError(error.message);});
    return()=>{active=false;if(retry)clearTimeout(retry);};
  },[]);
  const act = async (fn:()=>Promise<void>) => {
    if(locked.current)return; locked.current=true; setBusy(true); setError('');
    try{await fn();}catch(error){setError(error instanceof Error?error.message:'Request failed');}finally{locked.current=false;setBusy(false);}
  };
  const inspect = (id:string) => { if(!pair)return; void act(async()=>setEvidence(await api<Evidence>(`/api/pairs/${pair.id}/evidence?id=${encodeURIComponent(id)}`))); };
  const reasoning=pair?.agentEngine==='model_researcher';
  const mongo=pair?pair.mode==='mongo_corpus':runtime?.defaultMode==='mongo_corpus';
  const checkpoint = pair?.checkpoints.find(c=>c.month===selectedMonth);
  const exportRun = () => {if(!pair)return;const url=URL.createObjectURL(new Blob([JSON.stringify(pair,null,2)],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download=`replay-${pair.id}.json`;link.click();URL.revokeObjectURL(url);};
  return <main>
    <header><div><p className="eyebrow">SCIENTIFIC RESEARCH AGENT</p><h1>Agent PhD</h1><p className="subtitle">Recursive agent meets science. Learning continuously, advancing your research, and planning experiments toward your next breakthrough.</p></div>{!mongo&&<span className="badge">LOCAL FIXTURE MODE</span>}</header>
    <>
      {!reasoning && <aside className="notice">{mongo?'Evidence is retrieved from the imported CORD-19 corpus in Mongo. The reader is deterministic; no live model, biological confidence scores, or virtual experiments are generated. Replay memory is still saved locally.':'This saved run uses synthetic fixture evidence. New runs use the configured data source; existing run history is preserved.'}</aside>}
      <section className="panel mission"><p className="eyebrow">COVID-19 BENCHMARK · LONG-TERM RESEARCH GOAL</p><h2>Understand COVID-19 to guide treatment and prevention</h2><p>{runtime?.longTermGoal || 'Understand COVID-19 and how SARS-CoV-2 interacts with humans, and use that understanding to guide research on treatment and prevention, including vaccines.'}</p><p className="muted">Current benchmark: replay COVID-19 research through 2020 to compare agent progress with a familiar historical example.</p><p className="muted">Each month: read new evidence → update what we know → propose the next studies → learn from published observations.</p></section>
      {cachedView&&<p className="muted" role="status">Showing a saved display snapshot from {new Date(cachedRun.savedAt).toLocaleTimeString()}. Connecting to live research history…</p>}
      {error && <p id="error" role="alert">{error}</p>}
      <section className="clock"><div><p className="eyebrow">SIMULATED MONTH</p><h2>{pair?`${months[pair.month-1]} 2020`:'Ready to begin'}</h2><p>{pair?`Evidence cutoff: ${new Date(Date.UTC(2020,pair.month,1)-1).toISOString()}`:'Create a paired replay to start in January 2020.'}</p></div><div className="actions"><button disabled={busy||cachedView||pair?.status!=='ready'} onClick={()=>void act(async()=>{if(!pair)return;await api(`/api/pairs/${pair.id}/step`,'POST',`month-${pair.month}`);setSelectedMonth(pair.month);await load(pair.id);})}>Run month</button><button disabled={busy||cachedView||pair?.status!=='checkpoint'} className="secondary" onClick={()=>void act(async()=>{if(!pair)return;await api(`/api/pairs/${pair.id}/advance`,'POST');setSelectedMonth(undefined);await load(pair.id);})}>Unlock next month</button></div></section>
      {pair && <><nav id="months" aria-label="Monthly checkpoints">{months.map((name,i)=><button key={name} disabled={busy||!pair.checkpoints.some(c=>c.month===i+1)} className={`${pair.month===i+1?'current ':''}${selectedMonth===i+1?'selected':''}`} onClick={()=>setSelectedMonth(i+1)}>{name}</button>)}</nav>
        <p aria-live="polite">{busy?'Processing…':pair.status==='complete'?'Replay complete. All twelve checkpoints are frozen.':pair.status==='checkpoint'?null:'Ready: three bounded cycles per arm. Persistent memory is carried forward.'}</p>
        {checkpoint && <p className="muted">Viewing frozen {months[checkpoint.month-1]} state. Current evidence access follows the cutoff above.</p>}
        <section className="arms">{(checkpoint?.snapshots || pair.arms).map(arm=><ArmCard key={'name' in arm?arm.name:arm.arm} arm={arm} onEvidence={inspect} mongo={mongo} reportMonth={checkpoint?.month || pair.month} review={pair.monthlyReviews?.[checkpoint?.month || pair.month]?.arms['name' in arm?arm.name:arm.arm]} reviewBusy={busy} onReview={reasoning&&!cachedView?()=>void act(async()=>{const month=checkpoint?.month||pair.month;await api(`/api/pairs/${pair.id}/review?month=${month}`,'POST');await load(pair.id);}):undefined} sourceEvents={pair.arms.find(a=>a.name===('name' in arm?arm.name:arm.arm))?.events}/>)}</section>
        <CheckpointTable pair={pair}/></>}
      {pair && mongo && <CorpusBrowser pair={pair} onEvidence={inspect}/>}
      <WellPlate/>
      <section className="panel"><h2>Evidence & audit trail</h2><p>Inspect a source to see its provenance. Future and missing IDs return the same unavailable response.</p><EvidenceReader evidence={evidence}/>{pair && <AuditTrail pair={pair}/>}</section>
    </>
      <section className="toolbar"><label>Saved replay <select value={pair?.id || ''} disabled={busy || !pairs.length} onChange={e=>{const id=e.target.value;setSelectedMonth(undefined);setEvidence(undefined);const saved=pairs.find(p=>p.id===id);if(saved)setPair(saved);else void act(async()=>{const selected=await api<Pair>(`/api/pairs/${id}`);setPairs(current=>[...current.filter(p=>p.id!==id),selected]);setPair(selected);setCachedView(false);});}}>{!pairs.length && <option value="">Loading saved replays…</option>}{[...visibleRunIds].map(id=>{const p=pairs.find(p=>p.id===id);return <option key={id} value={id}>{p?`${p.id.slice(0,8)} · ${months[p.month-1]} · ${p.status}`:`${id.slice(0,8)} · Saved live run`}</option>;})}</select></label><button disabled={busy||cachedView||!runtime} onClick={()=>void act(async()=>{const created=await api<Pair>('/api/pairs','POST');setSelectedMonth(undefined);setEvidence(undefined);await load(created.id);})}>{runtime?.defaultMode==='mongo_corpus'?'New Mongo replay':'New paired replay'}</button><button disabled={busy||cachedView||!pair} className="secondary" onClick={exportRun}>Export JSON</button></section>
    <footer>Research history saved · {reasoning?'Model research loop · API usage recorded':'Deterministic reader · No model tokens used'}</footer>
  </main>;
}
