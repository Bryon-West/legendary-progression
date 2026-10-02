import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowRight, CalendarDays, Minus, Plus } from 'lucide-react';
import { Link } from 'wouter';
import { getListSplitsQueryKey, useAddLoadingWeek, useDeleteMesocyclePreservingHistory, useListSplits, useRemoveFinalLoadingWeek, useTransitionMesocycle } from '@workspace/api-client-react';
import type { TrainingSplit } from '@workspace/api-client-react';
import { useActiveProfile } from '@/lib/profile';
import { Empty, ErrorNote, QueryError } from '@/components/ui-bits';
import { Modal } from '@/components/modal';
import { fmtDate } from '@/lib/dates';
import { lifecycleOf } from '@/lib/v22';
import { refreshTrainingData, mutationError } from '@/lib/training-cache';

const GROUPS: { key: 'current' | 'planned' | 'paused' | 'past'; title: string }[] = [
  { key: 'current', title: 'Current' }, { key: 'planned', title: 'Planned' }, { key: 'paused', title: 'Paused' }, { key: 'past', title: 'Past' },
];
type Action = 'activate' | 'pause' | 'resume' | 'end_early' | 'restart';

export default function MesocyclesPage() {
  const { profile } = useActiveProfile(); const pid = profile?.id ?? 0;
  const qc = useQueryClient();
  const list = useListSplits({ profileId: pid }, { query: { enabled: !!profile, queryKey: getListSplitsQueryKey({ profileId: pid }) } });
  const transition = useTransitionMesocycle();
  const addWeek = useAddLoadingWeek();
  const del = useDeleteMesocyclePreservingHistory();
  const [delFor, setDelFor] = useState<TrainingSplit | null>(null);
  const removeWeek = useRemoveFinalLoadingWeek();
  const [confirm, setConfirm] = useState<{ split: TrainingSplit; action: 'end_early' | 'restart' } | null>(null);
  const [weekFor, setWeekFor] = useState<{ split: TrainingSplit; rir: string } | null>(null);
  const [recal, setRecal] = useState(false);
  const [err, setErr] = useState('');
  const refresh = () => refreshTrainingData(qc);
  const run = (split: TrainingSplit, action: Action, recalibrateAll?: boolean) => {
    setErr('');
    transition.mutate({ splitId: split.id, data: { profileId: pid, action, ...(recalibrateAll !== undefined ? { recalibrateAll } : {}) } }, { onSuccess: async () => { setConfirm(null); await refresh(); }, onError: error => setErr(mutationError(error)) });
  };
  const splits = list.data ?? [];
  const btn = (split: TrainingSplit, action: Action, label: string, primary = false) => <button key={action} className={`btn ${primary ? 'btn-primary' : 'btn-secondary'} btn-sm`} disabled={transition.isPending} onClick={() => action === 'end_early' || action === 'restart' ? (setRecal(false), setConfirm({ split, action })) : run(split, action)} data-testid={`button-${action}-${split.id}`}>{label}</button>;
  return <main className="page-wrap enter"><div className="eyebrow">Programming</div>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'end', margin: '8px 0 19px' }}><h1 className="display" style={{ fontSize: 48, margin: 0 }}>Plans.</h1>
      <Link href="/splits/new" className="btn btn-primary" style={{ textDecoration: 'none', minHeight: 43, padding: '0 14px' }} data-testid="link-new-mesocycle"><Plus size={17}/> New</Link></div>
    {err && <ErrorNote message={err}/>}
    {list.isLoading ? <div className="skeleton" style={{ height: 110 }}/> : list.isError ? <QueryError retry={() => void list.refetch()}/> : splits.length ? GROUPS.map((g) => {
      const items = splits.filter((s) => lifecycleOf(s) === g.key);
      if (!items.length) return null;
      return <section key={g.key} style={{ marginBottom: 22 }} data-testid={`group-${g.key}`}>
        <div className="eyebrow" style={{ marginBottom: 8 }}>{g.title} · {items.length}</div>
        <div style={{ display: 'grid', gap: 10 }}>{items.map((split) => <article key={split.id} className="panel" style={{ padding: 17 }}>
          <Link href={`/splits/${split.id}`} data-testid={`link-mesocycle-${split.id}`} style={{ textDecoration: 'none', color: 'inherit', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><div><div className="eyebrow">{split.days.length} training days · <span data-testid={`text-week-count-${split.id}`} style={{ fontFamily: 'system-ui, sans-serif', fontSize: 12, fontVariantNumeric: 'lining-nums tabular-nums', letterSpacing: '.04em' }}>{g.key === 'past' ? `${split.cycleLengthWeeks} weeks` : `Week ${split.currentWeek} of ${split.cycleLengthWeeks}`}</span></div><h2 style={{ margin: '5px 0 0', fontSize: 18 }}>{split.name}</h2><div style={{ fontSize: 11, color: 'hsl(var(--muted-foreground))', marginTop: 4 }}>{g.key === 'past' && split.endedAt ? `Ended ${fmtDate(String(split.endedAt).slice(0, 10), { month: 'short', day: 'numeric', year: 'numeric' })}` : `Starts ${fmtDate(split.startDate, { month: 'short', day: 'numeric', year: 'numeric' })}`}</div></div><ArrowRight size={18} color="hsl(var(--primary))"/></Link>
          {split.lifecycleStatus === 'ended_early' && <p style={{ fontSize: 12 }} data-testid={`text-ended-early-${split.id}`}>Ended Early — {split.completedWeeks ?? 0} of {split.cycleLengthWeeks} planned weeks completed</p>}
          <div style={{ display: 'flex', gap: 7, marginTop: 12, flexWrap: 'wrap' }}>
            <Link href={`/calendar?split=${split.id}`} className="btn btn-secondary btn-sm" style={{ textDecoration: 'none' }} data-testid={`link-calendar-${split.id}`}><CalendarDays size={14}/> Calendar</Link>
            {g.key === 'planned' && btn(split, 'activate', 'Activate', true)}
            <button className="btn btn-danger btn-sm" disabled={del.isPending} onClick={() => setDelFor(split)} data-testid={`button-delete-${split.id}`}>Delete</button>
            {g.key === 'current' && btn(split, 'pause', 'Pause')}
            {g.key === 'current' && btn(split, 'end_early', 'End early')}
            {g.key === 'paused' && btn(split, 'resume', 'Resume', true)}
            {g.key === 'paused' && btn(split, 'end_early', 'End early')}
            {g.key === 'past' && btn(split, 'restart', 'Restart', true)}
            {(g.key === 'current' || g.key === 'planned') && <>
              <button className="btn btn-ghost btn-sm" onClick={() => setWeekFor({ split, rir: '1' })} data-testid={`button-add-week-${split.id}`}><Plus size={13}/> Week</button>
              <button className="btn btn-ghost btn-sm" disabled={removeWeek.isPending} onClick={() => removeWeek.mutate({ splitId: split.id }, { onSuccess: refresh, onError: () => setErr('Only an unstarted final loading week can be removed.') })} data-testid={`button-remove-week-${split.id}`}><Minus size={13}/> Final loading week</button>
            </>}
          </div>
        </article>)}</div>
      </section>;
    }) : <Empty title="Build your first mesocycle" detail="Start from an original template, copy a finished block, or build your own." action={<Link href="/splits/new" className="btn btn-primary" style={{ textDecoration: 'none' }}><Plus size={16}/> New mesocycle</Link>}/>}
    {delFor && <Modal title="DELETE THIS MESOCYCLE?" close={() => { if (!del.isPending) setDelFor(null); }}>
      <p style={{ marginTop: 0, lineHeight: 1.5, color: 'hsl(var(--muted-foreground))' }}>The mesocycle plan and its future/uncompleted workouts will be removed. Your completed workout and exercise history will be preserved.</p>
      <div style={{ display: 'flex', gap: 9 }}><button className="btn btn-secondary" style={{ flex: 1 }} disabled={del.isPending} onClick={() => setDelFor(null)}>CANCEL</button>
        <button className="btn btn-danger" style={{ flex: 1 }} disabled={del.isPending} data-testid="button-confirm-delete-plan" onClick={() => { setErr(''); del.mutate({ splitId: delFor.id, params: { profileId: pid } }, { onSuccess: async () => { setDelFor(null); await refresh(); }, onError: error => { setDelFor(null); setErr(mutationError(error)); } }); }}>DELETE MESOCYCLE</button></div>
    </Modal>}
    {confirm && <Modal title={confirm.action === 'end_early' ? 'End this mesocycle early?' : 'Restart this mesocycle?'} close={() => setConfirm(null)}>
      {confirm.action === 'end_early' ? <p style={{ lineHeight: 1.5, marginTop: 0, color: 'hsl(var(--muted-foreground))' }}>Every set you performed stays in your history. Unstarted workouts are dropped from the plan.</p>
        : <>
          <p style={{ lineHeight: 1.5, marginTop: 0, color: 'hsl(var(--muted-foreground))' }}>This creates a new instance. The finished one stays in the past group.</p>
          <div className="seg" style={{ gridTemplateColumns: '1fr 1fr' }} role="group" aria-label="Starting loads">
            <button type="button" aria-pressed={!recal} onClick={() => setRecal(false)} data-testid="button-restart-history">USE VALID RECENT EXERCISE HISTORY</button>
            <button type="button" aria-pressed={recal} onClick={() => setRecal(true)} data-testid="button-restart-recalibrate">RECALIBRATE ALL EXERCISES</button>
          </div></>}
      <div style={{ display: 'flex', gap: 9, marginTop: 16 }}>
        <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setConfirm(null)}>Cancel</button>
        <button className={confirm.action === 'end_early' ? 'btn btn-destructive' : 'btn btn-primary'} style={{ flex: 1 }} disabled={transition.isPending} onClick={() => run(confirm.split, confirm.action, confirm.action === 'restart' ? recal : undefined)} data-testid="button-confirm-lifecycle">{confirm.action === 'end_early' ? 'End early' : 'Restart'}</button>
      </div>
    </Modal>}
    {weekFor && <Modal title="Add a loading week" close={() => setWeekFor(null)}>
      <p style={{ marginTop: 0, fontSize: 13, color: 'hsl(var(--muted-foreground))' }}>Adds one loading week. If you chose a recovery week, it stays last. Choose the new week’s target RIR.</p>
      <input className="field" type="number" min={0} max={10} step={1} value={weekFor.rir} onChange={(e) => setWeekFor({ ...weekFor, rir: e.target.value })} aria-label="Target RIR" data-testid="input-new-week-rir"/>
      <button className="btn btn-primary" style={{ width: '100%', marginTop: 14 }} disabled={addWeek.isPending || !Number.isInteger(Number(weekFor.rir)) || Number(weekFor.rir) < 0 || Number(weekFor.rir) > 10} onClick={() => addWeek.mutate({ splitId: weekFor.split.id, data: { profileId: pid, targetRir: Number(weekFor.rir) } }, { onSuccess: () => { setWeekFor(null); refresh(); }, onError: () => setErr('Could not add the week.') })} data-testid="button-confirm-add-week">Add week</button>
    </Modal>}
  </main>;
}
