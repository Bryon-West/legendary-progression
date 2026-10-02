import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Plus, Search } from 'lucide-react';
import { getListExercisesQueryKey, useCreateExercise } from '@workspace/api-client-react';
import type { Exercise } from '@workspace/api-client-react';
import { Modal } from '@/components/modal';
import { ErrorNote, FieldLabel } from '@/components/ui-bits';
import { CATEGORIES, EQUIPMENT, MUSCLES, humanize } from '@/lib/labels';

export function ExerciseForm({ initialName, profileId, submitLabel, onCreated }: { initialName: string; profileId: number; submitLabel: string; onCreated: (e: Exercise) => void }) {
  const [form, setForm] = useState({ name: initialName, muscleGroup: 'Chest', equipment: 'Barbell', category: 'strength' as (typeof CATEGORIES)[number], instructions: '', isCompound: true });
  const create = useCreateExercise();
  const qc = useQueryClient();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate({ data: { profileId, name: form.name.trim(), muscleGroup: form.muscleGroup.trim(), equipment: form.equipment, category: form.category, instructions: form.instructions.trim() || null, isCompound: form.isCompound } }, {
      onSuccess: (exercise) => { void qc.invalidateQueries({ queryKey: ['/api/exercises'] }); void qc.invalidateQueries({ queryKey: getListExercisesQueryKey({ profileId }) }); onCreated(exercise); },
    });
  };
  return <form onSubmit={submit} style={{ display: 'grid', gap: 13 }}>
    <FieldLabel label="NAME"><input className="field" data-testid="input-exercise-name" required maxLength={120} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}/></FieldLabel>
    <FieldLabel label="PRIMARY MUSCLE GROUP"><input className="field" list="muscle-options" required maxLength={60} value={form.muscleGroup} onChange={(e) => setForm({ ...form, muscleGroup: e.target.value })}/></FieldLabel>
    <datalist id="muscle-options">{MUSCLES.map((m) => <option key={m} value={m}/>)}</datalist>
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
      <FieldLabel label="EQUIPMENT"><select className="field" value={form.equipment} onChange={(e) => setForm({ ...form, equipment: e.target.value })}>{EQUIPMENT.map((x) => <option key={x}>{x}</option>)}</select></FieldLabel>
      <FieldLabel label="CATEGORY"><select className="field" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value as (typeof CATEGORIES)[number] })}>{CATEGORIES.map((x) => <option key={x} value={x}>{humanize(x)}</option>)}</select></FieldLabel>
    </div>
    <FieldLabel label="NOTES (OPTIONAL)"><input className="field" value={form.instructions} onChange={(e) => setForm({ ...form, instructions: e.target.value })}/></FieldLabel>
    <label style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 14 }}><input type="checkbox" checked={form.isCompound} onChange={(e) => setForm({ ...form, isCompound: e.target.checked })}/> Compound movement</label>
    <button className="btn btn-primary" disabled={create.isPending}>{create.isPending ? 'Saving…' : submitLabel}</button>
    {create.isError && <ErrorNote message="Could not create this exercise."/>}
  </form>;
}

export function ExercisePicker({ title, exercises, loading, onClose, onSelect, onCreate, profileId }: { title: string; exercises: Exercise[]; loading: boolean; onClose: () => void; onSelect: (e: Exercise) => void; onCreate: (e: Exercise) => void; profileId: number }) {
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const [prefill, setPrefill] = useState('');
  const filtered = exercises.filter((e) => `${e.name} ${e.muscleGroup}`.toLowerCase().includes(search.toLowerCase()));
  const startCreate = () => { setPrefill(search.trim()); setCreating(true); };
  return <Modal title={creating ? 'Create custom exercise' : title} close={onClose}>{creating ? <>
    <ExerciseForm initialName={prefill} profileId={profileId} submitLabel="Create and use exercise" onCreated={onCreate}/>
    <button className="btn btn-ghost" style={{ width: '100%', marginTop: 8 }} onClick={() => setCreating(false)}>Back to search</button>
  </> : <>
    <div style={{ position: 'relative', marginBottom: 12 }}><Search size={17} style={{ position: 'absolute', left: 13, top: 15, color: 'hsl(var(--muted-foreground))' }}/><input className="field" data-testid="input-picker-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search exercise library" style={{ paddingLeft: 40 }}/></div>
    <div style={{ maxHeight: '46dvh', overflowY: 'auto', display: 'grid', gap: 6 }}>
      {loading ? <div className="skeleton" style={{ height: 70 }}/> : filtered.map((exercise) => <button key={exercise.id} data-testid={`button-exercise-${exercise.id}`} onClick={() => onSelect(exercise)} style={{ border: '1px solid hsl(var(--border))', background: 'transparent', color: 'inherit', borderRadius: 13, padding: 13, display: 'flex', justifyContent: 'space-between', textAlign: 'left', alignItems: 'center' }}><span><b>{exercise.name}</b><small style={{ display: 'block', color: 'hsl(var(--muted-foreground))', marginTop: 3 }}>{exercise.muscleGroup} · {exercise.equipment}</small></span><ArrowRight size={16}/></button>)}
      {!loading && !filtered.length && <div style={{ padding: 18, color: 'hsl(var(--muted-foreground))', textAlign: 'center' }}>No matching exercises.</div>}
    </div>
    <button className="btn btn-secondary" data-testid="button-create-custom" style={{ width: '100%', marginTop: 14 }} onClick={startCreate}><Plus size={17}/> {search.trim() ? `Create custom exercise “${search.trim()}”` : 'Create custom exercise'}</button>
  </>}</Modal>;
}
