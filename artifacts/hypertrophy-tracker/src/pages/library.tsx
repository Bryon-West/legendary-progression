import { useState } from 'react';
import { Plus, Search } from 'lucide-react';
import { getListExercisesQueryKey, useListExercises } from '@workspace/api-client-react';
import { useActiveProfile } from '@/lib/profile';
import { Modal } from '@/components/modal';
import { ExerciseForm } from '@/components/exercise-picker';
import { Empty, QueryError } from '@/components/ui-bits';
import { humanize } from '@/lib/labels';

export default function ExercisesPage() {
  const { profile } = useActiveProfile(); const [search, setSearch] = useState(''); const [modal, setModal] = useState<string | null>(null);
  const pid = profile?.id ?? 0;
  const list = useListExercises({ profileId: pid, search: search || undefined }, { query: { enabled: !!profile, queryKey: getListExercisesQueryKey({ profileId: pid, search: search || undefined }) } });
  return <main className="page-wrap enter"><div className="eyebrow">Exercise library</div>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'end', margin: '8px 0 18px' }}><h1 className="display" style={{ fontSize: 46, margin: 0 }}>Library.</h1><button className="btn btn-primary" data-testid="button-add-exercise" style={{ minHeight: 43, padding: '0 12px' }} onClick={() => setModal(search.trim())}><Plus size={17}/> Add</button></div>
    <div style={{ position: 'relative', marginBottom: 14 }}><Search size={17} style={{ position: 'absolute', left: 13, top: 15, color: 'hsl(var(--muted-foreground))' }}/><input className="field" data-testid="input-exercise-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name or muscle" style={{ paddingLeft: 40 }}/></div>
    {list.isLoading ? <div style={{ display: 'grid', gap: 8 }}><div className="skeleton" style={{ height: 76 }}/><div className="skeleton" style={{ height: 76 }}/></div> : list.isError ? <QueryError retry={() => void list.refetch()}/> : list.data?.length ? <div style={{ display: 'grid', gap: 8 }}>{list.data.map((ex) => <article key={ex.id} className="panel" style={{ padding: 15, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}><div><b>{ex.name}</b><div style={{ fontSize: 12, color: 'hsl(var(--muted-foreground))', marginTop: 4 }}>{ex.muscleGroup} · {ex.equipment}{ex.category ? ` · ${humanize(String(ex.category))}` : ''}{ex.profileId ? ' · Custom' : ''}</div></div><span className="badge badge-red">{ex.isCompound ? 'Compound' : 'Isolation'}</span></article>)}</div>
      : <Empty title="No movements found" detail={search.trim() ? `Nothing matches “${search.trim()}”. Add it to your library.` : 'Add a custom exercise to your library.'} action={<button className="btn btn-primary" data-testid="button-create-from-search" onClick={() => setModal(search.trim())}><Plus size={16}/> {search.trim() ? 'Create custom exercise' : 'Add exercise'}</button>}/>}
    {modal !== null && profile && <Modal title="Add custom exercise" close={() => setModal(null)}><ExerciseForm initialName={modal} profileId={profile.id} submitLabel="Save exercise" onCreated={() => { setModal(null); setSearch(''); }}/></Modal>}
  </main>;
}
