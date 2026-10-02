import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowLeft, ArrowUp, Plus, Save, Trash2, X } from 'lucide-react';
import { useLocation, useParams } from 'wouter';
import {
  getGetOverviewQueryKey, getGetSplitQueryKey, getListExercisesQueryKey, getListSplitsQueryKey,
  useGetSplit, useListExercises, useSaveMesocycle,
} from '@workspace/api-client-react';
import type { Exercise, TrainingSplit } from '@workspace/api-client-react';
import { useActiveProfile } from '@/lib/profile';
import { inputValue, parseInputToKg, type WeightUnit } from '@/lib/units';
import { Modal } from '@/components/modal';
import { ExercisePicker } from '@/components/exercise-picker';
import { Empty, ErrorNote, FieldLabel, Loading, QueryError } from '@/components/ui-bits';

type DraftEx = { key: string; id?: number; exerciseId: number; name: string; muscle: string; sets: string; minSets: string; maxSets: string; repsMin: string; repsMax: string; rir: string; weight: string };
type DraftDay = { key: string; id?: number; name: string; exercises: DraftEx[] };
type Draft = { name: string; startDate: string; cycleLengthWeeks: string; days: DraftDay[] };
let seq = 0;
const nk = () => `k${++seq}`;

function toDraft(split: TrainingSplit, unit: WeightUnit): Draft {
  return {
    name: split.name, startDate: (split.startDate ?? new Date().toISOString()).slice(0, 10), cycleLengthWeeks: String(split.cycleLengthWeeks ?? 6),
    days: [...split.days].sort((a, b) => a.dayIndex - b.dayIndex).map((d) => ({
      key: nk(), id: d.id, name: d.name,
      exercises: [...d.exercises].sort((a, b) => a.orderIndex - b.orderIndex).map((x) => ({
        key: nk(), id: x.id, exerciseId: x.exerciseId, name: x.exercise.name, muscle: x.exercise.muscleGroup,
        sets: String(x.targetSets), minSets: String(x.minimumWorkingSets ?? x.targetSets), maxSets: String(x.maximumWorkingSets ?? x.targetSets),
        repsMin: String(x.targetRepsMin), repsMax: String(x.targetRepsMax), rir: String(x.targetRir), weight: inputValue(x.targetWeight, unit),
      })),
    })),
  };
}
const move = <T,>(arr: T[], i: number, d: number) => { const j = i + d; if (j < 0 || j >= arr.length) return arr; const c = [...arr]; [c[i], c[j]] = [c[j], c[i]]; return c; };

export default function MesocycleEditorPage() {
  const { splitId } = useParams<{ splitId: string }>(); const id = Number(splitId);
  const query = useGetSplit(id, { query: { enabled: !!id, queryKey: getGetSplitQueryKey(id) } });
  const { profile, unit } = useActiveProfile(); const pid = profile?.id ?? 0;
  const save = useSaveMesocycle(); const qc = useQueryClient(); const [, navigate] = useLocation();
  const [draft, setDraft] = useState<Draft | null>(null);
  const initial = useRef('');
  const initFor = useRef<number | null>(null);
  const [pickerDay, setPickerDay] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const exercises = useListExercises({ profileId: pid }, { query: { enabled: !!profile && pickerDay !== null, queryKey: getListExercisesQueryKey({ profileId: pid }) } });
  // Adopt fresh server data only while pristine; never overwrite unsaved edits.
  useEffect(() => {
    if (!query.data) return;
    const serialize = (value: Draft) => JSON.stringify(value, (k, v) => (k === 'key' ? undefined : v));
    if (initFor.current === query.data.id && draft && serialize(draft) !== initial.current) return;
    const d = toDraft(query.data, unit);
    const signature = serialize(d);
    if (initFor.current !== query.data.id || signature !== initial.current) {
      initFor.current = query.data.id;
      initial.current = signature;
      setDraft(d);
    }
  }, [query.data, unit, draft]);
  const dirty = useMemo(() => !!draft && JSON.stringify(draft, (k, v) => (k === 'key' ? undefined : v)) !== initial.current, [draft]);
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);
  if (query.isLoading || (query.data && !draft)) return <Loading/>;
  if (query.isError || !query.data || !draft) return <main className="page-wrap"><QueryError retry={() => void query.refetch()}/></main>;

  const patchDay = (key: string, fn: (d: DraftDay) => DraftDay) => setDraft({ ...draft, days: draft.days.map((d) => (d.key === key ? fn(d) : d)) });
  const patchEx = (dayKey: string, exKey: string, patch: Partial<DraftEx>) => patchDay(dayKey, (d) => ({ ...d, exercises: d.exercises.map((x) => (x.key === exKey ? { ...x, ...patch } : x)) }));
  const addExercise = (e: Exercise) => {
    if (!pickerDay) return;
    patchDay(pickerDay, (d) => ({ ...d, exercises: [...d.exercises, { key: nk(), exerciseId: e.id, name: e.name, muscle: e.muscleGroup, sets: '3', minSets: '2', maxSets: '4', repsMin: '8', repsMax: '12', rir: '2', weight: '' }] }));
    setPickerDay(null);
  };
  const submit = () => {
    const errs: string[] = [];
    const n = (s: string) => (s.trim() === '' ? NaN : Number(s));
    if (!draft.name.trim()) errs.push('Give the mesocycle a name.');
    const weeks = n(draft.cycleLengthWeeks);
    if (!Number.isInteger(weeks) || weeks < 1 || weeks > 52) errs.push('Length must be 1 to 52 weeks.');
    if (!draft.startDate) errs.push('Choose a start date.');
    draft.days.forEach((d, di) => {
      if (!d.name.trim()) errs.push(`Day ${di + 1} needs a name.`);
      d.exercises.forEach((x) => {
        const [s, lo, hi, a, b, r] = [n(x.sets), n(x.minSets), n(x.maxSets), n(x.repsMin), n(x.repsMax), n(x.rir)];
        if ([s, lo, hi, a, b, r].some((v) => !Number.isInteger(v))) errs.push(`${x.name}: fill in every number.`);
        else {
          if (lo < 1 || hi > 20 || lo > hi) errs.push(`${x.name}: working sets must run from at least 1 up to 20, minimum not above maximum.`);
          if (s < lo || s > hi) errs.push(`${x.name}: starting sets must sit between the minimum and maximum.`);
          if (a < 1 || b > 100 || a > b) errs.push(`${x.name}: rep minimum cannot exceed the maximum.`);
          if (r < 0 || r > 10) errs.push(`${x.name}: RIR must be 0 to 10.`);
        }
        if (Number.isNaN(parseInputToKg(x.weight, unit))) errs.push(`${x.name}: weight must be a positive number.`);
      });
    });
    setErrors(errs);
    if (errs.length) return;
    save.mutate({ splitId: id, data: {
      name: draft.name.trim(), startDate: draft.startDate, cycleLengthWeeks: weeks,
      days: draft.days.map((d, di) => ({ ...(d.id ? { id: d.id } : {}), name: d.name.trim(), dayIndex: di, exercises: d.exercises.map((x, xi) => ({
        ...(x.id ? { id: x.id } : {}), exerciseId: x.exerciseId, orderIndex: xi, targetSets: n(x.sets), minimumWorkingSets: n(x.minSets), maximumWorkingSets: n(x.maxSets),
        targetRepsMin: n(x.repsMin), targetRepsMax: n(x.repsMax), targetRir: n(x.rir), targetWeight: parseInputToKg(x.weight, unit),
      })) })),
    } }, { onSuccess: (saved) => {
      initial.current = JSON.stringify(draft, (k, v) => (k === 'key' ? undefined : v));
      qc.setQueryData(getGetSplitQueryKey(id), saved);
      void qc.invalidateQueries({ queryKey: getGetSplitQueryKey(id) });
      void qc.invalidateQueries({ queryKey: getListSplitsQueryKey({ profileId: pid }) });
      void qc.invalidateQueries({ queryKey: getGetOverviewQueryKey({ profileId: pid }) });
      navigate('/splits');
    } });
  };
  const cancel = () => { if (dirty) setConfirmCancel(true); else navigate('/splits'); };
  const cell = (day: DraftDay, x: DraftEx, label: string, key: keyof DraftEx, step = '1') => <label style={{ fontSize: 9, color: 'hsl(var(--muted-foreground))' }}>{label}<input className="set-input" style={{ height: 38, marginTop: 4, fontSize: 12 }} type="number" inputMode="decimal" step={step} min="0" value={x[key]} onChange={(e) => patchEx(day.key, x.key, { [key]: e.target.value })}/></label>;
  return <main className="page-wrap enter">
    <button className="btn btn-ghost" style={{ padding: 0 }} onClick={cancel}><ArrowLeft size={17}/> Mesocycles</button>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 17 }}><div className="eyebrow">Mesocycle editor</div>{dirty ? <span className="badge badge-warning" data-testid="badge-unsaved">Unsaved changes</span> : <span className="badge badge-success">Nothing changed</span>}</div>
    <div style={{ display: 'grid', gap: 10, margin: '10px 0 16px' }}>
      <FieldLabel label="NAME"><input className="field" data-testid="input-mesocycle-name" value={draft.name} maxLength={100} onChange={(e) => setDraft({ ...draft, name: e.target.value })}/></FieldLabel>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <FieldLabel label="START DATE"><input className="field" type="date" value={draft.startDate} onChange={(e) => setDraft({ ...draft, startDate: e.target.value })}/></FieldLabel>
        <FieldLabel label="LENGTH (WEEKS)"><input className="field" type="number" min="1" max="52" value={draft.cycleLengthWeeks} onChange={(e) => setDraft({ ...draft, cycleLengthWeeks: e.target.value })}/></FieldLabel>
      </div>
      {query.data.currentWeek != null && <div style={{ fontSize: 12, color: 'hsl(var(--muted-foreground))' }}>Currently in week {query.data.currentWeek}. Changes apply when you save.</div>}
    </div>
    {!draft.days.length && <Empty title="Add your first training day" detail="Name each day, then add movements with rep ranges and set limits."/>}
    <div style={{ display: 'grid', gap: 13, margin: '0 0 18px' }}>{draft.days.map((day, di) => <section className="panel" key={day.key} style={{ padding: 15 }}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 12 }}>
        <span className="eyebrow" style={{ whiteSpace: 'nowrap' }}>DAY {di + 1}</span>
        <input className="field" value={day.name} aria-label={`Day ${di + 1} name`} onChange={(e) => patchDay(day.key, (d) => ({ ...d, name: e.target.value }))}/>
        <button className="btn btn-ghost" style={{ minHeight: 40, padding: 6 }} aria-label="Move day up" disabled={di === 0} onClick={() => setDraft({ ...draft, days: move(draft.days, di, -1) })}><ArrowUp size={15}/></button>
        <button className="btn btn-ghost" style={{ minHeight: 40, padding: 6 }} aria-label="Move day down" disabled={di === draft.days.length - 1} onClick={() => setDraft({ ...draft, days: move(draft.days, di, 1) })}><ArrowDown size={15}/></button>
        <button className="btn btn-ghost" style={{ minHeight: 40, padding: 6 }} aria-label={`Remove day ${di + 1}`} onClick={() => setDraft({ ...draft, days: draft.days.filter((d) => d.key !== day.key) })}><Trash2 size={15}/></button>
      </div>
      {day.exercises.length ? <div style={{ display: 'grid', gap: 8 }}>{day.exercises.map((x, xi) => <div key={x.key} style={{ padding: 12, borderRadius: 14, background: 'hsl(var(--background))', border: '1px solid hsl(var(--border))' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}><div><b style={{ fontSize: 13 }}>{x.name}</b><div style={{ fontSize: 10, color: 'hsl(var(--muted-foreground))', marginTop: 2 }}>{x.muscle}</div></div>
          <div style={{ display: 'flex' }}>
            <button className="btn btn-ghost" style={{ minHeight: 34, padding: 6 }} aria-label={`Move ${x.name} up`} disabled={xi === 0} onClick={() => patchDay(day.key, (d) => ({ ...d, exercises: move(d.exercises, xi, -1) }))}><ArrowUp size={14}/></button>
            <button className="btn btn-ghost" style={{ minHeight: 34, padding: 6 }} aria-label={`Move ${x.name} down`} disabled={xi === day.exercises.length - 1} onClick={() => patchDay(day.key, (d) => ({ ...d, exercises: move(d.exercises, xi, 1) }))}><ArrowDown size={14}/></button>
            <button className="btn btn-ghost" style={{ minHeight: 34, padding: 6 }} aria-label={`Remove ${x.name}`} onClick={() => patchDay(day.key, (d) => ({ ...d, exercises: d.exercises.filter((e) => e.key !== x.key) }))}><Trash2 size={14}/></button></div></div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 5, marginBottom: 6 }}>{cell(day, x, 'Min reps', 'repsMin')}{cell(day, x, 'Max reps', 'repsMax')}{cell(day, x, 'Target RIR', 'rir')}{cell(day, x, `Weight (${unit})`, 'weight', 'any')}</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 5 }}>{cell(day, x, 'Min working sets', 'minSets')}{cell(day, x, 'Start sets', 'sets')}{cell(day, x, 'Max working sets', 'maxSets')}</div>
      </div>)}</div> : <div style={{ padding: '12px 2px', color: 'hsl(var(--muted-foreground))', fontSize: 13 }}>No exercises prescribed yet.</div>}
      <button className="btn btn-secondary" style={{ width: '100%', marginTop: 12, minHeight: 42 }} onClick={() => setPickerDay(day.key)} data-testid={`button-add-movement-${di}`}><Plus size={16}/> Add movement</button>
    </section>)}</div>
    <button className="btn btn-outline" style={{ width: '100%', marginBottom: 18 }} onClick={() => setDraft({ ...draft, days: [...draft.days, { key: nk(), name: `Day ${draft.days.length + 1}`, exercises: [] }] })} data-testid="button-add-day"><Plus size={17}/> Add training day</button>
    {errors.length > 0 && <div className="notice-warn" role="alert" style={{ marginBottom: 12 }}>{errors.map((e) => <div key={e}>{e}</div>)}</div>}
    {save.isError && <ErrorNote message="Could not save the mesocycle. Your edits are still here; try again."/>}
    <div style={{ display: 'flex', gap: 9, position: 'sticky', bottom: 'calc(80px + env(safe-area-inset-bottom))' }}>
      <button className="btn btn-secondary" style={{ flex: 1 }} onClick={cancel} data-testid="button-cancel-mesocycle"><X size={17}/> Cancel</button>
      <button className="btn btn-primary" style={{ flex: 2 }} disabled={save.isPending} onClick={submit} data-testid="button-save-exit"><Save size={17}/> {save.isPending ? 'Saving…' : 'Save & Exit'}</button>
    </div>
    <p style={{ fontSize: 11, color: 'hsl(var(--muted-foreground))', textAlign: 'center' }}>Nothing is saved until you press Save &amp; Exit.</p>
    {pickerDay !== null && <ExercisePicker title="Add movement" exercises={exercises.data ?? []} loading={exercises.isLoading} profileId={pid} onClose={() => setPickerDay(null)} onSelect={addExercise} onCreate={addExercise}/>}
    {confirmCancel && <Modal title="Discard unsaved changes?" close={() => setConfirmCancel(false)}>
      <p style={{ color: 'hsl(var(--muted-foreground))', lineHeight: 1.5, marginTop: 0 }}>Your edits to this mesocycle have not been saved. Discarding returns it to the last saved version.</p>
      <div style={{ display: 'flex', gap: 9 }}><button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setConfirmCancel(false)}>Keep editing</button><button className="btn btn-primary" style={{ flex: 1 }} onClick={() => navigate('/splits')} data-testid="button-discard">Discard</button></div>
    </Modal>}
  </main>;
}
