import { useEffect, useState } from 'react';
import { useIsMutating, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, CheckCircle2, Clock3, Plus } from 'lucide-react';
import { Link, useLocation, useParams } from 'wouter';
import {
  getGetActiveWorkoutQueryKey, getGetOverviewQueryKey, getGetWorkoutStructureChangesQueryKey, getWorkoutStructureChanges, useGetWorkoutStructureChanges, getGetWorkoutQueryKey, getListExercisesQueryKey,
  getListSplitsQueryKey, getListWorkoutsQueryKey, getGetPersonalRecordsQueryKey, useAddExerciseToWorkout, useFinishWorkout, useGetWorkout,
  useListExercises, useSubstituteWorkoutExercise,
} from '@workspace/api-client-react';
import type { Exercise, FinishWorkoutResult } from '@workspace/api-client-react';
import { useActiveProfile } from '@/lib/profile';
import { fmtTotal } from '@/lib/units';
import { formatRir } from '@/lib/labels';
import { Modal } from '@/components/modal';
import { Empty, ErrorNote, Loading, QueryError } from '@/components/ui-bits';
import { ExercisePicker } from '@/components/exercise-picker';
import { ExerciseCard } from '@/components/exercise-card';
import { CompletedWorkout, SessionContext } from '@/components/completed-workout';
import { MuscleTotals } from '@/components/muscle-totals';
import { ExerciseTools, FeedbackSheet, RecoveryPrompt, recoveryPromptKind } from '@/components/v22-workout';
import { asChanges, type StructureChanges } from '@/lib/v22';
import { WorkoutDraftsContext, useWorkoutDraftRegistry } from '@/lib/workout-drafts';

const sleep = (ms: number) => new Promise((r) => window.setTimeout(r, ms));
function formatTime(seconds: number) { const h = Math.floor(seconds / 3600); const m = Math.floor((seconds % 3600) / 60); const s = seconds % 60; return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`; }

export default function WorkoutPage() {
  const params = useParams<{ sessionId: string }>();
  const id = Number(params.sessionId);
  const workoutQuery = useGetWorkout(id, { query: { enabled: Number.isFinite(id), queryKey: getGetWorkoutQueryKey(id) } });
  const { profile, unit } = useActiveProfile();
  const pid = profile?.id ?? 0;
  const qc = useQueryClient();
  const [summary, setSummary] = useState<FinishWorkoutResult | null>(null);
  const [modal, setModal] = useState<'substitute' | 'add' | 'finish' | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [settling, setSettling] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const draftRegistry = useWorkoutDraftRegistry();
  const [swapTargetId, setSwapTargetId] = useState<number | null>(null);
  const [swapChoice, setSwapChoice] = useState<Exercise | null>(null);
  const [decision, setDecision] = useState<StructureChanges | null>(null);
  const [hiddenExerciseIds, setHiddenExerciseIds] = useState<number[]>([]);
  const [skippedFb, setSkippedFb] = useState<number[]>([]);
  const changesQuery = useGetWorkoutStructureChanges(id, { query: { enabled: Number.isFinite(id) && workoutQuery.data?.status === 'active', queryKey: getGetWorkoutStructureChangesQueryKey(id) } });
  const workout = workoutQuery.data;
  const addExercise = useAddExerciseToWorkout();
  const substitute = useSubstituteWorkoutExercise();
  const finish = useFinishWorkout();
  const pending = useIsMutating();
  const exercisesQuery = useListExercises({ profileId: pid }, { query: { enabled: !!profile && !!modal, queryKey: getListExercisesQueryKey({ profileId: pid }) } });
  const [, navigate] = useLocation();
  useEffect(() => { if (!workout?.startedAt || workout.status !== 'active') return; const tick = () => setElapsed(Math.max(0, Math.floor((Date.now() - new Date(workout.startedAt).getTime()) / 1000))); tick(); const timer = window.setInterval(tick, 1000); return () => window.clearInterval(timer); }, [workout?.startedAt, workout?.status]);

  if (summary) {
    const w = summary.workout;
    return <main className="page-wrap enter">
        <div className="eyebrow">Workout complete{w.mesocycleWeek != null ? ` · mesocycle week ${w.mesocycleWeek}` : ''}</div><h1 className="display" style={{ fontSize: 52, margin: '10px 0 20px' }}>Work<br/>logged.</h1>
      <div className="panel" style={{ padding: 20 }}>
        <div className="eyebrow">Total weight lifted</div>
        <div className="display metric" style={{ fontSize: 40, margin: '8px 0 14px' }} data-testid="text-summary-total">{fmtTotal(w.totalVolume, unit)}</div>
        {(w.muscleTotals ?? []).length > 0 && <MuscleTotals totalKg={w.totalVolume} muscleTotals={w.muscleTotals ?? []} unit={unit}/>}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginTop: 18 }}>
          <div><div className="eyebrow">Exercises</div><div className="metric" style={{ fontWeight: 700, marginTop: 6 }} data-testid="text-summary-exercises">{summary.summary.exerciseCount}</div></div>
          <div><div className="eyebrow">Working sets</div><div className="metric" style={{ fontWeight: 700, marginTop: 6 }} data-testid="text-summary-working-sets">{summary.summary.workingSetCount}</div></div>
          <div><div className="eyebrow">New PRs</div><div className="metric" style={{ fontWeight: 700, marginTop: 6, color: 'hsl(var(--primary))' }} data-testid="text-summary-prs">{summary.summary.newPrCount}</div></div>
          <div><div className="eyebrow">Next day</div><div style={{ fontWeight: 700, marginTop: 6 }}>{summary.nextWorkout?.dayName ?? 'Rest'}</div></div>
        </div>
        <div style={{ fontSize: 11, color: 'hsl(var(--muted-foreground))', marginTop: 14 }}>Completed working sets only. Warm-ups and removed sets are excluded.</div>
      </div>
      <Link href="/" className="btn btn-primary" style={{ width: '100%', textDecoration: 'none', marginTop: 18 }}>Back to today <ArrowRight size={17}/></Link>
    </main>;
  }
  if (workoutQuery.isLoading) return <Loading label="Loading active session"/>;
  if (workoutQuery.isError || !workout) return <main className="page-wrap"><QueryError retry={() => void workoutQuery.refetch()}/></main>;
  if (workout.status === 'completed') return <CompletedWorkout workout={workout} unit={unit}/>;

  const invalidate = () => { void qc.invalidateQueries({ queryKey: getGetWorkoutStructureChangesQueryKey(id) }); void qc.invalidateQueries({ queryKey: getGetWorkoutQueryKey(id) }); void qc.invalidateQueries({ queryKey: getGetActiveWorkoutQueryKey({ profileId: workout.profileId }) }); void qc.invalidateQueries({ queryKey: getGetPersonalRecordsQueryKey(workout.profileId) }); };
  const settle = async () => {
    setSettling(true);
    try {
      (document.activeElement as HTMLElement | null)?.blur?.();
      await sleep(0);
      await draftRegistry.flush();
      for (let n = 0; n < 100 && qc.isMutating() > 0; n++) await sleep(60);
      if (qc.isMutating() > 0) throw new Error('Changes are still saving. Wait and try finishing again.');
    } finally {
      setSettling(false);
    }
  };
  const finishSession = async (structureDecision?: 'today_only' | 'keep') => {
    setSaveError(null);
    try { await settle(); }
    catch (error) { setSaveError(error instanceof Error ? error.message : 'Could not save all set entries.'); return; }
    if (!structureDecision) {
      try {
        const ch = asChanges(await qc.fetchQuery({ queryKey: getGetWorkoutStructureChangesQueryKey(id), queryFn: () => getWorkoutStructureChanges(id), staleTime: 0 }));
        if (ch.changes?.length) { setModal(null); setDecision(ch); return; }
      } catch { setSaveError('Could not check structure changes. Try again.'); return; }
    }
    finish.mutate({ sessionId: id, ...(structureDecision ? { data: { structureDecision } } : {}) }, { onSuccess: (result) => {
      setSummary(result);
      qc.setQueryData(getGetWorkoutQueryKey(id), result.workout);
      void qc.invalidateQueries({ queryKey: getGetActiveWorkoutQueryKey({ profileId: workout.profileId }) });
      void qc.invalidateQueries({ queryKey: getListWorkoutsQueryKey({ profileId: workout.profileId }) });
      void qc.invalidateQueries({ queryKey: getGetOverviewQueryKey({ profileId: workout.profileId }) });
      void qc.invalidateQueries({ queryKey: getListSplitsQueryKey({ profileId: workout.profileId }) });
      void qc.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith('/api/') && q.queryKey[0] !== getGetWorkoutQueryKey(id)[0] });
      setModal(null); setDecision(null);
    } });
  };
  const addWith = (exercise: Exercise) => {
    addExercise.mutate({ sessionId: id, data: { exerciseId: exercise.id, targetRir: workout.targetRirSnapshot ?? 2, targetSets: 3, targetRepsMin: exercise.defaultRepMin, targetRepsMax: exercise.defaultRepMax, orderIndex: workout.exercises.length } }, { onSuccess: () => { invalidate(); setModal(null); } });
  };
  const swapTarget = workout.exercises.find((x) => x.id === swapTargetId);
  const doSwap = (updateMesocycle: boolean) => {
    if (!swapTarget || !swapChoice) return;
    substitute.mutate({ sessionId: id, workoutExerciseId: swapTarget.id, data: { exerciseId: swapChoice.id, updateMesocycle } }, { onSuccess: () => {
      invalidate(); if (updateMesocycle) void qc.invalidateQueries({ queryKey: getListSplitsQueryKey({ profileId: workout.profileId }) });
      setSwapChoice(null); setSwapTargetId(null);
    } });
  };
  const recMap = new Map((changesQuery.data ? asChanges(changesQuery.data).recovery ?? [] : []).map((r) => [r.workoutExerciseId, r]));
  const savedFb = new Set((changesQuery.data ? asChanges(changesQuery.data).feedback : []).map((f) => f.workoutExerciseId));
  const feedbackFor = workout.status === 'active' && changesQuery.data ? workout.exercises.find((x) => {
    if (x.skipped || x.superseded || savedFb.has(x.id) || skippedFb.includes(x.id)) return false;
    const w = x.sets.filter((q) => !q.removed && q.setType === 'work');
    return w.length > 0 && w.every((q) => q.completed);
  }) ?? null : null;
  const busy = settling || finish.isPending || pending > 0;
  return <WorkoutDraftsContext.Provider value={draftRegistry}><main className="page-wrap enter">
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
      <button className="btn btn-ghost" style={{ padding: 0, minHeight: 38 }} onClick={() => navigate('/')}><ArrowLeft size={19}/> Today</button>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', font: '700 12px var(--app-font-mono)', color: 'hsl(var(--accent))' }}><Clock3 size={15}/>{formatTime(elapsed)}</div>
      <button className="btn btn-secondary" data-testid="button-finish-top" style={{ minHeight: 40, padding: '0 12px', fontSize: 12 }} disabled={finish.isPending} onClick={() => setModal('finish')}>Finish</button>
    </div>
    <div className="eyebrow">{workout.splitName || 'Open session'}</div><h1 className="display" style={{ fontSize: 43, margin: '6px 0 14px' }}>{workout.dayName || 'Training session'}</h1>
    {(workout.weekKindSnapshot === 'deload' || workout.weekKindSnapshot === 'week_off') && <div className="panel" style={{ padding: '10px 13px', marginBottom: 12, borderColor: 'hsl(var(--primary) / .5)' }} data-testid="banner-recovery-week">
      <div style={{ fontWeight: 800, fontSize: 13, letterSpacing: '.04em' }}>{workout.weekKindSnapshot === 'deload' ? 'RECOVERY WEEK — DELOAD' : 'RECOVERY WEEK — WEEK OFF'}</div>
      <div style={{ fontSize: 12, color: 'hsl(var(--muted-foreground))', marginTop: 4, lineHeight: 1.45 }}>{workout.weekKindSnapshot === 'deload' ? `Higher RIR${workout.targetRirSnapshot != null ? ` (${formatRir(workout.targetRirSnapshot)})` : ''} with reduced sets and load. Planned recovery, not a setback.` : 'Planned rest. Anything you log here is optional and carries no penalty.'}</div>
    </div>}
     <SessionContext workout={workout}/>
     {saveError && modal === null && <ErrorNote message={saveError}/>}
    {!workout.exercises.length ? <Empty title="Your session is ready" detail="Add an exercise from your library to start logging sets." action={<button className="btn btn-primary" onClick={() => setModal('add')}><Plus size={17}/> Add exercise</button>}/> : null}
    <div style={{ display: 'grid', gap: 13 }}>
      {workout.exercises.filter((exercise) => !hiddenExerciseIds.includes(exercise.id)).map((exercise, i, all) => recoveryPromptKind(exercise, recMap.get(exercise.id)) !== 'none'
        ? <RecoveryPrompt key={exercise.id} exercise={exercise} rec={recMap.get(exercise.id)} sessionId={id} onDone={invalidate} onChangeExercise={() => { setSwapTargetId(exercise.id); setModal('substitute'); }}/>
        : <div key={exercise.id}><ExerciseCard exercise={exercise} profileId={workout.profileId} sessionId={id} unit={unit} onChanged={invalidate} onSubstitute={() => { setSwapTargetId(exercise.id); setModal('substitute'); }}/>
          {workout.status === 'active' && <ExerciseTools exercise={exercise} sessionId={id} first={i === 0} last={i === all.length - 1} onChanged={invalidate} onRemoved={() => { setSaveError(null); setHiddenExerciseIds((items) => items.includes(exercise.id) ? items : [...items, exercise.id]); }} onRemoveFailed={() => { setHiddenExerciseIds((items) => items.filter((x) => x !== exercise.id)); setSaveError('Could not remove this exercise. It has been restored to today’s list.'); }}/>}</div>)}
    </div>
    <button className="btn btn-secondary" style={{ width: '100%', marginTop: 14 }} onClick={() => setModal('add')} data-testid="button-add-exercise"><Plus size={18}/> Add exercise</button>
    <button className="btn btn-primary" data-testid="button-finish-workout" style={{ width: '100%', marginTop: 10, minHeight: 56 }} disabled={finish.isPending} onClick={() => setModal('finish')}><CheckCircle2 size={19}/> Finish workout</button>
    {(addExercise.isError || substitute.isError) && <ErrorNote message="That change did not save. Check your connection and try again."/>}
    {modal === 'finish' && <Modal title="Finish this workout?" close={() => setModal(null)}>
      <p style={{ color: 'hsl(var(--muted-foreground))', lineHeight: 1.5, marginTop: 0 }}>Any value you are still typing will be saved first. Completed working sets are rated and totalled; warm-ups and skipped exercises are not counted.</p>
      <div style={{ display: 'flex', gap: 9, marginTop: 20 }}><button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setModal(null)}>Keep training</button><button className="btn btn-primary" data-testid="button-confirm-finish" style={{ flex: 1 }} disabled={busy} onClick={() => void finishSession()}>{finish.isPending ? 'Finishing…' : busy ? 'Saving sets…' : 'Finish workout'}</button></div>
      {finish.isError && <ErrorNote message="Could not finish this workout. Your session is still saved as active."/>}
      {saveError && <ErrorNote message={saveError}/>}
    </Modal>}
    {modal === 'add' && <ExercisePicker title="Add exercise" exercises={exercisesQuery.data ?? []} loading={exercisesQuery.isLoading} onClose={() => setModal(null)} onSelect={addWith} onCreate={addWith} profileId={pid}/>}
    {modal === 'substitute' && !swapChoice && <ExercisePicker title="Replace exercise" exercises={exercisesQuery.data ?? []} loading={exercisesQuery.isLoading} onClose={() => setModal(null)} profileId={pid} onSelect={(e) => { setSwapChoice(e); setModal(null); }} onCreate={(e) => { setSwapChoice(e); setModal(null); }}/>}
    {swapChoice && swapTarget && <Modal title="Replace exercise" close={() => { setSwapChoice(null); setSwapTargetId(null); }}>
      <p style={{ lineHeight: 1.5, marginTop: 0 }}>Replace <b>{swapTarget.exerciseName}</b> with <b>{swapChoice.name}</b>. Anything already logged stays in your history.</p>
      <div style={{ display: 'grid', gap: 8 }}>
        <button className="btn btn-primary" disabled={substitute.isPending} onClick={() => doSwap(false)} data-testid="button-swap-once">Replace in today's workout</button>
        {workout.splitDayId != null && <p style={{ margin: 0, fontSize: 12, color: 'hsl(var(--muted-foreground))' }}>At Finish Workout, choose once whether to keep all changes for the rest of the mesocycle.</p>}
        <button className="btn btn-ghost" onClick={() => { setSwapChoice(null); setSwapTargetId(null); }}>Cancel</button>
      </div>
      {substitute.isError && <ErrorNote message="Could not replace the exercise."/>}
    </Modal>}
    {feedbackFor && <FeedbackSheet exercise={feedbackFor} sessionId={id} onDone={invalidate} onSkip={() => setSkippedFb((v) => [...v, feedbackFor.id])}/>}
     {decision && <Modal title="You changed today's workout" close={() => setDecision(null)}>
       <p style={{ margin: '0 0 12px', color: 'hsl(var(--muted-foreground))', fontSize: 13, lineHeight: 1.5 }}>Your completed session will always record exactly what you performed. Choose whether these structure changes carry forward to uncompleted workouts.</p>
       <ul style={{ margin: '0 0 14px', paddingLeft: 18, fontSize: 14, lineHeight: 1.6 }} data-testid="list-structure-changes">{decision.changes.map((c, i) => <li key={`${i}-${c}`}>{c}</li>)}</ul>
      <div style={{ display: 'grid', gap: 8 }}>
         <button className="btn btn-primary" disabled={busy} onClick={() => void finishSession('keep')} data-testid="button-structure-keep">Keep changes for rest of mesocycle</button>
         <button className="btn btn-secondary" disabled={busy} onClick={() => void finishSession('today_only')} data-testid="button-structure-today">Today only</button>
      </div>
       {saveError && <ErrorNote message={saveError}/>}
      {finish.isError && <ErrorNote message="Could not finish this workout. Your session is still saved as active."/>}
    </Modal>}
  </main></WorkoutDraftsContext.Provider>;
}
