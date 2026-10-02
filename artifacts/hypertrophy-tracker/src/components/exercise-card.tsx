import { useState } from 'react';
import { Edit3, Minus, Plus, SkipForward, TriangleAlert, Undo2 } from 'lucide-react';
import { getGetExerciseHistoryQueryKey, useCreateWorkoutSet, useGetExerciseHistory, useRemoveWorkoutSet, useUpdateWorkoutExercise } from '@workspace/api-client-react';
import type { WorkoutExercise, WorkoutSet } from '@workspace/api-client-react';
import { Modal } from '@/components/modal';
import { ErrorNote } from '@/components/ui-bits';
import { SetRow } from '@/components/set-row';
import { StatusIcon, statusClass, statusLabel, type TargetStatus } from '@/components/status';
import { humanize } from '@/lib/labels';
import { fmtWeight, type WeightUnit } from '@/lib/units';

export function ExerciseCard({ exercise, sessionId, profileId, unit, onChanged, onSubstitute }: {
  exercise: WorkoutExercise; sessionId: number; profileId: number; unit: WeightUnit; onChanged: () => void; onSubstitute: () => void;
}) {
  const history = useGetExerciseHistory(profileId, exercise.exerciseId, { query: { queryKey: getGetExerciseHistoryQueryKey(profileId, exercise.exerciseId), enabled: !!profileId } });
  const updateExercise = useUpdateWorkoutExercise();
  const createSet = useCreateWorkoutSet();
  const removeSet = useRemoveWorkoutSet();
  const [pain, setPain] = useState(false);
  const [painNote, setPainNote] = useState(exercise.painNote ?? '');
  const [confirmRemove, setConfirmRemove] = useState<WorkoutSet | null>(null);
  const [statusSet, setStatusSet] = useState<WorkoutSet | null>(null);
  const [rowFailed, setRowFailed] = useState(false);
  const superseded = !!exercise.superseded;
  const skipped = !!exercise.skipped;
  const readOnly = superseded || skipped;
  const live = exercise.sets.filter((s) => !s.removed);
  const warmups = live.filter((s) => s.setType === 'warmup').sort((a, b) => a.setNumber - b.setNumber);
  const works = live.filter((s) => s.setType === 'work').sort((a, b) => a.setNumber - b.setNumber);
  const minSets = exercise.minimumWorkingSets ?? 1;
  const maxSets = exercise.maximumWorkingSets ?? 20;
  const prior = history.data?.filter((h) => h.setType === 'work').slice(0, 4) ?? [];
  const add = (setType: 'warmup' | 'work') => {
    const same = exercise.sets.filter((s) => s.setType === setType);
    const setNumber = same.length ? Math.max(...same.map((s) => s.setNumber)) + 1 : 1;
    createSet.mutate({ sessionId, data: { workoutExerciseId: exercise.id, setNumber, setType, targetWeight: exercise.targetWeight ?? null, targetRepsMin: exercise.targetRepsMin, targetRepsMax: exercise.targetRepsMax } }, { onSuccess: onChanged });
  };
  const doRemove = (set: WorkoutSet) => removeSet.mutate({ sessionId, setId: set.id }, { onSuccess: () => { setConfirmRemove(null); onChanged(); } });
  const removeLast = () => {
    const target = [...works].reverse().find((s) => !s.completed) ?? works[works.length - 1];
    if (!target) return;
    if (target.completed) setConfirmRemove(target); else doRemove(target);
  };
  const feedback = (data: { skipped?: boolean; painReported?: boolean; painNote?: string }, after?: () => void) =>
    updateExercise.mutate({ sessionId, workoutExerciseId: exercise.id, data }, { onSuccess: () => { onChanged(); after?.(); } });
  const outcome = exercise.recommendationOutcome ? humanize(String(exercise.recommendationOutcome)) : '';
  const statusPicked = (statusSet?.targetStatus ?? null) as TargetStatus | null;
  return <article className="panel" style={{ padding: 15, opacity: readOnly ? .82 : 1 }} data-testid={`card-exercise-${exercise.id}`}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', gap: 10, marginBottom: 12 }}>
      <div style={{ minWidth: 0 }}>
        <div className="eyebrow">{exercise.muscleGroup}</div>
        <h2 style={{ fontSize: 19, margin: '4px 0 6px', lineHeight: 1.2 }}>{exercise.exerciseName}</h2>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
          {exercise.category && <span className="badge">{humanize(String(exercise.category))}</span>}
          <span className="badge">{exercise.isCompound ? 'Compound' : 'Isolation'}</span>
          {skipped && <span className="badge badge-warning">Skipped</span>}
          {superseded && <span className="badge">Replaced</span>}
          {exercise.painReported && <span className="badge badge-warning">Discomfort noted</span>}
        </div>
        <div style={{ fontSize: 12, color: 'hsl(var(--muted-foreground))', marginTop: 8 }}>
          Reps <b style={{ color: 'hsl(var(--foreground))' }}>{exercise.targetRepsMin}–{exercise.targetRepsMax}</b> · RIR <b style={{ color: 'hsl(var(--foreground))' }}>{exercise.targetRir}</b> · Working sets <b style={{ color: 'hsl(var(--foreground))' }}>{minSets}–{maxSets}</b> ({works.length} now)
        </div>
      </div>
    </div>
    {superseded && <div className="notice-warn" style={{ marginBottom: 10 }}>Replaced during this session. Sets already logged stay in your history.</div>}
    {skipped && !superseded && <div className="notice-warn" style={{ marginBottom: 10 }}>Skipped. It is recorded as skipped and does not count against progression.</div>}
    {!readOnly && outcome && <div style={{ padding: '10px 12px', marginBottom: 12, borderRadius: 12, background: 'hsl(var(--primary) / .1)', border: '1px solid hsl(var(--primary) / .35)' }} data-testid={`text-recommendation-${exercise.id}`}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}><span className="badge badge-red">{outcome}</span>{exercise.recommendedWeight != null && <span className="metric" style={{ fontSize: 12, fontWeight: 700 }}>{fmtWeight(exercise.recommendedWeight, unit)}{exercise.recommendedReps ? ` × ${exercise.recommendedReps}` : ''}</span>}</div>
      {exercise.recommendationRationale && <div style={{ fontSize: 12, marginTop: 7, lineHeight: 1.45, color: 'hsl(var(--muted-foreground))' }}>{exercise.recommendationRationale}</div>}
    </div>}
    {prior.length > 0 && <div style={{ padding: '8px 10px', marginBottom: 12, background: 'hsl(var(--secondary))', borderRadius: 11, fontSize: 11, color: 'hsl(var(--muted-foreground))' }}><span style={{ fontWeight: 700, color: 'hsl(var(--foreground))' }}>Last time</span> · {prior.map((p) => `${fmtWeight(p.actualWeight ?? p.targetWeight, unit, false)} × ${p.actualReps ?? p.targetRepsMin ?? '—'}`).join('  /  ')} {unit}</div>}
    <div className="set-grid" style={{ marginBottom: 6 }}><span className="set-head">Set</span><span className="set-head">Weight ({unit})</span><span className="set-head">Reps</span><span className="set-head">RIR</span><span className="set-head">Rating</span></div>
    {live.length ? <>
      {warmups.map((s, idx) => <SetRow key={s.id} set={s} label={idx + 1} exercise={exercise} sessionId={sessionId} unit={unit} readOnly={readOnly} onSaved={onChanged} onStatus={setStatusSet} onError={setRowFailed}/>)}
      {works.map((s, idx) => <SetRow key={s.id} set={s} label={idx + 1} exercise={exercise} sessionId={sessionId} unit={unit} readOnly={readOnly} onSaved={onChanged} onStatus={setStatusSet} onError={setRowFailed}/>)}
    </> : <div style={{ color: 'hsl(var(--muted-foreground))', fontSize: 12, padding: '6px 0 12px' }}>No sets yet.</div>}
    {rowFailed && <ErrorNote message="A set value was not saved. Check the numbers and try again."/>}
    {(createSet.isError || removeSet.isError || updateExercise.isError) && <ErrorNote message="That change did not save. Try again."/>}
    {skipped && !superseded ? <button className="btn btn-secondary btn-sm" style={{ width: '100%', marginTop: 10 }} disabled={updateExercise.isPending} onClick={() => feedback({ skipped: false })} data-testid={`button-restore-${exercise.id}`}><Undo2 size={15}/> Restore exercise</button>
    : !superseded && <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 7, marginTop: 10 }}>
      <button className="btn btn-outline btn-sm" onClick={() => add('warmup')} disabled={createSet.isPending} data-testid={`button-add-warmup-${exercise.id}`}><Plus size={14}/> Warm-up</button>
      <button className="btn btn-primary btn-sm" onClick={() => add('work')} disabled={createSet.isPending || works.length >= maxSets} data-testid={`button-add-work-${exercise.id}`}><Plus size={14}/> Working</button>
      <button className="btn btn-outline btn-sm" onClick={removeLast} disabled={removeSet.isPending || works.length <= minSets} data-testid={`button-remove-work-${exercise.id}`}><Minus size={14}/> Working</button>
      <button className="btn btn-outline btn-sm" onClick={() => feedback({ skipped: true })} disabled={updateExercise.isPending} data-testid={`button-skip-${exercise.id}`}><SkipForward size={14}/> Skip</button>
      <button className="btn btn-outline btn-sm" aria-label={`Substitute ${exercise.exerciseName}`} onClick={onSubstitute} data-testid={`button-swap-${exercise.id}`}><Edit3 size={14}/> Swap</button>
      <button className="btn btn-outline btn-sm" onClick={() => setPain(true)} data-testid={`button-pain-${exercise.id}`}><TriangleAlert size={14}/> Discomfort</button>
    </div>}
    {statusSet && <Modal title={statusLabel(statusPicked)} close={() => setStatusSet(null)}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 14 }}><span className={`status-btn ${statusClass(statusPicked)}`}><StatusIcon status={statusPicked}/></span><span style={{ fontSize: 14, lineHeight: 1.5 }}>{statusSet.targetExplanation ?? 'This set was logged before target ratings existed, so it has no rating.'}</span></div>
      <div className="eyebrow">Target</div>
      <p style={{ margin: '4px 0 12px' }}>{statusSet.targetRepsMin ?? exercise.targetRepsMin}–{statusSet.targetRepsMax ?? exercise.targetRepsMax} reps around {statusSet.adaptiveTargetRir ?? exercise.targetRir} RIR{statusSet.adaptiveTargetWeight != null ? <><br/><span className="metric">Adjusted: {fmtWeight(statusSet.adaptiveTargetWeight, unit)}{statusSet.adaptiveTargetReps ? ` × ${statusSet.adaptiveTargetReps}` : ''}</span></> : null}</p>
      <div className="eyebrow">Completed</div>
      <p className="metric" style={{ margin: '4px 0 0' }}>{fmtWeight(statusSet.actualWeight, unit)} × {statusSet.actualReps ?? '—'} @ {statusSet.actualRir ?? '—'} RIR</p>
      {statusSet.algorithmVersion && <div style={{ fontSize: 10, color: 'hsl(var(--muted-foreground))', marginTop: 12 }}>Rating model {String(statusSet.algorithmVersion)}</div>}
      <button className="btn btn-secondary" style={{ width: '100%', marginTop: 16 }} onClick={() => setStatusSet(null)}>Got it</button>
    </Modal>}
    {confirmRemove && <Modal title="Remove this working set?" close={() => setConfirmRemove(null)}>
      <p style={{ color: 'hsl(var(--muted-foreground))', lineHeight: 1.5, marginTop: 0 }}>This set has logged numbers. It will be removed from totals and progression.</p>
      <div style={{ display: 'flex', gap: 9 }}><button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setConfirmRemove(null)}>Keep set</button><button className="btn btn-primary" style={{ flex: 1 }} disabled={removeSet.isPending} onClick={() => doRemove(confirmRemove)}>Remove set</button></div>
    </Modal>}
    {pain && <Modal title="Discomfort on this movement" close={() => setPain(false)}>
      <p style={{ color: 'hsl(var(--muted-foreground))', lineHeight: 1.5, marginTop: 0, fontSize: 14 }}>Joint or tendon discomfort is recorded separately from normal muscle soreness. This is a training note, not a diagnosis. While it is flagged, the app will not recommend adding load or sets for this movement.</p>
      <textarea className="field" style={{ minHeight: 86, padding: 12 }} maxLength={300} placeholder="Optional note, e.g. left elbow pinch on lockout" value={painNote} onChange={(e) => setPainNote(e.target.value)} aria-label="Discomfort note"/>
      <div style={{ display: 'grid', gap: 8, marginTop: 14 }}>
        <button className="btn btn-primary" disabled={updateExercise.isPending} data-testid="button-save-pain" onClick={() => feedback({ painReported: true, painNote: painNote.trim() }, () => setPain(false))}>Record discomfort</button>
        {!superseded && <button className="btn btn-secondary" onClick={() => { setPain(false); onSubstitute(); }}>Swap for another exercise</button>}
        {exercise.painReported && <button className="btn btn-ghost" disabled={updateExercise.isPending} onClick={() => feedback({ painReported: false, painNote: '' }, () => setPain(false))}>Clear discomfort record</button>}
      </div>
    </Modal>}
  </article>;
}
