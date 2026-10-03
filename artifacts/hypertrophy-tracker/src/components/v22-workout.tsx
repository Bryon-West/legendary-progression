import { useState } from 'react';
import { ArrowDown, ArrowUp, Trash2 } from 'lucide-react';
import { useAdjustExerciseRecovery, useReorderWorkoutExercise, useRemoveWorkoutExercise, useSaveExercisePostFeedback } from '@workspace/api-client-react';
import type { WorkoutExercise } from '@workspace/api-client-react';
import { Modal } from '@/components/modal';
import { ErrorNote } from '@/components/ui-bits';
import { RECOVERY_ACTIONS, type RecoveryAction } from '@/lib/v22';

export type RecoveryInfo = { workoutExerciseId: number; status: string | null; action: string | null; repeatLimited: boolean };
export const recoveryPromptKind = (x: WorkoutExercise, rec?: RecoveryInfo): 'none' | 'normal' | 'limited' => {
  if (x.sets.some((q) => q.completed && !q.removed)) return 'none';
  const v = x.recoveryAdjustment ?? '';
  if (v === 'repeat_limited') return 'limited';
  if (v === 'pending') return rec?.repeatLimited ? 'limited' : 'normal';
  if (!v && rec && !rec.action && rec.status && !['recovered', 'fully_recovered', 'full'].includes(rec.status)) return rec.repeatLimited ? 'limited' : 'normal';
  return 'none';
};

export function RecoveryPrompt({ exercise, rec, sessionId, onDone, onChangeExercise }: { rec?: RecoveryInfo; exercise: WorkoutExercise; sessionId: number; onDone: () => void; onChangeExercise: () => void }) {
  const adjust = useAdjustExerciseRecovery();
  const limited = recoveryPromptKind(exercise, rec) === 'limited';
  const [confirm, setConfirm] = useState<{ label: string; run: () => void } | null>(null);
  const send = (action: RecoveryAction, persistentChoice?: 'reduce_working_sets' | 'keep_current_volume' | 'no_change') =>
    adjust.mutate({ sessionId, workoutExerciseId: exercise.id, data: { action, ...(persistentChoice ? { persistentChoice } : {}) } }, { onSuccess: onDone });
  const normal = RECOVERY_ACTIONS.map((a) => ({ key: a.value, label: a.label, hint: a.hint, run: () => send(a.value) }));
  const rep = [
    { key: 'reduce_working_sets', label: 'Reduce working sets', hint: 'Fewer sets for this exercise going forward.', run: () => send('reduce_sets', 'reduce_working_sets') },
    { key: 'keep_current_volume', label: 'Keep current volume', hint: 'Same sets as planned.', run: () => send('train_as_planned', 'keep_current_volume') },
    { key: 'change_exercise', label: 'Change exercise', hint: 'Pick a different movement.', run: onChangeExercise },
    { key: 'no_change', label: 'No change', hint: 'Train as planned and do not ask again.', run: () => send('train_as_planned', 'no_change') },
  ];
  const opts = limited ? rep : normal;
  return <article className="panel" style={{ padding: 16, borderColor: 'hsl(var(--primary) / .55)' }} data-testid={`prompt-recovery-${exercise.id}`}>
    <div className="eyebrow">{exercise.muscleGroup} · not fully recovered</div>
    <h2 style={{ fontSize: 19, margin: '4px 0 6px' }}>{exercise.exerciseName}</h2>
    <p style={{ margin: '0 0 12px', fontSize: 13, lineHeight: 1.5, color: 'hsl(var(--muted-foreground))' }}>{limited ? 'This muscle has been repeatedly limited by recovery. Choose how to handle it. This applies to today.' : 'How do you want to handle this exercise today? This applies to today only.'}</p>
    <div style={{ display: 'grid', gap: 7 }}>{opts.map((o) => <button key={o.key} className="btn btn-secondary" style={{ justifyContent: 'flex-start', textAlign: 'left', minHeight: 54, flexDirection: 'column', alignItems: 'flex-start', gap: 2 }} disabled={adjust.isPending}
      onClick={() => (limited && o.key !== 'change_exercise' ? setConfirm({ label: o.label, run: o.run }) : o.run())} data-testid={`button-recovery-${o.key}`}><b>{o.label}</b><small style={{ fontWeight: 400, opacity: .75 }}>{o.hint}</small></button>)}</div>
    {adjust.isError && <ErrorNote message="Could not apply that choice. Try again."/>}
    {confirm && <Modal title={`${confirm.label}?`} close={() => setConfirm(null)}>
      <p style={{ marginTop: 0, lineHeight: 1.5, color: 'hsl(var(--muted-foreground))' }}>Confirm this choice for {exercise.exerciseName}.</p>
      <div style={{ display: 'flex', gap: 9 }}><button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setConfirm(null)}>Back</button><button className="btn btn-primary" style={{ flex: 1 }} disabled={adjust.isPending} onClick={() => { confirm.run(); setConfirm(null); }} data-testid="button-confirm-recovery">Confirm</button></div>
    </Modal>}
  </article>;
}

const PUMP = ['none', 'low', 'good', 'great'] as const;
const FATIGUE = ['low', 'moderate', 'high', 'too_much'] as const;
const DISCOMFORT = ['none', 'mild', 'moderate', 'significant'] as const;
const nice = (s: string) => s.replace('_', ' ').replace(/^./, (c) => c.toUpperCase());

export function FeedbackSheet({ exercise, sessionId, onDone, onSkip }: { exercise: WorkoutExercise; sessionId: number; onDone: () => void; onSkip: () => void }) {
  const save = useSaveExercisePostFeedback();
  const [pump, setPump] = useState<typeof PUMP[number]>('good');
  const [fatigue, setFatigue] = useState<typeof FATIGUE[number]>('moderate');
  const [discomfort, setDiscomfort] = useState<typeof DISCOMFORT[number]>('none');
  const row = <T extends string>(label: string, opts: readonly T[], v: T, set: (x: T) => void, danger?: boolean) => <div style={{ marginBottom: 12 }}>
    <div className="eyebrow" style={{ marginBottom: 6 }}>{label}</div>
    <div className="seg" style={{ gridTemplateColumns: `repeat(${opts.length},1fr)` }} role="group" aria-label={label}>{opts.map((o) => <button key={o} type="button" aria-pressed={v === o} onClick={() => set(o)} style={danger && v === o && (o === 'significant' || o === 'moderate') ? { color: 'hsl(var(--destructive))' } : undefined} data-testid={`button-${label.toLowerCase()}-${o}`}>{nice(o)}</button>)}</div></div>;
  return <Modal title={`${exercise.exerciseName}: how did it feel?`} close={onSkip}>
    {row('Pump', PUMP, pump, (x) => setPump(x as typeof pump))}{row('Fatigue', FATIGUE, fatigue, (x) => setFatigue(x as typeof fatigue))}{row('Discomfort', DISCOMFORT, discomfort, (x) => setDiscomfort(x as typeof discomfort), true)}
    <button className="btn btn-primary" style={{ width: '100%' }} disabled={save.isPending} data-testid="button-save-feedback" onClick={() => save.mutate({ sessionId, workoutExerciseId: exercise.id, data: { pump, fatigue, discomfort } }, { onSuccess: onDone })}>{save.isPending ? 'Saving…' : 'Save'}</button>
    {save.isError && <ErrorNote message="Could not save feedback. Try again."/>}
  </Modal>;
}

export function ExerciseTools({ exercise, sessionId, first, last, onChanged, onRemoved, onRemoveFailed }: { exercise: WorkoutExercise; sessionId: number; first: boolean; last: boolean; onChanged: () => void; onRemoved?: () => void; onRemoveFailed?: () => void }) {
  const reorder = useReorderWorkoutExercise();
  const remove = useRemoveWorkoutExercise();
  const [ask, setAsk] = useState(false);
  const mv = (direction: 'up' | 'down') => reorder.mutate({ sessionId, workoutExerciseId: exercise.id, data: { direction } }, { onSuccess: onChanged });
  const hasLogged = exercise.sets.some((s) => !s.removed && s.completed);
  return <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 2, marginTop: 4 }}>
    <button className="btn btn-ghost" style={{ minHeight: 34, padding: 6 }} aria-label={`Move ${exercise.exerciseName} up`} disabled={first || reorder.isPending} onClick={() => mv('up')} data-testid={`button-move-up-${exercise.id}`}><ArrowUp size={14}/></button>
    <button className="btn btn-ghost" style={{ minHeight: 34, padding: 6 }} aria-label={`Move ${exercise.exerciseName} down`} disabled={last || reorder.isPending} onClick={() => mv('down')} data-testid={`button-move-down-${exercise.id}`}><ArrowDown size={14}/></button>
    <button className="btn btn-ghost" style={{ minHeight: 34, padding: 6 }} aria-label={`Remove ${exercise.exerciseName}`} onClick={() => setAsk(true)} data-testid={`button-remove-exercise-${exercise.id}`}><Trash2 size={14}/></button>
    {ask && <Modal title="Remove this exercise?" close={() => setAsk(false)}>
     <p style={{ marginTop: 0, lineHeight: 1.5, color: 'hsl(var(--muted-foreground))' }}>Remove it from today's visible workout now. {hasLogged && 'Completed sets remain in your history and total weight lifted. '}Unperformed sets will not count. You can decide at Finish Workout whether the change carries forward.</p>
      <div style={{ display: 'grid', gap: 8 }}>
       <button className="btn btn-primary" disabled={remove.isPending} onClick={() => { onRemoved?.(); remove.mutate({ sessionId, workoutExerciseId: exercise.id, data: { scope: 'today_only' } }, { onSuccess: () => { setAsk(false); onChanged(); }, onError: () => onRemoveFailed?.() }); }} data-testid="button-remove-today">Remove exercise</button>
        <button className="btn btn-ghost" onClick={() => setAsk(false)}>Cancel</button>
      </div>
      {remove.isError && <ErrorNote message="Could not remove the exercise."/>}
    </Modal>}
  </div>;
}
