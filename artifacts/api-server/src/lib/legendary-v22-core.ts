/** All persisted loads are kilograms. The user's comparison rule is in pounds. */
export const LB_PER_KG = 2.20462262185;
export const OUTSIDE_RANGE = "Outside prediction range. Legendary Progression can't reliably estimate the equivalent rep change at this load difference. Train to the prescribed RIR and your completed set will help establish a new reference.";
export const LOAD_NOT_CALCULATED = "This workout is more than one training week ahead of your latest completed workout. Return to the current week to establish progression data.";
export type PerformanceReference = { weight: number; reps: number; rir: number; prescribedRir?: number };
export const snap = (weight: number, increment: number) => {
  if (!Number.isFinite(weight) || !Number.isFinite(increment) || increment <= 0) throw new Error("Invalid load or increment");
  return Number((Math.round(weight / increment) * increment).toFixed(6));
};
export function equivalence(weight: number, reference: PerformanceReference, targetRir: number) {
  const pounds = (weight - reference.weight) * LB_PER_KG;
  if (Math.abs(pounds) > 20.00001) return { expected: null, warning: OUTSIDE_RANGE, pounds };
  return { expected: reference.reps + reference.rir - targetRir - pounds / 5, warning: null, pounds };
}
export function performanceStatus(actual: PerformanceReference, reference: PerformanceReference | null, targetRir: number, calibration = false) {
  if (!reference || calibration) return { status: null, explanation: null };
  const estimate = equivalence(actual.weight, reference, targetRir);
  if (estimate.expected === null) return { status: null, explanation: estimate.warning };
  const difference = actual.reps + actual.rir - targetRir - estimate.expected;
  const status = difference > 0.5 ? "above_target" : difference < -0.5 ? "below_target" : "target_met";
  return { status: status as "above_target" | "below_target" | "target_met",
    explanation: `Compared with ${reference.reps} reps at the reference load and ${reference.rir} RIR, load/rep equivalence and actual ${actual.rir} versus prescribed ${targetRir} RIR give an effort-adjusted difference of ${difference.toFixed(1)} reps. Reps alone do not determine this status.` };
}
export function prescribe(reference: PerformanceReference | null, targetRir: number, increment: number, compound: boolean, hold = false) {
  if (!reference) return { weight: null, reps: null, reference: null, rationale: `Calibration: choose a load and stop near ${targetRir} RIR.` };
  const base = snap(reference.weight, increment);
  const overshot = reference.rir < (reference.prescribedRir ?? reference.rir) - 0.5;
  const same = equivalence(base, reference, targetRir);
  const candidate = snap(base + increment, increment);
  const next = equivalence(candidate, reference, targetRir);
  const easy = reference.rir > (reference.prescribedRir ?? reference.rir) + 0.5;
  const increase = !hold && !overshot && next.expected !== null && next.expected >= 6 &&
    (compound || easy || (same.expected ?? 0) >= 30);
  let weight = increase ? candidate : base;
  let estimate = equivalence(weight, reference, targetRir);
  if (estimate.expected !== null && estimate.expected < 6) {
    const lower = snap(base - (6 - estimate.expected) * 5 / LB_PER_KG, increment);
    if (lower >= 0 && equivalence(lower, reference, targetRir).expected !== null) weight = lower;
    estimate = equivalence(weight, reference, targetRir);
  }
  const reps = estimate.expected === null ? null : Math.max(6, Math.min(30, Math.round(estimate.expected)));
  return { weight, reps, reference, rationale: overshot
    ? "Actual RIR overshot the previous prescription. Hold or reduce load so prescribed effort is achievable."
    : increase ? "Load-first progression, with prescribed RIR and the six-rep floor protected."
    : compound ? "Hold load: prescribed RIR provides overload without pushing expected performance below six reps."
    : "Rep-first progression: keep the load while observed performance develops toward a viable equipment increment." };
}
export const loadingSets = (base: number, loadingIndex: number, maximum: number) => Math.max(1, Math.min(maximum, base + loadingIndex));
export const deloadSets = (finalLoadingSets: number) => Math.max(1, Math.floor(finalLoadingSets / 2));
export const recoverySets = (normal: number) => Math.max(1, normal - 1);
export const recoveryLoad = (normal: number, increment: number) => Math.max(0, Math.floor(normal * 0.95 / increment + 1e-8) * increment);