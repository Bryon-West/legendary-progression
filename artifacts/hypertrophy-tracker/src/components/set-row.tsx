import { useEffect, useRef, useState } from 'react';
import { Check, Lock, Pencil, Trash2, X } from 'lucide-react';
import { getGetProfileEngineSettingsQueryKey, useCompleteWorkoutSet, useGetProfileEngineSettings, useUpdateWorkoutSet } from '@workspace/api-client-react';
import type { WorkoutExercise, WorkoutSet, WorkoutSetUpdate } from '@workspace/api-client-react';
import { StatusIcon, statusClass, statusLabel, type TargetStatus } from '@/components/status';
import { formatRir } from '@/lib/labels';
import { fmtWeight, inputValue, parseInputToKg, parseIntOrNull, type WeightUnit } from '@/lib/units';
import { useActiveProfile } from '@/lib/profile';
import { markWorkoutDraftPending, useWorkoutDrafts } from '@/lib/workout-drafts';

type Field = 'w' | 'r' | 'i';
const numText = (v: number | null | undefined) => (v === null || v === undefined ? '' : String(v));

export function SetRow({ set, label, exercise, sessionId, unit, readOnly, locked, trainingMode, onSaved, onStatus, onError, onRemove }: {
  set: WorkoutSet; label: number; exercise: WorkoutExercise; sessionId: number; unit: WeightUnit; readOnly: boolean; locked: boolean; trainingMode: "basic" | "legendary_pro";
  onSaved: () => void; onStatus: (s: WorkoutSet) => void; onError: (failed: boolean) => void;
  onRemove: (s: WorkoutSet, needsConfirm: boolean) => void;
}) {
  const isWork = set.setType === 'work';
  const isPro = trainingMode === "legendary_pro";
  const calibration = isPro && isWork && exercise.calibrationMode;
  const activeProfileId = useActiveProfile().profile?.id ?? 0;
  const update = useUpdateWorkoutSet();
  const complete = useCompleteWorkoutSet();
  // Prefills: only unlocked working rows with a valid recommendation, or the calibration RIR.
  const canPrefill = isWork && !locked && !set.completed;
  const prefillW = canPrefill && !calibration
    ? (isPro ? set.adaptiveTargetWeight ?? set.targetWeight ?? exercise.recommendedWeight ?? null : set.targetWeight ?? exercise.targetWeight ?? null)
    : null;
  const prefillR = canPrefill && !calibration
    ? (isPro ? set.adaptiveTargetReps ?? exercise.recommendedReps ?? null : set.targetRepsMin ?? exercise.targetRepsMin ?? null)
    : null;
  const prefillI = canPrefill ? (calibration ? (exercise.calibrationRir ?? exercise.targetRir) : (set.adaptiveTargetRir ?? exercise.targetRir)) : null;
  const serverText = () => ({
    w: inputValue(set.actualWeight ?? prefillW, unit),
    r: numText(set.actualReps ?? prefillR),
    i: numText(isPro ? set.actualRir ?? prefillI : null),
  });
  const init = serverText();
  const [w, setW] = useState(init.w);
  const [r, setR] = useState(init.r);
  const [i, setI] = useState(init.i);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState('');
  const dirty = useRef(false);
  const touched = useRef<Record<Field, boolean>>({ w: false, r: false, i: false });
  const version = useRef(0);
  const saving = useRef<Promise<void>>(Promise.resolve());
  const editingRef = useRef(false);
  editingRef.current = editing;
  const latest = useRef({ w, r, i });
  latest.current = { w, r, i };
  const drafts = useWorkoutDrafts();

  // Adopt server values / refreshed recommendations only while the user has no unsaved edit in this row.
  const sig = `${set.actualWeight}|${set.actualReps}|${set.actualRir}|${prefillW}|${prefillR}|${prefillI}|${unit}|${set.completed}`;
  useEffect(() => {
    if (dirty.current) return;
    const t = serverText();
    setW(t.w); setR(t.r); setI(t.i);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);

  const edit = (field: Field, fn: (v: string) => void) => (e: { currentTarget: { value: string } }) => {
    dirty.current = true; markWorkoutDraftPending(set.id, true); touched.current[field] = true; version.current += 1; fn(e.currentTarget.value);
  };

  const parse = () => {
    const v = latest.current;
    const wk = parseInputToKg(v.w, unit);
    const rp = parseIntOrNull(v.r);
    const ri = isPro ? parseIntOrNull(v.i) : null;
    const bad = Number.isNaN(wk) || Number.isNaN(rp) || (isPro && Number.isNaN(ri)) || (rp !== null && !Number.isInteger(rp)) || (ri !== null && (ri > 10 || !Number.isInteger(ri)));
    return { wk, rp, ri, bad };
  };
  const badMsg = isPro ? 'Enter a non-negative weight, whole reps, and a whole RIR from 0 to 10.' : 'Enter a non-negative weight and whole reps.';

  // Serialized per row. Autosave stores only fields the user touched, always as an incomplete draft.
  const save = () => {
    const next = saving.current.catch(() => undefined).then(async () => {
      if (!dirty.current) return;
      if (set.completed && !editingRef.current) return;
      if (editingRef.current) throw new Error(`Finish editing ${isWork ? 'set' : 'warm-up'} ${label} first (Save edit or Cancel).`);
      const { wk, rp, ri, bad } = parse();
      if (bad) { onError(true); throw new Error(badMsg); }
      const data: WorkoutSetUpdate = { completed: false };
      if (touched.current.w) data.actualWeight = wk;
      if (touched.current.r) data.actualReps = rp;
      if (touched.current.i) data.actualRir = ri;
      const sent = version.current;
      try {
        await update.mutateAsync({ sessionId, setId: set.id, data });
        if (version.current === sent) { dirty.current = false; markWorkoutDraftPending(set.id, false); }
        onError(false);
        onSaved();
      } catch (error) { onError(true); throw error; }
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
  const commit = () => { if (!editingRef.current) void save().catch(() => undefined); };

  const completeSet = () => {
    setLocalError('');
    const { wk, rp, ri, bad } = parse();
    if (bad) { setLocalError(badMsg); return; }
    if (wk === null || rp === null || (isPro && isWork && ri === null)) { setLocalError(isPro && isWork ? 'Weight, reps and RIR are all required to complete a set.' : 'Weight and reps are required to complete a set.'); return; }
    setBusy(true);
    // Wait for any queued partial save so it cannot land after the completion.
    const run = saving.current.catch(() => undefined).then(async () => {
      try {
        if (isWork) await complete.mutateAsync({ sessionId, setId: set.id, data: { actualWeight: wk, actualReps: rp, ...(isPro ? { actualRir: ri as number } : {}) } });
        else await update.mutateAsync({ sessionId, setId: set.id, data: { actualWeight: wk, actualReps: rp, ...(isPro ? { actualRir: ri } : {}), completed: true } });
        dirty.current = false; markWorkoutDraftPending(set.id, false); touched.current = { w: false, r: false, i: false };
        onError(false); onSaved();
      } catch (error) { setLocalError('Could not complete this set. Your numbers are still here.'); throw error; }
    });
    saving.current = run;
    void run.catch(() => undefined).finally(() => setBusy(false));
  };
  const saveEdit = () => {
    setLocalError('');
    const { wk, rp, ri, bad } = parse();
    if (bad || wk === null || rp === null || (isPro && isWork && ri === null)) { setLocalError(bad ? badMsg : isPro && isWork ? 'Weight, reps and RIR are required.' : 'Weight and reps are required.'); return; }
    setBusy(true);
    const run = saving.current.catch(() => undefined).then(async () => {
      try {
        await update.mutateAsync({ sessionId, setId: set.id, data: { actualWeight: wk, actualReps: rp, ...(isPro ? { actualRir: ri } : {}), completed: true, editIntent: true } });
        dirty.current = false; markWorkoutDraftPending(set.id, false); touched.current = { w: false, r: false, i: false }; setEditing(false); onSaved();
      } catch (error) { setLocalError('Could not save the edit. The original values are unchanged.'); throw error; }
    });
    saving.current = run;
    void run.catch(() => undefined).finally(() => setBusy(false));
  };
  const cancelEdit = () => { dirty.current = false; markWorkoutDraftPending(set.id, false); touched.current = { w: false, r: false, i: false }; setEditing(false); setLocalError(''); const t = serverText(); setW(t.w); setR(t.r); setI(t.i); };

  const hasEntered = () => {
    if (set.completed || dirty.current) return true;
    const t = serverText();
    const stored = { w: set.actualWeight != null, r: set.actualReps != null, i: isPro && set.actualRir != null };
    // Stored actuals that differ from what we would prefill are real data.
    return (stored.w && t.w !== inputValue(prefillW, unit)) || (stored.r && t.r !== numText(prefillR)) || (stored.i && t.i !== numText(prefillI));
  };

  const inputsOff = readOnly || locked || (set.completed && !editing);
  const status = (set.targetStatus ?? null) as TargetStatus | null;
  const showStatus = isPro && isWork && set.completed && !calibration && status !== null;
  const tw = set.adaptiveTargetWeight ?? set.targetWeight ?? exercise.recommendedWeight ?? null;
  const tr = set.adaptiveTargetReps ?? exercise.recommendedReps ?? null;
  const rirT = set.adaptiveTargetRir ?? exercise.targetRir;
  const manualWeightTarget = set.targetWeight ?? exercise.targetWeight ?? null;
  const manualRepMin = set.targetRepsMin ?? exercise.targetRepsMin;
  const manualRepMax = set.targetRepsMax ?? exercise.targetRepsMax;
  const historical = set.completed || readOnly;
  const rangeText = historical && set.targetRepsMin != null && set.targetRepsMax != null ? `snapshot ${set.targetRepsMin}–${set.targetRepsMax} reps` : '6–30 guardrail';
  const settings = useGetProfileEngineSettings(activeProfileId, { query: { enabled: isPro && !!activeProfileId && !historical && !calibration, queryKey: getGetProfileEngineSettingsQueryKey(activeProfileId) } });
  const incText = !isPro ? '' : exercise.loadIncrement != null ? `Load steps of ${inputValue(exercise.loadIncrement, unit)} ${unit}.` : settings.data ? `Load steps of ${unit === 'lb' ? settings.data.loadIncrementLb : settings.data.loadIncrementKg} ${unit}.` : '';
  const liveInfo = (() => {
    if (!isPro || !isWork || calibration || historical || tw == null) return '';
    const kg = parseInputToKg(w, unit);
    const parts: string[] = [];
    if (kg !== null && !Number.isNaN(kg)) {
      const dLb = (kg - (set.referenceTargetWeight ?? tw)) * 2.20462262185;
      const referenceRir = set.referenceTargetRir ?? exercise.targetRir;
      const adaptiveRir = set.adaptiveTargetRir ?? exercise.targetRir;
      if (Math.abs(dLb) > 20.00001) parts.push("Outside prediction range. Legendary Progression can't reliably estimate the equivalent rep change at this load difference. Train to the prescribed RIR and your completed set will help establish a new reference.");
      else if (Math.abs(dLb) >= 0.05) {
        const reps = Math.round(dLb / 5);
        const expected = set.referenceTargetReps != null
          ? referenceRir != null && adaptiveRir != null
            ? set.referenceTargetReps + referenceRir - adaptiveRir - dLb / 5
            : null
          : tr != null ? tr - dLb / 5 : null;
        parts.push(`${Math.abs(dLb).toFixed(1)} lb ${dLb > 0 ? 'above' : 'below'} the reference${expected != null ? `; approximately ${Math.abs(dLb / 5).toFixed(1)} rep${reps === 1 ? '' : 's'} ${dLb > 0 ? 'fewer' : 'more'} (5 lb is roughly 1 rep). Expect about ${Math.max(6, Math.min(30, Math.round(expected)))} reps` : ''}.`);
      }
    }
    return parts.join(' ');
  })();
  const warning = isPro && isWork && !calibration && set.adaptiveWarning ? set.adaptiveWarning : '';
  const kind = isWork ? 'Set' : 'Warm-up';
  const rowClass = `${isWork ? '' : 'set-warm'} ${locked && !set.completed ? 'set-locked' : ''} ${set.completed && !editing ? 'set-done' : ''}`;
  return <div className={rowClass} style={{ marginBottom: 12 }} data-testid={`row-set-${set.id}`}>
    <div className={`set-grid ${isPro ? '' : 'set-grid-basic'}`}>
      <div className="set-num" title={isWork ? 'Working set' : 'Warm-up set'} style={isWork ? { background: 'hsl(var(--primary))', color: 'hsl(var(--primary-foreground))' } : { background: 'transparent', border: '1px dashed hsl(var(--muted-foreground))', color: 'hsl(var(--muted-foreground))' }}>{isWork ? label : `W${label}`}</div>
      <input aria-label={`${kind} ${label} weight in ${unit}`} data-testid={`input-set-weight-${set.id}`} type="number" inputMode="decimal" step="any" min="0" className="set-input" placeholder={unit} value={w} disabled={inputsOff} onChange={edit('w', setW)} onBlur={commit}/>
      <input aria-label={`${kind} ${label} reps`} data-testid={`input-set-reps-${set.id}`} type="number" inputMode="numeric" min="0" className="set-input" placeholder="reps" value={r} disabled={inputsOff} onChange={edit('r', setR)} onBlur={commit}/>
       {isPro && <input aria-label={`${kind} ${label} reps in reserve`} data-testid={`input-set-rir-${set.id}`} type="number" inputMode="numeric" min="0" max="10" className="set-input" placeholder="RIR" value={i} disabled={inputsOff} onChange={edit('i', setI)} onBlur={commit}/>}
       {showStatus ? <button className={`status-btn ${statusClass(status)}`} aria-label={`${statusLabel(status)}. Show explanation`} data-testid={`button-status-${set.id}`} onClick={() => onStatus(set)}><StatusIcon status={status}/></button>
         : <span className="set-head" style={{ fontSize: 8, display: 'grid', placeItems: 'center' }}>{locked && !set.completed ? <Lock size={13}/> : set.completed ? <Check size={14} color="hsl(var(--primary))"/> : isPro && !isWork ? 'warm-up' : ''}</span>}
    </div>
    {isWork ? <div style={{ fontSize: 10.5, color: 'hsl(var(--muted-foreground))', margin: '4px 0 0 39px', lineHeight: 1.4 }} data-testid={`text-target-${set.id}`}>
        {!isPro ? <>Manual entry · {manualWeightTarget != null ? `target ${fmtWeight(manualWeightTarget, unit)} · ` : ''}{manualRepMin != null ? `${manualRepMin}${manualRepMax != null ? `–${manualRepMax}` : ''} reps` : 'weight and reps'}</>
         : calibration ? <>Calibration set. About {formatRir(exercise.calibrationRir ?? exercise.targetRir)} RIR. Not rated.</>
        : locked && !set.completed ? <>Locked until the previous working set is completed.</>
        : <>Target <b className="metric" style={{ color: 'hsl(var(--foreground))' }}>{fmtWeight(tw, unit)}{tr ? ` × ${Math.round(tr)}` : ''}</b> · {rangeText}, {formatRir(rirT)} RIR effort target</>}
    </div> : isPro ? <div style={{ fontSize: 10.5, color: 'hsl(var(--muted-foreground))', margin: '4px 0 0 39px' }}>Warm-up, not rated and not counted</div> : null}
    {(liveInfo || incText) && !readOnly && !set.completed && isWork && !calibration && <div role="status" style={{ margin: '4px 0 0 39px', fontSize: 10.5, color: 'hsl(var(--primary))', lineHeight: 1.4 }} data-testid={`text-live-info-${set.id}`}>{liveInfo} {incText}</div>}
    {warning && <div className="notice-warn" style={{ margin: '5px 0 0 39px' }} data-testid={`text-warning-${set.id}`}>{warning}</div>}
    {localError && <div role="alert" style={{ margin: '5px 0 0 39px', fontSize: 12, color: 'hsl(var(--destructive))' }} data-testid={`text-error-${set.id}`}>{localError}</div>}
    {!readOnly && <div style={{ display: 'flex', gap: 6, margin: '7px 0 0 39px', alignItems: 'center' }}>
       {!set.completed && !locked && <button className="btn btn-primary btn-sm" style={{ flex: 1 }} disabled={busy} onClick={completeSet} data-testid={`button-complete-set-${set.id}`}><Check size={15}/> {busy ? 'Saving…' : isPro ? isWork ? 'Complete set' : 'Complete warm-up' : 'Log set'}</button>}
      {set.completed && !editing && <button className="btn btn-outline btn-sm" onClick={() => { setEditing(true); setLocalError(''); }} data-testid={`button-edit-set-${set.id}`}><Pencil size={13}/> Edit</button>}
      {editing && <><button className="btn btn-primary btn-sm" style={{ flex: 1 }} disabled={busy} onClick={saveEdit} data-testid={`button-save-edit-${set.id}`}><Check size={15}/> Save edit</button><button className="btn btn-outline btn-sm" disabled={busy} onClick={cancelEdit}><X size={14}/> Cancel</button></>}
      <button className="btn btn-danger btn-sm" style={{ marginLeft: 'auto', minWidth: 42 }} aria-label={`Remove ${kind.toLowerCase()} ${label}`} disabled={busy} onClick={() => onRemove(set, hasEntered())} data-testid={`button-remove-set-${set.id}`}><Trash2 size={15}/></button>
    </div>}
  </div>;
}
