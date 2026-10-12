// Evaluator data is never passed into the agent cycle. Matching is exact in fixture mode.
export function evaluate(checkpoint, benchmark) {
  const resolved = benchmark.filter(p => Date.parse(p.availableAt) <= Date.parse(checkpoint.cutoff));
  const predictions = checkpoint.hypotheses.filter(h => resolved.some(p => p.id === h.id));
  const matches = predictions.filter(h => {
    const p = resolved.find(p => p.id === h.id);
    return (h.pTrue >= 0.7 && p.label) || (h.pTrue <= 0.3 && !p.label);
  });
  const brier = predictions.length ? predictions.reduce((sum, h) => {
    const truth = Number(resolved.find(p => p.id === h.id).label);
    return sum + (h.pTrue - truth) ** 2;
  }, 0) / predictions.length : null;
  return { eligibleMilestones: resolved.length, matchedMilestones: matches.length,
    coverage: resolved.length ? matches.length / resolved.length : null,
    brier, calibrationDenominator: predictions.length,
    citedClaimRate: predictions.length ? predictions.filter(h => h.evidenceRefs.length).length / predictions.length : null,
    integrityViolations: 0,
    note: 'Synthetic exact-match scoring; citation presence is not entailment. No independent-discovery or scientific performance claim.' };
}
