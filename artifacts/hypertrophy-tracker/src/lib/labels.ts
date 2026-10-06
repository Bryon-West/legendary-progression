export type Readiness = 'great' | 'normal' | 'below_normal' | 'poor';
export type RecoveryStatus = 'fully_recovered' | 'slightly_fatigued' | 'still_sore' | 'very_sore';
export const READINESS: { value: Readiness; label: string }[] = [
  { value: 'great', label: 'Great' }, { value: 'normal', label: 'Normal' },
  { value: 'below_normal', label: 'Below normal' }, { value: 'poor', label: 'Poor' },
];
export const RECOVERY: { value: RecoveryStatus; label: string }[] = [
  { value: 'fully_recovered', label: 'Fully recovered' }, { value: 'slightly_fatigued', label: 'Slightly fatigued' },
  { value: 'still_sore', label: 'Still sore or fatigued' }, { value: 'very_sore', label: 'Very sore or limiting' },
];
export const labelOf = (list: { value: string; label: string }[], value: string | null | undefined) =>
  list.find((x) => x.value === value)?.label ?? (value ? humanize(value) : '—');
export function humanize(raw: string) {
  const t = raw.replace(/[_-]+/g, ' ').trim().toLowerCase();
  return t.charAt(0).toUpperCase() + t.slice(1);
}
export const CATEGORIES = ['strength', 'bodyweight', 'calisthenics', 'cardio', 'plyometric', 'carry', 'sled', 'conditioning', 'mobility', 'other'] as const;
export const EQUIPMENT = ['Barbell', 'Dumbbell', 'Cable', 'Selectorized machine', 'Plate-loaded machine', 'Machine', 'Smith machine', 'Bodyweight', 'Other'];
export const MUSCLES = ['Chest', 'Back', 'Lats', 'Upper back', 'Quads', 'Hamstrings', 'Glutes', 'Calves', 'Front delts', 'Side delts', 'Rear delts', 'Shoulders', 'Biceps', 'Triceps', 'Forearms', 'Abs', 'Core'];
export const formatRir = (rir: number | null | undefined) =>
  rir == null || !Number.isFinite(rir) ? '—' : String(Number(rir.toFixed(1)));
export const weekLabel = (kind: string | null | undefined, index?: number | null, rir?: number | null) =>
  kind === 'deload' ? 'RECOVERY WEEK — DELOAD' : kind === 'week_off' ? 'RECOVERY WEEK — WEEK OFF' : `WEEK ${index ?? ''} — ${rir == null ? '?' : formatRir(rir)} RIR`;
export const STATUS_META = {
  target_met: { label: 'Target met', cls: 'status-met' },
  above_target: { label: 'Above target', cls: 'status-above' },
  below_target: { label: 'Below target', cls: 'status-below' },
} as const;
