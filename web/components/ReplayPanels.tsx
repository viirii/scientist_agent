import { useState } from 'react';
import type { Arm, Snapshot, Pair, AuditEvent, MonthlyReview } from '../types';
import { months, percent } from '../api';
import presentationSummaries from '../presentation/summaries.json';
import presentationTakeaways from '../presentation/takeaways.json';

function brief(text: string) {
  const first = text.trim().split(/(?<=[.!?])\s/)[0].replace(/[.!?]+$/, '');
  return first.length > 180 ? `${first.slice(0,177).replace(/\s+\S*$/, '')}…` : first;
}
function plainLanguage(text: string) {
  // Presentation-only wording for saved findings; never feeds back into agent memory.
  const translations: Record<string,string> = {
    'Early evidence directly supports ACE2 receptor use by 2019-nCoV, but the supplied excerpts do not quantify SARS-CoV-2 neutralizing-antibody titers, seroconversion timing, persistence, severity associations, or protective immunity.': 'The papers suggest the virus uses a doorway called ACE2 to enter cells, but they do not yet tell us how well the body fights it off',
    'The supplied early SARS-CoV-2 evidence directly supports ACE2-mediated cell entry, but does not establish human interferon responses or protective immunity.': 'The papers suggest the virus uses a doorway called ACE2 to enter cells, but we still do not know how the body sounds the alarm or protects itself',
    'Before the cutoff, do patient cohorts report SARS-CoV-2 neutralizing titers and seroconversion timing using validated assays?': 'We will look for papers showing when people start making antibodies and whether those antibodies can block the virus',
    'Are there eligible pre-cutoff human airway, epithelial-cell, or immune-cell studies that directly measure SARS-CoV-2 type I interferon magnitude and timing, ideally against respiratory-virus comparators?': 'We will look for papers showing how quickly and strongly human cells sound the alarm when this virus arrives'
  };
  return translations[text] || text.trim()
    .replace(/type I interferon/gi,'the body’s early warning signal')
    .replace(/neutralizing antibodies/gi,'antibodies that can block the virus')
    .replace(/seroconversion timing/gi,'when antibodies first appear')
    .replace(/pre-cutoff/gi,'available at this point in the replay')
    .replace(/eligible/gi,'available').replace(/induces/gi,'triggers');
}
function simpleHypothesis(claim: string) {
  const entries=presentationSummaries as {sourceKnowledge:string;sourceNext:string;knowledge:string;next:string}[];
  return entries.find(entry=>entry.sourceKnowledge===claim&&!entry.sourceNext)?.knowledge || plainLanguage(claim);
}
function SummaryBullets({text}: {text:string}) {
  const items=text.trim().split(/\n+|(?<=[.!?])\s+(?=[A-Z])/).map(item=>item.replace(/^\s*[-•*]\s+/, '').trim()).filter(Boolean);
  return <ul className="summary-bullets">{items.map((item,i)=><li key={i}>{item}</li>)}</ul>;
}
const reviewStatus: Record<string,string> = {
  supported:'Supporting evidence', challenged:'Challenging evidence',
  partly_addressed:'Partially addressed', unresolved:'Still open'
};
function reviewSummary(text: string) {
  // Remove legacy numeric tallies from presentation only; preserve saved evaluations.
  return text.replace(/\s*New papers touched on \d+ of the \d+ proposed study questions; the rest remain open\./g,'').trim();
}
function completeSentence(text: string) {
  return /[.!?]$/.test(text) ? text : `${text}.`;
}
function researchSummary(arm: Arm | Snapshot, month:number) {
  const sourceKnowledge=arm.memory.filter(note=>note.month===month).map(note=>note.text).join('\n');
  const sourceNext=(arm.researchRequests||[]).filter(plan=>plan.month===month).map(plan=>JSON.stringify({question:plan.question,goal:plan.goal_connection,evidence:plan.evidence_needed,outcomes:plan.discriminating_outcomes})).join('\n');
  const cached=(presentationSummaries as {sourceKnowledge:string;sourceNext:string;knowledge:string;next:string}[]).find(entry=>entry.sourceKnowledge===sourceKnowledge&&entry.sourceNext===sourceNext);
  return {knowledge:cached?.knowledge||(sourceKnowledge?plainLanguage(sourceKnowledge):'No literature findings have been recorded for this month yet.'),next:cached?.next||(sourceNext?(arm.researchRequests||[]).filter(plan=>plan.month===month).map(plan=>plainLanguage(plan.question)).join('\n'):'No proposed studies have been recorded for this month yet.'),sourceKnowledge,sourceNext};
}

export function ArmCard({ arm, onEvidence, mongo=false, reportMonth, sourceEvents=[],review,onReview,reviewBusy=false }: { arm: Arm | Snapshot; onEvidence: (id: string) => void;mongo?:boolean;reportMonth:number;sourceEvents?:AuditEvent[];review?:MonthlyReview;onReview?:()=>void;reviewBusy?:boolean }) {
  const name = 'name' in arm ? arm.name : arm.arm;
  const summary = researchSummary(arm,reportMonth);
  const takeaway = presentationTakeaways.find(entry=>entry.sourceKnowledge===summary.sourceKnowledge&&entry.sourceNext===summary.sourceNext&&entry.sourceReview===(review?.summary||''));
  const [view,setView] = useState<'findings'|'plans'|'papers'|'memory'>('findings');
  const events = 'name' in arm ? (arm.events || []) : sourceEvents.filter(e=>e.seq<=arm.lastSeq);
  const monthNotes = arm.memory.filter(note=>note.month===reportMonth || (!note.month&&events.some(e=>e.month===reportMonth&&note.sourceEventIds.includes(e.id))));
  const proposals = (arm.researchRequests||[]).filter(r=>r.month===reportMonth);
  return <article className="panel arm">
    <div className="arm-top"><h2>{name === 'fixed' ? 'Fixed harness' : 'Recursive harness'}</h2><span className="badge">v{arm.harness.version}</span></div>
    <p className="muted">{name === 'fixed'
      ? 'Each month, knowledge, memory, hypotheses, and research plans evolve. The research strategy stays fixed.'
      : 'Each month, knowledge, memory, hypotheses, and research plans evolve. The agent can also revise its research strategy through bounded, versioned updates.'}</p>
    <details><summary>Research strategy</summary>
      <p>{arm.harness.config.prioritizeRecent ? 'Favor newer eligible papers.' : 'Keep standard paper ordering.'} {arm.harness.config.searchApproach==='broaden'?'Broaden searches even when the first search finds papers.':'Broaden only when a search finds nothing.'}</p>
      <p>{arm.harness.config.readingDepth==='abstract_screen'?'Screen abstracts.':'Prefer complete extracted full text when it fits.'} Read up to {arm.harness.config.papersPerCycle||2} papers per cycle. Focus: {(arm.harness.config.researchFocus||'balanced').replaceAll('_',' ')}.</p>
      {events.filter(e=>e.type==='harness_promotion'||e.type==='harness_rollback'||e.type==='monthly_strategy_review').map(e=><p key={e.id}>{e.type==='harness_rollback'?'Strategy restored':e.type==='monthly_strategy_review'?'Monthly strategy decision':'Strategy changed'}: {String((e.payload as {reason?:string}).reason||'Recorded in research history.')}</p>)}
    </details>
    <div className="research-flow">
    <section className="monthly-review"><span className="flow-step" aria-hidden="true">01</span><div className="review-heading"><h3>How we did last month</h3><span className="muted">{reportMonth>1?months[reportMonth-2]+' → '+months[reportMonth-1]:'Starting point'}</span></div>
      <p className="eli5-takeaway"><strong>{takeaway?.review||(reportMonth===1?'This is our starting point; we’ll track these ideas as new evidence arrives.':'Earlier ideas stay open until new evidence helps us judge them.')}</strong></p>
      <SummaryBullets text={reviewSummary(review?.summary||'')||(reportMonth===1?'Our first month sets the baseline. We’ll review these ideas as evidence arrives.':'Track earlier hypotheses and proposed study questions as new literature becomes available.')}/>
      {review?.status==='complete'&&!![...(review.hypotheses||[]),...(review.proposals||[])].length&&<>
        <h4>Open questions & hypotheses from last month</h4>
        <p className="muted">Evidence status, not a score. Questions may remain open across many months.</p>
        <ul className="review-status-list">{[...(review.hypotheses||[]).map(item=>({...item,category:'Hypothesis'})),...(review.proposals||[]).map(item=>({...item,category:'Study question'}))].map(item=><li key={`${item.category}-${item.id}`}><div className="review-status-heading"><span className="muted">{item.category}</span><span className={`review-status ${item.verdict}`}>{reviewStatus[item.verdict]||item.verdict.replaceAll('_',' ')}</span></div><p>{item.category==='Hypothesis'&&item.subject?simpleHypothesis(item.subject):item.subject||item.id}</p><details><summary>Evidence update</summary>{item.subject&&<p><strong>Original wording:</strong> {item.subject}</p>}<p>{item.reason}</p>{item.citations.map((cite,j)=><button key={j} className="evidence-link" onClick={()=>onEvidence(cite.version_id)}>Evidence {j+1}</button>)}</details></li>)}</ul>
        <details><summary>Review scope</summary><p className="muted">{review.scope}</p></details>
      </>}
      {reportMonth>1&&review?.status!=='complete'&&onReview&&<button className="secondary" disabled={reviewBusy} onClick={onReview}>{reviewBusy?'Reviewing…':'Review last month'}</button>}
    </section>
    <div className="research-summary split-summary"><section><span className="flow-step" aria-hidden="true">02</span><h3>What we know now</h3><p className="eli5-takeaway"><strong>{takeaway?.knowledge||summary.knowledge.split(/\n/)[0].replace(/^[-•*]\s*/,'')}</strong></p><p className="muted">This month’s literature findings from the papers reviewed by this agent.</p><SummaryBullets text={summary.knowledge}/>{summary.sourceKnowledge&&<details><summary>Original research wording</summary><p>{summary.sourceKnowledge}</p></details>}</section><section><span className="flow-step" aria-hidden="true">03</span><h3>What’s next</h3><p className="eli5-takeaway"><strong>{takeaway?.next||summary.next.split(/\n/)[0].replace(/^[-•*]\s*/,'')}</strong></p><p className="muted">Proposed studies informed by new findings and accumulated knowledge.</p><SummaryBullets text={summary.next}/>{summary.sourceNext&&<details><summary>Original research wording</summary><p>{summary.sourceNext}</p></details>}</section></div>
    </div>
    <div className="research-metrics"><div><strong>{arm.readings?.length||0}</strong><span>Papers read</span></div><div><strong>{arm.hypotheses.length}</strong><span>Hypotheses</span></div><div><strong>{proposals.length}</strong><span>Monthly proposals</span></div></div>
    <div className="research-tabs" role="tablist" aria-label={`${name} research views`}>{([{id:'findings',label:'Findings'},{id:'plans',label:'Research plan'},{id:'papers',label:'Papers'},{id:'memory',label:'Memory'}] as const).map(tab=><button key={tab.id} id={`${name}-${tab.id}-tab`} role="tab" aria-selected={view===tab.id} aria-controls={`${name}-research-panel`} onClick={()=>setView(tab.id)}>{tab.label}</button>)}</div>
    <div id={`${name}-research-panel`} role="tabpanel" aria-labelledby={`${name}-${view}-tab`} className="research-content">
    {view==='findings' && <>
    <h3>Working hypotheses</h3>
    {arm.hypotheses.map((h,index) => <details className="hypothesis finding-card" key={h.id}><summary><span className="finding-number">H{index+1}</span><span>{simpleHypothesis(h.claim)}</span><span className="finding-status">{h.status}</span></summary><p>{h.claim}</p><div className="belief-meter"><span>Agent belief · {percent(h.pTrue)}</span><progress max={1} value={h.pTrue} aria-label={`Agent belief for hypothesis ${index+1}`}/></div>{h.rationale&&<p className="muted">{h.rationale}</p>}{h.evidenceRefs.map((id,i) => <button className="evidence-link" key={id} onClick={() => onEvidence(id)}>Source {i+1} · {h.provenance==='model_inference'?'cited model inference':'read from fixture'}</button>)}</details>)}
    {!arm.hypotheses.length&&<p className="empty-state">No hypotheses recorded yet.</p>}
    {!!arm.agenda?.length&&<details className="research-fold"><summary>Open research questions · {arm.agenda.length}</summary><ul>{arm.agenda.map((q,i)=><li key={i}>{q}</li>)}</ul></details>}
    <details className="research-fold"><summary>{months[reportMonth-1]} learning notes · {monthNotes.length}</summary>{monthNotes.length?<ul>{monthNotes.map((note,i)=><li key={i}>{note.text}</li>)}</ul>:<p className="muted">{'stateHash' in arm&&arm.memory.length?'This older checkpoint has no month labels on its notes; its original findings remain in research memory below.':'No new findings recorded for this month yet.'}</p>}</details>
    </>}
    {view==='plans' && <div><h3>{months[reportMonth-1]} action items for scientist review</h3><p className="muted">Proposed studies and evidence checks to advance the long-term goal.</p>{!proposals.length&&<p className="muted">No action items proposed for this month yet.</p>}{proposals.map((r,index)=><details key={r.id}><summary>{index+1}. {r.priority?`${r.priority} priority · `:''}{r.question}</summary>
      {r.goal_connection?<p><strong>How this advances the goal:</strong> {r.goal_connection}</p>:<p className="muted">This older proposal predates explicit goal connections; its original wording is preserved.</p>}
      {r.why_it_matters&&<p><strong>Why this matters:</strong> {r.why_it_matters}</p>}
      {!!r.competing_explanations?.length&&<><p><strong>Competing explanations</strong></p><ul>{r.competing_explanations.map((text,i)=><li key={i}>{text}</li>)}</ul></>}
      {r.evidence_needed&&<p><strong>Evidence to look for:</strong> {r.evidence_needed}</p>}
      <p><strong>What could distinguish them</strong></p><ul>{r.discriminating_outcomes.map((text,i)=><li key={i}>{text}</li>)}</ul>
      {r.limitations&&<p><strong>Limitations:</strong> {r.limitations}</p>}
      {r.evidence_refs?.map((ref,i)=><button className="evidence-link" key={i} onClick={()=>onEvidence(ref.version_id)}>Proposal source {i+1}</button>)}
      <p className="muted">Scientist review required · High-level research plan · No experiment performed</p>
      {!r.result?<p className="muted">Awaiting historical evidence check in a subsequent cycle</p>:<div className="lesson"><strong>{r.result.status==='resolved'?'Related published observations':'No reviewed evidence available'}</strong><p>{r.result.interpretation}</p>{r.result.observations.map(o=><div key={o.cardId}><p>{o.observation}</p><p className="muted">{o.limitations}</p><blockquote>{o.citation.quote}</blockquote><button className="evidence-link" onClick={()=>onEvidence(o.citation.version_id)}>Read observation source</button><p className="muted">Review: {o.review.reviewer} · {o.review.method}</p></div>)}<p className="muted">Checked through {r.result.checkedCutoff.slice(0,10)}</p></div>}
    </details>)}</div>}
    {view==='memory' && <section><h3>Persistent research memory</h3><p className="muted">{arm.memory.length} saved notes carried across research cycles.</p>{!arm.memory.length&&<p className="empty-state">No notes saved yet.</p>}{arm.memory.length>0&&<details open><summary>Persistent research memory ({arm.memory.length} notes)</summary>{arm.memory.map((m,i)=><div className="memory-note" key={i}><span className="muted">Note {i+1}{m.month?` · ${months[m.month-1]}`:''}</span><p>{m.text}</p></div>)}</details>}</section>}
    {view==='papers' && <section><h3>Reading library</h3>
    {mongo && (arm.readings||[]).map(reading=><div className="hypothesis" key={reading.id}><p>{reading.title}</p><p className="muted">{reading.readingCoverage==='complete_extracted_text'?'Complete extracted paper read':reading.readingCoverage==='abstract_only'?'Abstract only — full text unavailable at this cutoff':'Earlier reading — coverage not recorded'}{reading.textCharacters?` · ${reading.textCharacters.toLocaleString()} characters`:null}</p><p className="muted">{reading.excerpt}…</p><button className="evidence-link" onClick={()=>onEvidence(reading.id)}>Read CORD-19 paper and provenance</button></div>)}
    {!arm.hypotheses.length && !mongo && <p className="muted">No hypotheses yet. Run January to begin.</p>}
    {mongo && !arm.readings?.length && <p className="muted">No papers read yet. Run a research cycle to explore the available literature.</p>}
    </section>}
    </div>
  </article>;
}
export function CheckpointTable({ pair }: { pair: Pair }) {
  if(pair.mode==='mongo_corpus')return <section className="panel"><h2>Frozen monthly progress</h2><p>Real papers are recorded as reading notes. Scientific benchmark scores are unavailable until the historical evaluator is configured.</p><div className="table-wrap"><table><thead><tr><th>Month</th><th>Available literature</th><th>Fixed: read</th><th>Recursive: read</th><th>Evaluation</th></tr></thead><tbody>{pair.checkpoints.map(cp=><tr key={cp.month}><td>{months[cp.month-1]}</td><td>{cp.corpusAccess?.papers??'—'}</td><td>{cp.snapshots.find(s=>s.arm==='fixed')?.readings?.length??0}</td><td>{cp.snapshots.find(s=>s.arm==='recursive')?.readings?.length??0}</td><td>Not configured</td></tr>)}</tbody></table></div>{!pair.checkpoints.length && <p>No checkpoints yet.</p>}</section>;
  return <section className="panel"><h2>Frozen monthly comparison</h2><p>Private evaluation stays outside agent memory. Scores describe synthetic fixtures only.</p>
    {!pair.checkpoints.length ? <p>No checkpoints yet.</p> : <div className="table-wrap"><table><thead><tr>{['Month','Arm','Coverage','Brier ↓','Resolved claims','Citation presence'].map(title=><th key={title}>{title}</th>)}</tr></thead><tbody>{pair.checkpoints.flatMap(cp=>cp.scores.map(score=><tr key={`${cp.month}-${score.arm}`}><td>{months[cp.month-1]}</td><td>{score.arm}</td><td>{percent(score.coverage)}</td><td>{score.brier?.toFixed(3) ?? '—'}</td><td>{score.calibrationDenominator}</td><td>{percent(score.citedClaimRate)}</td></tr>))}</tbody></table></div>}
  </section>;
}
export function AuditTrail({ pair }: { pair: Pair }) {
  return <div>{pair.arms.flatMap(arm=>(arm.events || []).slice(-8).reverse().map(ev=><details key={ev.id}><summary>{arm.name} · {months[ev.month-1]} · #{ev.seq} · {ev.type}</summary><pre>{JSON.stringify(ev,null,2)}</pre></details>))}</div>;
}
