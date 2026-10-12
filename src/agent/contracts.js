import {strategyProperties} from './strategy.js';
import { ReplayError } from '../errors.js';
const str=(max=1000)=>({type:'string',minLength:1,maxLength:max});
const array=(items,maxItems)=>({type:'array',items,maxItems});
const object=properties=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
export const querySchema=object({query:{type:'string',maxLength:256}});
export const selectionSchema=object({read_ids:array(str(500),2)});
const citation=object({version_id:str(500),quote_start:{type:'integer',minimum:0},quote_end:{type:'integer',minimum:1},quote:str(600),relation:{type:'string',enum:['supports','contradicts','context']}});
export const cycleSchema=object({
 hypothesis_updates:array(object({id:str(80),claim:str(),p_true:{type:'number',minimum:0,maximum:1},status:{type:'string',enum:['open','supported','refuted']},rationale:str(),evidence_refs:{...array(citation,4),minItems:1}}),3),
 memory_updates:array(object({kind:{type:'string',enum:['summary','lesson']},text:str(),evidence_refs:{...array(citation,4),minItems:1}}),3),
 next_questions:array(str(256),3),
 lab_requests:array(object({hypothesis_id:str(80),question:str(500),why_it_matters:str(500),goal_connection:str(500),competing_explanations:array(str(300),3),evidence_needed:str(500),limitations:str(500),priority:{type:'string',enum:['high','medium','low']},evidence_refs:{...array(citation,4),minItems:1},evidence_category:{type:'string',enum:['published_observation','literature_comparison']},discriminating_outcomes:array(str(200),3)}),2),
 harness_proposal:{anyOf:[{type:'null'},object({...strategyProperties,reason:str(500),expected_benefit:str(500)})]}
});
export function validate(schema,value) {
 if(schema.anyOf){if(!schema.anyOf.some(s=>{try{validate(s,value);return true;}catch{return false;}}))throw new ReplayError('Invalid model output',422);return value;}
 const type=schema.type;
 if((type==='object'&&(!value||typeof value!=='object'||Array.isArray(value)))||(type==='array'&&!Array.isArray(value))||(type==='integer'&&!Number.isInteger(value))||(type==='number'&&(!Number.isFinite(value)))||(type==='string'&&typeof value!=='string')||(type==='boolean'&&typeof value!=='boolean')||(type==='null'&&value!==null))throw new ReplayError('Invalid model output',422);
 if(schema.enum&&!schema.enum.includes(value))throw new ReplayError('Invalid model output',422);
 if(type==='object'){if(Object.keys(value).some(k=>!Object.hasOwn(schema.properties,k))||schema.required.some(k=>!Object.hasOwn(value,k)))throw new ReplayError('Invalid model output',422);for(const [k,s] of Object.entries(schema.properties))validate(s,value[k]);}
 if(type==='array'){if(value.length<(schema.minItems||0)||value.length>schema.maxItems)throw new ReplayError('Model output exceeds bounds',422);value.forEach(v=>validate(schema.items,v));}
 if(type==='string'&&(value.length<(schema.minLength||0)||value.length>schema.maxLength))throw new ReplayError('Model text exceeds bounds',422);
 if(['number','integer'].includes(type)&&((schema.minimum!==undefined&&value<schema.minimum)||(schema.maximum!==undefined&&value>schema.maximum)))throw new ReplayError('Model value exceeds bounds',422);
 return value;
}
export function validateCitations(refs,sources) {
 if(!refs.length)throw new ReplayError('Evidence-backed updates require citations',422);
 for(const ref of refs){const source=sources.find(p=>p.id===ref.version_id);if(!source||ref.quote_end<=ref.quote_start||source.text.slice(ref.quote_start,ref.quote_end)!==ref.quote)throw new ReplayError('Citation must exactly match a read eligible excerpt',422);}
}

// Models copy quotes more reliably than they count character offsets. Resolve a
// unique verbatim quote server-side; never use fuzzy matching or substitute text.
export function anchorCitations(refs,sources){
 for(const ref of refs){const source=sources.find(p=>p.id===ref.version_id);if(!source||!ref.quote)throw new ReplayError('Citation must exactly match a read eligible excerpt',422);
  if(ref.quote_end>ref.quote_start&&source.text.slice(ref.quote_start,ref.quote_end)===ref.quote)continue;
  const start=source.text.indexOf(ref.quote);
  if(start<0||source.text.indexOf(ref.quote,start+1)>=0)throw new ReplayError('Citation quote is missing or ambiguous in the read excerpt',422);
  ref.quote_start=start;ref.quote_end=start+ref.quote.length;
 }
 return refs;
}
