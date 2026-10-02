import { useState } from 'react';
import { EngineSettings } from '@/components/engine-settings';
import { useQueryClient } from '@tanstack/react-query';
import { Check, Edit3, Plus } from 'lucide-react';
import { getListProfilesQueryKey, useCreateProfile, useUpdateProfile } from '@workspace/api-client-react';
import type { Profile } from '@workspace/api-client-react';
import { useActiveProfile } from '@/lib/profile';
import { ErrorNote, QueryError } from '@/components/ui-bits';
import type { WeightUnit } from '@/lib/units';

export default function ProfilesPage() {
  const { profile, profiles, setProfileId, profilesQuery, unit } = useActiveProfile(); const create = useCreateProfile(); const update = useUpdateProfile(); const qc = useQueryClient();
  const [name, setName] = useState(''); const [editing, setEditing] = useState<number | null>(null); const [editValue, setEditValue] = useState('');
  const refresh = () => void qc.invalidateQueries({ queryKey: getListProfilesQueryKey() });
  const setUnit = (next: WeightUnit) => {
    if (!profile || next === unit) return;
    update.mutate({ profileId: profile.id, data: { weightUnit: next } }, {
      onSuccess: (p) => { qc.setQueryData(getListProfilesQueryKey(), (old: Profile[] | undefined) => old?.map((x) => (x.id === p.id ? p : x))); refresh(); },
    });
  };
  const saveName = (p: Profile) => { if (editValue.trim()) update.mutate({ profileId: p.id, data: { name: editValue.trim() } }, { onSuccess: () => { setEditing(null); refresh(); } }); };
  return <main className="page-wrap enter"><div className="eyebrow">Personal settings</div><h1 className="display" style={{ fontSize: 48, margin: '8px 0 20px' }}>Profile.</h1>
    {profilesQuery.isError && <QueryError retry={() => void profilesQuery.refetch()}/>}
    {profile && <section className="panel" style={{ padding: 17, marginBottom: 20 }}>
      <div className="eyebrow">Weight unit</div>
      <div className="seg" style={{ gridTemplateColumns: '1fr 1fr', margin: '10px 0' }} role="group" aria-label="Weight unit">
        <button type="button" aria-pressed={unit === 'lb'} disabled={update.isPending} onClick={() => setUnit('lb')} data-testid="button-unit-lb">Pounds (lb)</button>
        <button type="button" aria-pressed={unit === 'kg'} disabled={update.isPending} onClick={() => setUnit('kg')} data-testid="button-unit-kg">Kilograms (kg)</button>
      </div>
      <div style={{ fontSize: 12, color: 'hsl(var(--muted-foreground))', lineHeight: 1.5 }}>Records are stored in kilograms. Switching units converts every weight you see, including targets, history and totals. Nothing stored changes.</div>
      {update.isError && <ErrorNote message="Could not save that setting."/>}
    </section>}
    <div style={{ display: 'grid', gap: 9, marginBottom: 20 }}>{profiles.map((p: Profile) => <article className="panel" key={p.id} style={{ padding: 15, display: 'flex', alignItems: 'center', gap: 12 }}>
      <button onClick={() => { setProfileId(p.id); window.localStorage.setItem('training-profile', String(p.id)); }} aria-label={`Switch to ${p.name}`} style={{ width: 40, height: 40, border: 0, borderRadius: 14, background: p.id === profile?.id ? 'hsl(var(--primary))' : 'hsl(var(--secondary))', color: p.id === profile?.id ? 'hsl(var(--primary-foreground))' : 'hsl(var(--foreground))', fontWeight: 800 }}>{p.name.slice(0, 1).toUpperCase()}</button>
      <div style={{ flex: 1 }}>{editing === p.id ? <input className="field" aria-label="Profile name" value={editValue} onChange={(e) => setEditValue(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') saveName(p); }}/> : <><b>{p.name}</b><div style={{ fontSize: 11, color: 'hsl(var(--muted-foreground))' }}>{p.id === profile?.id ? 'Current profile' : 'Training profile'} · {p.weightUnit === 'lb' ? 'lb' : 'kg'}</div></>}</div>
      <button className="btn btn-ghost" aria-label={`Rename ${p.name}`} style={{ minHeight: 40, padding: 8 }} onClick={() => { setEditing(p.id); setEditValue(p.name); }}><Edit3 size={16}/></button>
      {editing === p.id && <button className="btn btn-ghost" aria-label="Save profile name" style={{ minHeight: 40, padding: 8 }} onClick={() => saveName(p)}><Check size={16}/></button>}
    </article>)}</div>
    {profile && <EngineSettings profileId={profile.id}/>}
    <form className="panel" style={{ padding: 17, display: 'grid', gap: 10 }} onSubmit={(e) => { e.preventDefault(); if (!name.trim()) return; create.mutate({ data: { name: name.trim() } }, { onSuccess: (p) => { setName(''); setProfileId(p.id); window.localStorage.setItem('training-profile', String(p.id)); refresh(); } }); }}><strong>Create profile</strong><input className="field" required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} placeholder="Name this profile"/><button className="btn btn-primary" disabled={create.isPending}><Plus size={17}/> Add profile</button>{create.isError && <ErrorNote message="Could not create profile."/>}</form>
  </main>;
}
