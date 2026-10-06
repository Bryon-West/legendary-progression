import { useState } from 'react';
import { Activity, ArrowRight } from 'lucide-react';
import { Link } from 'wouter';
import {
  getGetActiveWorkoutQueryKey, getGetOverviewQueryKey, getListSplitsQueryKey,
  useGetActiveWorkout, useGetMesocycleCalendar, getGetMesocycleCalendarQueryKey, useGetOverview, useListSplits,
} from '@workspace/api-client-react';
import { localToday } from '@/lib/dates';
import { weekLabel } from '@/lib/labels';
import { useActiveProfile } from '@/lib/profile';
import { fmtTotal, type WeightUnit } from '@/lib/units';
import { Empty, Loading, QueryError } from '@/components/ui-bits';
import { StartSessionModal } from '@/components/start-session-modal';
import { SessionContext } from '@/components/completed-workout';
import { WorkoutSummaryCard } from '@/components/workout-summary-card';

export default function HomePage() {
  const { profile, profilesQuery, unit } = useActiveProfile();
  const pid = profile?.id ?? 0;
  const overview = useGetOverview({ profileId: pid }, { query: { enabled: !!profile, queryKey: getGetOverviewQueryKey({ profileId: pid }) } });
  const splits = useListSplits({ profileId: pid }, { query: { enabled: !!profile, queryKey: getListSplitsQueryKey({ profileId: pid }) } });
  const activeQuery = useGetActiveWorkout({ profileId: pid }, { query: { enabled: !!profile, queryKey: getGetActiveWorkoutQueryKey({ profileId: pid }) } });
  const calSplit = overview.data?.nextWorkout?.splitId ?? splits.data?.at(-1)?.id ?? 0;
  const cal = useGetMesocycleCalendar({ profileId: pid, splitId: calSplit }, { query: { enabled: !!pid && !!calSplit, queryKey: getGetMesocycleCalendarQueryKey({ profileId: pid, splitId: calSplit }) } });
  const todayStr = localToday();
  const calWeeks = cal.data ?? [];
  const todayWeek = calWeeks.find((w) => w.startDate <= todayStr && todayStr <= w.endDate);
  const pending = calWeeks.flatMap((w) => w.scheduledWorkouts.map((x) => ({ w, x }))).filter(({ x }) => x.status === 'scheduled').sort((a, b) => a.w.weekIndex - b.w.weekIndex || a.x.scheduledDate.localeCompare(b.x.scheduledDate))[0];
  const [startFor, setStartFor] = useState<{ dayId: number | null; plannedId?: number } | null>(null);
  if (profilesQuery.isLoading) return <Loading/>;
  if (profilesQuery.isError) return <main className="page-wrap"><QueryError retry={() => void profilesQuery.refetch()}/></main>;
  if (!profile) return <main className="page-wrap"><div className="eyebrow">Account setup</div><p role="alert">Your training profile is not available yet.</p><button className="btn btn-secondary" onClick={() => void profilesQuery.refetch()}>Try again</button></main>;
  if (overview.isLoading || splits.isLoading) return <Loading/>;
  if (overview.isError) return <main className="page-wrap"><QueryError retry={() => void overview.refetch()}/></main>;
  const data = overview.data;
  const activeWorkout = activeQuery.data?.workout ?? data?.activeWorkout;
  const next = data?.nextWorkout;
  const nextSplit = splits.data?.find((s) => s.id === next?.splitId);
  const nextDay = nextSplit?.days.find((d) => d.id === next?.dayId);
  const weekly = [...(data?.weeklyMuscleSets ?? [])].sort((a, b) => b.workingSetCount - a.workingSetCount);
  const trained = new Set(data?.previouslyTrainedMuscles ?? []);
  const askMuscles = startFor?.dayId != null ? Array.from(new Set((nextDay?.exercises ?? []).map((x) => x.exercise.muscleGroup))).filter((m) => trained.has(m)) : [];
  const maxSets = Math.max(1, ...weekly.map((m) => m.workingSetCount));
  return <main className="page-wrap enter">
    <section style={{ marginBottom: 24 }}>
      <div className="eyebrow">{new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</div>
      <h1 className="display" style={{ fontSize: 48, margin: '9px 0 5px' }}>Earn it.<br/><span style={{ color: 'hsl(var(--primary))' }}>Log it right.</span></h1>
      <div style={{ color: 'hsl(var(--muted-foreground))', fontSize: 14 }}>Good to see you, {profile.name}.</div>
    </section>
    {activeWorkout ? <section className="panel" style={{ padding: 20, background: 'hsl(var(--primary))', color: 'hsl(var(--primary-foreground))', marginBottom: 18, borderColor: 'transparent' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}><div><div className="eyebrow" style={{ color: 'inherit', opacity: .8 }}>Session in progress{activeWorkout.mesocycleWeek != null ? ` · week ${activeWorkout.mesocycleWeek}` : ''}</div><h2 className="display" style={{ fontSize: 32, margin: '8px 0 5px' }}>{activeWorkout.dayName || 'Training session'}</h2><div style={{ opacity: .85, fontSize: 13 }}>{activeWorkout.splitName || 'Open workout'} · started {new Date(activeWorkout.startedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</div></div><Activity size={22}/></div>
      <Link className="btn" href={`/workout/${activeWorkout.id}`} style={{ background: 'hsl(var(--background))', color: 'hsl(var(--foreground))', textDecoration: 'none', marginTop: 16, width: '100%' }} data-testid="link-resume-workout">Resume workout <ArrowRight size={17}/></Link>
    </section> : <section className="panel" style={{ padding: 20, marginBottom: 18 }}>
      <div className="eyebrow">Up next{nextSplit?.currentWeek != null ? ` · mesocycle week ${pending?.w.weekIndex ?? nextSplit.currentWeek}${nextSplit.cycleLengthWeeks ? ` of ${nextSplit.cycleLengthWeeks}` : ''}` : ''}</div>
      {todayWeek?.kind === 'week_off' && <div className="notice-ok" style={{ margin: '10px 0' }}>Week off. Rest is the plan; nothing is missed.</div>}
      {pending && <div className="badge badge-red" style={{ margin: '8px 0 0' }} data-testid="text-week-label">{profile.trainingMode === 'legendary_pro' ? weekLabel(pending.w.kind, pending.w.weekIndex, pending.w.targetRir) : 'UPCOMING'} · {pending.x.scheduledDate === todayStr ? 'today' : pending.x.scheduledDate}</div>}
      {next ? <><h2 className="display" style={{ fontSize: 35, margin: '8px 0 4px' }}>{next.dayName}</h2><div style={{ fontSize: 13, color: 'hsl(var(--muted-foreground))' }}>{next.splitName} · {next.exerciseCount} exercises</div>
        {nextDay?.exercises?.length ? <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginTop: 14 }}>{nextDay.exercises.slice(0, 4).map((x) => <span key={x.id} style={{ borderRadius: 20, padding: '6px 10px', background: 'hsl(var(--secondary))', fontSize: 11 }}>{x.exercise.name}</span>)}</div> : null}
        <button className="btn btn-primary" data-testid="button-start-workout" disabled={!!calSplit && cal.isLoading} style={{ width: '100%', marginTop: 18 }} onClick={() => setStartFor({ dayId: next.dayId, plannedId: pending?.x.id })}>Start workout<ArrowRight size={18}/></button>
      </> : <><h2 className="display" style={{ fontSize: 32, margin: '8px 0' }}>{profile.trainingMode === 'basic' ? 'Ready to train?' : 'No mesocycle yet'}</h2><p style={{ fontSize: 13, color: 'hsl(var(--muted-foreground))' }}>{profile.trainingMode === 'basic' ? 'Start a manual workout and choose your exercises, sets, weight and reps as you go.' : 'Create a mesocycle or start an open session when you’re ready.'}</p><div style={{ display: 'flex', gap: 9, flexWrap: 'wrap' }}>{profile.trainingMode === 'legendary_pro' && <Link href="/splits" className="btn btn-primary" style={{ textDecoration: 'none' }}>Build a mesocycle <ArrowRight size={16}/></Link>}<button className="btn btn-secondary" onClick={() => setStartFor({ dayId: null })}>Start open session</button></div></>}
    </section>}
    <section style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 11, marginBottom: 18 }}>
      <div className="panel" style={{ padding: 16 }}><div className="eyebrow">This week</div><div className="display" style={{ fontSize: 38, marginTop: 8 }}>{data?.workoutsThisWeek ?? 0}<span style={{ fontSize: 17, marginLeft: 5 }}>sessions</span></div></div>
      <div className="panel" style={{ padding: 16 }}><div className="eyebrow">Total weight lifted</div><div className="display metric" style={{ fontSize: 28, marginTop: 10 }} data-testid="text-week-total">{fmtTotal(data?.volumeThisWeek ?? 0, unit as WeightUnit)}</div><div style={{ fontSize: 11, color: 'hsl(var(--muted-foreground))', marginTop: 4 }}>working sets, this week</div></div>
    </section>
    {weekly.length > 0 && <section className="panel" style={{ padding: 16, marginBottom: 25 }}>
      <div className="eyebrow" style={{ marginBottom: 10 }}>Working sets this week by muscle</div>
      {weekly.map((m) => <div key={m.muscleGroup} style={{ display: 'grid', gridTemplateColumns: '92px 1fr 28px', alignItems: 'center', gap: 8, fontSize: 12, marginBottom: 7 }}><span>{m.muscleGroup}</span><span style={{ height: 6, borderRadius: 4, background: 'hsl(var(--secondary))', overflow: 'hidden' }}><span style={{ display: 'block', height: '100%', width: `${(m.workingSetCount / maxSets) * 100}%`, background: 'hsl(var(--primary))' }}/></span><span className="metric" style={{ textAlign: 'right' }}>{m.workingSetCount}</span></div>)}
    </section>}
    {activeWorkout && <SessionContext workout={activeWorkout}/>}
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}><h2 style={{ fontSize: 19, margin: 0 }}>Recent sessions</h2><Link href="/history" style={{ color: 'hsl(var(--accent))', textDecoration: 'none', fontSize: 13, fontWeight: 700 }}>See log</Link></div>
    {data?.recentWorkouts?.length ? <div style={{ display: 'grid', gap: 9 }}>{data.recentWorkouts.slice(0, 4).map((w) => <WorkoutSummaryCard key={w.id} item={w} unit={unit}/>)}</div> : <Empty title="The log starts here" detail="Finish your first session and it’ll appear in your recent training."/>}
     {startFor && <StartSessionModal profileId={profile.id} trainingMode={profile.trainingMode} splitDayId={startFor.dayId} scheduledWorkoutId={startFor.plannedId} muscles={askMuscles} onClose={() => setStartFor(null)}/>}
  </main>;
}
