import { useState } from 'react';
export type Well = { id: string; label?: string; evidenceId?: string };
export type WellPlateProps = { wells?: Well[]; onEvidence?: (id: string) => void };
const rows = 'ABCDEFGH'.split('');
// Display contract only: evidence links can be supplied later by curated historical records.
// Empty coordinates are layout, not measurements or historical observations.
export function WellPlate({ wells = [], onEvidence }: WellPlateProps) {
  const [selected, setSelected] = useState('A1');
  const detail = wells.find(well => well.id === selected);
  return <section className="panel"><div className="arm-top"><h2>96-well visualization</h2><span className="badge">LAYOUT PREVIEW</span></div>
    <p>Explore the interactive layout. All wells are empty; no measurements or experimental results are implied.</p>
    <div className="plate-layout"><div className="plate-scroll"><div className="plate-grid" role="group" aria-label="96-well plate layout">
      <span aria-hidden="true" />{Array.from({length:12},(_,i)=><span className="plate-label" key={`col-${i}`}>{i+1}</span>)}
      {rows.map(row=><div className="plate-row" key={row}><span className="plate-label">{row}</span>{Array.from({length:12},(_,i)=>{ const id = `${row}${i+1}`; const well = wells.find(w=>w.id === id); return <button key={id} className={`well${selected===id?' selected':''}`} aria-label={`Well ${id}`} aria-pressed={selected===id} onClick={()=>setSelected(id)} title={well?.label || `${id}: empty`}>{id}</button>; })}</div>)}
    </div></div><aside className="well-detail"><p className="eyebrow">SELECTED WELL</p><h3>{selected}</h3><p>{detail?.label || 'No data assigned.'}</p>{detail?.evidenceId && onEvidence && <button className="evidence-link" onClick={()=>onEvidence(detail.evidenceId!)}>Inspect evidence</button>}<p className="muted">Use Tab and Enter, or click a well. Future data can connect selection, colors, and evidence details.</p></aside></div>
  </section>;
}
