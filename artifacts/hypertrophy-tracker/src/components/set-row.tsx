import { useEffect, useRef, useState } from 'react';
import { useUpdateWorkoutSet } from '@workspace/api-client-react';
import type { WorkoutExercise, WorkoutSet } from '@workspace/api-client-react';
import { StatusIcon, statusClass, statusLabel, type TargetStatus } from '@/components/status';
import { fmtWeight, inputValue, parseInputToKg, parseIntOrNull, type WeightUnit } from '@/lib/units';
import { useWorkoutDrafts } from '@/lib/workout-drafts';

export function SetRow({ set, label, exercise, sessionId, unit, readOnly, onSaved, onStatus, onError }: {
  set: WorkoutSet; label: number; exercise: WorkoutExercise; sessionId: number; unit: WeightUnit; readOnly: boolean;
  onSaved: () => void; onStatus: (s: WorkoutSet) => void; onError: (failed: boolean) => void;
}) {
  const isWork = set.setType === 'work';
  const update = useUpdateWorkoutSet();
  const [w, setW] = useState(inputValue(set.actualWeight, unit));
  const [r, setR] = useState(set.actualReps === null ? '' : String(set.actualReps));
  const [i, setI] = useState(set.actualRir === null ? '' : String(set.actualRir));
  const dirty = useRef(false);
  const version = useRef(0);
  const drafts = useWorkoutDrafts();
  const saving = useRef<Promise<void>>(Promise.resolve());
  const latest = useRef({ w, r, i });
  latest.current = { w, r, i };
  // Only adopt server values while the user has no unsaved edit in this row.
  useEffect(() => {
    if (dirty.current) return;
    setW(inputValue(set.actualWeight, unit));
    setR(set.actualReps === null ? '' : String(set.actualReps));
    setI(set.actualRir === null ? '' : String(set.actualRir));
  }, [set.actualWeight, set.actualReps, set.actualRir, unit]);
  const edit = (fn: (v: string) => void) => (e: { currentTarget: { value: string } }) => { dirty.current = true; version.current += 1; fn(e.currentTarget.value); };
  const save = () => {
    // Serialize a row's saves: an older partial request cannot overwrite a newer completed set.
    const next = saving.current.catch(() => undefined).then(async () => {
      if (!dirty.current) return;
      const values = latest.current;
      const wk = parseInputToKg(values.w, unit);
      const rp = parseIntOrNull(values.r);
      const ri = parseIntOrNull(values.i);
      if (Number.isNaN(wk) || Number.isNaN(rp) || Number.isNaN(ri) ||
          (rp !== null && !Number.isInteger(rp)) || (ri !== null && ri > 10)) {
        onError(true);
        throw new Error('Enter a non-negative weight, whole reps, and RIR from 0 to 10.');
      }
      const complete = isWork ? wk !== null && rp !== null && ri !== null : wk !== null && rp !== null;
      const sent = version.current;
      try {
        await update.mutateAsync({ sessionId, setId: set.id, data: {
          actualWeight: wk, actualReps: rp, actualRir: ri, completed: complete,
        } });
        if (version.current === sent) dirty.current = false;
        onError(false);
        onSaved();
      } catch (error) {
        onError(true);
        throw error;
      }
    });
    saving.current = next;
    return next;
  };
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    if (readOnly || !drafts) return;
    return drafts.register(set.id, () => saveRef.current());
  }, [drafts, readOnly, set.id]);
  const commit = () => { void save().catch(() => undefined); };
  const status = (set.targetStatus ?? null) as TargetStatus | null;
  const tw = set.adaptiveTargetWeight ?? set.targetWeight ?? exercise.targetWeight ?? null;
  const tr = set.adaptiveTargetReps;
  const range = `${set.targetRepsMin ?? exercise.targetRepsMin}–${set.targetRepsMax ?? exercise.targetRepsMax}`;
  const rirT = set.adaptiveTargetRir ?? exercise.targetRir;
  const warning = isWork && set.adaptiveWarning ? set.adaptiveWarning : '';
  return <div className={isWork ? '' : 'set-warm'} style={{ marginBottom: 9 }} data-testid={`row-set-${set.id}`}>
    <div className="set-grid">
      <div className="set-num" title={isWork ? 'Working set' : 'Warm-up set'} style={isWork ? { background: 'hsl(var(--primary))', color: 'hsl(var(--primary-foreground))' } : { background: 'transparent', border: '1px dashed hsl(var(--muted-foreground))', color: 'hsl(var(--muted-foreground))' }}>{isWork ? label : `W${label}`}</div>
      <input aria-label={`${isWork ? 'Set' : 'Warm-up'} ${label} weight in ${unit}`} data-testid={`input-set-weight-${set.id}`} type="number" inputMode="decimal" step="any" min="0" className="set-input" placeholder={unit} value={w} disabled={readOnly} onChange={edit(setW)} onBlur={commit}/>
      <input aria-label={`${isWork ? 'Set' : 'Warm-up'} ${label} reps`} data-testid={`input-set-reps-${set.id}`} type="number" inputMode="numeric" min="0" className="set-input" placeholder="reps" value={r} disabled={readOnly} onChange={edit(setR)} onBlur={commit}/>
      <input aria-label={`${isWork ? 'Set' : 'Warm-up'} ${label} reps in reserve`} data-testid={`input-set-rir-${set.id}`} type="number" inputMode="numeric" min="0" max="10" className="set-input" placeholder="RIR" value={i} disabled={readOnly} onChange={edit(setI)} onBlur={commit}/>
      {isWork && set.completed ? <button className={`status-btn ${statusClass(status)}`} aria-label={`${statusLabel(status)}. Show explanation`} data-testid={`button-status-${set.id}`} onClick={() => onStatus(set)}><StatusIcon status={status}/></button> : <span className="set-head" style={{ fontSize: 8 }}>{isWork ? '' : 'warm-up'}</span>}
    </div>
    {isWork ? <div style={{ fontSize: 10.5, color: 'hsl(var(--muted-foreground))', margin: '4px 0 0 39px', lineHeight: 1.4 }} data-testid={`text-target-${set.id}`}>
      Target <b className="metric" style={{ color: 'hsl(var(--foreground))' }}>{fmtWeight(tw, unit)}{tr ? ` × ${tr}` : ''}</b> · range {range} reps · RIR {rirT}
    </div> : <div style={{ fontSize: 10.5, color: 'hsl(var(--muted-foreground))', margin: '4px 0 0 39px' }}>Warm-up, not rated and not counted</div>}
    {warning && <div className="notice-warn" style={{ margin: '5px 0 0 39px' }} data-testid={`text-warning-${set.id}`}>{warning}</div>}
  </div>;
}
