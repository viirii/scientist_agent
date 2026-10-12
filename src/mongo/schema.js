const string = { bsonType:'string', minLength:1 };
const date = { bsonType:'date' };
function schema(required, properties) { return {$jsonSchema:{bsonType:'object',required,properties}}; }
export const corpusCollections = {
  corpora: {
    validator: schema(['corpus_version','status','manifest_hash','created_at'],{
      corpus_version:string,status:{enum:['staging','frozen']},manifest_hash:string,created_at:date,
      source_release:string,document_count:{bsonType:['int','long'],minimum:0},
    }),
    indexes:[{key:{corpus_version:1},name:'unique_corpus_version',unique:true}],
  },
  papers: {
    validator: schema(['paper_id','version_id','corpus_version','title','available_at','date_precision','date_evidence','content_hash','admitted'],{
      paper_id:string,version_id:string,corpus_version:string,title:string,available_at:date,
      date_precision:{enum:['day','month','year','timestamp']},date_evidence:string,content_hash:string,
      admitted:{enum:[true]},cord_uid:string,doi:string,publish_time_raw:{bsonType:'string'},
    }),
    indexes:[
      {key:{corpus_version:1,version_id:1},name:'unique_paper_version',unique:true},
      {key:{corpus_version:1,admitted:1,available_at:1},name:'paper_temporal_gate'},
    ],
  },
  chunks: {
    validator: schema(['chunk_id','version_id','corpus_version','available_at','admitted','text','section','offset','hash'],{
      chunk_id:string,version_id:string,corpus_version:string,available_at:date,admitted:{enum:[true]},text:string,section:{bsonType:'string'},
      offset:{bsonType:['int','long'],minimum:0},hash:string,
    }),
    indexes:[
      {key:{corpus_version:1,chunk_id:1},name:'unique_chunk_in_corpus',unique:true},
      {key:{corpus_version:1,version_id:1,offset:1},name:'chunk_version_order'},
      {key:{corpus_version:1,admitted:1,available_at:1},name:'chunk_temporal_gate'},
    ],
  },
  quarantine: {
    validator:schema(['corpus_version','source_id','reason','created_at'],{
      corpus_version:string,source_id:string,reason:string,created_at:date,raw_metadata:{bsonType:'object'},
    }),
    indexes:[{key:{corpus_version:1,source_id:1},name:'unique_quarantined_source',unique:true}],
  },
};
export function temporalFilter(corpusVersion, cutoff) {
  if (typeof corpusVersion!=='string' || !corpusVersion || !(cutoff instanceof Date) || !Number.isFinite(cutoff.getTime())) throw new Error('Valid corpus version and server cutoff required');
  return {corpus_version:corpusVersion,admitted:true,available_at:{$lte:new Date(cutoff)}};
}
const canonical = value => JSON.stringify(value, (key,item)=> item && typeof item==='object' && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a],[b])=>a.localeCompare(b))) : item);
export async function prepareCorpus(db) {
  // Repeatable bootstrap, never modify an incompatible existing validator or existing data.
  const existing = await db.listCollections({}, {nameOnly:false}).toArray();
  for(const [name,spec] of Object.entries(corpusCollections)) {
    const collection = existing.find(c=>c.name===name);
    if (collection && (canonical(collection.options?.validator)!==canonical(spec.validator) || (collection.options?.validationLevel || 'strict')!=='strict' || (collection.options?.validationAction || 'error')!=='error')) throw new Error('Incompatible existing corpus collection; use a fresh replay_corpus_* database.');
  }
  for(const [name,spec] of Object.entries(corpusCollections)) {
    if(!existing.some(c=>c.name===name)) await db.createCollection(name,{validator:spec.validator,validationLevel:'strict',validationAction:'error'});
    await db.collection(name).createIndexes(spec.indexes);
  }
  return Object.keys(corpusCollections);
}
