import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowLeft, ArrowUp, Lock, Plus, Save, Trash2, X } from 'lucide-react';
import type { Exercise, MesocycleExerciseInput, NewMesocycleInput } from '@workspace/api-client-react';
import { inputValue, parseInputToKg, type WeightUnit } from '@/lib/units';
import { addDays, dayOffsets } from '@/lib/dates';
import { weekLabel } from '@/lib/labels';
import { Modal } from '@/components/modal';
import { ExercisePicker } from '@/components/exercise-picker';
import { Empty, ErrorNote, FieldLabel } from '@/components/ui-bits';

export type DraftEx = { key: string; id?: number; exerciseId: number; name: string; muscle: string; sets: string; minSets: string; maxSets: string; repsMin: string; repsMax: string; rir: string; weight: string };
export type DraftDay = { key: string; id?: number; name: string; exercises: DraftEx[] };
export type DraftOcc = { id?: number; dayKey: string; date: string };
export type WeekKind = 'loading' | 'deload' | 'week_off';
export type WeekState = 'new' | 'future' | 'in_progress' | 'completed';
export type DraftWeek = { key: string; id?: number; kind: WeekKind; rir: string; state: WeekState; occ: DraftOcc[] };
export type Draft = { name: string; startDate: string; days: DraftDay[]; weeks: DraftWeek[] };

let seq = 0;
export const nk = () => `k${++seq}`;
const locked = (w: DraftWeek) => w.state === 'completed' || w.state === 'in_progress';
const move = <T,>(arr: T[], i: number, d: number) => { const j = i + d; if (j < 0 || j >= arr.length) return arr; const c = [...arr]; [c[i], c[j]] = [c[j], c[i]]; return c; };
const serialize = (d: Draft) => JSON.stringify(d, (k, v) => (k === 'key' ? undefined : v));

export function exFromInput(x: MesocycleExerciseInput & { id?: number }, byId: Map<number, Exercise>, unit: WeightUnit): DraftEx {
  const meta = byId.get(x.exerciseId);
  return {
    key: nk(), id: x.id, exerciseId: x.exerciseId, name: meta?.name ?? `Exercise ${x.exerciseId}`, muscle: meta?.muscleGroup ?? '',
    sets: String(x.targetSets), minSets: String(x.minimumWorkingSets ?? x.targetSets), maxSets: String(x.maximumWorkingSets ?? x.targetSets),
    repsMin: String(x.targetRepsMin), repsMax: String(x.targetRepsMax), rir: String(x.targetRir), weight: inputValue(x.targetWeight, unit),
  };
}
export function newWeekOcc(days: DraftDay[], startDate: string, pos: number): DraftOcc[] {
  const offs = dayOffsets(days.length);
  return days.map((d, i) => ({ dayKey: d.key, date: addDays(startDate, 7 * pos + offs[i]) }));
}
export const defaultWeeks = (rirs: number[], days: DraftDay[], startDate: string): DraftWeek[] =>
  rirs.map((r, i) => ({ key: nk(), kind: 'loading' as const, rir: String(r), state: 'new' as const, occ: newWeekOcc(days, startDate, i) }));
/** Keep unstarted weeks in step with the day list without touching started or completed history. */
function syncWeeks(days: DraftDay[], weeks: DraftWeek[], startDate: string): DraftWeek[] {
  return weeks.map((w, pos) => {
    if (locked(w) || w.kind === 'week_off') return w;
    const keys = new Set(days.map((d) => d.key));
    const kept = w.occ.filter((o) => keys.has(o.dayKey));
    const have = new Set(kept.map((o) => o.dayKey));
    const gen = newWeekOcc(days, startDate, pos).filter((o) => !have.has(o.dayKey));
    return { ...w, occ: [...kept, ...gen] };
  });
}
export function suggestRir(weeks: DraftWeek[]) {
  const loading = weeks.filter((w) => w.kind === 'loading');
  const last = Number(loading[loading.length - 1]?.rir ?? 3);
  // Step toward harder loading but never auto-stack repeated 0 RIR weeks.
  return last > 0 ? last - 1 : 1;
}

export function toInput(draft: Draft, unit: WeightUnit): { input?: NewMesocycleInput; errors: string[] } {
  const errors: string[] = [];
  const n = (s: string) => (s.trim() === '' ? NaN : Number(s));
  if (!draft.name.trim()) errors.push('Give the mesocycle a name.');
  if (!draft.startDate) errors.push('Choose a start date.');
  if (!draft.days.length) errors.push('Add at least one training day.');
  if (!draft.weeks.length) errors.push('Add at least one week.');
  if (draft.weeks.length > 104) errors.push('A mesocycle can have at most 104 weeks.');
  if (draft.weeks.length && !draft.weeks.some((w) => w.kind === 'loading')) errors.push('Include at least one loading week.');
  draft.weeks.forEach((w, i) => {
    const r = n(w.rir);
    if (!Number.isInteger(r) || r < 0 || r > 10) errors.push(`Week ${i + 1}: RIR must be a whole number from 0 to 10.`);
  });
  draft.days.forEach((d, di) => {
    if (!d.name.trim()) errors.push(`Day ${di + 1} needs a name.`);
    if (!d.exercises.length) errors.push(`${d.name || `Day ${di + 1}`} needs at least one movement.`);
    d.exercises.forEach((x) => {
      const [s, lo, hi, a, b, r] = [n(x.sets), n(x.minSets), n(x.maxSets), n(x.repsMin), n(x.repsMax), n(x.rir)];
      if ([s, lo, hi, a, b, r].some((v) => !Number.isInteger(v))) { errors.push(`${x.name}: fill in every number.`); return; }
      if (lo < 1 || hi > 20 || lo > hi) errors.push(`${x.name}: working sets must run from at least 1 up to 20, minimum not above maximum.`);
      if (s < lo || s > hi) errors.push(`${x.name}: starting sets must sit between the minimum and maximum.`);
      if (a < 1 || b > 100 || a > b) errors.push(`${x.name}: rep minimum cannot exceed the maximum.`);
      if (r < 0 || r > 10) errors.push(`${x.name}: RIR must be 0 to 10.`);
      if (Number.isNaN(parseInputToKg(x.weight, unit))) errors.push(`${x.name}: weight must be a positive number.`);
    });
  });
  if (errors.length) return { errors };
  return { errors, input: {
    name: draft.name.trim(), startDate: draft.startDate, cycleLengthWeeks: draft.weeks.length,
    days: draft.days.map((d, di) => ({ ...(d.id ? { id: d.id } : {}), name: d.name.trim(), dayIndex: di, exercises: d.exercises.map((x, xi) => ({
      ...(x.id ? { id: x.id } : {}), exerciseId: x.exerciseId, orderIndex: xi, targetSets: n(x.sets), minimumWorkingSets: n(x.minSets), maximumWorkingSets: n(x.maxSets),
      targetRepsMin: n(x.repsMin), targetRepsMax: n(x.repsMax), targetRir: n(x.rir), targetWeight: parseInputToKg(x.weight, unit),
    })) })),
    weeks: draft.weeks.map((w, wi) => ({
      ...(w.id ? { id: w.id } : {}), weekIndex: wi + 1, kind: w.kind, targetRir: n(w.rir),
      scheduledWorkouts: w.kind === 'week_off' ? [] : [...w.occ].sort((a, b) => a.date.localeCompare(b.date)).map((o) => ({ ...(o.id ? { id: o.id } : {}), dayIndex: Math.max(0, draft.days.findIndex((d) => d.key === o.dayKey)), scheduledDate: o.date })),
    })),
  } };
}

export function MesocycleBuilder({ initial, mode, splitId, profileId, unit, deloadRir, saving, saveError, banner, onSave, onCancel }: {
  initial: Draft; mode: 'new' | 'edit'; splitId?: number; profileId: number; unit: WeightUnit; deloadRir: number; saving: boolean; saveError: boolean;
  banner?: ReactNode; onSave: (input: NewMesocycleInput) => void; onCancel: () => void;
}) {
  const [draft, setDraft] = useState(initial);
  const baseline = useRef(serialize(initial));
  const [pickerDay, setPickerDay] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [addWeek, setAddWeek] = useState<{ rir: string } | null>(null);
  const [addRecovery, setAddRecovery] = useState(false);
  const [removeWeek, setRemoveWeek] = useState<DraftWeek | null>(null);
  const dirty = useMemo(() => serialize(draft) !== baseline.current, [draft]);
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);

  const setDays = (days: DraftDay[]) => setDraft((d) => ({ ...d, days, weeks: syncWeeks(days, d.weeks, d.startDate) }));
  const patchDay = (key: string, fn: (d: DraftDay) => DraftDay) => setDays(draft.days.map((d) => (d.key === key ? fn(d) : d)));
  const patchEx = (dayKey: string, exKey: string, patch: Partial<DraftEx>) => patchDay(dayKey, (d) => ({ ...d, exercises: d.exercises.map((x) => (x.key === exKey ? { ...x, ...patch } : x)) }));
  const patchWeek = (key: string, patch: Partial<DraftWeek>) => setDraft((d) => ({ ...d, weeks: d.weeks.map((w) => (w.key === key ? { ...w, ...patch } : w)) }));
  const recoveryIdx = draft.weeks.findIndex((w) => w.kind !== 'loading');
  const hasRecovery = recoveryIdx >= 0;

  const addExercise = (e: Exercise) => {
    if (!pickerDay) return;
    patchDay(pickerDay, (d) => ({ ...d, exercises: [...d.exercises, { key: nk(), exerciseId: e.id, name: e.name, muscle: e.muscleGroup, sets: '3', minSets: '2', maxSets: '4', repsMin: String(e.defaultRepMin ?? 8), repsMax: String(e.defaultRepMax ?? 12), rir: '2', weight: '' }] }));
    setPickerDay(null);
  };
  const shiftWeek = (w: DraftWeek, by: number): DraftWeek => locked(w) ? w : ({ ...w, occ: w.occ.map((o) => ({ ...o, date: addDays(o.date, by) })) });
  const insertWeek = (week: Omit<DraftWeek, 'occ'>, at: number) => setDraft((d) => {
    const occ = week.kind === 'week_off' ? [] : newWeekOcc(d.days, d.startDate, at);
    const before = d.weeks.slice(0, at); const after = d.weeks.slice(at).map((w) => shiftWeek(w, 7));
    return { ...d, weeks: [...before, { ...week, occ }, ...after] };
  });
  const openAddWeek = () => setAddWeek({ rir: String(suggestRir(draft.weeks)) });
  const confirmAddWeek = () => {
    if (!addWeek) return;
    const r = Number(addWeek.rir);
    if (!Number.isInteger(r) || r < 0 || r > 10) return;
    const at = hasRecovery && !locked(draft.weeks[recoveryIdx]) ? recoveryIdx : draft.weeks.length;
    insertWeek({ key: nk(), kind: 'loading', rir: String(r), state: 'new' }, at);
    setAddWeek(null);
  };
  const confirmAddRecovery = (kind: 'deload' | 'week_off') => {
    insertWeek({ key: nk(), kind, rir: kind === 'deload' ? String(deloadRir) : '10', state: 'new' }, draft.weeks.length);
    setAddRecovery(false);
  };
  // Draft-only: nothing touches the server until Save & Exit. Following unstarted weeks move up one week.
  const doRemoveWeek = (w: DraftWeek) => {
    setDraft((d) => {
      const at = d.weeks.findIndex((x) => x.key === w.key);
      if (at < 0) return d;
      return { ...d, weeks: [...d.weeks.slice(0, at), ...d.weeks.slice(at + 1).map((x) => shiftWeek(x, -7))] };
    });
    setRemoveWeek(null);
  };
  const submit = () => {
    const res = toInput(draft, unit);
    setErrors(res.errors);
    if (res.input) onSave(res.input);
  };
  const cancel = () => { if (dirty) setConfirmCancel(true); else onCancel(); };
  const cell = (day: DraftDay, x: DraftEx, lab: string, key: keyof DraftEx, step = '1') => <label style={{ fontSize: 9, color: 'hsl(var(--muted-foreground))' }}>{lab}<input className="set-input" style={{ height: 38, marginTop: 4, fontSize: 12 }} type="number" inputMode="decimal" step={step} min="0" value={x[key]} onChange={(e) => patchEx(day.key, x.key, { [key]: e.target.value })}/></label>;
  const loadingCount = draft.weeks.filter((w) => w.kind === 'loading').length;

  return <main className="page-wrap enter">
    <button className="btn btn-ghost" style={{ padding: 0 }} onClick={cancel} data-testid="button-back"><ArrowLeft size={17}/> Plans</button>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 17 }}><div className="eyebrow">{mode === 'new' ? 'New mesocycle draft' : 'Mesocycle editor'}</div>{dirty ? <span className="badge badge-warning" data-testid="badge-unsaved">Unsaved changes</span> : <span className="badge badge-success">Nothing changed</span>}</div>
    {banner}
    <div style={{ display: 'grid', gap: 10, margin: '10px 0 16px' }}>
      <FieldLabel label="NAME"><input className="field" data-testid="input-mesocycle-name" value={draft.name} maxLength={100} onChange={(e) => setDraft({ ...draft, name: e.target.value })}/></FieldLabel>
      <FieldLabel label="START DATE"><input className="field" type="date" disabled={mode === 'edit'} value={draft.startDate} onChange={(e) => setDraft((d) => ({ ...d, startDate: e.target.value, weeks: d.weeks.map((w, pos) => (w.state === 'new' && w.kind !== 'week_off' ? { ...w, occ: newWeekOcc(d.days, e.target.value || d.startDate, pos) } : w)) }))}/></FieldLabel>
    </div>

    <section className="panel" style={{ padding: 15, marginBottom: 18 }} data-testid="section-weeks">
      <div className="eyebrow" style={{ marginBottom: 4 }}>Weeks and target RIR</div>
      <div style={{ fontSize: 12, color: 'hsl(var(--muted-foreground))', marginBottom: 12, lineHeight: 1.45 }}>Each week stores its own RIR. Dates are separate: moving a workout never changes its week or RIR. Completed and started weeks are historical and cannot be removed.</div>
      <div style={{ display: 'grid', gap: 7 }}>{draft.weeks.map((w, wi) => {
        const isLocked = locked(w);
        return <div key={w.key} className={`week-head ${w.kind === 'loading' ? '' : 'recovery'}`} data-testid={`row-week-${wi + 1}`}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 800, fontSize: 13 }}>{w.kind === 'loading' ? `WEEK ${wi + 1}` : weekLabel(w.kind)}</div>
            {w.kind === 'week_off' ? <div style={{ fontSize: 11, color: 'hsl(var(--muted-foreground))' }}>No scheduled lifting. Not counted as missed.</div> : w.kind === 'deload' && !isLocked ? <div style={{ fontSize: 11, color: 'hsl(var(--muted-foreground))' }}>Reduced load and sets from your engine settings.</div> : null}
            {isLocked && <div style={{ fontSize: 10, color: 'hsl(var(--muted-foreground))', display: 'flex', gap: 4, alignItems: 'center', marginTop: 2 }}><Lock size={10}/> {w.state === 'completed' ? 'Completed' : 'In progress'}</div>}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {w.kind !== 'week_off' && <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11 }}><input className="set-input" style={{ width: 52, height: 36 }} type="number" min="0" max="10" aria-label={`Week ${wi + 1} target RIR`} data-testid={`input-week-rir-${wi + 1}`} value={w.rir} disabled={isLocked || w.kind === 'deload'} onChange={(e) => patchWeek(w.key, { rir: e.target.value })}/>RIR</label>}
            {w.kind !== 'loading' && !isLocked && <select className="field" style={{ minHeight: 36, width: 'auto', fontSize: 12, padding: '0 8px' }} aria-label="Recovery type" value={w.kind} onChange={(e) => { const k = e.target.value as WeekKind; setDraft((d) => ({ ...d, weeks: d.weeks.map((x, p) => (x.key === w.key ? { ...x, kind: k, rir: k === 'deload' ? String(deloadRir) : '10', occ: k === 'week_off' ? [] : newWeekOcc(d.days, d.startDate, p) } : x)) })); }}><option value="deload">Deload</option><option value="week_off">Week off</option></select>}
            {!isLocked && <button className="btn btn-ghost" style={{ minHeight: 36, padding: 6 }} aria-label={`Remove week ${wi + 1}`} data-testid={`button-remove-week-${wi + 1}`} disabled={w.kind === 'loading' && loadingCount <= 1} onClick={() => (w.id ? setRemoveWeek(w) : doRemoveWeek(w))}><Trash2 size={15}/></button>}
          </div>
        </div>;
      })}</div>
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button className="btn btn-secondary btn-sm" style={{ flex: 1 }} onClick={openAddWeek} data-testid="button-add-week"><Plus size={15}/> Add week</button>
        <button className="btn btn-secondary btn-sm" style={{ flex: 1 }} disabled={hasRecovery} onClick={() => setAddRecovery(true)} data-testid="button-add-recovery"><Plus size={15}/> Recovery week</button>
      </div>
    </section>

    {!draft.days.length && <Empty title="Add your first training day" detail="Name each day, then add movements with rep ranges and set limits."/>}
    <div style={{ display: 'grid', gap: 13, margin: '0 0 18px' }}>{draft.days.map((day, di) => <section className="panel" key={day.key} style={{ padding: 15 }}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 12 }}>
        <span className="eyebrow" style={{ whiteSpace: 'nowrap' }}>DAY {di + 1}</span>
        <input className="field" value={day.name} aria-label={`Day ${di + 1} name`} onChange={(e) => patchDay(day.key, (d) => ({ ...d, name: e.target.value }))}/>
        <button className="btn btn-ghost" style={{ minHeight: 40, padding: 6 }} aria-label="Move day up" disabled={di === 0} onClick={() => setDays(move(draft.days, di, -1))}><ArrowUp size={15}/></button>
        <button className="btn btn-ghost" style={{ minHeight: 40, padding: 6 }} aria-label="Move day down" disabled={di === draft.days.length - 1} onClick={() => setDays(move(draft.days, di, 1))}><ArrowDown size={15}/></button>
        <button className="btn btn-ghost" style={{ minHeight: 40, padding: 6 }} aria-label={`Remove day ${di + 1}`} disabled={draft.days.length <= 1} onClick={() => setDays(draft.days.filter((d) => d.key !== day.key))}><Trash2 size={15}/></button>
      </div>
      {day.exercises.length ? <div style={{ display: 'grid', gap: 8 }}>{day.exercises.map((x, xi) => <div key={x.key} style={{ padding: 12, borderRadius: 14, background: 'hsl(var(--background))', border: '1px solid hsl(var(--border))' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}><div><b style={{ fontSize: 13 }}>{x.name}</b><div style={{ fontSize: 10, color: 'hsl(var(--muted-foreground))', marginTop: 2 }}>{x.muscle}</div></div>
          <div style={{ display: 'flex' }}>
            <button className="btn btn-ghost" style={{ minHeight: 34, padding: 6 }} aria-label={`Move ${x.name} up`} disabled={xi === 0} onClick={() => patchDay(day.key, (d) => ({ ...d, exercises: move(d.exercises, xi, -1) }))}><ArrowUp size={14}/></button>
            <button className="btn btn-ghost" style={{ minHeight: 34, padding: 6 }} aria-label={`Move ${x.name} down`} disabled={xi === day.exercises.length - 1} onClick={() => patchDay(day.key, (d) => ({ ...d, exercises: move(d.exercises, xi, 1) }))}><ArrowDown size={14}/></button>
            <button className="btn btn-ghost" style={{ minHeight: 34, padding: 6 }} aria-label={`Remove ${x.name}`} onClick={() => patchDay(day.key, (d) => ({ ...d, exercises: d.exercises.filter((e) => e.key !== x.key) }))}><Trash2 size={14}/></button></div></div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 5, marginBottom: 6 }}>{cell(day, x, 'Min reps', 'repsMin')}{cell(day, x, 'Max reps', 'repsMax')}{cell(day, x, 'Base RIR', 'rir')}{cell(day, x, `Weight (${unit})`, 'weight', 'any')}</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 5 }}>{cell(day, x, 'Min working sets', 'minSets')}{cell(day, x, 'Start sets', 'sets')}{cell(day, x, 'Max working sets', 'maxSets')}</div>
      </div>)}</div> : <div style={{ padding: '12px 2px', color: 'hsl(var(--muted-foreground))', fontSize: 13 }}>No exercises prescribed yet.</div>}
      <button className="btn btn-secondary" style={{ width: '100%', marginTop: 12, minHeight: 42 }} onClick={() => setPickerDay(day.key)} data-testid={`button-add-movement-${di}`}><Plus size={16}/> Add movement</button>
    </section>)}</div>
    <button className="btn btn-outline" style={{ width: '100%', marginBottom: 18 }} onClick={() => setDays([...draft.days, { key: nk(), name: `Day ${draft.days.length + 1}`, exercises: [] }])} data-testid="button-add-day"><Plus size={17}/> Add training day</button>
    {errors.length > 0 && <div className="notice-warn" role="alert" style={{ marginBottom: 12 }}>{errors.map((e) => <div key={e}>{e}</div>)}</div>}
    {saveError && <ErrorNote message="Could not save the mesocycle. Your edits are still here; try again."/>}
    <div style={{ display: 'flex', gap: 9, position: 'sticky', bottom: 'calc(80px + env(safe-area-inset-bottom))' }}>
      <button className="btn btn-secondary" style={{ flex: 1 }} onClick={cancel} data-testid="button-cancel-mesocycle"><X size={17}/> Cancel</button>
      <button className="btn btn-primary" style={{ flex: 2 }} disabled={saving} onClick={submit} data-testid="button-save-exit"><Save size={17}/> {saving ? 'Saving…' : 'Save & Exit'}</button>
    </div>
    <p style={{ fontSize: 11, color: 'hsl(var(--muted-foreground))', textAlign: 'center' }}>{mode === 'new' ? 'Nothing is created until you press Save & Exit.' : 'Day and week edits apply when you press Save & Exit.'}</p>
    {pickerDay !== null && <ExercisePicker title="Add movement" profileId={profileId} onClose={() => setPickerDay(null)} onSelect={addExercise} onCreate={addExercise}/>}
    {confirmCancel && <Modal title="Discard unsaved changes?" close={() => setConfirmCancel(false)}>
      <p style={{ color: 'hsl(var(--muted-foreground))', lineHeight: 1.5, marginTop: 0 }}>{mode === 'new' ? 'This draft has not been created. Discarding leaves nothing behind.' : 'Your edits have not been saved. Discarding returns it to the last saved version.'}</p>
      <div style={{ display: 'flex', gap: 9 }}><button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setConfirmCancel(false)}>Keep editing</button><button className="btn btn-destructive" style={{ flex: 1 }} onClick={onCancel} data-testid="button-discard">Discard</button></div>
    </Modal>}
    {addWeek && <Modal title="Add loading week" close={() => setAddWeek(null)}>
      <FieldLabel label="TARGET RIR FOR THIS WEEK"><input className="field" type="number" min="0" max="10" data-testid="input-new-week-rir" value={addWeek.rir} onChange={(e) => setAddWeek({ rir: e.target.value })}/></FieldLabel>
      <p style={{ fontSize: 12, color: 'hsl(var(--muted-foreground))', lineHeight: 1.5 }}>Suggested {suggestRir(draft.weeks)} RIR, one step harder than the last loading week. Repeated 0 RIR weeks are never added automatically. You choose.</p>
      <div style={{ display: 'flex', gap: 9 }}><button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setAddWeek(null)}>Cancel</button><button className="btn btn-primary" style={{ flex: 1 }} onClick={confirmAddWeek} data-testid="button-confirm-add-week">Add week</button></div>
    </Modal>}
    {addRecovery && <Modal title="Add recovery week" close={() => setAddRecovery(false)}>
      <div style={{ display: 'grid', gap: 9 }}>
        <button className="btn btn-secondary" style={{ justifyContent: 'flex-start', textAlign: 'left', minHeight: 64 }} onClick={() => confirmAddRecovery('deload')} data-testid="button-recovery-deload"><span><b>Deload</b><br/><small style={{ fontWeight: 400 }}>Same days, reduced sets and load, higher RIR.</small></span></button>
        <button className="btn btn-secondary" style={{ justifyContent: 'flex-start', textAlign: 'left', minHeight: 64 }} onClick={() => confirmAddRecovery('week_off')} data-testid="button-recovery-week-off"><span><b>Week off</b><br/><small style={{ fontWeight: 400 }}>No lifting. Counts as no missed workouts and does not hurt progression.</small></span></button>
      </div>
    </Modal>}
    {removeWeek && <Modal title="Remove this week?" close={() => setRemoveWeek(null)}>
      <p style={{ color: 'hsl(var(--muted-foreground))', lineHeight: 1.5, marginTop: 0 }}>{weekLabel(removeWeek.kind, draft.weeks.indexOf(removeWeek) + 1, Number(removeWeek.rir))} has not started. It is removed from this draft only; the saved plan changes when you press Save & Exit, and Cancel keeps it.</p>
      <div style={{ display: 'flex', gap: 9 }}><button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setRemoveWeek(null)}>Keep week</button><button className="btn btn-destructive" style={{ flex: 1 }} onClick={() => doRemoveWeek(removeWeek)} data-testid="button-confirm-remove-week">Remove week</button></div>
    </Modal>}
  </main>;
}
