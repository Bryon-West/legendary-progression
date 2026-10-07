import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, Copy, Hammer, LayoutTemplate } from 'lucide-react';
import { Link, useLocation } from 'wouter';
import {
  getGetOverviewQueryKey, getListSplitsQueryKey, getGetProfileEngineSettingsQueryKey,
  useCreateMesocycle,  useGetMesocycleCopyOptions, useGetProfileEngineSettings, useListExercises, useListMesocycleTemplates,
} from '@workspace/api-client-react';
import type { Exercise, MesocycleCreateInputCreateMode, MesocycleDayInput, MesocycleTemplate, CopyEligibleWeek } from '@workspace/api-client-react';
import { useActiveProfile } from '@/lib/profile';
import { localToday } from '@/lib/dates';
import { MesocycleBuilder, defaultWeeks, newWeekOcc, exFromInput, nk, type Draft, type DraftDay } from '@/components/mesocycle-builder';
import { Empty, ErrorNote, Loading, QueryError } from '@/components/ui-bits';
import { refreshTrainingData } from '@/lib/training-cache';
import { EducationInfo } from '@/components/education-info';

type Source = { createMode: MesocycleCreateInputCreateMode; templateId?: string; sourceWeekId?: number; description?: string };
type Tab = 'template' | 'copy' | 'build';

export default function MesocycleNewPage() {
  const { profile, unit } = useActiveProfile(); const pid = profile?.id ?? 0;
  const [, navigate] = useLocation(); const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>(() => new URLSearchParams(window.location.search).get('start') === 'build' ? 'build' : 'template');
  const [started, setStarted] = useState<{ draft: Draft; source: Source } | null>(null);
  const [pickedTemplate, setPickedTemplate] = useState<string | null>(null);
  const [pickedWeek, setPickedWeek] = useState<CopyEligibleWeek | null>(null);
  const [choosing, setChoosing] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const templates = useListMesocycleTemplates();
  const copy = useGetMesocycleCopyOptions({ profileId: pid }, { query: { enabled: !!pid, queryKey: ['/api/mesocycles/copy-options', { profileId: pid }] } });
  const exercises = useListExercises({ profileId: pid }, { query: { enabled: !!pid, queryKey: ['/api/exercises', { profileId: pid }] } });
  const settings = useGetProfileEngineSettings(pid, { query: { enabled: !!pid, queryKey: getGetProfileEngineSettingsQueryKey(pid) } });
  const create = useCreateMesocycle();
  const recommended = copy.data?.eligibleWeeks.find((w) => w.weekId === copy.data?.recommendedWeekId) ?? null;
  const activeWeek = pickedWeek ?? recommended;
  const byId = new Map<number, Exercise>((exercises.data ?? []).map((e) => [e.id, e]));

  const begin = (
    days: MesocycleDayInput[],
    rirs: number[],
    name: string,
    source: Source,
    weekPlan?: NonNullable<MesocycleTemplate['defaultWeeks']>,
  ) => {
    const start = localToday();
    const dd: DraftDay[] = days.map((d) => ({ key: nk(), name: d.name, exercises: d.exercises.map((x) => exFromInput(x, byId, unit)) }));
    const weeks = weekPlan
      ? weekPlan.map((week, index) => ({
          key: nk(),
          kind: week.kind,
          rir: String(week.targetRir ?? settings.data?.deloadRir ?? 4),
          state: 'new' as const,
          occ: newWeekOcc(dd, start, index),
        }))
      : [...defaultWeeks(rirs, dd, start), {
          key: nk(),
          kind: 'deload' as const,
          rir: String(settings.data?.deloadRir ?? 4),
          state: 'new' as const,
          occ: newWeekOcc(dd, start, rirs.length),
        }];
    setStarted({ draft: { name, startDate: start, days: dd, weeks }, source });
  };
  const startTemplate = (t: MesocycleTemplate) => begin(
    t.days,
    t.defaultLoadingRirs.length ? t.defaultLoadingRirs : [3, 2, 1, 0],
    t.name,
    { createMode: 'template', templateId: t.templateId, description: `Based on template ${t.name}` },
    t.defaultWeeks,
  );
  const startCopy = (chosen?: CopyEligibleWeek) => {
    const activeWeek = chosen ?? pickedWeek ?? recommended;
    if (!activeWeek) return;
    // Historical program of the completed week as returned by the server, never the current (possibly edited) plan.
    const days = activeWeek.days;
    if (!days.length) { setCopyError(true); return; }
    setCopyError(false);
    // The new mesocycle starts at its own default Week 1 RIR schedule, never the source week's RIR.
    begin(days, [3, 2, 1, 0], `${activeWeek.mesocycleName} (next block)`, { createMode: 'copy_completed_week', sourceWeekId: activeWeek.weekId, description: activeWeek.description });
  };
  const startOwn = () => begin([{ name: 'Day 1', dayIndex: 0, exercises: [] }], [3, 2, 1, 0], '', { createMode: 'build_own', description: undefined });

  if (!profile) return <Loading/>;
  if (started) return <MesocycleBuilder key="draft" initial={started.draft} mode="new" profileId={pid} unit={unit} deloadRir={settings.data?.deloadRir ?? 4}
    saving={create.isPending} saveError={create.isError}
    banner={started.source.description ? <div className="badge" style={{ margin: '10px 0' }} data-testid="text-source-trace">{started.source.description}</div> : undefined}
    onCancel={() => navigate('/splits')}
    onSave={(input) => create.mutate({ data: { ...input, profileId: pid, createMode: started.source.createMode, templateId: started.source.templateId ?? null, sourceWeekId: started.source.sourceWeekId ?? null, sourceDescription: started.source.description ?? null } }, { onSuccess: async (created) => {
      await refreshTrainingData(qc);
      void qc.invalidateQueries({ queryKey: getListSplitsQueryKey({ profileId: pid }) });
      void qc.invalidateQueries({ queryKey: getGetOverviewQueryKey({ profileId: pid }) });
      void qc.invalidateQueries({ queryKey: ['/api/mesocycles/copy-options', { profileId: pid }] });
      navigate(`/calendar?split=${created.id}`);
    } })}/>;

  const tabs: { id: Tab; label: string; icon: typeof Copy }[] = [{ id: 'template', label: 'Start from template', icon: LayoutTemplate }, { id: 'copy', label: 'Copy previous', icon: Copy }, { id: 'build', label: 'Build my own', icon: Hammer }];
  return <main className="page-wrap enter">
    <Link href="/splits" className="btn btn-ghost" style={{ textDecoration: 'none', padding: 0 }}><ArrowLeft size={17}/> Plans</Link>
    <div className="eyebrow" style={{ marginTop: 10 }}><span className="inline-term">New mesocycle <EducationInfo term="mesocycle" testId="info-mesocycle-create"/></span></div>
    <h1 className="display" style={{ fontSize: 44, margin: '8px 0 6px' }}>How do you want<br/>to start?</h1>
    <p style={{ fontSize: 13, color: 'hsl(var(--muted-foreground))', marginTop: 0 }}>Every option opens an editable draft. Nothing is saved until you press Save &amp; Exit.</p>
    {profile.trainingMode === 'basic' && <div className="panel" role="note" style={{ padding: 14, margin: '12px 0', fontSize: 12, lineHeight: 1.55, color: 'hsl(var(--muted-foreground))' }}>
      In Basic, plans organize your workout days. You choose your weight and reps as you train; guided progression stays off.
    </div>}
    <div className="seg" style={{ gridTemplateColumns: '1fr', margin: '16px 0' }} role="tablist">{tabs.map(({ id, label, icon: Icon }) => <button key={id} type="button" role="tab" aria-pressed={tab === id} onClick={() => setTab(id)} data-testid={`tab-${id}`} style={{ display: 'flex', alignItems: 'center', gap: 10 }}><Icon size={17}/>{label.toUpperCase()}</button>)}</div>
     {tab === 'template' && (templates.isLoading ? <div className="skeleton" style={{ height: 150 }}/> : templates.isError ? <QueryError retry={() => void templates.refetch()}/> : <div style={{ display: 'grid', gap: 9 }}>{templates.data?.map((t) => {
       const loadingWeeks = t.defaultWeeks?.filter((week) => week.kind === 'loading').length ?? t.defaultLoadingRirs.length;
       const deloadWeeks = t.defaultWeeks?.filter((week) => week.kind === 'deload').length ?? 1;
       const totalWeeks = t.defaultWeeks?.length ?? loadingWeeks + deloadWeeks;
       return <article key={t.templateId} className="panel" style={{ padding: 15 }} data-testid={`card-template-${t.templateId}`}>
       <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}><div><h2 style={{ margin: 0, fontSize: 16 }}>{t.name}</h2><div className="eyebrow" style={{ marginTop: 5 }}>{t.days.length} days · {totalWeeks} weeks · {loadingWeeks} loading · {deloadWeeks} deload</div></div></div>
      <p style={{ fontSize: 12.5, lineHeight: 1.5, color: 'hsl(var(--muted-foreground))', margin: '9px 0' }}>{t.description}</p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 11 }}>{t.days.map((d) => <span key={d.dayIndex} className="badge">{d.name}</span>)}</div>
      <button className="btn btn-primary btn-sm" style={{ width: '100%' }} disabled={exercises.isLoading || pickedTemplate === t.templateId} onClick={() => { setPickedTemplate(t.templateId); startTemplate(t); }} data-testid={`button-use-template-${t.templateId}`}>Use and edit <ArrowRight size={15}/></button>
     </article>;
     })}{!templates.data?.length && <Empty title="No templates yet" detail="Templates arrive from the server. Build your own in the meantime."/>}</div>)}
    {tab === 'copy' && (copy.isLoading ? <div className="skeleton" style={{ height: 120 }}/> : copy.isError ? <QueryError retry={() => void copy.refetch()}/> : !copy.data?.eligibleWeeks.length ? <Empty title="Nothing to copy yet" detail="Only fully completed loading weeks can be copied. Deloads, weeks off and unfinished weeks are not eligible."/> : <div style={{ display: 'grid', gap: 10 }}>
      {recommended && <div className="panel" style={{ padding: 15, borderColor: 'hsl(var(--primary) / .5)' }}>
        <span className="badge badge-red">Recommended</span>
        <h2 style={{ margin: '8px 0 3px', fontSize: 16 }}>{recommended.mesocycleName} — Week {recommended.weekIndex}</h2>
        <div style={{ fontSize: 12, color: 'hsl(var(--muted-foreground))' }} data-testid="text-copy-source">{recommended.description}</div>
        <button className="btn btn-primary btn-sm" style={{ width: '100%', marginTop: 12 }} disabled={exercises.isLoading} onClick={() => { setPickedWeek(null); setChoosing(false); startCopy(recommended); }} data-testid="button-use-recommended-week">USE RECOMMENDED WEEK</button>
      </div>}
      <button className="btn btn-secondary btn-sm" onClick={() => setChoosing((c) => !c)} data-testid="button-choose-another-week">CHOOSE ANOTHER WEEK</button>
      {choosing && <div style={{ display: 'grid', gap: 7 }}>{copy.data.eligibleWeeks.map((w) => <button key={w.weekId} type="button" className="panel" aria-pressed={pickedWeek?.weekId === w.weekId} style={{ padding: 12, textAlign: 'left', color: 'inherit', borderColor: pickedWeek?.weekId === w.weekId ? 'hsl(var(--primary))' : undefined }} onClick={() => setPickedWeek(w)} data-testid={`option-week-${w.weekId}`}><b style={{ fontSize: 13 }}>{w.mesocycleName} — Week {w.weekIndex}</b><div style={{ fontSize: 11, color: 'hsl(var(--muted-foreground))', marginTop: 3 }}>{w.description}</div></button>)}</div>}
      {activeWeek && <div className="notice-ok" style={{ background: 'hsl(var(--primary) / .12)', color: 'hsl(var(--primary))' }}>Selected: {activeWeek.description}</div>}
      <button className="btn btn-primary" disabled={!activeWeek || exercises.isLoading} onClick={() => startCopy()} data-testid="button-continue-copy">Continue to draft <ArrowRight size={17}/></button>
      {copyError && <ErrorNote message="That completed week has no saved program to copy."/>}
      <p style={{ fontSize: 11, color: 'hsl(var(--muted-foreground))', margin: 0, lineHeight: 1.5 }}>Copies days, exercises, order, set counts and rep ranges. Results, readiness answers, dates and deload reductions are not copied. The new block starts at its own Week 1 RIR.</p>
    </div>)}
    {tab === 'build' && <div className="panel" style={{ padding: 18 }}><h2 style={{ margin: '0 0 6px', fontSize: 17 }}>Build my own</h2><p style={{ fontSize: 13, color: 'hsl(var(--muted-foreground))', lineHeight: 1.5, margin: '0 0 14px' }}>Start with one empty day and default weeks at 3, 2, 1 and 0 RIR. Add or remove weeks and a recovery week as you like.</p><button className="btn btn-primary" style={{ width: '100%' }} onClick={startOwn} data-testid="button-build-own">Open blank draft <ArrowRight size={17}/></button></div>}
  </main>;
}
