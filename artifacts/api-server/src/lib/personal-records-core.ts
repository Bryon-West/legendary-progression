export type PersonalRecordWeightUnit = "kg" | "lb";

export type PersonalRecordCandidate = {
  exerciseId: number;
  exerciseName: string;
  sessionId: number;
  sessionDate: string | Date;
  sessionStatus: "active" | "completed";
  setId: number;
  setNumber: number;
  setType: "work" | "warmup";
  completed: boolean;
  removed: boolean;
  skipped: boolean;
  actualWeight: number | null;
  actualReps: number | null;
  actualRir: number | null;
};

export type PersonalRecordSet = {
  sessionId: number;
  setId: number;
  sessionDate: string;
  weight: number;
  reps: number;
  rir: number | null;
  heaviestLoadRecord: boolean;
  legendaryPerformanceRecord: boolean;
};

export type PersonalRecordExercise = {
  exerciseId: number;
  exerciseName: string;
  heaviestLoad: PersonalRecordSet | null;
  bestPerformance: PersonalRecordSet | null;
  history: PersonalRecordSet[];
};

const LB_PER_KG = 2.20462262185;
const REP_PER_5_LB = 1;
const MAX_COMPARABLE_DELTA_LB = 20;

function asDate(value: string | Date): Date {
  return value instanceof Date ? value : new Date(value);
}

function toIso(value: string | Date): string {
  return asDate(value).toISOString();
}

function weightInPounds(weight: number, unit: PersonalRecordWeightUnit): number {
  return unit === "kg" ? weight * LB_PER_KG : weight;
}

export function beatsComparablePerformance(
  candidate: Pick<PersonalRecordCandidate, "actualWeight" | "actualReps" | "actualRir">,
  reference: Pick<PersonalRecordSet, "weight" | "reps" | "rir">,
  unit: PersonalRecordWeightUnit,
): boolean {
  if (candidate.actualWeight === null || candidate.actualReps === null) return false;
  const differenceLb = weightInPounds(candidate.actualWeight, unit) - weightInPounds(reference.weight, unit);
  if (Math.abs(differenceLb) > MAX_COMPARABLE_DELTA_LB + 1e-8) return false;

  // Without RIR on both sets, only compare reps at essentially the same load.
  if (candidate.actualRir === null || reference.rir === null) {
    return Math.abs(differenceLb) < 0.1 && candidate.actualReps > reference.reps;
  }

  const expectedReps = reference.reps + reference.rir - candidate.actualRir -
    differenceLb / (5 / REP_PER_5_LB);
  return candidate.actualReps > expectedReps + 1e-8;
}

export function derivePersonalRecords(
  candidates: PersonalRecordCandidate[],
  unit: PersonalRecordWeightUnit,
): PersonalRecordExercise[] {
  const eligible = candidates
    .filter((candidate) =>
      candidate.setType === "work" &&
      candidate.completed &&
      !candidate.removed &&
      !candidate.skipped &&
      candidate.actualWeight !== null &&
      candidate.actualReps !== null,
    )
    .sort((a, b) =>
      asDate(a.sessionDate).getTime() - asDate(b.sessionDate).getTime() ||
      a.sessionId - b.sessionId ||
      a.setNumber - b.setNumber ||
      a.setId - b.setId,
    );

  const grouped = new Map<number, PersonalRecordExercise>();
  for (const candidate of eligible) {
    let exercise = grouped.get(candidate.exerciseId);
    if (!exercise) {
      exercise = {
        exerciseId: candidate.exerciseId,
        exerciseName: candidate.exerciseName,
        heaviestLoad: null,
        bestPerformance: null,
        history: [],
      };
      grouped.set(candidate.exerciseId, exercise);
    }
    exercise.exerciseName = candidate.exerciseName;

    const entry: PersonalRecordSet = {
      sessionId: candidate.sessionId,
      setId: candidate.setId,
      sessionDate: toIso(candidate.sessionDate),
      weight: candidate.actualWeight!,
      reps: candidate.actualReps!,
      rir: candidate.actualRir,
      heaviestLoadRecord: false,
      legendaryPerformanceRecord: false,
    };

    if (!exercise.heaviestLoad || entry.weight > exercise.heaviestLoad.weight) {
      entry.heaviestLoadRecord = true;
      exercise.heaviestLoad = entry;
    }
    if (!exercise.bestPerformance || beatsComparablePerformance(candidate, exercise.bestPerformance, unit)) {
      entry.legendaryPerformanceRecord = true;
      exercise.bestPerformance = entry;
    }
    exercise.history.push(entry);
  }

  return [...grouped.values()].sort((a, b) => a.exerciseName.localeCompare(b.exerciseName));
}