import assert from "node:assert/strict";
import test from "node:test";
import {
  canEditSet,
  calibrationTargets,
  classifySetAtReference,
  fixedWeekRange,
  isCopyEligibleWeek,
  isDateInsideWeek,
  recommendationAfterCompletedWork,
  recoverySpacingWarning,
  sequentialSetStates,
  selectRecommendedCopyWeek,
} from "./workout-core.ts";

test("working sets unlock sequentially while warmups remain independent", () => {
  const states = sequentialSetStates([
    { id: 1, setNumber: 1, setType: "work", completed: false, removed: false },
    { id: 2, setNumber: 2, setType: "work", completed: false, removed: false },
    { id: 3, setNumber: 1, setType: "warmup", completed: false, removed: false },
    { id: 4, setNumber: 3, setType: "work", completed: true, removed: false },
  ]);
  assert.equal(states.get(3), "active");
  assert.equal(states.get(1), "active");
  assert.equal(states.get(2), "locked");
  assert.equal(states.get(4), "locked");
  const afterFirst = sequentialSetStates([
    { id: 1, setNumber: 1, setType: "work", completed: true, removed: false },
    { id: 2, setNumber: 2, setType: "work", completed: false, removed: false },
    { id: 3, setNumber: 3, setType: "work", completed: false, removed: false },
  ]);
  assert.equal(afterFirst.get(2), "active");
  assert.equal(afterFirst.get(3), "locked");
});

test("calibration has a 3 RIR target and no prescribed load, reps, range, or status", () => {
  assert.deepEqual(calibrationTargets(), {
    targetWeight: null,
    targetRepsMin: null,
    targetRepsMax: null,
    targetRir: 3,
    calibrationMode: true,
    targetStatus: null,
  });
});

test("completed rows are only editable with explicit intent", () => {
  assert.equal(canEditSet(false, undefined), true);
  assert.equal(canEditSet(true, undefined), false);
  assert.equal(canEditSet(true, true), true);
});

test("row target snapshots score 230 x 7 at 2 RIR against its original 225 x 7 reference", () => {
  const reference = { weight: 225, reps: 7, rir: 2, repsMin: 6, repsMax: 8 };
  assert.equal(classifySetAtReference({
    actualWeight: 230,
    actualReps: 7,
    actualRir: 2,
    reference,
  }), "target_met");
  assert.equal(classifySetAtReference({
    actualWeight: 230,
    actualReps: 12,
    actualRir: 2,
    reference,
  }), "above_target");
});

test("future prescriptions follow completed effort using the configured load increment", () => {
  const baseline = { weight: 225, reps: 7, rir: 2, repsMin: 6, repsMax: 8 };
  const met = recommendationAfterCompletedWork({
    calibrationMode: false,
    allowIncrease: true,
    baseline,
    loadIncrement: 2.5,
    anchor: {
      actualWeight: 230,
      actualReps: 7,
      actualRir: 2,
      targetStatus: "target_met",
      reference: baseline,
    },
  });
  assert.deepEqual(met, { weight: 230, reps: 7, rir: 2, repsMin: 6, repsMax: 8 });
  const editedAboveTarget = recommendationAfterCompletedWork({
    calibrationMode: false,
    allowIncrease: true,
    baseline: met,
    loadIncrement: 2.5,
    anchor: {
      actualWeight: 230,
      actualReps: 12,
      actualRir: 2,
      targetStatus: "above_target",
      reference: baseline,
    },
  });
  assert.deepEqual(editedAboveTarget, { weight: 232.5, reps: 6, rir: 2, repsMin: 6, repsMax: 8 });
});

test("calibration never creates targets after the first calibration set", () => {
  const result = recommendationAfterCompletedWork({
    calibrationMode: true,
    allowIncrease: true,
    baseline: { weight: null, reps: null, rir: 3, repsMin: null, repsMax: null },
    loadIncrement: 2.5,
    anchor: {
      actualWeight: 80,
      actualReps: 9,
      actualRir: 3,
      targetStatus: null,
      reference: { weight: null, reps: null, rir: 3, repsMin: null, repsMax: null },
    },
  });
  assert.deepEqual(result, { weight: null, reps: null, rir: 3, repsMin: null, repsMax: null });
});

test("without a remaining completed anchor, removal restores the original exercise recommendation", () => {
  assert.deepEqual(recommendationAfterCompletedWork({
    calibrationMode: false,
    allowIncrease: true,
    baseline: { weight: 225, reps: 7, rir: 2, repsMin: 6, repsMax: 8 },
    loadIncrement: 2.5,
    anchor: null,
  }), { weight: 225, reps: 7, rir: 2, repsMin: 6, repsMax: 8 });
});

test("removing the latest high-capacity anchor recalculates from the remaining completed set", () => {
  const baseline = { weight: 225, reps: 7, rir: 2, repsMin: 6, repsMax: 8 };
  assert.deepEqual(recommendationAfterCompletedWork({
    calibrationMode: false,
    allowIncrease: true,
    baseline,
    loadIncrement: 2.5,
    anchor: {
      actualWeight: 225,
      actualReps: 7,
      actualRir: 2,
      targetStatus: "target_met",
      reference: baseline,
    },
  }), { weight: 225, reps: 7, rir: 2, repsMin: 6, repsMax: 8 });
});

test("only completed loading weeks are recommended as copy sources", () => {
  assert.equal(isCopyEligibleWeek({ kind: "loading", status: "completed" }), true);
  assert.equal(isCopyEligibleWeek({ kind: "deload", status: "completed" }), false);
  assert.equal(isCopyEligibleWeek({ kind: "loading", status: "in_progress" }), false);
  const selected = selectRecommendedCopyWeek([
    { weekId: 1, kind: "loading", status: "completed", completedAt: new Date("2025-01-01T00:00:00Z") },
    { weekId: 2, kind: "deload", status: "completed", completedAt: new Date("2025-02-01T00:00:00Z") },
    { weekId: 3, kind: "loading", status: "completed", completedAt: new Date("2025-03-01T00:00:00Z") },
  ]);
  assert.equal(selected?.weekId, 3);
});

test("week dates are date-only fixed identity ranges and close spacing is informational", () => {
  assert.deepEqual(fixedWeekRange("2025-01-06", 3), {
    startDate: "2025-01-20",
    endDate: "2025-01-26",
  });
  assert.equal(isDateInsideWeek("2025-01-26", "2025-01-20", "2025-01-26"), true);
  assert.equal(isDateInsideWeek("2025-01-27", "2025-01-20", "2025-01-26"), false);
  assert.match(recoverySpacingWarning("2025-01-20", "2025-01-21") ?? "", /consecutive days/);
  assert.equal(recoverySpacingWarning("2025-01-20", "2025-01-23"), null);
});