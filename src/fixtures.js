// Synthetic software fixtures: these are not scientific evidence or CORD-19 papers.
export const corpusVersion = 'synthetic-fixture-v1';
export const papers = [
  { id: 'background', availableAt: '2019-12-31T23:59:59.999Z', title: 'Fixture: evidence quality background', text: 'A research claim needs traceable evidence. Review the source and record uncertainty.', claim: 'Evidence provenance matters', label: true },
  ...Array.from({ length: 12 }, (_, i) => ({
    id: `observation-${i + 1}`, availableAt: new Date(Date.UTC(2020, i + 1, 0, 12)).toISOString(),
    title: `Fixture: observation ${i + 1}`, text: `Synthetic observation ${i + 1}: the benchmark claim C${i + 1} is ${i % 3 === 2 ? 'refuted' : 'supported'} by this fixture record.`,
    claim: `Synthetic benchmark claim C${i + 1}`, label: i % 3 !== 2,
  })),
];
export function cutoffFor(month) {
  if (!Number.isInteger(month) || month < 1 || month > 12) throw new Error('Invalid replay month');
  return new Date(Date.UTC(2020, month, 1) - 1).toISOString();
}
