import assert from "node:assert/strict";
import test from "node:test";
import { deloadSets, equivalence, LB_PER_KG, loadingSets, performanceStatus, prescribe, recoveryLoad, recoverySets, snap } from "./legendary-v22-core.ts";
const kg = lb => lb / LB_PER_KG;
const ref = { weight: kg(225), reps: 8, rir: 3, prescribedRir: 3 };
test("week one calibrates at the configured RIR, including RIR 1", () => {
  const p = prescribe(null, 1, kg(2.5), true);
  assert.equal(p.weight, null); assert.equal(p.reps, null); assert.match(p.rationale, /1 RIR/);
});
test("compound load-first versus isolation rep-first at the same effort", () => {
  assert.ok(prescribe(ref, 2, kg(2.5), true).weight > ref.weight);
  assert.ok(Math.abs(prescribe(ref, 2, kg(2.5), false).weight - ref.weight) < 0.00001);
});
test("six-rep floor prevents a blind increase", () => {
  const p = prescribe({ ...ref, reps: 6, rir: 2, prescribedRir: 2 }, 2, kg(5), true);
  assert.equal(p.reps, 6); assert.ok(p.weight <= ref.weight + 0.00001);
});
test("overshooting effort does not blindly increase load", () => {
  const p = prescribe({ ...ref, reps: 6, rir: 0, prescribedRir: 2 }, 2, kg(2.5), true);
  assert.ok(p.weight < ref.weight); assert.ok(p.reps >= 6);
});
test("easier-than-prescribed effort supports a viable isolation increment", () => {
  assert.ok(prescribe({ ...ref, rir: 4, prescribedRir: 2 }, 2, kg(2.5), false).weight > ref.weight);
});
test("30-rep ceiling favors a load increment", () => {
  const p = prescribe({ ...ref, reps: 30 }, 2, kg(2.5), false);
  assert.ok(p.weight > ref.weight); assert.ok(p.reps <= 30); assert.ok(Number.isInteger(p.reps));
});
test("2.5-lb metadata snapping works in canonical kilograms", () => {
  assert.ok(Math.abs(snap(kg(228), kg(2.5)) * LB_PER_KG - 227.5) < 0.00001);
});
test("+5 lb costs about one repetition; -5 lb adds about one", () => {
  assert.ok(Math.abs(equivalence(kg(230), ref, 3).expected - 7) < 0.00001);
  assert.ok(Math.abs(equivalence(kg(220), ref, 3).expected - 9) < 0.00001);
});
test("equivalence accepts exactly +/-20 lb and stops beyond it", () => {
  assert.notEqual(equivalence(kg(245), ref, 3).expected, null);
  assert.notEqual(equivalence(kg(205), ref, 3).expected, null);
  assert.equal(equivalence(kg(246), ref, 3).expected, null);
  assert.equal(equivalence(kg(204), ref, 3).expected, null);
});
test("actual RIR changes status even when reps and weight match", () => {
  assert.equal(performanceStatus({ ...ref, rir: 0 }, ref, 2).status, "below_target");
  assert.equal(performanceStatus({ ...ref, rir: 3 }, ref, 2).status, "target_met");
  assert.equal(performanceStatus({ ...ref, rir: 4 }, ref, 2).status, "above_target");
});
test("calibration and out-of-range sets receive no fabricated status", () => {
  assert.equal(performanceStatus(ref, null, 3).status, null);
  assert.equal(performanceStatus({ ...ref, weight: kg(300) }, ref, 2).status, null);
});
test("normal weeks add exactly one set until the configured maximum", () => {
  assert.deepEqual([0, 1, 2, 3, 4].map(n => loadingSets(2, n, 5)), [2, 3, 4, 5, 5]);
  assert.equal(loadingSets(4, 1, 7), 5);
});
test("deload halves final-loading sets, rounds down, and never goes below one", () => {
  assert.deepEqual([1, 2, 3, 4, 5, 7].map(deloadSets), [1, 1, 1, 2, 2, 3]);
});
test("today-only recovery helpers reduce conservatively on valid increments", () => {
  assert.equal(recoverySets(1), 1); assert.equal(recoverySets(4), 3);
  assert.ok(Math.abs(recoveryLoad(kg(235), kg(2.5)) * LB_PER_KG - 222.5) < 0.00001);
});