import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { sha256, fileHash, identityOf, contentOf, publicationBound } from './importer.js';

// Add independently dated full-text versions; never enrich/backdate an abstract in place.
export async function addFullText(plan, selections, config) {
  const additions=[]; const sources=[]; let missing=0;
  for(const selection of selections) {
    const spec=selection.snapshot.full_text;
    if(!spec)continue;
    const expected=`https://ai2-semanticscholar-cord-19.s3-us-west-2.amazonaws.com/historical_releases/cord-19_${selection.snapshot.release}.tar.gz`;
    const observed=new Date(spec.observed_at);
    if(spec.source_url!==expected || !Number.isFinite(observed.getTime()) || observed<new Date(selection.snapshot.observed_at) || observed>new Date('2020-12-31T23:59:59.999Z') || !spec.date_evidence)throw new Error('Invalid full-text provenance');
    const archiveHash=await fileHash(spec.archive_file);
    const index=JSON.parse(await readFile(resolve(spec.parse_directory,'archive-index.json'),'utf8'));
    if(index.archive_sha256!==archiveHash)throw new Error('Invalid full-text archive index');
    const source={release:selection.snapshot.release,...spec,archive_sha256:archiveHash};sources.push(source);
    for(const {row} of selection.rows) {
      const sha=(row.sha||'').trim();
      if(!/^[a-f0-9]{40}$/.test(sha)){missing++;continue;}
      let raw;
      try{raw=await readFile(resolve(spec.parse_directory,`${sha}.json`),'utf8');}catch(error){if(error.code==='ENOENT'){missing++;continue;}throw error;}
      if(Buffer.byteLength(raw)>8_000_000)throw new Error('Invalid full-text size');
      if(index.parses[sha]?.sha256!==sha256(raw))throw new Error('Invalid full-text parse hash');
      const parsed=JSON.parse(raw);
      if(parsed.paper_id!==sha || !Array.isArray(parsed.body_text))throw new Error('Invalid full-text identity');
      const paragraphs=parsed.body_text.map((p,index)=>{
        if(typeof p.text!=='string'||typeof p.section!=='string')throw new Error('Invalid full-text paragraph');
        return {index,section:p.section,text:p.text,cite_spans:p.cite_spans||[],ref_spans:p.ref_spans||[]};
      });
      if(!paragraphs.some(p=>p.text.trim())){missing++;continue;}
      const refs=parsed.ref_entries||{};const bibliography=parsed.bib_entries||{};
      const content={...contentOf(row),paragraphs,reference_entries:refs,bibliography};
      const hash=sha256(content);const versionId=`${identityOf(row)}:full:${hash}`;
      if(plan.papers.some(p=>p.version_id===versionId))continue;
      const available=new Date(Math.max(observed.getTime(),publicationBound(row.publish_time).date.getTime()));
      const paper={...plan.papers.find(p=>p.paper_id===identityOf(row)&&p.content_hash===sha256(contentOf(row))),
        version_id:versionId,content_hash:hash,available_at:available,content_scope:'full_text',paragraphs,reference_entries:refs,bibliography,
        full_text_sha:sha,date_evidence:spec.date_evidence,source_refs:[{release:selection.snapshot.release,source_url:spec.source_url,archive_sha256:archiveHash,parse_sha256:sha256(raw),observed_at:observed}],table_support:'captions_and_references_only'};
      plan.papers.push(paper);additions.push({version_id:versionId,content_hash:hash,available_at:available.toISOString(),parse_sha256:sha256(raw)});
      for(const paragraph of paragraphs)for(let offset=0;offset<paragraph.text.length;offset+=config.chunk_characters){
        const text=paragraph.text.slice(offset,offset+config.chunk_characters);
        plan.chunks.push({chunk_id:`${sha256(versionId)}:body:${paragraph.index}:${offset}`,version_id:versionId,corpus_version:config.corpus_version,available_at:available,admitted:true,text,section:paragraph.section,paragraph_index:paragraph.index,offset,hash:sha256(text)});
      }
    }
  }
  plan.papers.sort((a,b)=>a.version_id.localeCompare(b.version_id));
  plan.manifest.full_text={sources,versions:additions,missing_selected:missing,table_support:'Captions/references are preserved. Structured table cells are not inferred.'};
  plan.manifest.chunk_hashes=plan.chunks.map(c=>({chunk_id:c.chunk_id,hash:c.hash}));
  plan.manifest.limitations[0]='Automated topic-filtered starter selection, not expert curation. Full text only where matched historical parses are available.';
  plan.manifestHash=sha256(plan.manifest);
  return plan;
}
