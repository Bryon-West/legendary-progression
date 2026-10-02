export type SetWorkflowRow = {
  id: number;
  setNumber: number;
  setType: "work" | "warmup";
  completed: boolean;
  removed: boolean;
};

export function sequentialSetStates<T extends SetWorkflowRow>(rows: T[]) {
  const ordered = [...rows].filter((row) => !row.removed)
    .sort((left, right) => left.setNumber - right.setNumber || left.id - right.id);
  const firstIncompleteWork = ordered.find((row) => row.setType === "work" && !row.completed)?.id;
  return new Map(ordered.map((row) => [
    row.id,
    row.setType === "warmup"
      ? (row.completed ? "locked" : "active")
      : row.completed
        ? "locked"
        : row.id === firstIncompleteWork
          ? "active"
          : "locked",
  ] as const));
}

export function canEditSet(completed: boolean, editIntent: boolean | undefined) {
  return !completed || editIntent === true;
}

function adaptiveRepsForReference(
  selectedWeight: number,
  baseWeight: number | null,
  baseReps: number,
  minReps: number,
  maxReps: number,
  targetRir: number,
) {
  if (selectedWeight <= 0 || baseWeight === null || baseWeight <= 0) {
    return Math.max(minReps, Math.min(maxReps, baseReps));
  }
  const capacity = baseWeight * (1 + (baseReps + targetRir) / 30);
  const rawReps = (capacity / selectedWeight - 1) * 30 - targetRir;
  return Math.max(minReps, Math.min(maxReps, Math.round(rawReps)));
}

function snapLoad(weight: number, increment: number) {
  if (!Number.isFinite(weight) || !Number.isFinite(increment) || increment <= 0) {
    throw new Error("Weight and a positive load increment are required");
  }
  return Number((Math.round(weight / increment) * increment).toFixed(6));
}

export type SetTargetReference = {
  weight: number | null;
  reps: number | null;
  rir: number;
  repsMin: number | null;
  repsMax: number | null;
};

export type CompletedWorkAnchor = {
  actualWeight: number | null;
  actualReps: number | null;
  actualRir: number | null;
  targetStatus: "target_met" | "above_target" | "below_target" | null;
  reference: SetTargetReference;
};

export function classifySetAtReference(input: {
  actualWeight: number;
  actualReps: number;
  actualRir: number;
  reference: SetTargetReference;
}): "target_met" | "above_target" | "below_target" | null {
  const { reference } = input;
  if (reference.weight === null || reference.reps === null ||
    reference.repsMin === null || reference.repsMax === null) return null;
  const adaptive = adaptiveRepsForReference(
    input.actualWeight,
    reference.weight,
    reference.reps,
    reference.repsMin,
    reference.repsMax,
    reference.rir,
  );
  const difference = input.actualReps + input.actualRir - (adaptive + reference.rir);
  if (input.actualReps < reference.repsMin || difference < -1.25) return "below_target";
  if (difference > 1.25) return "above_target";
  return "target_met";
}

export function recommendationAfterCompletedWork(input: {
  calibrationMode: boolean;
  allowIncrease: boolean;
  baseline: SetTargetReference;
  anchor: CompletedWorkAnchor | null;
  loadIncrement: number;
}): SetTargetReference {
  if (input.calibrationMode) {
    return { weight: null, reps: null, rir: 3, repsMin: null, repsMax: null };
  }
  const baseline = input.baseline;
  if (baseline.repsMin === null || baseline.repsMax === null) {
    return { ...baseline };
  }
  const anchor = input.anchor;
  if (!anchor || anchor.actualWeight === null || anchor.actualReps === null || anchor.actualRir === null) {
    return { ...baseline };
  }
  const status = anchor.targetStatus ?? classifySetAtReference({
    actualWeight: anchor.actualWeight,
    actualReps: anchor.actualReps,
    actualRir: anchor.actualRir,
    reference: anchor.reference,
  });
  if (status === null) return { ...baseline };
  const min = baseline.repsMin;
  const max = baseline.repsMax;
  let weight = anchor.actualWeight;
  let reps = Math.max(min, Math.min(max, anchor.actualReps));
  if (status === "above_target" && input.allowIncrease) {
    weight = snapLoad(anchor.actualWeight + input.loadIncrement, input.loadIncrement);
    reps = min;
  } else if (status === "below_target") {
    weight = snapLoad(Math.max(0, anchor.actualWeight - input.loadIncrement), input.loadIncrement);
    reps = max;
  }
  return {
    weight,
    reps,
    rir: baseline.rir,
    repsMin: min,
    repsMax: max,
  };
}

export function calibrationTargets() {
  return {
    targetWeight: null,
    targetRepsMin: null,
    targetRepsMax: null,
    targetRir: 3,
    calibrationMode: true,
    targetStatus: null,
  } as const;
}

export function isCopyEligibleWeek(week: { kind: string; status: string }) {
  return week.kind === "loading" && week.status === "completed";
}

export function selectRecommendedCopyWeek<T extends { kind: string; status: string; completedAt: Date | null }>(weeks: T[]) {
  return weeks.filter(isCopyEligibleWeek)
    .sort((left, right) => (right.completedAt?.getTime() ?? 0) - (left.completedAt?.getTime() ?? 0))[0] ?? null;
}

export function fixedWeekRange(startDate: string, weekIndex: number) {
  const start = new Date(`${startDate}T00:00:00.000Z`);
  start.setUTCDate(start.getUTCDate() + (weekIndex - 1) * 7);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 6);
  return {
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
  };
}

export function isDateInsideWeek(date: string, weekStart: string, weekEnd: string) {
  return date >= weekStart && date <= weekEnd;
}

export function recoverySpacingWarning(previousDate: string | null, nextDate: string | null) {
  if (!previousDate || !nextDate) return null;
  const distance = Math.abs(
    new Date(`${previousDate}T00:00:00.000Z`).getTime() -
    new Date(`${nextDate}T00:00:00.000Z`).getTime(),
  ) / 86400000;
  return distance < 2 ? "These sessions will be scheduled on consecutive days; allow adequate recovery if needed." : null;
}