import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import type { CorpusResult, Pair } from '../types';
export function CorpusBrowser({pair,onEvidence}:{pair:Pair;onEvidence:(id:string)=>void}) {
  const [query,setQuery]=useState('');const [result,setResult]=useState<CorpusResult>();const [error,setError]=useState('');const [loading,setLoading]=useState(false);const generation=useRef(0);
  const search=async(term:string)=>{
    const request=++generation.current;setLoading(true);setError('');setResult(undefined);
    try{const data=await api<CorpusResult>(`/api/pairs/${pair.id}/papers?query=${encodeURIComponent(term)}`);if(generation.current===request)setResult(data);}
    catch(error){if(generation.current===request)setError(error instanceof Error?error.message:'Paper search failed');}
    finally{if(generation.current===request)setLoading(false);}
  };
  useEffect(()=>{setQuery('');void search('');return()=>{generation.current++;};},[pair.id,pair.month,pair.status]);
  return <section className="panel"><div className="arm-top"><h2>Newly published literature (available knowledge)</h2></div><p>Only versions available by this run’s current cutoff are returned. Reading a paper here does not change agent memory.</p>
    <form className="toolbar" onSubmit={event=>{event.preventDefault();void search(query);}}><label>Search papers <input type="search" maxLength={256} value={query} onChange={event=>setQuery(event.target.value)} placeholder="e.g. immune response" /></label><button disabled={loading}>Search</button></form>
    {loading && <p aria-live="polite">Loading eligible evidence from Mongo…</p>}{error && <p role="alert" className="error-message">{error}</p>}
    {result && <><p className="muted">{result.papers} eligible paper versions · {result.chunks} text chunks · {result.corpusVersion}</p>{!result.results.length && <div className="lesson">{result.papers===0?'No papers are available at this cutoff. The starter corpus has no verified January/February versions. Advance through the monthly checkpoints to unlock March.':'No papers match this search.'}</div>}{result.results.map(paper=><article className="hypothesis" key={paper.id}><h3>{paper.title}</h3><p className="muted">Available by {new Date(paper.availableAt).toLocaleDateString('en-US',{timeZone:'UTC'})} · {paper.contentScope==='full_text'?'Full text':'Abstract only'} · Conservative snapshot bound</p><button className="evidence-link" onClick={()=>onEvidence(paper.id)}>Read paper and provenance</button></article>)}{result.results.length===20 && <p className="muted">Showing the first 20 matches. Narrow the search to find other papers.</p>}</>}
  </section>;
}
