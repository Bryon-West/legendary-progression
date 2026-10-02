import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Plus } from 'lucide-react';
import { Link, useLocation } from 'wouter';
import { getListSplitsQueryKey, useCreateSplit, useListSplits } from '@workspace/api-client-react';
import { useActiveProfile } from '@/lib/profile';
import { Empty, ErrorNote, QueryError } from '@/components/ui-bits';

export default function MesocyclesPage() {
  const { profile } = useActiveProfile(); const pid = profile?.id ?? 0;
  const list = useListSplits({ profileId: pid }, { query: { enabled: !!profile, queryKey: getListSplitsQueryKey({ profileId: pid }) } });
  const [name, setName] = useState(''); const create = useCreateSplit(); const qc = useQueryClient(); const [, navigate] = useLocation();
  const createPlan = (e: FormEvent) => { e.preventDefault(); if (!profile) return; create.mutate({ data: { profileId: profile.id, name: name.trim() } }, { onSuccess: (split) => { void qc.invalidateQueries({ queryKey: getListSplitsQueryKey({ profileId: profile.id }) }); navigate(`/splits/${split.id}`); } }); };
  return <main className="page-wrap enter"><div className="eyebrow">Programming</div><h1 className="display" style={{ fontSize: 48, margin: '8px 0 19px' }}>Mesocycles.</h1>
    {list.isLoading ? <div className="skeleton" style={{ height: 110 }}/> : list.isError ? <QueryError retry={() => void list.refetch()}/> : list.data?.length ? <div style={{ display: 'grid', gap: 10, marginBottom: 20 }}>{list.data.map((split) => <Link key={split.id} href={`/splits/${split.id}`} data-testid={`link-mesocycle-${split.id}`} style={{ textDecoration: 'none', color: 'inherit' }}><article className="panel" style={{ padding: 17, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><div><div className="eyebrow">{split.days.length} training days{split.currentWeek != null ? ` · week ${split.currentWeek}${split.cycleLengthWeeks ? ` of ${split.cycleLengthWeeks}` : ''}` : ''}</div><h2 style={{ margin: '5px 0 0', fontSize: 18 }}>{split.name}</h2>{split.startDate && <div style={{ fontSize: 11, color: 'hsl(var(--muted-foreground))', marginTop: 4 }}>Started {split.startDate}</div>}</div><ArrowRight size={18} color="hsl(var(--primary))"/></article></Link>)}</div> : <Empty title="Build your first mesocycle" detail="Set up your training days and the movements, rep ranges and set limits for each."/>}
    <form onSubmit={createPlan} className="panel" style={{ padding: 17, display: 'grid', gap: 11 }}><strong>Create a mesocycle</strong><input className="field" data-testid="input-mesocycle-name" required maxLength={100} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Upper / lower, block 1"/><button className="btn btn-primary" disabled={create.isPending}><Plus size={17}/>{create.isPending ? 'Creating…' : 'Create mesocycle'}</button>{create.isError && <ErrorNote message="Could not create this mesocycle."/>}</form>
  </main>;
}
