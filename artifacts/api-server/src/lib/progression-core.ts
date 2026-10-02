export type Exposure = {
  weight: number;
  reps: number;
  rir: number;
  status: "target_met" | "above_target" | "below_target" | null;
};

export type RecoveryObservation = {
  readiness: string | null;
  muscleRecovery: string | null;
};

export type ProgressionInput = {
  exercise: {
    category: string;
    equipment: string;
    isCompound: boolean;
    muscleGroup: string;
    targetSets: number;
    minimumWorkingSets: number;
    maximumWorkingSets: number;
    targetRepsMin: number;
    targetRepsMax: number;
    targetRir: number;
    targetWeight: number | null;
    loadIncrement?: number;
  };
  exposures: Exposure[][];
  recoveryHistory: RecoveryObservation[];
  weeklyMuscleSets: number;
  painReported?: boolean;
};

export type ProgressionRecommendation = {
  recommendedWeight: number | null;
  recommendedReps: number | null;
  targetSets: number;
  outcome: "increase_load" | "increase_reps" | "increase_sets" | "decrease_sets" | "maintain";
  rationale: string;
};

export function adaptiveRepsForWeight(
  selectedWeight: number | null,
  baseWeight: number | null,
  baseReps: number,
  minReps: number,
  maxReps: number,
  targetRir = 2,
): { reps: number; warning: string | null } {
  if (selectedWeight === null || selectedWeight <= 0 || baseWeight === null || baseWeight <= 0) {
    return { reps: Math.max(minReps, Math.min(maxReps, baseReps)), warning: null };
  }
  // Anchor the Epley capacity to the athlete's own recent load/reps/RIR.
  const capacity = baseWeight * (1 + (baseReps + targetRir) / 30);
  const rawReps = (capacity / selectedWeight - 1) * 30 - targetRir;
  const reps = Math.max(minReps, Math.min(maxReps, Math.round(rawReps)));
  return {
    reps,
    warning: rawReps < minReps || rawReps > maxReps
      ? `Selected load may put expected performance outside the ${minReps}-${maxReps} rep target at ${targetRir} RIR.`
      : null,
  };
}

export function snapToLoadIncrement(weight: number, increment: number): number {
  if (!Number.isFinite(weight) || !Number.isFinite(increment) || increment <= 0) {
    throw new Error("Weight and a positive load increment are required");
  }
  return Number((Math.round(weight / increment) * increment).toFixed(6));
}

function estimatedCapacity(set: Exposure) {
  return set.weight * (1 + (set.reps + set.rir) / 30);
}

function exposureCapacity(exposure: Exposure[]) {
  const valid = exposure.filter((set) => set.weight > 0 && set.reps > 0);
  return valid.length
    ? valid.reduce((sum, set) => sum + estimatedCapacity(set), 0) / valid.length
    : null;
}

function appropriateEffort(exposure: Exposure[], targetRir: number, minReps: number, maxReps: number) {
  return exposure.length > 0 && exposure.every((set) =>
    set.reps >= minReps &&
    set.reps <= maxReps &&
    Math.abs(set.rir - targetRir) <= 1,
  );
}

function plateauAcrossThree(exposures: Exposure[][], targetRir: number, minReps: number, maxReps: number) {
  const recent = exposures.slice(0, 3);
  const capacities = recent.map(exposureCapacity);
  if (recent.length < 3 || capacities.some((value) => value === null)) return false;
  if (!recent.every((exposure) => appropriateEffort(exposure, targetRir, minReps, maxReps))) return false;
  const values = capacities as number[];
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return mean > 0 && (Math.max(...values) - Math.min(...values)) / mean <= 0.02;
}

function repeatedCapacityDecline(exposures: Exposure[][]) {
  const capacities = exposures.slice(0, 3).map(exposureCapacity);
  if (capacities.length < 3 || capacities.some((value) => value === null)) return false;
  return capacities[0]! < capacities[1]! * 0.98 && capacities[1]! < capacities[2]! * 0.98;
}

function repeatedPoorRecovery(history: RecoveryObservation[]) {
  return history.slice(0, 3).filter((entry) =>
    entry.readiness === "poor" ||
    entry.muscleRecovery === "still_sore" ||
    entry.muscleRecovery === "very_sore",
  ).length >= 2;
}

function repeatedGoodRecovery(history: RecoveryObservation[]) {
  return history.slice(0, 3).filter((entry) =>
    entry.readiness !== "poor" &&
    (entry.muscleRecovery === "fully_recovered" || entry.muscleRecovery === "slightly_fatigued"),
  ).length >= 2;
}

export function calculateProgression(input: ProgressionInput): ProgressionRecommendation {
  const { exercise } = input;
  const recent = input.exposures.slice(0, 3);
  const latestSets = (recent[0] ?? []).filter((item) => item.weight > 0 && item.reps > 0);
  const latestBest = [...latestSets].sort((a, b) => estimatedCapacity(b) - estimatedCapacity(a))[0];
  const existingWeight = latestBest?.weight ?? exercise.targetWeight;
  const recentAverageReps = latestSets.length
    ? Math.round(latestSets.reduce((sum, item) => sum + item.reps, 0) / latestSets.length)
    : exercise.targetRepsMin;
  const repFirst =
    exercise.category === "bodyweight" ||
    /dumbbell|cable|machine/i.test(exercise.equipment) ||
    !exercise.isCompound;
  const validStrengthCategory = exercise.category === "strength" || exercise.category === "bodyweight";
  let targetSets = Math.max(
    exercise.minimumWorkingSets,
    Math.min(exercise.maximumWorkingSets, exercise.targetSets),
  );
  let outcome: ProgressionRecommendation["outcome"] = "maintain";
  let rationale = "Maintain the current prescription while more performance data is collected.";
  let recommendedWeight = existingWeight;
  let recommendedReps = Math.max(
    exercise.targetRepsMin,
    Math.min(exercise.targetRepsMax, recentAverageReps),
  );

  if (!validStrengthCategory) {
    return {
      recommendedWeight,
      recommendedReps,
      targetSets,
      outcome: "maintain",
      rationale: "Automatic strength progression is disabled for this exercise category.",
    };
  }
  if (input.painReported) {
    return {
      recommendedWeight,
      recommendedReps,
      targetSets,
      outcome: "maintain",
      rationale: "Pain was reported; automatic load and volume increases are withheld.",
    };
  }

  const declined = repeatedCapacityDecline(recent);
  const poorRecovery = repeatedPoorRecovery(input.recoveryHistory);
  if (declined && poorRecovery && targetSets > exercise.minimumWorkingSets) {
    targetSets -= 1;
    outcome = "decrease_sets";
    rationale = "Repeated effort-adjusted capacity decline and repeated poor recovery support a one-set reduction.";
    return { recommendedWeight, recommendedReps, targetSets, outcome, rationale };
  }

  if (
    plateauAcrossThree(recent, exercise.targetRir, exercise.targetRepsMin, exercise.targetRepsMax) &&
    repeatedGoodRecovery(input.recoveryHistory) &&
    input.weeklyMuscleSets < 14 &&
    targetSets < exercise.maximumWorkingSets
  ) {
    targetSets += 1;
    outcome = "increase_sets";
    rationale = "Three-exposure effort-adjusted plateau, repeated good recovery, and reasonable weekly volume support +1 set.";
    return { recommendedWeight, recommendedReps, targetSets, outcome, rationale };
  }

  const appropriateLatest = latestSets.length > 0 && latestSets.every((set) =>
    set.reps >= exercise.targetRepsMin &&
    set.reps <= exercise.targetRepsMax &&
    Math.abs(set.rir - exercise.targetRir) <= 1,
  );
  if (appropriateLatest && recentAverageReps < exercise.targetRepsMax) {
    recommendedReps = Math.min(exercise.targetRepsMax, recentAverageReps + 1);
    outcome = "increase_reps";
    rationale = "Add repetitions within the prescribed rep range at appropriate effort.";
  } else if (
    existingWeight !== null &&
    appropriateLatest &&
    recentAverageReps >= exercise.targetRepsMax &&
    ((!repFirst && exercise.isCompound) ||
      (repFirst && recent.slice(0, 2).length === 2 &&
        recent.slice(0, 2).every((exposure) =>
          exposure.length > 0 && exposure.every((set) =>
            set.reps >= exercise.targetRepsMax &&
            Math.abs(set.rir - exercise.targetRir) <= 1,
          ),
        )))
  ) {
    const step = exercise.loadIncrement ?? 2.5;
    recommendedWeight = snapToLoadIncrement(existingWeight + step, step);
    recommendedReps = exercise.targetRepsMin;
    outcome = "increase_load";
    rationale = repFirst
      ? "Two top-range exposures at appropriate effort support a small load increase."
      : "Top-range performance supports a small load increase and a return to the lower end of the rep range.";
  }

  return { recommendedWeight, recommendedReps, targetSets, outcome, rationale };
}