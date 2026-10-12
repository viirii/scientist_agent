import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { parse } from 'csv-parse';

export const sha256 = value => createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value,(key,item)=>item && typeof item==='object' && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a],[b])=>a.localeCompare(b))) : item)).digest('hex');
const endOfReplay = new Date('2020-12-31T23:59:59.999Z');
export function publicationBound(raw) {
  if(typeof raw!=='string') return null;
  const match=raw.trim().match(/^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/);
  if(!match)return null;
  const year=Number(match[1]); const month=match[2]?Number(match[2]):12;
  if(year<1800||year>2100||month<1||month>12)return null;
  const lastDay=new Date(Date.UTC(year,month,0)).getUTCDate();
  const day=match[3]?Number(match[3]):lastDay;
  if(day<1||day>lastDay)return null;
  return {date:new Date(Date.UTC(year,month-1,day,23,59,59,999)),precision:match[3]?'day':match[2]?'month':'year'};
}
function textValue(row,key) {return typeof row[key]==='string'?row[key].trim():'';}
export function contentOf(row) {return {title:textValue(row,'title'),abstract:textValue(row,'abstract')};}
export function identityOf(row) {
  const doi=textValue(row,'doi').toLowerCase().replace(/^https?:\/\/(?:dx\.)?doi\.org\//,'');
  if(doi)return `doi:${doi}`;
  const pmcid=textValue(row,'pmcid'); if(pmcid)return `pmc:${pmcid.toUpperCase()}`;
  const uid=textValue(row,'cord_uid'); if(uid)return `cord:${uid}`;
  return `title:${sha256(textValue(row,'title').toLowerCase())}`;
}
export function relevance(row) {
  const {title,abstract}=contentOf(row); const text=`${title} ${abstract}`.toLowerCase();
  if(!/sars[ -]?(?:cov[ -]?)?2|covid[ -]?19|coronavirus|sars[ -]?cov|mers/.test(text))return 0;
  const topics=['entry','receptor','host','immune','interferon','antibody','neutraliz','vaccine','response','transmission'];
  const hits=topics.filter(term=>text.includes(term)).length;
  if(!hits)return 0;
  return hits + Number(/sars[ -]?cov[ -]?2|covid[ -]?19/.test(title.toLowerCase()))*3;
}
export function validateCuration(config) {
  if(!config || !/^[a-z0-9][a-z0-9_-]{0,99}$/.test(config.corpus_version) || config.selection_policy!=='topic-balanced-abstracts-v1')throw new Error('Invalid corpus version or selection policy');
  for(const [key,min,max] of [['per_month',1,30],['background_limit',0,100],['quarantine_limit',0,100],['chunk_characters',200,4000]]) if(!Number.isInteger(config[key])||config[key]<min||config[key]>max)throw new Error(`Invalid curation setting: ${key}`);
  if(!Array.isArray(config.snapshots)||!config.snapshots.length||config.snapshots.length>12)throw new Error('One to twelve source snapshots required');
  const releases=new Set();
  for(const snapshot of config.snapshots) {
    const release=publicationBound(snapshot.release);
    const observed=new Date(snapshot.observed_at);
    let url; try{url=new URL(snapshot.source_url);}catch{throw new Error('Invalid snapshot source');}
    if(!release || release.precision!=='day' || !Number.isFinite(observed.getTime()) || observed>endOfReplay || observed.getTime()<release.date.getTime()-86399999 || !snapshot.metadata_file || !snapshot.date_evidence || releases.has(snapshot.release))throw new Error('Invalid snapshot provenance');
    if(url.protocol!=='https:'||url.hostname!=='ai2-semanticscholar-cord-19.s3-us-west-2.amazonaws.com'||!url.pathname.startsWith(`/${snapshot.release}/`))throw new Error('Source must be an official historical snapshot');
    releases.add(snapshot.release);
  }
}
export async function fileHash(path) {
  const hash=createHash('sha256'); for await(const buffer of createReadStream(path))hash.update(buffer); return hash.digest('hex');
}
function rank(a,b) {return b.score-a.score || a.rowHash.localeCompare(b.rowHash);}
export async function selectSnapshot(snapshot,config) {
  const groups=new Map(); const quarantined=[]; let scanned=0,relevant=0;
  const path=resolve(snapshot.metadata_file);
  const initialStat=await stat(path);
  const sourceStream=createReadStream(path);
  const parser=parse({columns:true,bom:true,skip_empty_lines:true,max_record_size:2_000_000});
  sourceStream.on('error',error=>parser.destroy(error));sourceStream.pipe(parser);
  let checked=false;
  for await(const row of parser) {
    if(!checked){if(!['title','abstract','publish_time'].every(key=>Object.hasOwn(row,key)))throw new Error('CORD-19 CSV requires title, abstract and publish_time headers');checked=true;}
    scanned++; const score=relevance(row); if(!score)continue; relevant++;
    const rowHash=sha256(row); const publication=publicationBound(textValue(row,'publish_time')); const content=contentOf(row);
    let reason;
    if(!content.title||!content.abstract)reason='missing_title_or_abstract';
    else if(!publication)reason='missing_or_invalid_publication_date';
    else if(publication.date>endOfReplay)reason='publication_after_replay_end';
    if(reason){quarantined.push({row,rowHash,reason,score});quarantined.sort(rank);quarantined.splice(config.quarantine_limit);continue;}
    const bucket=publication.date.getUTCFullYear()<2020?'background':String(publication.date.getUTCMonth()+1);
    const limit=bucket==='background'?config.background_limit:config.per_month;
    const candidates=groups.get(bucket)||[];
    // Duplicate source rows must not crowd out distinct versions in the small starter selection.
    const key=`${identityOf(row)}:${sha256(content)}`;
    if(!candidates.some(c=>c.key===key))candidates.push({row,rowHash,score,key});
    candidates.sort(rank);candidates.splice(limit);groups.set(bucket,candidates);
  }
  if(!checked)throw new Error('Empty source metadata file');
  const metadataHash=await fileHash(path);
  const finalStat=await stat(path);
  if(initialStat.size!==finalStat.size||initialStat.mtimeMs!==finalStat.mtimeMs)throw new Error('Source changed during preparation');
  return {snapshot:{...snapshot,metadata_sha256:metadataHash,bytes:finalStat.size},rows:[...groups.values()].flat(),quarantined,stats:{scanned,relevant,selected:[...groups.values()].reduce((n,rows)=>n+rows.length,0),quarantine_selected:quarantined.length}};
}
export function buildPlan(config,selections) {
  validateCuration(config);
  const versions=new Map(); const quarantine=[];
  for(const selection of selections) {
    const source=selection.snapshot; const observed=new Date(source.observed_at);
    for(const {row,rowHash} of selection.rows) {
      const content=contentOf(row); const publication=publicationBound(textValue(row,'publish_time'));
      if(!publication||!content.title||!content.abstract)throw new Error('Invalid selected record');
      const contentHash=sha256(content); const paperId=identityOf(row); const versionId=`${paperId}:${contentHash}`;
      const available=new Date(Math.max(observed.getTime(),publication.date.getTime()));
      if(available>endOfReplay)throw new Error('Selected record exceeds replay boundary');
      const reference={release:source.release,source_url:source.source_url,source_row_hash:rowHash,metadata_sha256:source.metadata_sha256,observed_at:observed};
      const existing=versions.get(versionId);
      if(existing){
        existing.source_refs.push(reference);
        // Exact same title/abstract seen in an earlier snapshot can use that earlier conservative bound.
        if(available<existing.available_at){existing.available_at=available;existing.date_evidence=source.date_evidence;}
        continue;
      }
      versions.set(versionId,{paper_id:paperId,version_id:versionId,corpus_version:config.corpus_version,title:content.title,
        abstract:content.abstract,available_at:available,date_precision:'timestamp',date_evidence:source.date_evidence,
        content_hash:contentHash,admitted:true,publish_time_raw:textValue(row,'publish_time'),publication_precision:publication.precision,
        availability_policy:'snapshot_upper_bound',eligible_for_precise_timing:false,content_scope:'abstract',
        ...(textValue(row,'cord_uid')?{cord_uid:textValue(row,'cord_uid')}:{}),...(textValue(row,'doi')?{doi:textValue(row,'doi')}:{}),
        license:textValue(row,'license'),source_refs:[reference]});
    }
    for(const {row,rowHash,reason} of selection.quarantined)quarantine.push({corpus_version:config.corpus_version,source_id:`${source.release}:${rowHash}`,reason,raw_metadata:row,source_release:source.release});
  }
  const paperDocs=[...versions.values()].sort((a,b)=>a.version_id.localeCompare(b.version_id));
  const chunks=[];
  for(const paper of paperDocs) {
    for(let offset=0;offset<paper.abstract.length;offset+=config.chunk_characters) {
      const text=paper.abstract.slice(offset,offset+config.chunk_characters);
      chunks.push({chunk_id:`${sha256(paper.version_id)}:${offset}`,version_id:paper.version_id,corpus_version:config.corpus_version,
        available_at:paper.available_at,admitted:true,text,section:'abstract',offset,hash:sha256(text)});
    }
  }
  const manifest={format_version:1,curation:config,sources:selections.map(s=>s.snapshot),stats:selections.map(s=>({release:s.snapshot.release,...s.stats})),
    paper_versions:paperDocs.map(p=>({version_id:p.version_id,available_at:p.available_at.toISOString(),content_hash:p.content_hash,source_refs:p.source_refs})),
    chunk_hashes:chunks.map(c=>({chunk_id:c.chunk_id,hash:c.hash})),quarantine:quarantine.map(q=>({source_id:q.source_id,reason:q.reason})),
    limitations:['Automated topic-filtered starter selection, not expert curation. Abstracts only.', 'Snapshot upper bounds do not establish first publication/discovery dates.', 'No January/February text-version evidence; empty early-month access is intentional.', 'Only two snapshots; intermediate version coverage is incomplete.']};
  return {manifest,manifestHash:sha256(manifest),papers:paperDocs,chunks,quarantine};
}
