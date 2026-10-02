import { useState } from 'react';
import { Plus, Search } from 'lucide-react';
import { getGetExerciseBaselineQueryKey, getListExercisesQueryKey, useGetExerciseBaseline, useGetProfileEngineSettings, getGetProfileEngineSettingsQueryKey, useListExercises } from '@workspace/api-client-react';
import { useActiveProfile } from '@/lib/profile';
import { Modal } from '@/components/modal';
import { ExerciseForm } from '@/components/exercise-picker';
import { Empty, QueryError } from '@/components/ui-bits';
import type { Exercise } from '@workspace/api-client-react';
import { fmtDate } from '@/lib/dates';
import { MUSCLES, humanize } from '@/lib/labels';

export default function ExercisesPage() {
  const { profile } = useActiveProfile(); const [search, setSearch] = useState(''); const [modal, setModal] = useState<string | null>(null); const [muscle, setMuscle] = useState(''); const [openId, setOpenId] = useState<number | null>(null);
  const pid = profile?.id ?? 0;
  const list = useListExercises({ profileId: pid, search: search || undefined, muscleGroup: muscle || undefined }, { query: { enabled: !!profile, queryKey: getListExercisesQueryKey({ profileId: pid, search: search || undefined, muscleGroup: muscle || undefined }) } });
  return <main className="page-wrap enter"><div className="eyebrow">Exercise library</div>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'end', margin: '8px 0 18px' }}><h1 className="display" style={{ fontSize: 46, margin: 0 }}>Library.</h1><button className="btn btn-primary" data-testid="button-add-exercise" style={{ minHeight: 43, padding: '0 12px' }} onClick={() => setModal(search.trim())}><Plus size={17}/> Add</button></div>
    <div style={{ position: 'relative', marginBottom: 14 }}><Search size={17} style={{ position: 'absolute', left: 13, top: 15, color: 'hsl(var(--muted-foreground))' }}/><input className="field" data-testid="input-exercise-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name or muscle" style={{ paddingLeft: 40 }}/></div>
    <select className="field" style={{ marginBottom: 14 }} aria-label="Filter by muscle" data-testid="select-muscle-filter" value={muscle} onChange={(e) => setMuscle(e.target.value)}><option value="">All muscles</option>{MUSCLES.map((m) => <option key={m} value={m}>{m}</option>)}</select>
    {list.isLoading ? <div style={{ display: 'grid', gap: 8 }}><div className="skeleton" style={{ height: 76 }}/><div className="skeleton" style={{ height: 76 }}/></div> : list.isError ? <QueryError retry={() => void list.refetch()}/> : list.data?.length ? <div style={{ display: 'grid', gap: 8 }}>{list.data.map((ex) => <ExerciseRow key={ex.id} ex={ex} profileId={pid} open={openId === ex.id} toggle={() => setOpenId(openId === ex.id ? null : ex.id)}/>)}</div>
      : <Empty title="No movements found" detail={search.trim() ? `Nothing matches “${search.trim()}”. Add it to your library.` : 'Add a custom exercise to your library.'} action={<button className="btn btn-primary" data-testid="button-create-from-search" onClick={() => setModal(search.trim())}><Plus size={16}/> {search.trim() ? 'Create custom exercise' : 'Add exercise'}</button>}/>}
    {modal !== null && profile && <Modal title="Add custom exercise" close={() => setModal(null)}><ExerciseForm initialName={modal} profileId={profile.id} submitLabel="Save exercise" onCreated={() => { setModal(null); setSearch(''); }}/></Modal>}
  </main>;
}

type Ex = Exercise;
function ExerciseRow({ ex, profileId, open, toggle }: { ex: Ex; profileId: number; open: boolean; toggle: () => void }) {
  return <article className="panel" style={{ padding: 15 }} data-testid={`row-exercise-${ex.id}`}>
    <button type="button" onClick={toggle} aria-expanded={open} style={{ all: 'unset', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, width: '100%' }}>
      <span><b>{ex.name}</b><span style={{ display: 'block', fontSize: 12, color: 'hsl(var(--muted-foreground))', marginTop: 4 }}>{ex.muscleGroup} · {ex.equipment}{ex.category ? ` · ${humanize(String(ex.category))}` : ''}{ex.profileId ? ' · Custom' : ''}</span></span>
      <span className="badge badge-red">{ex.isCompound ? 'Compound' : 'Isolation'}</span>
    </button>
    {open && <ExerciseDetail ex={ex} profileId={profileId}/>}
  </article>;
}
function ExerciseDetail({ ex, profileId }: { ex: Ex; profileId: number }) {
  const base = useGetExerciseBaseline(profileId, ex.id, { query: { enabled: !!profileId, queryKey: getGetExerciseBaselineQueryKey(profileId, ex.id) } });
  const settings = useGetProfileEngineSettings(profileId, { query: { enabled: !!profileId, queryKey: getGetProfileEngineSettingsQueryKey(profileId) } });
  const st = base.data?.status;
  const row = (k: string, v: string) => <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 12, padding: '5px 0' }}><span style={{ color: 'hsl(var(--muted-foreground))' }}>{k}</span><span style={{ textAlign: 'right' }}>{v}</span></div>;
  return <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid hsl(var(--border))' }} data-testid={`detail-exercise-${ex.id}`}>
    {base.isLoading ? <div className="skeleton" style={{ height: 60 }}/> : base.isError ? <QueryError retry={() => void base.refetch()}/> : base.data && <div style={{ marginBottom: 10 }}>
      <span className={`badge ${st === 'active' ? 'badge-red' : st === 'expired' ? 'badge-warning' : ''}`} data-testid="badge-detail-baseline">{st === 'active' ? 'Active baseline' : st === 'expired' ? 'Baseline expired' : 'No baseline'}</span>
      {st === 'no_baseline' && <div style={{ fontSize: 12, marginTop: 6, color: 'hsl(var(--muted-foreground))' }}>The next session starts in calibration mode at about 3 RIR.</div>}
      {base.data.establishedAt && row('As of', fmtDate(base.data.establishedAt.slice(0, 10), { month: 'short', day: 'numeric', year: 'numeric' }))}
      {base.data.expiresAt && row(st === 'expired' ? 'Expired' : 'Expires', fmtDate(base.data.expiresAt.slice(0, 10), { month: 'short', day: 'numeric', year: 'numeric' }))}
      {settings.data && row('Expiry window', `${settings.data.baselineExpiryWeeks} weeks`)}
      {base.data.pausedWeekOffCount > 0 && row('Paused by week off', String(base.data.pausedWeekOffCount))}
    </div>}
    {ex.secondaryMuscles?.length ? row('Secondary muscles', ex.secondaryMuscles.join(', ')) : null}
    {ex.defaultRepMin != null && ex.defaultRepMax != null && row('Default reps', `${ex.defaultRepMin}–${ex.defaultRepMax}`)}
    {ex.loadIncrementLb != null && row('Increment', `${ex.loadIncrementLb} lb`)}
    {ex.loadIncrementKg != null && row('Increment (kg)', `${ex.loadIncrementKg} kg`)}
    {ex.aliases?.length ? row('Also called', ex.aliases.join(', ')) : null}
  </div>;
}
