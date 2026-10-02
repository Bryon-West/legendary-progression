import { createContext, useContext, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import {
  Activity, ArrowLeft, ArrowRight, BarChart3, Check, CheckCircle2, ChevronDown, CircleHelp,
  Clock3, Dumbbell, Edit3, History, Home, Plus, Search, Trash2, UserRound, X,
} from 'lucide-react';
import {
  getGetActiveWorkoutQueryKey, getGetExerciseHistoryQueryKey, getGetOverviewQueryKey,
  getGetSplitQueryKey, getGetWorkoutQueryKey, getListExercisesQueryKey, getListProfilesQueryKey,
  getListSplitsQueryKey, getListWorkoutsQueryKey, useAddExerciseToSplitDay,
  useAddExerciseToWorkout, useCreateExercise, useCreateProfile, useCreateSplit,
  useCreateSplitDay, useCreateWorkoutSet, useFinishWorkout, useGetActiveWorkout,
  useGetExerciseHistory, useGetOverview, useGetSplit, useGetWorkout, useHealthCheck,
  useListExercises, useListProfiles, useListSplits, useListWorkouts,
  useRemoveExerciseFromSplitDay, useStartWorkout, useSubstituteWorkoutExercise,
  useUpdateProfile, useUpdateSplit, useUpdateSplitDay, useUpdateSplitDayExercise,
  useUpdateWorkoutSet,
} from '@workspace/api-client-react';
import type { Exercise, Profile, SplitDayExercise, WorkoutExercise, WorkoutSession, WorkoutSet } from '@workspace/api-client-react';
import { Link, Route, Switch, useLocation, useParams } from 'wouter';

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false, retry: 1, staleTime: 12_000 } },
});

const ProfileSelection = createContext<{ profileId: number | null; setProfileId: (id: number | null) => void } | null>(null);

function ProfileProvider({ children }: { children: ReactNode }) {
  const [profileId, setProfileId] = useState<number | null>(() => {
    const saved = Number(window.localStorage.getItem('training-profile'));
    return Number.isFinite(saved) && saved > 0 ? saved : null;
  });
  return <ProfileSelection.Provider value={{ profileId, setProfileId }}>{children}</ProfileSelection.Provider>;
}
function useActiveProfile() {
  const selection = useContext(ProfileSelection);
  const profileId = selection?.profileId ?? null;
  const setProfileId = selection?.setProfileId ?? (() => undefined);
  const profiles = useListProfiles();
  const selected = profiles.data?.find((p) => p.id === profileId) ?? profiles.data?.[0] ?? null;
  useEffect(() => {
    if (selected && selected.id !== profileId) setProfileId(selected.id);
    if (selected) window.localStorage.setItem('training-profile', String(selected.id));
  }, [profileId, selected]);
  return { profile: selected, profiles: profiles.data ?? [], profilesQuery: profiles, setProfileId };
}

function Shell({ children }: { children: ReactNode }) {
  const { profile, profiles, profilesQuery, setProfileId } = useActiveProfile();
  const [location] = useLocation();
  useHealthCheck();
  const nav = [
    { href: '/', label: 'Today', icon: Home },
    { href: '/history', label: 'Log', icon: History },
    { href: '/exercises', label: 'Moves', icon: Dumbbell },
    { href: '/splits', label: 'Plan', icon: BarChart3 },
    { href: '/profiles', label: 'You', icon: UserRound },
  ];
  return <div className="app-shell">
    <header className="topbar">
      <div style={{ maxWidth: 720, margin: 'auto', padding: '12px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Link href="/" className="brand" style={{ textDecoration: 'none', color: 'inherit', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          <div style={{ width: 36, height: 36, background: 'hsl(var(--primary))', color: 'hsl(var(--primary-foreground))', borderRadius: 12, display: 'grid', placeItems: 'center' }}><Activity size={19}/></div>
          <div><div className="display" style={{ fontSize: 20, fontWeight: 800, letterSpacing: '.015em', whiteSpace: 'nowrap' }}>FORM / LOG</div><div className="eyebrow" style={{ fontSize: 8, whiteSpace: 'nowrap' }}>Training record</div></div>
        </Link>
        <label aria-label="Choose training profile" style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
          <select data-testid="select-active-profile" className="field" style={{ width: 'clamp(122px, 38vw, 152px)', flexShrink: 0, minHeight: 40, padding: '0 30px 0 12px', borderRadius: 12, appearance: 'none', fontSize: 13, fontWeight: 700 }}
            value={profile?.id ?? ''} onChange={(e) => { const id = Number(e.target.value); setProfileId(id); window.localStorage.setItem('training-profile', String(id)); }}>
            {profiles.length ? profiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>) : <option value="">No profile</option>}
          </select><ChevronDown size={14} style={{ position: 'absolute', right: 10, pointerEvents: 'none' }}/>
        </label>
      </div>
    </header>
    <nav className="bottom-nav" aria-label="Main navigation">
      {nav.map(({ href, label, icon: Icon }) => <Link key={href} href={href} data-testid={`link-nav-${label.toLowerCase()}`} className={`nav-item ${location === href || (href !== '/' && location.startsWith(href)) ? 'active' : ''}`}><Icon size={18}/><span>{label}</span></Link>)}
    </nav>
    {children}
  </div>;
}

function Loading({ label = 'Loading your training log' }: { label?: string }) {
  return <div className="page-wrap" aria-label={label}><div className="skeleton" style={{ height: 12, width: 110, marginBottom: 18 }}/><div className="skeleton" style={{ height: 48, width: '74%', marginBottom: 24 }}/><div className="skeleton" style={{ height: 150, marginBottom: 14 }}/><div className="skeleton" style={{ height: 104 }}/></div>;
}
function QueryError({ retry }: { retry: () => void }) {
  return <div className="panel" style={{ padding: 22, textAlign: 'center' }}><CircleHelp size={24} color="hsl(var(--accent))"/><h3 style={{ margin: '10px 0 4px' }}>Couldn’t load this view</h3><p style={{ color: 'hsl(var(--muted-foreground))', margin: '0 0 14px', fontSize: 14 }}>Your saved training data has not been changed.</p><button className="btn btn-secondary" onClick={retry}>Try again</button></div>;
}
function Empty({ title, detail, action }: { title: string; detail: string; action?: React.ReactNode }) {
  return <div className="panel" style={{ padding: 26, textAlign: 'center' }}><div style={{ width: 48, height: 48, margin: '0 auto 14px', borderRadius: 16, display: 'grid', placeItems: 'center', background: 'hsl(var(--secondary))', color: 'hsl(var(--primary))' }}><Dumbbell size={21}/></div><strong>{title}</strong><p style={{ margin: '7px auto 16px', color: 'hsl(var(--muted-foreground))', maxWidth: 300, fontSize: 14 }}>{detail}</p>{action}</div>;
}
function Modal({ title, close, children }: { title: string; close: () => void; children: React.ReactNode }) {
  return <div className="modal-backdrop" role="presentation" onClick={close}><section className="modal enter" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}><h2 style={{ margin: 0, fontSize: 21 }}>{title}</h2><button className="btn btn-ghost" aria-label="Close dialog" onClick={close} style={{ minHeight: 40, padding: 8 }}><X size={20}/></button></div>{children}
  </section></div>;
}
function FieldLabel({ label, children }: { label: string; children: React.ReactNode }) { return <label style={{ display: 'grid', gap: 7, fontSize: 12, fontWeight: 700, color: 'hsl(var(--muted-foreground))' }}>{label}{children}</label>; }
function ErrorNote({ message }: { message: string }) { return <div role="alert" style={{ color: 'hsl(var(--destructive))', fontSize: 13, marginTop: 9 }}>{message}</div>; }

function HomePage() {
  const { profile, profilesQuery } = useActiveProfile();
  const overview = useGetOverview({ profileId: profile?.id ?? 0 }, { query: { enabled: !!profile, queryKey: getGetOverviewQueryKey({ profileId: profile?.id ?? 0 }) } });
  const splits = useListSplits({ profileId: profile?.id ?? 0 }, { query: { enabled: !!profile, queryKey: getListSplitsQueryKey({ profileId: profile?.id ?? 0 }) } });
  const activeQuery = useGetActiveWorkout({ profileId: profile?.id ?? 0 }, { query: { enabled: !!profile, queryKey: getGetActiveWorkoutQueryKey({ profileId: profile?.id ?? 0 }) } });
  const start = useStartWorkout();
  const qc = useQueryClient();
  const [, navigate] = useLocation();
  const [profileName, setProfileName] = useState('');
  const createProfile = useCreateProfile();
  if (profilesQuery.isLoading) return <Loading/>;
  if (profilesQuery.isError) return <main className="page-wrap"><QueryError retry={() => void profilesQuery.refetch()}/></main>;
  if (!profile) return <main className="page-wrap enter">
    <div className="eyebrow">Start your record</div><h1 className="display" style={{ fontSize: 52, margin: '12px 0 8px' }}>A place for<br/>the work.</h1>
    <p style={{ color: 'hsl(var(--muted-foreground))', lineHeight: 1.6, maxWidth: 390 }}>Keep your training history close. Create a profile to begin tracking sessions, progression and the details between sets.</p>
    <form className="panel" style={{ padding: 18, marginTop: 22, display: 'grid', gap: 12 }} onSubmit={(e) => { e.preventDefault(); if (profileName.trim()) createProfile.mutate({ data: { name: profileName.trim() } }, { onSuccess: (p) => { window.localStorage.setItem('training-profile', String(p.id)); void qc.invalidateQueries({ queryKey: getListProfilesQueryKey() }); } }); }}>
      <FieldLabel label="YOUR NAME"><input className="field" required maxLength={80} value={profileName} onChange={(e) => setProfileName(e.target.value)} placeholder="e.g. Alex"/></FieldLabel>
      <button className="btn btn-primary" disabled={createProfile.isPending}>{createProfile.isPending ? 'Creating…' : 'Create training profile'}<ArrowRight size={17}/></button>
      {createProfile.isError && <ErrorNote message="Could not create your profile. Please try again."/>}
    </form>
  </main>;
  if (overview.isLoading || splits.isLoading) return <Loading/>;
  if (overview.isError) return <main className="page-wrap"><QueryError retry={() => void overview.refetch()}/></main>;
  const data = overview.data;
  const activeWorkout = activeQuery.data?.workout ?? data?.activeWorkout;
  const next = data?.nextWorkout;
  const nextSplit = splits.data?.find((s) => s.id === next?.splitId);
  const nextDay = nextSplit?.days.find((d) => d.id === next?.dayId);
  return <main className="page-wrap enter">
    <section style={{ marginBottom: 24 }}>
      <div className="eyebrow">{new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</div>
      <h1 className="display" style={{ fontSize: 48, margin: '9px 0 5px' }}>Show up.<br/><span style={{ color: 'hsl(var(--primary))' }}>Get stronger.</span></h1>
      <div style={{ color: 'hsl(var(--muted-foreground))', fontSize: 14 }}>Good to see you, {profile.name}.</div>
    </section>
    {activeWorkout ? <section className="panel" style={{ padding: 20, background: 'hsl(var(--primary))', color: 'hsl(var(--primary-foreground))', marginBottom: 18 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}><div><div className="eyebrow" style={{ color: 'inherit', opacity: .72 }}>Session in progress</div><h2 className="display" style={{ fontSize: 32, margin: '8px 0 5px' }}>{activeWorkout.dayName || 'Training session'}</h2><div style={{ opacity: .8, fontSize: 13 }}>{activeWorkout.splitName || 'Open workout'} · started {new Date(activeWorkout.startedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</div></div><Activity size={22}/></div>
      <Link className="btn" href={`/workout/${activeWorkout.id}`} style={{ background: 'hsl(var(--card))', color: 'hsl(var(--foreground))', textDecoration: 'none', marginTop: 16, width: '100%' }} data-testid="link-resume-workout">Resume workout <ArrowRight size={17}/></Link>
    </section> : <section className="panel" style={{ padding: 20, marginBottom: 18, overflow: 'hidden', position: 'relative' }}>
      <div style={{ position: 'absolute', width: 150, height: 150, borderRadius: 90, background: 'hsl(var(--accent) / .10)', right: -32, top: -40 }}/>
      <div className="eyebrow">Up next</div>
      {next ? <><h2 className="display" style={{ fontSize: 35, margin: '8px 0 4px' }}>{next.dayName}</h2><div style={{ fontSize: 13, color: 'hsl(var(--muted-foreground))' }}>{next.splitName} · {next.exerciseCount} exercises</div>
        {nextDay?.exercises?.length ? <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginTop: 14 }}>{nextDay.exercises.slice(0, 4).map((x) => <span key={x.id} style={{ borderRadius: 20, padding: '6px 10px', background: 'hsl(var(--secondary))', fontSize: 11 }}>{x.exercise.name}</span>)}</div> : null}
        <button className="btn btn-primary" style={{ width: '100%', marginTop: 18 }} disabled={start.isPending} onClick={() => start.mutate({ data: { profileId: profile.id, splitDayId: next.dayId } }, { onSuccess: (w) => { void qc.invalidateQueries({ queryKey: getGetActiveWorkoutQueryKey({ profileId: profile.id }) }); void qc.invalidateQueries({ queryKey: getGetOverviewQueryKey({ profileId: profile.id }) }); navigate(`/workout/${w.id}`); } })}>{start.isPending ? 'Starting…' : 'Start workout'}<ArrowRight size={18}/></button>
      </> : <><h2 className="display" style={{ fontSize: 32, margin: '8px 0' }}>No plan yet</h2><p style={{ fontSize: 13, color: 'hsl(var(--muted-foreground))' }}>Create a split or start an open session when you’re ready.</p><div style={{ display: 'flex', gap: 9, flexWrap: 'wrap' }}><Link href="/splits" className="btn btn-primary" style={{ textDecoration: 'none' }}>Build a split <ArrowRight size={16}/></Link><button className="btn btn-secondary" onClick={() => start.mutate({ data: { profileId: profile.id, splitDayId: null } }, { onSuccess: (w) => { void qc.invalidateQueries({ queryKey: getGetActiveWorkoutQueryKey({ profileId: profile.id }) }); navigate(`/workout/${w.id}`); } })}>Start open session</button></div></>}
      {start.isError && <ErrorNote message="Could not start this session. Try again."/>}
    </section>}
    <section style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 11, marginBottom: 25 }}>
      <div className="panel" style={{ padding: 16 }}><div className="eyebrow">This week</div><div className="display" style={{ fontSize: 38, marginTop: 8 }}>{data?.workoutsThisWeek ?? 0}<span style={{ fontSize: 17, marginLeft: 5 }}>sessions</span></div><div style={{ fontSize: 11, color: 'hsl(var(--muted-foreground))', marginTop: 4 }}>Keep the rhythm</div></div>
      <div className="panel" style={{ padding: 16 }}><div className="eyebrow">Volume</div><div className="display metric" style={{ fontSize: 35, marginTop: 8 }}>{formatVolume(data?.volumeThisWeek ?? 0)}</div><div style={{ fontSize: 11, color: 'hsl(var(--muted-foreground))', marginTop: 4 }}>kg moved this week</div></div>
    </section>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}><h2 style={{ fontSize: 19, margin: 0 }}>Recent sessions</h2><Link href="/history" style={{ color: 'hsl(var(--primary))', textDecoration: 'none', fontSize: 13, fontWeight: 700 }}>See log</Link></div>
    {data?.recentWorkouts?.length ? <div style={{ display: 'grid', gap: 9 }}>{data.recentWorkouts.slice(0, 4).map((w) => <WorkoutSummaryCard key={w.id} item={w}/>)}</div> : <Empty title="The log starts here" detail="Finish your first session and it’ll appear in your recent training."/>}
  </main>;
}

function formatVolume(volume: number) { return volume >= 1000 ? `${(volume / 1000).toFixed(1)}k` : Math.round(volume).toLocaleString(); }
function WorkoutSummaryCard({ item }: { item: { id: number; splitName: string | null; dayName: string | null; startedAt: string; totalVolume: number; workingSetCount?: number; exerciseCount?: number } }) {
  return <Link href={`/history/${item.id}`} data-testid={`link-session-${item.id}`} style={{ textDecoration: 'none', color: 'inherit' }}><article className="panel" style={{ padding: 15, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
    <div><div style={{ fontWeight: 700 }}>{item.dayName || item.splitName || 'Training session'}</div><div style={{ color: 'hsl(var(--muted-foreground))', fontSize: 12, marginTop: 4 }}>{new Date(item.startedAt).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })} · {item.workingSetCount ?? item.exerciseCount ?? 0} sets</div></div>
    <div style={{ textAlign: 'right' }}><div className="metric" style={{ fontWeight: 700 }}>{formatVolume(item.totalVolume)} kg</div><div style={{ color: 'hsl(var(--muted-foreground))', fontSize: 11, marginTop: 4 }}>volume</div></div>
  </article></Link>;
}

function WorkoutPage() {
  const params = useParams<{ sessionId: string }>();
  const id = Number(params.sessionId);
  const workoutQuery = useGetWorkout(id, { query: { enabled: Number.isFinite(id), queryKey: getGetWorkoutQueryKey(id) } });
  const { profile } = useActiveProfile();
  const qc = useQueryClient();
  const [summary, setSummary] = useState<{ duration: number; sets: number; volume: number; nextDay: string | null } | null>(null);
  const [modal, setModal] = useState<'substitute' | 'add' | 'finish' | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [successMessage, setSuccessMessage] = useState('');
  const [substituteExerciseId, setSubstituteExerciseId] = useState<number | null>(null);
  const workout = workoutQuery.data;
  const addExercise = useAddExerciseToWorkout();
  const substitute = useSubstituteWorkoutExercise();
  const createSet = useCreateWorkoutSet();
  const updateSet = useUpdateWorkoutSet();
  const finish = useFinishWorkout();
  const changesSaving = addExercise.isPending || substitute.isPending || createSet.isPending || updateSet.isPending;
  const exercisesQuery = useListExercises({ profileId: profile?.id ?? 0 }, { query: { enabled: !!profile && !!modal, queryKey: getListExercisesQueryKey({ profileId: profile?.id ?? 0 }) } });
  const [, navigate] = useLocation();
  useEffect(() => { if (!workout?.startedAt || workout.status !== 'active') return; const tick = () => setElapsed(Math.max(0, Math.floor((Date.now() - new Date(workout.startedAt).getTime()) / 1000))); tick(); const timer = window.setInterval(tick, 1000); return () => window.clearInterval(timer); }, [workout?.startedAt, workout?.status]);
  if (summary) return <main className="page-wrap enter">
    <div className="eyebrow">Session complete</div><h1 className="display" style={{ fontSize: 52, margin: '10px 0 20px' }}>Work<br/>well done.</h1>
    <div className="panel" style={{ padding: 20, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
      <SummaryMetric label="Time" value={formatTime(summary.duration)}/><SummaryMetric label="Working sets" value={String(summary.sets)}/><SummaryMetric label="Volume" value={`${formatVolume(summary.volume)} kg`}/><SummaryMetric label="Next day" value={summary.nextDay || 'Rest & recover'}/>
    </div><Link href="/" className="btn btn-primary" style={{ width: '100%', textDecoration: 'none', marginTop: 18 }}>Back to today <ArrowRight size={17}/></Link>
  </main>;
  if (workoutQuery.isLoading) return <Loading label="Loading active session"/>;
  if (workoutQuery.isError || !workout) return <main className="page-wrap"><QueryError retry={() => void workoutQuery.refetch()}/></main>;
  if (workout.status === 'completed') return <CompletedWorkout workout={workout}/>;
  const invalidate = () => { void qc.invalidateQueries({ queryKey: getGetWorkoutQueryKey(id) }); if (profile) void qc.invalidateQueries({ queryKey: getGetActiveWorkoutQueryKey({ profileId: profile.id }) }); };
  const finishSession = () => finish.mutate({ sessionId: id }, { onSuccess: (result) => { invalidate(); setSummary({ duration: Math.max(0, Math.floor((Date.now() - new Date(workout.startedAt).getTime()) / 1000)), sets: result.workout.exercises.reduce((n, e) => n + e.sets.filter((s) => s.completed && s.setType === 'work').length, 0), volume: result.workout.totalVolume, nextDay: result.nextWorkout?.dayName ?? null }); void qc.invalidateQueries({ queryKey: getListWorkoutsQueryKey({ profileId: profile?.id ?? 0 }) }); void qc.invalidateQueries({ queryKey: getGetOverviewQueryKey({ profileId: profile?.id ?? 0 }) }); } });
  return <main className="page-wrap enter">
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
      <button className="btn btn-ghost" style={{ padding: 0, minHeight: 38 }} onClick={() => navigate('/')}><ArrowLeft size={19}/> Today</button>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', font: '700 12px var(--app-font-mono)', color: 'hsl(var(--primary))' }}><Clock3 size={15}/>{formatTime(elapsed)}</div>
      <button className="btn btn-secondary" style={{ minHeight: 40, padding: '0 12px', fontSize: 12 }} disabled={finish.isPending || changesSaving} onClick={() => setModal('finish')}>Finish</button>
    </div>
    <div className="eyebrow">{workout.splitName || 'Open session'}</div><h1 className="display" style={{ fontSize: 43, margin: '6px 0 20px' }}>{workout.dayName || 'Training session'}</h1>
    {successMessage && <div style={{ marginBottom: 12, padding: '10px 13px', borderRadius: 12, background: 'hsl(var(--primary) / .1)', color: 'hsl(var(--primary))', fontSize: 13, fontWeight: 700 }}>{successMessage}</div>}
    {!workout.exercises.length ? <Empty title="Your session is ready" detail="Add an exercise from your library to start logging sets." action={<button className="btn btn-primary" onClick={() => setModal('add')}><Plus size={17}/> Add exercise</button>}/> : null}
    <div style={{ display: 'grid', gap: 13 }}>
      {workout.exercises.map((exercise) => <WorkoutExerciseCard key={exercise.id} exercise={exercise} profileId={workout.profileId} sessionId={id}
        onChanged={invalidate} onSubstitute={() => { setSubstituteExerciseId(exercise.id); setModal('substitute'); }} updateSet={updateSet} createSet={createSet} setMessage={setSuccessMessage}/>)}
    </div>
    <button className="btn btn-secondary" style={{ width: '100%', marginTop: 14 }} onClick={() => setModal('add')}><Plus size={18}/> Add exercise</button>
    <button className="btn btn-primary" style={{ width: '100%', marginTop: 10, minHeight: 56 }} disabled={finish.isPending || changesSaving} onClick={() => setModal('finish')}><CheckCircle2 size={19}/> Finish workout</button>
    {(finish.isError || addExercise.isError || substitute.isError || createSet.isError || updateSet.isError) && <ErrorNote message="That change did not save. Check your connection and try again."/>}
    {modal === 'finish' && <Modal title="Finish this workout?" close={() => setModal(null)}>
      <p style={{ color: 'hsl(var(--muted-foreground))', lineHeight: 1.5 }}>Your completed sets and training volume will be saved to your history.</p>
      <div style={{ display: 'flex', gap: 9, marginTop: 20 }}><button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setModal(null)}>Keep training</button><button className="btn btn-primary" style={{ flex: 1 }} disabled={finish.isPending || changesSaving} onClick={finishSession}>{finish.isPending ? 'Saving…' : changesSaving ? 'Saving sets…' : 'Finish workout'}</button></div>
      {finish.isError && <ErrorNote message="Could not finish this workout. Your session is still saved as active."/>}
    </Modal>}
    {modal === 'add' && <ExercisePicker title="Add exercise" exercises={exercisesQuery.data ?? []} loading={exercisesQuery.isLoading} onClose={() => setModal(null)} onSelect={(exercise) => {
      const order = workout.exercises.length;
      addExercise.mutate({ sessionId: id, data: { exerciseId: exercise.id, targetRir: 2, targetSets: 3, targetRepsMin: 8, targetRepsMax: 12, orderIndex: order } }, { onSuccess: () => { invalidate(); setModal(null); } });
    }} onCreate={(exercise) => { void qc.invalidateQueries({ queryKey: getListExercisesQueryKey({ profileId: profile?.id ?? 0 }) }); addExercise.mutate({ sessionId: id, data: { exerciseId: exercise.id, targetRir: 2, targetSets: 3, targetRepsMin: 8, targetRepsMax: 12, orderIndex: workout.exercises.length } }, { onSuccess: () => { invalidate(); setModal(null); } }); }} profileId={profile?.id ?? 0}/>}
    {modal === 'substitute' && <ExercisePicker title="Replace exercise" exercises={exercisesQuery.data ?? []} loading={exercisesQuery.isLoading} onClose={() => setModal(null)} profileId={profile?.id ?? 0} onSelect={(exercise) => {
      const target = workout.exercises.find((x) => x.id === substituteExerciseId) ?? workout.exercises[0];
      if (target) substitute.mutate({ sessionId: id, workoutExerciseId: target.id, data: { exerciseId: exercise.id } }, { onSuccess: () => { invalidate(); setModal(null); } });
    }} onCreate={(exercise) => { const target = workout.exercises.find((x) => x.id === substituteExerciseId) ?? workout.exercises[0]; if (target) substitute.mutate({ sessionId: id, workoutExerciseId: target.id, data: { exerciseId: exercise.id } }, { onSuccess: () => { invalidate(); setModal(null); } }); }}/>}
  </main>;
}

function SummaryMetric({ label, value }: { label: string; value: string }) { return <div><div className="eyebrow">{label}</div><div style={{ fontWeight: 700, fontSize: 17, marginTop: 7 }}>{value}</div></div>; }
function formatTime(seconds: number) { const h = Math.floor(seconds / 3600); const m = Math.floor((seconds % 3600) / 60); const s = seconds % 60; return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`; }

function WorkoutExerciseCard({ exercise, profileId, sessionId, onChanged, onSubstitute, updateSet, createSet, setMessage }: {
  exercise: WorkoutExercise; profileId: number; sessionId: number; onChanged: () => void; onSubstitute: () => void;
  updateSet: ReturnType<typeof useUpdateWorkoutSet>; createSet: ReturnType<typeof useCreateWorkoutSet>; setMessage: (message: string) => void;
}) {
  const history = useGetExerciseHistory(profileId, exercise.exerciseId, { query: { queryKey: getGetExerciseHistoryQueryKey(profileId, exercise.exerciseId), enabled: !!profileId } });
  const sets = [...exercise.sets].sort((a, b) => a.setNumber - b.setNumber);
  const prior = history.data?.filter((h) => h.setType === 'work').slice(0, 4) ?? [];
  const createRow = (setType: 'warmup' | 'work') => {
    const sameType = sets.filter((s) => s.setType === setType);
    const setNumber = sameType.length ? Math.max(...sameType.map((s) => s.setNumber)) + 1 : 1;
    createSet.mutate({ sessionId, data: { workoutExerciseId: exercise.id, setNumber, setType, targetWeight: exercise.targetWeight ?? null, targetRepsMin: exercise.targetRepsMin, targetRepsMax: exercise.targetRepsMax } }, { onSuccess: () => { onChanged(); setMessage(setType === 'warmup' ? 'Warm-up set added' : 'Working set added'); window.setTimeout(() => setMessage(''), 1800); } });
    void sameType;
  };
  const commit = (set: WorkoutSet, field: 'actualWeight' | 'actualReps' | 'actualRir', value: string) => {
    const parsed = value.trim() === '' ? null : Number(value);
    if (parsed !== null && !Number.isFinite(parsed)) return;
    const completed = field === 'actualRir' ? parsed !== null && (set.actualWeight ?? null) !== null && (set.actualReps ?? null) !== null : parsed !== null && (field === 'actualWeight' ? set.actualReps : set.actualWeight) !== null;
    updateSet.mutate({ sessionId, setId: set.id, data: { [field]: parsed, ...(completed ? { completed: true } : {}) } }, { onSuccess: onChanged });
  };
  return <article className="panel" style={{ padding: 15 }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', gap: 10, marginBottom: 14 }}>
      <div><div className="eyebrow">{exercise.muscleGroup}</div><h2 style={{ fontSize: 19, margin: '4px 0 5px', lineHeight: 1.2 }}>{exercise.exerciseName}</h2><div style={{ fontSize: 12, color: 'hsl(var(--muted-foreground))' }}>Target RIR <b style={{ color: 'hsl(var(--foreground))' }}>{exercise.targetRir}</b></div></div>
      <button className="btn btn-ghost" aria-label={`Substitute ${exercise.exerciseName}`} onClick={onSubstitute} style={{ minHeight: 38, padding: '0 7px', fontSize: 11 }}><Edit3 size={15}/> Swap</button>
    </div>
    {prior.length > 0 && <div style={{ padding: '8px 10px', marginBottom: 12, background: 'hsl(var(--secondary) / .65)', borderRadius: 11, fontSize: 11, color: 'hsl(var(--muted-foreground))' }}><span style={{ fontWeight: 700, color: 'hsl(var(--foreground))' }}>Last time</span> · {prior.map((p) => `${p.actualWeight ?? p.targetWeight ?? '—'} × ${p.actualReps ?? p.targetRepsMin ?? '—'}`).join('  /  ')}</div>}
    <div className="set-grid" style={{ marginBottom: 6 }}><span className="set-head">Set #</span><span className="set-head">Target</span><span className="set-head">Weight</span><span className="set-head">Reps</span><span className="set-head">Actual RIR</span></div>
    {sets.length ? sets.map((set) => <div className="set-grid" key={set.id} style={{ marginBottom: 7 }}>
      <div className="set-num" title={set.setType === 'warmup' ? 'Warm-up set' : 'Working set'} style={set.setType === 'warmup' ? { background: 'hsl(var(--accent) / .13)', color: 'hsl(var(--accent))' } : {}}>{set.setNumber}</div>
      <div style={{ textAlign: 'center', fontSize: 10, lineHeight: 1.2, color: 'hsl(var(--muted-foreground))' }}>{set.setType === 'warmup' ? 'Warm-up' : `${set.targetRepsMin ?? exercise.targetRepsMin}–${set.targetRepsMax ?? exercise.targetRepsMax}`}<br/><span className="metric">{set.targetWeight ?? exercise.targetWeight ?? '—'} kg</span></div>
      <input aria-label={`Set ${set.setNumber} weight`} data-testid={`input-set-weight-${set.id}`} type="number" inputMode="decimal" className="set-input" placeholder="kg" defaultValue={set.actualWeight ?? ''} onBlur={(e) => commit(set, 'actualWeight', e.currentTarget.value)}/>
      <input aria-label={`Set ${set.setNumber} reps`} data-testid={`input-set-reps-${set.id}`} type="number" inputMode="numeric" className="set-input" placeholder="reps" defaultValue={set.actualReps ?? ''} onBlur={(e) => commit(set, 'actualReps', e.currentTarget.value)}/>
      <input aria-label={`Set ${set.setNumber} actual RIR`} data-testid={`input-set-rir-${set.id}`} type="number" inputMode="numeric" className="set-input" placeholder="—" defaultValue={set.actualRir ?? ''} onBlur={(e) => commit(set, 'actualRir', e.currentTarget.value)}/>
    </div>) : <div style={{ color: 'hsl(var(--muted-foreground))', fontSize: 12, padding: '6px 0 12px' }}>No sets logged yet. Add your first set below.</div>}
    {updateSet.isError && <ErrorNote message="Set values were not saved. Tap a field and try again."/>}
    <div style={{ display: 'flex', gap: 8, marginTop: 12 }}><button className="btn btn-secondary" style={{ flex: 1, minHeight: 42, fontSize: 12 }} onClick={() => createRow('warmup')} disabled={createSet.isPending}><Plus size={15}/> Warm-up</button><button className="btn btn-primary" style={{ flex: 1, minHeight: 42, fontSize: 12 }} onClick={() => createRow('work')} disabled={createSet.isPending}><Plus size={15}/> Working set</button></div>
  </article>;
}

function CompletedWorkout({ workout }: { workout: WorkoutSession }) {
  return <main className="page-wrap"><Link href="/history" className="btn btn-ghost" style={{ textDecoration: 'none', padding: 0 }}><ArrowLeft size={17}/> Training log</Link><div className="eyebrow" style={{ marginTop: 20 }}>Completed session</div><h1 className="display" style={{ fontSize: 44, margin: '8px 0 18px' }}>{workout.dayName || 'Workout'}</h1><div className="panel" style={{ padding: 17, marginBottom: 14 }}><SummaryMetric label="Volume" value={`${formatVolume(workout.totalVolume)} kg`}/></div>{workout.exercises.map((exercise) => <section className="panel" key={exercise.id} style={{ padding: 16, marginBottom: 10 }}><div className="eyebrow">{exercise.muscleGroup}</div><h3 style={{ margin: '5px 0 10px' }}>{exercise.exerciseName}</h3>{exercise.sets.map((set) => <div key={set.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderTop: '1px solid hsl(var(--border))', fontSize: 13 }}><span>Set {set.setNumber} · {set.setType}</span><span className="metric">{set.actualWeight ?? '—'} kg × {set.actualReps ?? '—'} · RIR {set.actualRir ?? '—'}</span></div>)}</section>)}</main>;
}

function ExercisePicker({ title, exercises, loading, onClose, onSelect, onCreate, profileId }: { title: string; exercises: Exercise[]; loading: boolean; onClose: () => void; onSelect: (e: Exercise) => void; onCreate: (e: Exercise) => void; profileId: number }) {
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState(''); const [muscle, setMuscle] = useState('Chest'); const [equipment, setEquipment] = useState('Dumbbell');
  const createExercise = useCreateExercise();
  const filtered = exercises.filter((e) => `${e.name} ${e.muscleGroup}`.toLowerCase().includes(search.toLowerCase()));
  const submit = (e: FormEvent) => { e.preventDefault(); createExercise.mutate({ data: { profileId, name: name.trim(), muscleGroup: muscle.trim(), equipment: equipment.trim(), isCompound: true } }, { onSuccess: (exercise) => onCreate(exercise) }); };
  return <Modal title={title} close={onClose}>{creating ? <form onSubmit={submit} style={{ display: 'grid', gap: 13 }}>
    <FieldLabel label="EXERCISE NAME"><input className="field" required value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Incline cable press"/></FieldLabel>
    <FieldLabel label="MUSCLE GROUP"><input className="field" required value={muscle} onChange={(e) => setMuscle(e.target.value)}/></FieldLabel>
    <FieldLabel label="EQUIPMENT"><input className="field" required value={equipment} onChange={(e) => setEquipment(e.target.value)}/></FieldLabel>
    <button className="btn btn-primary" disabled={createExercise.isPending}>{createExercise.isPending ? 'Saving…' : 'Create and use exercise'}</button>{createExercise.isError && <ErrorNote message="Could not create this exercise."/>}
  </form> : <>
    <div style={{ position: 'relative', marginBottom: 12 }}><Search size={17} style={{ position: 'absolute', left: 13, top: 15, color: 'hsl(var(--muted-foreground))' }}/><input className="field" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search exercise library" style={{ paddingLeft: 40 }}/></div>
    <div style={{ maxHeight: '48dvh', overflowY: 'auto', display: 'grid', gap: 6 }}>
      {loading ? <div className="skeleton" style={{ height: 70 }}/> : filtered.map((exercise) => <button key={exercise.id} data-testid={`button-exercise-${exercise.id}`} onClick={() => onSelect(exercise)} style={{ border: '1px solid hsl(var(--border))', background: 'transparent', color: 'inherit', borderRadius: 13, padding: 13, display: 'flex', justifyContent: 'space-between', textAlign: 'left', alignItems: 'center' }}><span><b>{exercise.name}</b><small style={{ display: 'block', color: 'hsl(var(--muted-foreground))', marginTop: 3 }}>{exercise.muscleGroup} · {exercise.equipment}</small></span><ArrowRight size={16}/></button>)}
      {!loading && !filtered.length && <div style={{ padding: 18, color: 'hsl(var(--muted-foreground))', textAlign: 'center' }}>No matching exercises. Add it to your library.</div>}
    </div>
    <button className="btn btn-secondary" style={{ width: '100%', marginTop: 14 }} onClick={() => setCreating(true)}><Plus size={17}/> Create custom exercise</button>
  </>}</Modal>;
}

function HistoryPage() {
  const { profile } = useActiveProfile();
  const list = useListWorkouts({ profileId: profile?.id ?? 0 }, { query: { enabled: !!profile, queryKey: getListWorkoutsQueryKey({ profileId: profile?.id ?? 0 }) } });
  if (list.isLoading) return <Loading/>;
  return <main className="page-wrap enter"><div className="eyebrow">Your training record</div><h1 className="display" style={{ fontSize: 48, margin: '8px 0 20px' }}>The log.</h1>{list.isError ? <QueryError retry={() => void list.refetch()}/> : list.data?.length ? <div style={{ display: 'grid', gap: 10 }}>{list.data.map((w) => <WorkoutSummaryCard key={w.id} item={w}/>)}</div> : <Empty title="Nothing logged yet" detail="Completed workouts will live here, with the sets and volume behind them."/>}</main>;
}
function HistoryDetailPage() { const { sessionId } = useParams<{ sessionId: string }>(); const id = Number(sessionId); const q = useGetWorkout(id, { query: { enabled: !!id, queryKey: getGetWorkoutQueryKey(id) } }); if (q.isLoading) return <Loading/>; if (q.isError || !q.data) return <main className="page-wrap"><QueryError retry={() => void q.refetch()}/></main>; return <CompletedWorkout workout={q.data}/>; }

function ExercisesPage() {
  const { profile } = useActiveProfile(); const [search, setSearch] = useState(''); const [modal, setModal] = useState(false);
  const list = useListExercises({ profileId: profile?.id ?? 0, search: search || undefined }, { query: { enabled: !!profile, queryKey: getListExercisesQueryKey({ profileId: profile?.id ?? 0, search: search || undefined }) } });
  const create = useCreateExercise(); const qc = useQueryClient();
  const [form, setForm] = useState({ name: '', muscleGroup: 'Chest', equipment: 'Barbell', instructions: '', isCompound: true });
  const submit = (e: FormEvent) => { e.preventDefault(); if (!profile) return; create.mutate({ data: { ...form, profileId: profile.id } }, { onSuccess: () => { setModal(false); setForm({ name: '', muscleGroup: 'Chest', equipment: 'Barbell', instructions: '', isCompound: true }); void qc.invalidateQueries({ queryKey: getListExercisesQueryKey({ profileId: profile.id }) }); } }); };
  return <main className="page-wrap enter"><div className="eyebrow">Exercise library</div><div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'end', margin: '8px 0 18px' }}><h1 className="display" style={{ fontSize: 46, margin: 0 }}>Movements.</h1><button className="btn btn-primary" style={{ minHeight: 43, padding: '0 12px' }} onClick={() => setModal(true)}><Plus size={17}/> Add</button></div>
    <div style={{ position: 'relative', marginBottom: 14 }}><Search size={17} style={{ position: 'absolute', left: 13, top: 15, color: 'hsl(var(--muted-foreground))' }}/><input className="field" data-testid="input-exercise-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name or muscle" style={{ paddingLeft: 40 }}/></div>
    {list.isLoading ? <div style={{ display: 'grid', gap: 8 }}><div className="skeleton" style={{ height: 76 }}/><div className="skeleton" style={{ height: 76 }}/></div> : list.isError ? <QueryError retry={() => void list.refetch()}/> : list.data?.length ? <div style={{ display: 'grid', gap: 8 }}>{list.data.map((ex) => <article key={ex.id} className="panel" style={{ padding: 15, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><div><b>{ex.name}</b><div style={{ fontSize: 12, color: 'hsl(var(--muted-foreground))', marginTop: 4 }}>{ex.muscleGroup} · {ex.equipment}{ex.profileId ? ' · Custom' : ' · Library'}</div></div><span style={{ font: '700 10px var(--app-font-mono)', color: 'hsl(var(--primary))' }}>{ex.isCompound ? 'COMPOUND' : 'ISOLATION'}</span></article>)}</div> : <Empty title="No movements found" detail="Try another search, or add a custom exercise to your library." action={<button className="btn btn-primary" onClick={() => setModal(true)}><Plus size={16}/> Add exercise</button>}/>}
    {modal && <Modal title="Add custom exercise" close={() => setModal(false)}><form onSubmit={submit} style={{ display: 'grid', gap: 13 }}>
      <FieldLabel label="NAME"><input className="field" required maxLength={120} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}/></FieldLabel>
      <FieldLabel label="MUSCLE GROUP"><input className="field" required value={form.muscleGroup} onChange={(e) => setForm({ ...form, muscleGroup: e.target.value })}/></FieldLabel>
      <FieldLabel label="EQUIPMENT"><input className="field" required value={form.equipment} onChange={(e) => setForm({ ...form, equipment: e.target.value })}/></FieldLabel>
      <FieldLabel label="NOTES (OPTIONAL)"><input className="field" value={form.instructions} onChange={(e) => setForm({ ...form, instructions: e.target.value })}/></FieldLabel>
      <label style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 14 }}><input type="checkbox" checked={form.isCompound} onChange={(e) => setForm({ ...form, isCompound: e.target.checked })}/> Compound movement</label>
      <button className="btn btn-primary" disabled={create.isPending}>{create.isPending ? 'Saving…' : 'Save exercise'}</button>{create.isError && <ErrorNote message="Could not save the exercise."/>}
    </form></Modal>}
  </main>;
}

function SplitsPage() {
  const { profile } = useActiveProfile(); const list = useListSplits({ profileId: profile?.id ?? 0 }, { query: { enabled: !!profile, queryKey: getListSplitsQueryKey({ profileId: profile?.id ?? 0 }) } });
  const [name, setName] = useState(''); const create = useCreateSplit(); const qc = useQueryClient(); const [, navigate] = useLocation();
  const createPlan = (e: FormEvent) => { e.preventDefault(); if (!profile) return; create.mutate({ data: { profileId: profile.id, name: name.trim() } }, { onSuccess: (split) => { void qc.invalidateQueries({ queryKey: getListSplitsQueryKey({ profileId: profile.id }) }); navigate(`/splits/${split.id}`); } }); };
  return <main className="page-wrap enter"><div className="eyebrow">Programming</div><h1 className="display" style={{ fontSize: 48, margin: '8px 0 19px' }}>Your plans.</h1>
    {list.isLoading ? <div className="skeleton" style={{ height: 110 }}/> : list.isError ? <QueryError retry={() => void list.refetch()}/> : list.data?.length ? <div style={{ display: 'grid', gap: 10, marginBottom: 20 }}>{list.data.map((split) => <Link key={split.id} href={`/splits/${split.id}`} style={{ textDecoration: 'none', color: 'inherit' }}><article className="panel" style={{ padding: 17, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><div><div className="eyebrow">{split.days.length} training days</div><h2 style={{ margin: '5px 0 0', fontSize: 18 }}>{split.name}</h2></div><ArrowRight size={18} color="hsl(var(--primary))"/></article></Link>)}</div> : <Empty title="Build your first split" detail="Set up a training rhythm with the days and movements you want to repeat."/>}
    <form onSubmit={createPlan} className="panel" style={{ padding: 17, display: 'grid', gap: 11 }}><strong>Create a training split</strong><input className="field" required maxLength={100} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Upper / lower"/><button className="btn btn-primary" disabled={create.isPending}><Plus size={17}/>{create.isPending ? 'Creating…' : 'Create split'}</button>{create.isError && <ErrorNote message="Could not create this split."/>}</form>
  </main>;
}

function SplitEditorPage() {
  const { splitId } = useParams<{ splitId: string }>(); const id = Number(splitId);
  const query = useGetSplit(id, { query: { enabled: !!id, queryKey: getGetSplitQueryKey(id) } });
  const { profile } = useActiveProfile(); const update = useUpdateSplit(); const addDay = useCreateSplitDay(); const updateDay = useUpdateSplitDay(); const addExercise = useAddExerciseToSplitDay(); const updateExercise = useUpdateSplitDayExercise(); const removeExercise = useRemoveExerciseFromSplitDay();
  const qc = useQueryClient(); const [dayName, setDayName] = useState(''); const [editName, setEditName] = useState(''); const [pickerDay, setPickerDay] = useState<number | null>(null);
  const exercises = useListExercises({ profileId: profile?.id ?? 0 }, { query: { enabled: !!profile && pickerDay !== null, queryKey: getListExercisesQueryKey({ profileId: profile?.id ?? 0 }) } });
  useEffect(() => { if (query.data) setEditName(query.data.name); }, [query.data?.id, query.data?.name]);
  const invalidate = () => void qc.invalidateQueries({ queryKey: getGetSplitQueryKey(id) });
  if (query.isLoading) return <Loading/>; if (query.isError || !query.data) return <main className="page-wrap"><QueryError retry={() => void query.refetch()}/></main>;
  const split = query.data;
  return <main className="page-wrap enter">
    <Link href="/splits" className="btn btn-ghost" style={{ padding: 0, textDecoration: 'none' }}><ArrowLeft size={17}/> Plans</Link>
    <div className="eyebrow" style={{ marginTop: 17 }}>Split editor</div><div style={{ display: 'flex', gap: 8, margin: '7px 0 16px' }}><input className="field" value={editName} onChange={(e) => setEditName(e.target.value)} aria-label="Split name"/><button className="btn btn-secondary" onClick={() => update.mutate({ splitId: id, data: { name: editName } }, { onSuccess: invalidate })} style={{ minHeight: 48 }}><Check size={17}/></button></div>
    {!split.days.length && <Empty title="Add your first workout day" detail="Name each day in your split, then assign movements and targets."/>}
    <div style={{ display: 'grid', gap: 13, marginBottom: 18 }}>{[...split.days].sort((a,b)=>a.dayIndex-b.dayIndex).map((day) => <section className="panel" key={day.id} style={{ padding: 15 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}><span className="eyebrow" style={{ whiteSpace: 'nowrap' }}>DAY {day.dayIndex + 1}</span><input className="field" defaultValue={day.name} aria-label={`Day ${day.dayIndex + 1} name`} onBlur={(e) => { if (e.currentTarget.value.trim() && e.currentTarget.value !== day.name) updateDay.mutate({ dayId: day.id, data: { name: e.currentTarget.value.trim() } }, { onSuccess: invalidate }); }}/></div>
      {day.exercises.length ? <div style={{ display: 'grid', gap: 8 }}>{day.exercises.map((prescription) => <PrescriptionEditor key={prescription.id} item={prescription} onSave={(data) => updateExercise.mutate({ dayExerciseId: prescription.id, data }, { onSuccess: invalidate })} onRemove={() => removeExercise.mutate({ dayExerciseId: prescription.id }, { onSuccess: invalidate })}/>)}</div> : <div style={{ padding: '12px 2px', color: 'hsl(var(--muted-foreground))', fontSize: 13 }}>No exercises prescribed yet.</div>}
      <button className="btn btn-secondary" style={{ width: '100%', marginTop: 12, minHeight: 42 }} onClick={() => setPickerDay(day.id)}><Plus size={16}/> Add movement</button>
    </section>)}</div>
    <form className="panel" style={{ padding: 16, display: 'flex', gap: 8 }} onSubmit={(e) => { e.preventDefault(); if (!dayName.trim()) return; addDay.mutate({ splitId: id, data: { name: dayName.trim(), dayIndex: split.days.length } }, { onSuccess: () => { setDayName(''); invalidate(); } }); }}><input className="field" value={dayName} onChange={(e) => setDayName(e.target.value)} placeholder="New day name" required/><button className="btn btn-primary" aria-label="Add workout day" style={{ padding: '0 14px' }}><Plus size={18}/></button></form>
    {(addDay.isError || update.isError || addExercise.isError) && <ErrorNote message="Could not save that plan change."/>}
    {pickerDay !== null && <ExercisePicker title="Add movement" exercises={exercises.data ?? []} loading={exercises.isLoading} profileId={profile?.id ?? 0} onClose={() => setPickerDay(null)} onSelect={(exercise) => { const day = split.days.find((d) => d.id === pickerDay); if (day) addExercise.mutate({ dayId: day.id, data: { exerciseId: exercise.id, orderIndex: day.exercises.length, targetSets: 3, targetRepsMin: 8, targetRepsMax: 12, targetRir: 2, targetWeight: null } }, { onSuccess: () => { invalidate(); setPickerDay(null); } }); }} onCreate={(exercise) => { const day = split.days.find((d) => d.id === pickerDay); if (day) addExercise.mutate({ dayId: day.id, data: { exerciseId: exercise.id, orderIndex: day.exercises.length, targetSets: 3, targetRepsMin: 8, targetRepsMax: 12, targetRir: 2 } }, { onSuccess: () => { invalidate(); setPickerDay(null); } }); }}/>}
  </main>;
}
function PrescriptionEditor({ item, onSave, onRemove }: { item: SplitDayExercise; onSave: (data: { targetSets?: number; targetRepsMin?: number; targetRepsMax?: number; targetRir?: number; targetWeight?: number | null }) => void; onRemove: () => void }) {
  const [fields, setFields] = useState({ targetSets: item.targetSets, targetRepsMin: item.targetRepsMin, targetRepsMax: item.targetRepsMax, targetRir: item.targetRir, targetWeight: item.targetWeight ?? '' });
  return <div style={{ padding: 12, borderRadius: 14, background: 'hsl(var(--background))', border: '1px solid hsl(var(--border))' }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}><div><b style={{ fontSize: 13 }}>{item.exercise.name}</b><div style={{ fontSize: 10, color: 'hsl(var(--muted-foreground))', marginTop: 2 }}>{item.exercise.muscleGroup}</div></div><button className="btn btn-ghost" style={{ minHeight: 34, padding: 7 }} aria-label={`Remove ${item.exercise.name}`} onClick={onRemove}><Trash2 size={15}/></button></div>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 5 }}>
      {([['Sets','targetSets'],['Min reps','targetRepsMin'],['Max reps','targetRepsMax'],['RIR','targetRir'],['kg','targetWeight']] as const).map(([label, key]) => <label key={key} style={{ fontSize: 9, color: 'hsl(var(--muted-foreground))' }}>{label}<input className="set-input" style={{ height: 38, marginTop: 4, fontSize: 12 }} type="number" value={fields[key]} onChange={(e) => setFields({ ...fields, [key]: e.target.value === '' ? '' : Number(e.target.value) })} onBlur={() => onSave({ targetSets: Number(fields.targetSets), targetRepsMin: Number(fields.targetRepsMin), targetRepsMax: Number(fields.targetRepsMax), targetRir: Number(fields.targetRir), targetWeight: fields.targetWeight === '' ? null : Number(fields.targetWeight) })}/></label>)}
    </div>
  </div>;
}

function ProfilesPage() {
  const { profile, profiles, setProfileId, profilesQuery } = useActiveProfile(); const create = useCreateProfile(); const update = useUpdateProfile(); const qc = useQueryClient();
  const [name, setName] = useState(''); const [editing, setEditing] = useState<number | null>(null); const [editValue, setEditValue] = useState('');
  return <main className="page-wrap enter"><div className="eyebrow">Personal settings</div><h1 className="display" style={{ fontSize: 48, margin: '8px 0 20px' }}>Profiles.</h1>
    {profilesQuery.isError && <QueryError retry={() => void profilesQuery.refetch()}/>}
    <div style={{ display: 'grid', gap: 9, marginBottom: 20 }}>{profiles.map((p: Profile) => <article className="panel" key={p.id} style={{ padding: 15, display: 'flex', alignItems: 'center', gap: 12 }}>
      <button onClick={() => { setProfileId(p.id); window.localStorage.setItem('training-profile', String(p.id)); }} aria-label={`Switch to ${p.name}`} style={{ width: 40, height: 40, border: 0, borderRadius: 14, background: p.id === profile?.id ? 'hsl(var(--primary))' : 'hsl(var(--secondary))', color: p.id === profile?.id ? 'hsl(var(--primary-foreground))' : 'hsl(var(--foreground))', fontWeight: 800 }}>{p.name.slice(0,1).toUpperCase()}</button>
      <div style={{ flex: 1 }}>{editing === p.id ? <input className="field" value={editValue} onChange={(e) => setEditValue(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') update.mutate({ profileId: p.id, data: { name: editValue } }, { onSuccess: () => { setEditing(null); void qc.invalidateQueries({ queryKey: getListProfilesQueryKey() }); } }); }}/>:<><b>{p.name}</b><div style={{ fontSize: 11, color: 'hsl(var(--muted-foreground))' }}>{p.id === profile?.id ? 'Current profile' : 'Training profile'}</div></>}</div>
      <button className="btn btn-ghost" aria-label={`Rename ${p.name}`} style={{ minHeight: 40, padding: 8 }} onClick={() => { setEditing(p.id); setEditValue(p.name); }}><Edit3 size={16}/></button>
      {editing === p.id && <button className="btn btn-ghost" aria-label="Save profile name" style={{ minHeight: 40, padding: 8 }} onClick={() => update.mutate({ profileId: p.id, data: { name: editValue.trim() } }, { onSuccess: () => { setEditing(null); void qc.invalidateQueries({ queryKey: getListProfilesQueryKey() }); } })}><Check size={16}/></button>}
    </article>)}</div>
    <form className="panel" style={{ padding: 17, display: 'grid', gap: 10 }} onSubmit={(e) => { e.preventDefault(); if (!name.trim()) return; create.mutate({ data: { name: name.trim() } }, { onSuccess: (p) => { setName(''); setProfileId(p.id); window.localStorage.setItem('training-profile', String(p.id)); void qc.invalidateQueries({ queryKey: getListProfilesQueryKey() }); } }); }}><strong>Create profile</strong><input className="field" required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} placeholder="Name this profile"/><button className="btn btn-primary" disabled={create.isPending}><Plus size={17}/> Add profile</button>{create.isError && <ErrorNote message="Could not create profile."/>}</form>
  </main>;
}

function NotFound() { return <main className="page-wrap"><div className="eyebrow">Not found</div><h1 className="display" style={{ fontSize: 48 }}>Wrong turn.</h1><Link href="/" className="btn btn-primary" style={{ textDecoration: 'none' }}>Back to today</Link></main>; }

function Router() {
  return <ErrorBoundary resetKey={window.location.pathname}><Shell><Switch>
    <Route path="/" component={HomePage}/>
    <Route path="/workout/:sessionId" component={WorkoutPage}/>
    <Route path="/history" component={HistoryPage}/>
    <Route path="/history/:sessionId" component={HistoryDetailPage}/>
    <Route path="/exercises" component={ExercisesPage}/>
    <Route path="/splits" component={SplitsPage}/>
    <Route path="/splits/:splitId" component={SplitEditorPage}/>
    <Route path="/profiles" component={ProfilesPage}/>
    <Route component={NotFound}/>
  </Switch></Shell></ErrorBoundary>;
}
function App() {
  useEffect(() => {
    if ('serviceWorker' in navigator) void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => undefined);
  }, []);
  return <QueryClientProvider client={queryClient}><TooltipProvider><ProfileProvider><Router/></ProfileProvider><Toaster/></TooltipProvider></QueryClientProvider>;
}
export default App;