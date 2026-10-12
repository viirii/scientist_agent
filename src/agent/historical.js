import { createHash } from 'node:crypto';
import { cutoffFor } from '../fixtures.js';
import { ReplayError } from '../errors.js';
import { validateCitations } from './contracts.js';

// Curated observations are a resolver input, never a hidden benchmark. Matching
// retrieves related evidence; it does not decide whether a hypothesis is true.
export class HistoricalResolver {
  constructor(cards=[]) {
    const ids=new Set();
    for(const c of cards) {
      if(!c.id||ids.has(c.id)||!c.corpusVersion||!c.versionId||!c.contentHash||!c.observation||!c.limitations||!c.review?.reviewer||c.review.status!=='reviewed'||!Array.isArray(c.matchAll)||!c.matchAll.length||c.matchAll.some(t=>typeof t!=='string'||!t.trim())||!c.quote||!Number.isFinite(Date.parse(c.availableAt)))throw new ReplayError('Invalid reviewed historical observation card');
      ids.add(c.id);
    }
    this.cards=structuredClone(cards);
    this.manifestHash=createHash('sha256').update(JSON.stringify(this.cards)).digest('hex');
  }
  async resolve(pair,request,provider) {
    const cutoff=Date.parse(cutoffFor(pair.month));
    const text=request.question.toLowerCase();
    const matches=this.cards.filter(c=>c.corpusVersion===pair.corpusVersion&&Date.parse(c.availableAt)<=cutoff&&c.matchAll.every(term=>text.includes(term.toLowerCase()))).slice(0,2);
    const observations=[];
    for(const card of matches) {
      let source;
      try{source=await provider.read(pair,card.versionId);}catch(error){if(error.status===404)continue;throw error;}
      if(source.id!==card.versionId||!Number.isFinite(Date.parse(source.availableAt))||Date.parse(source.availableAt)>cutoff||Date.parse(source.availableAt)>Date.parse(card.availableAt)||source.contentHash!==card.contentHash)throw new ReplayError('Historical observation provenance verification failed',422);
      const citation={version_id:source.id,quote_start:card.quoteStart,quote_end:card.quoteStart+card.quote.length,quote:card.quote,relation:'context'};
      validateCitations([citation],[source]);
      observations.push({cardId:card.id,observation:card.observation,limitations:card.limitations,citation,availableAt:card.availableAt,review:card.review});
    }
    return {status:observations.length?'resolved':'no_evidence',observations,checkedCutoff:cutoffFor(pair.month),manifestHash:this.manifestHash,interpretation:observations.length?'Related published evidence; not a performed experiment or automatic confirmation.':'No matching reviewed evidence available in this corpus at this cutoff; this is not evidence that the hypothesis is false.'};
  }
}

export async function resolveRequests(pair,arm,provider,resolver,record) {
  if(!resolver)return;
  for(const request of (arm.researchRequests||[]).filter(r=>r.status!=='resolved'&&r.result?.checkedCutoff!==cutoffFor(pair.month)).slice(0,2)) {
    const result=await resolver.resolve(pair,request,provider);
    request.status=result.status;request.result=result;
    arm.usage.labRequests++;
    const event=record(arm,pair,'historical_observation',{requestId:request.id,...result});
    if(result.observations.length) {
      const item={month:pair.month,kind:'historical_observation',text:result.observations.map(o=>`${o.observation} Limitations: ${o.limitations}`).join('\n'),citations:result.observations.map(o=>o.citation),evidenceRefs:result.observations.map(o=>o.citation.version_id),sourceEventIds:[event.id],maxSourceAvailableAt:result.observations.map(o=>o.availableAt).sort().at(-1),provenance:'reviewed_historical_observation'};
      arm.memory.push(item);record(arm,pair,'memory_update',item);
    }
  }
}
