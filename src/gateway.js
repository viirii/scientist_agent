export class AccessError extends Error {}
export function eligible(paper, cutoff) {
  return typeof paper.availableAt === 'string' && Number.isFinite(Date.parse(paper.availableAt)) && Date.parse(paper.availableAt) <= Date.parse(cutoff);
}
export class TemporalGateway {
  constructor(papers, cutoff) { this.papers = papers; this.cutoff = cutoff; }
  search(query = '', limit = 10) {
    if (typeof query !== 'string' || !Number.isInteger(limit) || limit < 1 || limit > 10) throw new AccessError('Invalid search request');
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    return this.papers.filter(p => eligible(p, this.cutoff))
      .filter(p => terms.every(term => `${p.title} ${p.text}`.toLowerCase().includes(term)))
      .sort((a, b) => b.availableAt.localeCompare(a.availableAt)).slice(0, limit).map(p => structuredClone(p));
  }
  read(id) {
    const paper = this.papers.find(p => p.id === id && eligible(p, this.cutoff));
    if (!paper) throw new AccessError('Evidence unavailable'); // Same response for missing and future IDs.
    return structuredClone(paper);
  }
  resolve(id) {
    try {
      const p = this.read(id);
      return { status: p.label ? 'supported' : 'contradicted', summary: p.text, evidenceRefs: [p.id], limitations: ['Synthetic fixture; not a scientific observation.'] };
    } catch (error) {
      if (!(error instanceof AccessError)) throw error;
      return { status: 'no_evidence', summary: 'No eligible historical evidence available.', evidenceRefs: [], limitations: [] };
    }
  }
  validateRefs(refs) { for (const id of refs) this.read(id); }
}
