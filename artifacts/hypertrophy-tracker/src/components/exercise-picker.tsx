import { useEffect, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Plus, Search } from 'lucide-react';
import { getListExercisesQueryKey, useCreateExercise, useListExercises } from '@workspace/api-client-react';
import type { Exercise, ExerciseMetricDefinition } from '@workspace/api-client-react';
import { Modal } from '@/components/modal';
import { ErrorNote, FieldLabel } from '@/components/ui-bits';
import { CATEGORIES, EQUIPMENT, MUSCLES, humanize } from '@/lib/labels';

type MetricType = ExerciseMetricDefinition['type'];
type MetricUnit = ExerciseMetricDefinition['unit'];
const metricTypes: MetricType[] = ['weight', 'reps', 'distance', 'time', 'height', 'elevation', 'calories', 'steps'];
const metricUnits: Record<MetricType, MetricUnit[]> = {
  weight: ['profile', 'kg', 'lb'],
  reps: ['reps'],
  distance: ['m', 'km', 'mi', 'ft'],
  time: ['s', 'min', 'h'],
  height: ['cm', 'm', 'in', 'ft'],
  elevation: ['m', 'ft'],
  calories: ['kcal'],
  steps: ['steps'],
};
const metricDefaults = (category: string): ExerciseMetricDefinition[] => {
  if (category === 'cardio') return [
    { type: 'distance', label: 'Distance', unit: 'mi', required: true },
    { type: 'time', label: 'Time', unit: 'min', required: true },
  ];
  if (category === 'calisthenics') return [
    { type: 'reps', label: 'Reps', unit: 'reps', required: true },
  ];
  if (category === 'plyometric') return [
    { type: 'reps', label: 'Jumps', unit: 'reps', required: true },
    { type: 'height', label: 'Height', unit: 'cm', required: false },
  ];
  if (category === 'carry' || category === 'sled') return [
    { type: 'weight', label: 'Load', unit: 'profile', required: true },
    { type: 'distance', label: 'Distance', unit: 'm', required: true },
  ];
  return [
    { type: 'weight', label: 'Weight', unit: 'profile', required: true },
    { type: 'reps', label: 'Reps', unit: 'reps', required: true },
  ];
};

export function ExerciseForm({ initialName, profileId, submitLabel, onCreated }: { initialName: string; profileId: number; submitLabel: string; onCreated: (e: Exercise) => void }) {
  const [form, setForm] = useState({ name: initialName, muscleGroup: 'Chest', equipment: 'Barbell', category: 'strength' as (typeof CATEGORIES)[number], instructions: '', isCompound: true, secondary: '', aliases: '', repMin: '', repMax: '', incLb: '', incKg: '' });
  const [metricDefinitions, setMetricDefinitions] = useState<ExerciseMetricDefinition[]>(() => metricDefaults('strength'));
  const create = useCreateExercise();
  const qc = useQueryClient();
  const list = (t: string) => t.split(',').map((x) => x.trim()).filter(Boolean);
  const numOrNull = (t: string) => (t.trim() === '' ? undefined : Number(t));
  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate({ data: { profileId, name: form.name.trim(), muscleGroup: form.muscleGroup.trim(), equipment: form.equipment, category: form.category, metricDefinitions, instructions: form.instructions.trim() || null, isCompound: form.isCompound, secondaryMuscles: list(form.secondary), aliases: list(form.aliases), defaultRepMin: numOrNull(form.repMin), defaultRepMax: numOrNull(form.repMax), loadIncrementLb: numOrNull(form.incLb), loadIncrementKg: numOrNull(form.incKg) } }, {
      onSuccess: (exercise) => { void qc.invalidateQueries({ queryKey: ['/api/exercises'] }); void qc.invalidateQueries({ queryKey: getListExercisesQueryKey({ profileId }) }); onCreated(exercise); },
    });
  };
  return <form onSubmit={submit} style={{ display: 'grid', gap: 13 }}>
    <FieldLabel label="NAME"><input className="field" data-testid="input-exercise-name" required maxLength={120} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}/></FieldLabel>
    <FieldLabel label="PRIMARY MUSCLE GROUP"><input className="field" list="muscle-options" required maxLength={60} value={form.muscleGroup} onChange={(e) => setForm({ ...form, muscleGroup: e.target.value })}/></FieldLabel>
    <datalist id="muscle-options">{MUSCLES.map((m) => <option key={m} value={m}/>)}</datalist>
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
      <FieldLabel label="EQUIPMENT"><select className="field" value={form.equipment} onChange={(e) => setForm({ ...form, equipment: e.target.value })}>{EQUIPMENT.map((x) => <option key={x}>{x}</option>)}</select></FieldLabel>
       <FieldLabel label="CATEGORY"><select className="field" value={form.category} onChange={(e) => {
         const category = e.target.value as (typeof CATEGORIES)[number];
         setForm({ ...form, category });
         setMetricDefinitions(metricDefaults(category));
       }}>{CATEGORIES.map((x) => <option key={x} value={x}>{humanize(x)}</option>)}</select></FieldLabel>
    </div>
     <section style={{ border: '1px solid hsl(var(--border))', borderRadius: 12, padding: 12, display: 'grid', gap: 9 }}>
       <div><b style={{ fontSize: 13 }}>Set metrics</b><div style={{ fontSize: 11, color: 'hsl(var(--muted-foreground))', marginTop: 3 }}>Choose one or two values to record for each set.</div></div>
       {metricDefinitions.map((definition, index) => <div key={index} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, alignItems: 'end' }}>
         <FieldLabel label={`METRIC ${index + 1} TYPE`}><select className="field" value={definition.type} onChange={(e) => {
           const type = e.target.value as MetricType;
           const unit = metricUnits[type][0];
           const label = type === 'reps' ? 'Reps' : type === 'weight' ? 'Weight' : humanize(type);
           setMetricDefinitions((old) => old.map((item, itemIndex) => itemIndex === index ? { ...item, type, unit, label } : item));
         }}>{metricTypes.map((type) => <option key={type} value={type}>{humanize(type)}</option>)}</select></FieldLabel>
         <FieldLabel label="LABEL"><input className="field" maxLength={24} required value={definition.label} onChange={(e) => setMetricDefinitions((old) => old.map((item, itemIndex) => itemIndex === index ? { ...item, label: e.target.value } : item))}/></FieldLabel>
         <FieldLabel label="UNIT"><select className="field" value={definition.unit} onChange={(e) => setMetricDefinitions((old) => old.map((item, itemIndex) => itemIndex === index ? { ...item, unit: e.target.value as MetricUnit } : item))}>{metricUnits[definition.type].map((unit) => <option key={unit} value={unit}>{unit === 'profile' ? 'Profile weight unit' : unit}</option>)}</select></FieldLabel>
         <label style={{ display: 'flex', alignItems: 'center', gap: 7, minHeight: 42, fontSize: 12 }}><input type="checkbox" checked={definition.required} onChange={(e) => setMetricDefinitions((old) => old.map((item, itemIndex) => itemIndex === index ? { ...item, required: e.target.checked } : item))}/> Required</label>
       </div>)}
       <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
         <button type="button" className="btn btn-outline btn-sm" disabled={metricDefinitions.length >= 2} onClick={() => setMetricDefinitions((old) => old.length >= 2 ? old : [...old, { type: 'time', label: 'Time', unit: 'min', required: false }])}>Add second metric</button>
         <button type="button" className="btn btn-outline btn-sm" disabled={metricDefinitions.length <= 1} onClick={() => setMetricDefinitions((old) => old.slice(0, 1))}>Use one metric</button>
       </div>
     </section>
    <FieldLabel label="NOTES (OPTIONAL)"><input className="field" value={form.instructions} onChange={(e) => setForm({ ...form, instructions: e.target.value })}/></FieldLabel>
    <FieldLabel label="SECONDARY MUSCLES (COMMA SEPARATED, OPTIONAL)"><input className="field" value={form.secondary} onChange={(e) => setForm({ ...form, secondary: e.target.value })}/></FieldLabel>
    <FieldLabel label="ALIASES (OPTIONAL, E.G. RDL)"><input className="field" value={form.aliases} onChange={(e) => setForm({ ...form, aliases: e.target.value })}/></FieldLabel>
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
      <FieldLabel label="DEFAULT REPS MIN"><input className="field" type="number" min="1" value={form.repMin} onChange={(e) => setForm({ ...form, repMin: e.target.value })}/></FieldLabel>
      <FieldLabel label="DEFAULT REPS MAX"><input className="field" type="number" min="1" value={form.repMax} onChange={(e) => setForm({ ...form, repMax: e.target.value })}/></FieldLabel>
      <FieldLabel label="INCREMENT (LB)"><input className="field" type="number" step="any" min="0" value={form.incLb} onChange={(e) => setForm({ ...form, incLb: e.target.value })}/></FieldLabel>
      <FieldLabel label="INCREMENT (KG)"><input className="field" type="number" step="any" min="0" value={form.incKg} onChange={(e) => setForm({ ...form, incKg: e.target.value })}/></FieldLabel>
    </div>
    <label style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 14 }}><input type="checkbox" checked={form.isCompound} onChange={(e) => setForm({ ...form, isCompound: e.target.checked })}/> Compound movement</label>
    <button className="btn btn-primary" disabled={create.isPending}>{create.isPending ? 'Saving…' : submitLabel}</button>
    {create.isError && <ErrorNote message="Could not create this exercise."/>}
  </form>;
}

export function ExercisePicker({ title, onClose, onSelect, onCreate, profileId }: { title: string; exercises?: Exercise[]; loading?: boolean; onClose: () => void; onSelect: (e: Exercise) => void; onCreate: (e: Exercise) => void; profileId: number }) {
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const [prefill, setPrefill] = useState('');
  const [term, setTerm] = useState('');
  useEffect(() => { const t = window.setTimeout(() => setTerm(search.trim()), 250); return () => window.clearTimeout(t); }, [search]);
  // Server-side search so aliases such as RDL or DB Bench match.
  const q = useListExercises({ profileId, ...(term ? { search: term } : {}) }, { query: { queryKey: ['/api/exercises', { profileId, search: term }] } });
  const loading = q.isLoading;
  const filtered = q.data ?? [];
  const startCreate = () => { setPrefill(search.trim()); setCreating(true); };
  return <Modal title={creating ? 'Create custom exercise' : title} close={onClose}>{creating ? <>
    <ExerciseForm initialName={prefill} profileId={profileId} submitLabel="Create and use exercise" onCreated={onCreate}/>
    <button className="btn btn-ghost" style={{ width: '100%', marginTop: 8 }} onClick={() => setCreating(false)}>Back to search</button>
  </> : <>
    <div style={{ position: 'relative', marginBottom: 12 }}><Search size={17} style={{ position: 'absolute', left: 13, top: 15, color: 'hsl(var(--muted-foreground))' }}/><input className="field" data-testid="input-picker-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search exercise library" style={{ paddingLeft: 40 }}/></div>
    <div style={{ maxHeight: '46dvh', overflowY: 'auto', display: 'grid', gap: 6 }}>
       {loading ? <div className="skeleton" style={{ height: 70 }}/> : filtered.map((exercise) => <button key={exercise.id} data-testid={`button-exercise-${exercise.id}`} onClick={() => onSelect(exercise)} style={{ border: '1px solid hsl(var(--border))', background: 'transparent', color: 'inherit', borderRadius: 13, padding: 13, display: 'flex', justifyContent: 'space-between', textAlign: 'left', alignItems: 'center' }}><span><b>{exercise.name}</b><small style={{ display: 'block', color: 'hsl(var(--muted-foreground))', marginTop: 3 }}>{exercise.muscleGroup} · {exercise.equipment}{exercise.category ? ` · ${humanize(String(exercise.category))}` : ''}{exercise.metricDefinitions?.length ? ` · ${exercise.metricDefinitions.map((metric) => metric.label).join(', ')}` : ''}{exercise.aliases?.length ? ` · ${exercise.aliases.join(', ')}` : ''}</small></span><ArrowRight size={16}/></button>)}
      {q.isError && <div role="alert" style={{ padding: 14, color: 'hsl(var(--destructive))' }}>Could not search the library. <button className="btn btn-ghost" onClick={() => void q.refetch()}>Retry</button></div>}
      {!loading && !q.isError && !filtered.length && <div style={{ padding: 18, color: 'hsl(var(--muted-foreground))', textAlign: 'center' }}>No matching exercises.</div>}
    </div>
    <button className="btn btn-secondary" data-testid="button-create-custom" style={{ width: '100%', marginTop: 14 }} onClick={startCreate}><Plus size={17}/> {search.trim() ? `Create custom exercise “${search.trim()}”` : 'Create custom exercise'}</button>
  </>}</Modal>;
}
