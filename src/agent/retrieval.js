// Keep a failed query tied to its research topic instead of silently browsing everything.
export function broadenQuery(query) {
 const terms=query.toLowerCase().match(/[a-z0-9-]+/g)||[];
 const anchors=['vaccine','immunity','immune','receptor','antibody','interferon','transmission','treatment','host'];
 return anchors.find(term=>terms.includes(term))||terms.filter(t=>!['coronavirus','covid-19','sars-cov-2','the','and','of','in','for','what','how'].includes(t)).sort((a,b)=>b.length-a.length)[0]||terms[0]||'';
}
export async function retrieveCandidates(provider,pair,query,exclude=[],config={}) {
 const searches=[];
 let candidates=await provider.search(pair,query,exclude);searches.push({query,count:candidates.length});
 if((!candidates.length||config.searchApproach==='broaden')&&query.trim()){
  const broader=broadenQuery(query);
  if(broader&&broader!==query.trim().toLowerCase()){const extra=await provider.search(pair,broader,exclude);searches.push({query:broader,count:extra.length});candidates=[...new Map([...candidates,...extra].map(p=>[p.id,p])).values()];}
 }
 return {candidates,searches};
}
export function rankCandidates(candidates,config={}) {
 return [...candidates].sort((a,b)=>Number(b.contentScope==='full_text')-Number(a.contentScope==='full_text')||(config.prioritizeRecent?Date.parse(b.availableAt)-Date.parse(a.availableAt):0));
}
