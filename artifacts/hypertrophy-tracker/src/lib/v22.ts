export type Doc = Record<string, unknown>;
export interface PrescriptionRef { weight: number; reps: number; rir: number; prescribedRir?: number }
export interface PrescriptionSet { setNumber: number; weight: number | null; expectedReps: number | null; rir: number; reference: PrescriptionRef | null }
export interface PrescriptionExercise {
  exerciseId: number; exerciseName: string; muscleGroup: string; isCompound: boolean; orderIndex: number; targetSets: number; maximumWorkingSets: number;
  loadIncrement: number; calibrationMode: boolean; baselineStatus: string; rationale: string; reference: PrescriptionRef | null; sets: PrescriptionSet[];
}
export interface Prescription {
  state: 'generated' | 'calibration' | 'load_not_calculated' | 'completed'; plannedWorkoutId: number; splitId: number; weekIndex: number; kind: string; targetRir: number;
  scheduledDate: string; dayName: string; sessionId?: number | null; currentPlannedId?: number | null; message?: string | null; exercises: PrescriptionExercise[];
}
export interface StructureChanges {
  changes: string[];
  feedback: { workoutExerciseId: number; pump: string; fatigue: string; discomfort: string }[];
  recovery: { workoutExerciseId: number; muscleGroup: string; status: string | null; action: string | null; repeatLimited: boolean }[];
  lifecycleStatus?: string;
}
export const asPrescription = (d: unknown) => d as Prescription;
export const asChanges = (d: unknown) => d as StructureChanges;

export const RECOVERY_ACTIONS = [
  { value: 'train_as_planned', label: 'Train as planned', hint: 'Normal load and sets.' },
  { value: 'reduce_load', label: 'Reduce load', hint: 'Same sets, lighter weight.' },
  { value: 'reduce_sets', label: 'Reduce sets', hint: 'Same load, fewer working sets.' },
  { value: 'reduce_both', label: 'Reduce load and sets', hint: 'Lighter and fewer.' },
  { value: 'skip_today', label: 'Skip today', hint: 'Not trained. Kept in history as skipped.' },
] as const;
export type RecoveryAction = typeof RECOVERY_ACTIONS[number]['value'];

export function lifecycleOf(s: { lifecycleStatus?: string | null; endedAt?: string | null; pausedAt?: string | null }): 'current' | 'planned' | 'paused' | 'past' {
  const v = s.lifecycleStatus;
  if (v === 'planned') return 'planned';
  if (v === 'paused' || (!v && s.pausedAt)) return 'paused';
  if (v === 'ended_early' || v === 'restarted' || v === 'ended' || v === 'completed' || v === 'past' || s.endedAt) return 'past';
  return 'current';
}
