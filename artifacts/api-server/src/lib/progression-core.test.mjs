import assert from "node:assert/strict";
import test from "node:test";
import {
  adaptiveRepsForWeight,
  calculateProgression,
} from "./progression-core.ts";
import { primaryMuscleVolume } from "./volume.ts";

const baseExercise = {
  category: "strength",
  equipment: "Barbell",
  isCompound: true,
  muscleGroup: "Chest",
  targetSets: 3,
  minimumWorkingSets: 2,
  maximumWorkingSets: 4,
  targetRepsMin: 6,
  targetRepsMax: 8,
  targetRir: 2,
  targetWeight: 225,
};

test("effort-adjusted Epley target adapts 225 x 7 to about 230 x 6", () => {
  assert.deepEqual(adaptiveRepsForWeight(230, 225, 7, 6, 8, 2), {
    reps: 6,
    warning: null,
  });
  const farOutside = adaptiveRepsForWeight(450, 225, 7, 6, 8, 2);
  assert.equal(farOutside.reps, 6);
  assert.match(farOutside.warning ?? "", /outside the 6-8 rep target/);
});

test("volume plateau compares per-set effort-adjusted capacity, not set-count totals", () => {
  const exposures = [
    [{ weight: 90, reps: 8, rir: 2, status: "target_met" }],
    Array.from({ length: 4 }, () => ({ weight: 92.3077, reps: 7, rir: 2, status: "target_met" })),
    Array.from({ length: 2 }, () => ({ weight: 94.7368, reps: 6, rir: 2, status: "target_met" })),
  ];
  const recommendation = calculateProgression({
    exercise: baseExercise,
    exposures,
    recoveryHistory: [
      { readiness: "normal", muscleRecovery: "fully_recovered" },
      { readiness: "great", muscleRecovery: "slightly_fatigued" },
      { readiness: "normal", muscleRecovery: "fully_recovered" },
    ],
    weeklyMuscleSets: 6,
  });
  assert.equal(recommendation.outcome, "increase_sets");
  assert.equal(recommendation.targetSets, 4);
});

test("struggling at low reps is not a plateau eligible for additional sets", () => {
  const exposures = Array.from({ length: 3 }, () =>
    Array.from({ length: 3 }, () => ({ weight: 100, reps: 6, rir: 0, status: "below_target" })),
  );
  const recommendation = calculateProgression({
    exercise: baseExercise,
    exposures,
    recoveryHistory: [
      { readiness: "great", muscleRecovery: "fully_recovered" },
      { readiness: "great", muscleRecovery: "fully_recovered" },
      { readiness: "normal", muscleRecovery: "fully_recovered" },
    ],
    weeklyMuscleSets: 6,
  });
  assert.notEqual(recommendation.outcome, "increase_sets");
});

test("volume decrease requires repeated capacity decline and repeated recorded poor recovery", () => {
  const decline = [
    Array.from({ length: 3 }, () => ({ weight: 90, reps: 6, rir: 2, status: "target_met" })),
    Array.from({ length: 3 }, () => ({ weight: 95, reps: 7, rir: 2, status: "target_met" })),
    Array.from({ length: 3 }, () => ({ weight: 100, reps: 8, rir: 2, status: "target_met" })),
  ];
  const onePoorReport = calculateProgression({
    exercise: baseExercise,
    exposures: decline,
    recoveryHistory: [{ readiness: "poor", muscleRecovery: "very_sore" }],
    weeklyMuscleSets: 10,
  });
  assert.notEqual(onePoorReport.outcome, "decrease_sets");
  const repeatedPoorReports = calculateProgression({
    exercise: baseExercise,
    exposures: decline,
    recoveryHistory: [
      { readiness: "poor", muscleRecovery: "very_sore" },
      { readiness: "poor", muscleRecovery: "still_sore" },
      { readiness: "normal", muscleRecovery: "fully_recovered" },
    ],
    weeklyMuscleSets: 10,
  });
  assert.equal(repeatedPoorReports.outcome, "decrease_sets");
});

test("rep-first isolation movements can add load after repeated top-range exposures", () => {
  const recommendation = calculateProgression({
    exercise: {
      ...baseExercise,
      category: "strength",
      equipment: "Dumbbell",
      isCompound: false,
    },
    exposures: [
      Array.from({ length: 3 }, () => ({ weight: 20, reps: 8, rir: 2, status: "target_met" })),
      Array.from({ length: 3 }, () => ({ weight: 20, reps: 8, rir: 2, status: "target_met" })),
    ],
    recoveryHistory: [],
    weeklyMuscleSets: 8,
  });
  assert.equal(recommendation.outcome, "increase_load");
  assert.equal(recommendation.recommendedWeight, 22.5);
  assert.equal(recommendation.recommendedReps, 6);
});

test("conditioning and mobility do not receive automatic strength progression", () => {
  const recommendation = calculateProgression({
    exercise: { ...baseExercise, category: "conditioning" },
    exposures: Array.from({ length: 3 }, () =>
      Array.from({ length: 3 }, () => ({ weight: 100, reps: 8, rir: 2, status: "target_met" })),
    ),
    recoveryHistory: [
      { readiness: "normal", muscleRecovery: "fully_recovered" },
      { readiness: "normal", muscleRecovery: "fully_recovered" },
      { readiness: "normal", muscleRecovery: "fully_recovered" },
    ],
    weeklyMuscleSets: 4,
  });
  assert.equal(recommendation.outcome, "maintain");
  assert.equal(recommendation.targetSets, 3);
});

test("primary muscle totals sum in the same order to the exact session total", () => {
  const grouped = primaryMuscleVolume([
    { muscleGroup: "Chest", weight: 0.1, reps: 1 },
    { muscleGroup: "Back", weight: 0.2, reps: 1 },
    { muscleGroup: "Chest", weight: 0.3, reps: 1 },
    { muscleGroup: "Legs", weight: 0.4, reps: 1 },
    { muscleGroup: "Back", weight: 0.5, reps: 1 },
  ]);
  assert.equal(
    grouped.muscleTotals.reduce((total, item) => total + item.totalWeightLifted, 0),
    grouped.totalVolume,
  );
});