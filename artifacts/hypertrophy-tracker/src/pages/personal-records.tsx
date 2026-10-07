import { ArrowLeft, ArrowRight } from 'lucide-react';
import { Link, useParams } from 'wouter';
import { getGetPersonalRecordsQueryKey, useGetPersonalRecords } from '@workspace/api-client-react';
import type { PersonalRecordExercise, PersonalRecordSet } from '@workspace/api-client-react';
import { useActiveProfile } from '@/lib/profile';
import { fmtWeight } from '@/lib/units';
import { fmtDate } from '@/lib/dates';
import { Empty, Loading, QueryError } from '@/components/ui-bits';
import { EducationInfo } from '@/components/education-info';

function achievedDate(value: string) {
  const date = value.slice(0, 10);
  return fmtDate(date, { month: 'short', day: 'numeric', year: 'numeric' });
}
function performance(set: PersonalRecordSet, unit: 'kg' | 'lb', showRir: boolean) {
  return `${fmtWeight(set.weight, unit, false)} ${unit} × ${set.reps}${showRir && set.rir != null ? ` @ ${set.rir} RIR` : ''}`;
}

export function PersonalRecordsPage() {
  const { profile, unit } = useActiveProfile();
  const showRir = profile?.trainingMode === 'legendary_pro';
  const profileId = profile?.id ?? 0;
  const query = useGetPersonalRecords(profileId, { query: { enabled: !!profileId, queryKey: getGetPersonalRecordsQueryKey(profileId) } });
  if (query.isLoading) return <Loading label="Loading personal records"/>;
  if (query.isError) return <main className="page-wrap"><QueryError retry={() => void query.refetch()}/></main>;
  const exercises = (query.data?.exercises ?? []).filter((exercise) => exercise.history.length > 0 || exercise.bestPerformance || exercise.heaviestLoad);
  return <main className="page-wrap enter">
    <div className="eyebrow">Your training record</div>
    <h1 className="display" style={{ fontSize: 48, margin: '8px 0 16px' }}>Personal records.</h1>
    <div style={{ display: 'flex', gap: 8, borderBottom: '1px solid hsl(var(--border))', marginBottom: 16 }}>
      <Link href="/history" className="log-tab" data-testid="link-log-history">HISTORY</Link>
      <Link href="/history/prs" className="log-tab active" data-testid="link-log-prs">PRs</Link>
    </div>
    <p style={{ margin: '0 0 16px', color: 'hsl(var(--muted-foreground))', fontSize: 13, lineHeight: 1.5 }}>
      Best recorded performances for each exercise. <span className="inline-term">PR <EducationInfo term="pr" testId="info-pr-list" /></span> · <span className="inline-term">e1RM <EducationInfo term="e1rm" testId="info-e1rm-list" /></span>
    </p>
    {exercises.length ? <div style={{ display: 'grid', gap: 10 }}>{exercises.map((exercise) => <RecordCard key={exercise.exerciseId} exercise={exercise} unit={unit} showRir={showRir}/>)}</div>
      : <Empty title="No records yet" detail="Completed working sets that establish a record will appear here. Warm-ups and planned work never qualify."/>}
  </main>;
}

function RecordCard({ exercise, unit, showRir }: { exercise: PersonalRecordExercise; unit: 'kg' | 'lb'; showRir: boolean }) {
  const best = exercise.bestPerformance;
  const heaviest = exercise.heaviestLoad;
  return <Link href={`/history/prs/${exercise.exerciseId}`} data-testid={`link-pr-exercise-${exercise.exerciseId}`} style={{ textDecoration: 'none', color: 'inherit' }}>
    <article className="panel" style={{ padding: 15, display: 'grid', gap: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <div style={{ minWidth: 0 }}><div className="eyebrow">Exercise record</div><h2 style={{ fontSize: 17, margin: '4px 0 0' }}>{exercise.exerciseName}</h2></div>
        <ArrowRight size={17} color="hsl(var(--primary))"/>
      </div>
      {best && <div style={{ padding: '10px 11px', borderRadius: 12, background: 'hsl(var(--primary) / .09)', border: '1px solid hsl(var(--primary) / .24)' }}>
        <div className="eyebrow" style={{ color: 'hsl(var(--primary))' }}>ESTIMATED 1RM PR · EPLEY</div>
        <div className="metric" style={{ fontWeight: 700, marginTop: 5 }}>{best.estimatedOneRepMax != null ? `${fmtWeight(best.estimatedOneRepMax, unit, false)} ${unit}` : performance(best, unit, showRir)}</div>
        {best.estimatedOneRepMax != null && <div style={{ fontSize: 11, color: 'hsl(var(--muted-foreground))', marginTop: 4 }}>Actual set · {performance(best, unit, showRir)}</div>}
        <div style={{ fontSize: 11, color: 'hsl(var(--muted-foreground))', marginTop: 4 }}>Date achieved · {achievedDate(best.sessionDate)}</div>
      </div>}
      {heaviest && <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, fontSize: 12 }}>
        <span className="badge">HEAVIEST LOAD</span><span className="metric" style={{ textAlign: 'right' }}>{performance(heaviest, unit, showRir)}</span>
      </div>}
    </article>
  </Link>;
}

export function PersonalRecordDetailPage() {
  const params = useParams<{ exerciseId: string }>();
  const exerciseId = Number(params.exerciseId);
  const { profile, unit } = useActiveProfile();
  const showRir = profile?.trainingMode === 'legendary_pro';
  const profileId = profile?.id ?? 0;
  const query = useGetPersonalRecords(profileId, { query: { enabled: !!profileId, queryKey: getGetPersonalRecordsQueryKey(profileId) } });
  if (query.isLoading) return <Loading label="Loading record history"/>;
  if (query.isError) return <main className="page-wrap"><QueryError retry={() => void query.refetch()}/></main>;
  const exercise = query.data?.exercises.find((item) => item.exerciseId === exerciseId);
  if (!exercise) return <main className="page-wrap"><Link href="/history/prs" className="btn btn-ghost" style={{ padding: 0, textDecoration: 'none' }}><ArrowLeft size={17}/> PRs</Link><Empty title="Record not found" detail="This exercise has no qualifying completed working-set records."/></main>;
  const history = [...exercise.history].sort((a, b) => a.sessionDate.localeCompare(b.sessionDate) || a.setId - b.setId);
  return <main className="page-wrap enter">
    <Link href="/history/prs" className="btn btn-ghost" style={{ padding: 0, textDecoration: 'none' }}><ArrowLeft size={17}/> All PRs</Link>
    <div className="eyebrow" style={{ marginTop: 18 }}>Chronological record history</div>
    <h1 className="display" style={{ fontSize: 43, margin: '7px 0 16px' }}>{exercise.exerciseName}</h1>
    <p style={{ margin: '10px 0 14px', color: 'hsl(var(--muted-foreground))', fontSize: 12, lineHeight: 1.5 }}>
      <span className="inline-term">PR <EducationInfo term="pr" testId="info-pr-detail" /></span> · <span className="inline-term">e1RM <EducationInfo term="e1rm" testId="info-e1rm-detail" /></span>
    </p>
    {exercise.bestPerformance?.estimatedOneRepMax != null && <div className="panel" style={{ padding: 14, marginBottom: 12 }}>
      <div className="eyebrow">Estimated 1RM PR · Epley</div>
      <div className="metric" style={{ marginTop: 5, fontWeight: 700 }}>{fmtWeight(exercise.bestPerformance.estimatedOneRepMax, unit, false)} {unit}</div>
      <div style={{ fontSize: 11, color: 'hsl(var(--muted-foreground))', marginTop: 4 }}>Established by {performance(exercise.bestPerformance, unit, showRir)} · {achievedDate(exercise.bestPerformance.sessionDate)}</div>
    </div>}
    {exercise.heaviestLoad && <div className="panel" style={{ padding: 14, marginBottom: 12 }}>
      <div className="eyebrow">Heaviest load</div><div className="metric" style={{ marginTop: 5, fontWeight: 700 }}>{performance(exercise.heaviestLoad, unit, showRir)}</div>
      <div style={{ fontSize: 11, color: 'hsl(var(--muted-foreground))', marginTop: 4 }}>Date achieved · {achievedDate(exercise.heaviestLoad.sessionDate)}</div>
    </div>}
    {history.length ? <div style={{ display: 'grid', gap: 8 }}>{history.map((entry, index) => <article key={`${entry.sessionId}-${entry.setId}`} className="panel" style={{ padding: 13, display: 'grid', gridTemplateColumns: '30px minmax(0,1fr)', gap: 10, alignItems: 'start' }} data-testid={`record-entry-${entry.setId}`}>
      <span className="metric" style={{ color: 'hsl(var(--muted-foreground))', fontSize: 12, paddingTop: 2 }}>{String(index + 1).padStart(2, '0')}</span>
      <div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 5 }}>
          {entry.legendaryPerformanceRecord && <span className="badge badge-red">ESTIMATED 1RM PR · EPLEY</span>}
          {entry.heaviestLoadRecord && <span className="badge">HEAVIEST LOAD</span>}
        </div>
        <div className="metric" style={{ fontWeight: 700 }}>{performance(entry, unit, showRir)}</div>
        {entry.estimatedOneRepMax != null && <div style={{ fontSize: 12, marginTop: 4 }}>Estimated 1RM · {fmtWeight(entry.estimatedOneRepMax, unit, false)} {unit}</div>}
        <div style={{ fontSize: 11, color: 'hsl(var(--muted-foreground))', marginTop: 4 }}>Date achieved · {achievedDate(entry.sessionDate)}</div>
      </div>
    </article>)}</div> : <Empty title="No record history" detail="Completed performance records will appear here in workout-date order."/>}
  </main>;
}