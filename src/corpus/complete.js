import {sha256,identityOf,contentOf,publicationBound} from './importer.js';
export function basePaper(row,snapshot,version) {
 const content=contentOf(row);const publication=publicationBound(row.publish_time);if(!content.title||!publication||publication.date>new Date('2020-12-31T23:59:59.999Z'))return null;
 const hash=sha256(content);return {paper_id:identityOf(row),version_id:`${identityOf(row)}:${hash}`,corpus_version:version,...content,content_hash:hash,available_at:new Date(Math.max(Date.parse(snapshot.observed_at),publication.date.getTime())),admitted:true,date_precision:'timestamp',date_evidence:`Official ${snapshot.release} metadata S3 object observed at ${snapshot.observed_at}; conservative upper bound.`,publish_time_raw:row.publish_time,content_scope:'abstract',availability_policy:'snapshot_upper_bound',eligible_for_precise_timing:false,license:row.license||'',authors:row.authors||'',journal:row.journal||'',...(row.doi?{doi:row.doi}:{}),source_refs:[{release:snapshot.release,source_url:snapshot.metadata_url,source_row_hash:sha256(row),observed_at:new Date(snapshot.observed_at)}]};
}
export function parseKeys(row) {
 const paths=[...(row.pdf_json_files||'').split(';'),...(row.pmc_json_files||'').split(';')].map(x=>x.trim()).filter(Boolean);
 return [...new Set([...paths,...(row.sha||'').split(';').map(x=>x.trim()).filter(x=>/^[a-f0-9]{40}$/.test(x))])];
}
export function fullPaper(row,snapshot,version,entry) {
 const paper=basePaper(row,snapshot,version);if(!paper)return null;
 const parsed=entry.parsed;if(!parsed||!Array.isArray(parsed.body_text)||parsed.body_text.some(p=>typeof p.text!=='string'||typeof p.section!=='string'))throw new Error('Invalid full-text paragraph');
 const paragraphs=parsed.body_text.map((p,index)=>({index,section:p.section,text:p.text,cite_spans:p.cite_spans||[],ref_spans:p.ref_spans||[]}));if(!paragraphs.some(p=>p.text.trim()))return null;
 const content={...contentOf(row),paragraphs,reference_entries:parsed.ref_entries||{},bibliography:parsed.bib_entries||{}};const hash=sha256(content);
 return {...paper,...content,version_id:`${paper.paper_id}:full:${hash}`,content_hash:hash,content_scope:'full_text',available_at:new Date(Math.max(paper.available_at.getTime(),Date.parse(snapshot.archive_observed_at))),date_evidence:`Official ${snapshot.release} full-text archive observed at ${snapshot.archive_observed_at}; independently gated.`,source_refs:[{release:snapshot.release,source_url:snapshot.archive_url,parse_sha256:entry.raw_hash,member:entry.member,observed_at:new Date(snapshot.archive_observed_at)}],table_support:'captions_and_references_only'};
}
