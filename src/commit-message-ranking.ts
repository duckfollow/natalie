export function bestCandidate(scores: readonly number[]): number {
  if (!scores.length || scores.some(score => !Number.isFinite(score))) throw Error("Invalid model scores.");
  return scores.reduce((best, score, index) => score > scores[best] ? index : best, 0);
}
