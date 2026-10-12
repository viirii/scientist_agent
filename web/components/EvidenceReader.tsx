import type { Evidence } from '../types';
export function EvidenceReader({evidence}:{evidence?:Evidence}) {
  if(!evidence)return <p>No evidence selected.</p>;
  return <article><h3>{evidence.title}</h3><p className="muted">{evidence.contentScope==='full_text'?'Historical full-text parse':'Abstract'} · Available by {evidence.availableAt}</p>
    {evidence.paragraphs?<><details open><summary>Abstract</summary><p>{evidence.abstract}</p></details><h4>Paper sections</h4>{evidence.paragraphs.map(p=><section key={p.index}>{(p.index===0||evidence.paragraphs?.[p.index-1]?.section!==p.section)&&<h4>{p.section||'Untitled section'}</h4>}<p style={{whiteSpace:'pre-wrap'}}>{p.text}</p></section>)}
    <details><summary>Figure and table captions / references</summary><p>Parsed captions may be incomplete. This source does not supply structured table cells.</p>{Object.entries(evidence.referenceEntries||{}).map(([id,ref])=><p key={id}><strong>{id} ({ref.type})</strong>: {ref.text}</p>)}</details></>:<p style={{whiteSpace:'pre-wrap'}}>{evidence.text}</p>}
    <details><summary>Provenance and raw evidence</summary><pre>{JSON.stringify(evidence,null,2)}</pre></details></article>;
}
