import { useState } from 'react';
import { ArrowLeft, Play } from 'lucide-react';
import { Link, useParams } from 'wouter';
import { getGetMesocycleQueryKey, getGetPlannedPrescriptionQueryKey, useGetMesocycle, useGetPlannedPrescription } from '@workspace/api-client-react';
import { useActiveProfile } from '@/lib/profile';
import { fmtWeight } from '@/lib/units';
import { fmtDate } from '@/lib/dates';
import { formatRir } from '@/lib/labels';
import { asPrescription } from '@/lib/v22';
import { StartSessionModal } from '@/components/start-session-modal';
import { Loading, QueryError } from '@/components/ui-bits';

export default function PlannedPage() {
  const { plannedId } = useParams<{ plannedId: string }>();
  const id = Number(plannedId);
  const { profile, profilesQuery, unit } = useActiveProfile();
  const q = useGetPlannedPrescription(id, { query: { enabled: Number.isFinite(id), queryKey: getGetPlannedPrescriptionQueryKey(id) } });
  const rx = q.data ? asPrescription(q.data) : null;
  const splitId = rx?.splitId ?? 0;
  const meso = useGetMesocycle(splitId, { query: { enabled: !!splitId, queryKey: getGetMesocycleQueryKey(splitId) } });
  const [start, setStart] = useState(false);
  if (profilesQuery.isLoading || q.isLoading) return <Loading label="Loading planned workout"/>;
  if (profilesQuery.isError) return <main className="page-wrap"><QueryError retry={() => void profilesQuery.refetch()}/></main>;
  if (q.isError || !rx) return <main className="page-wrap"><QueryError retry={() => void q.refetch()}/></main>;
  const dayId = meso.data?.weeks.flatMap((w) => w.scheduledWorkouts).find((p) => p.id === id)?.splitDayId ?? null;
  const blocked = rx.state === 'load_not_calculated' && profile?.trainingMode === "legendary_pro";
  return <main className="page-wrap enter">
    <Link href={`/calendar?split=${rx.splitId}`} className="btn btn-ghost" style={{ padding: 0, minHeight: 38, textDecoration: 'none' }} data-testid="link-back-calendar"><ArrowLeft size={18}/> Calendar</Link>
    <div className="eyebrow" style={{ marginTop: 10 }}><span className="badge badge-red">{profile?.trainingMode === "legendary_pro" ? rx.kind === 'deload' ? 'DELOAD' : rx.state === 'completed' ? 'COMPLETED' : 'UPCOMING' : rx.state === "completed" ? "COMPLETED" : "PLANNED"}</span> · {fmtDate(rx.scheduledDate)}{profile?.trainingMode === "legendary_pro" ? ` · ${rx.kind === 'loading' ? `Week ${rx.weekIndex} · ${formatRir(rx.targetRir)} RIR` : `Week ${rx.weekIndex} · recovery`}` : ""}</div>
    <h1 className="display" style={{ fontSize: 44, margin: '6px 0 14px' }} data-testid="text-planned-day">{rx.dayName}</h1>
    {blocked && <div className="panel" style={{ padding: 16, borderColor: 'hsl(var(--primary) / .6)', marginBottom: 14 }} data-testid="status-load-not-calculated">
      <div style={{ fontWeight: 800, letterSpacing: '.05em', fontSize: 13 }}>LOAD NOT CALCULATED</div>
      <p style={{ margin: '6px 0 12px', fontSize: 13, lineHeight: 1.5, color: 'hsl(var(--muted-foreground))' }}>{rx.message ?? 'Loads for this workout depend on sessions you have not performed yet. No weight is shown until the earlier work is logged.'}</p>
      {rx.currentPlannedId ? <Link href={`/planned/${rx.currentPlannedId}`} className="btn btn-primary" style={{ textDecoration: 'none' }} data-testid="link-go-current-week">GO TO CURRENT WEEK</Link> : <Link href={`/calendar?split=${rx.splitId}`} className="btn btn-primary" style={{ textDecoration: 'none' }}>GO TO CURRENT WEEK</Link>}
    </div>}
    {rx.state === 'completed' && <div className="panel" style={{ padding: 14, marginBottom: 14 }}>
      <b>Completed.</b> {rx.sessionId ? <Link href={`/history/${rx.sessionId}`} data-testid="link-completed-log" style={{ color: 'hsl(var(--primary))' }}>View the performed sets</Link> : null}
    </div>}
    {profile?.trainingMode === 'legendary_pro' && rx.state === 'calibration' && <div className="notice-warn" style={{ marginBottom: 14, fontSize: 13 }}>Some exercises need calibration. Choose a weight you believe you can perform at approximately {formatRir(rx.targetRir)} RIR.</div>}
    <div style={{ display: 'grid', gap: 10 }}>
      {[...rx.exercises].sort((a, b) => a.orderIndex - b.orderIndex).map((x) => <article key={x.exerciseId} className="panel" style={{ padding: 14 }} data-testid={`card-rx-${x.exerciseId}`}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}><div><div className="eyebrow">{x.muscleGroup}{x.isCompound ? ' · compound' : ''}</div><div style={{ fontWeight: 800, fontSize: 16, marginTop: 3 }}>{x.exerciseName}</div></div><span className="badge">{x.targetSets} sets</span></div>
        {blocked && profile?.trainingMode === "legendary_pro" ? <>
          <div className="set-grid" style={{ margin: '12px 0 6px' }}><span className="set-head">Set</span><span className="set-head">Load</span><span className="set-head">Reps</span><span className="set-head">RIR</span><span className="set-head"></span></div>
          {Array.from({ length: Math.max(1, x.targetSets) }, (_, index) => <div key={index} className="set-grid" style={{ marginBottom: 8 }}>
            <span className="set-num">{index + 1}</span>
            <div className="set-input" style={{ gridColumn: 'span 3', width: '100%', display: 'grid', placeItems: 'center', font: '700 9px var(--app-font-mono)', color: 'hsl(var(--warning))' }}>LOAD NOT CALCULATED</div>
            <span className="set-head"></span>
          </div>)}
        </>
          : profile?.trainingMode === "legendary_pro" && (x.calibrationMode || !x.sets.length) ? <div style={{ marginTop: 8, fontSize: 13, color: 'hsl(var(--muted-foreground))' }}>Calibration: choose a weight you believe you can perform at approximately {formatRir(rx.targetRir)} RIR. Record weight, reps and actual RIR.</div>
          : profile?.trainingMode === "basic" ? <div style={{ marginTop: 11, padding: "10px 12px", borderLeft: "2px solid hsl(var(--primary))", background: "hsl(var(--background))", color: "hsl(var(--muted-foreground))", fontSize: 12, lineHeight: 1.5 }}>Manual workout · choose and record your weight and reps as you train.</div>
          : <><div className="set-grid" style={{ margin: '12px 0 6px' }}><span className="set-head">Set</span><span className="set-head">Weight ({unit})</span><span className="set-head">Reps</span><span className="set-head">RIR</span><span className="set-head"></span></div>
            {x.sets.map((s) => <div key={s.setNumber} className="set-grid" style={{ marginBottom: 8 }}>
              <span className="set-num" style={{ background: 'hsl(var(--primary))', color: 'hsl(var(--primary-foreground))' }}>{s.setNumber}</span>
              <div className="set-input metric" style={{ display: 'grid', placeItems: 'center', fontSize: 11 }}>{s.weight != null ? fmtWeight(s.weight, unit, false) : '—'}</div>
              <div className="set-input metric" style={{ display: 'grid', placeItems: 'center' }}>{s.expectedReps != null ? Math.round(s.expectedReps) : '—'}</div>
               <div className="set-input metric" style={{ display: 'grid', placeItems: 'center' }}>{s.rir}</div>
              <span className="set-head">PLAN</span>
            </div>)}</>}
        {profile?.trainingMode === "legendary_pro" && !blocked && !x.calibrationMode && x.sets.some((s) => s.weight == null) && <div className="notice-warn" style={{ marginTop: 8 }}>LOAD NOT CALCULATED</div>}
        {profile?.trainingMode === "legendary_pro" && !blocked && x.rationale && <div style={{ fontSize: 11, color: 'hsl(var(--muted-foreground))', marginTop: 8, lineHeight: 1.45 }}>{x.rationale}</div>}
        {profile?.trainingMode === "legendary_pro" && !blocked && x.reference && <div style={{ fontSize: 11, color: 'hsl(var(--muted-foreground))', marginTop: 4 }}>Reference: {fmtWeight(x.reference.weight, unit)} x {x.reference.reps} @ {x.reference.rir} RIR</div>}
      </article>)}
    </div>
    {!blocked && rx.state !== 'completed' && profile && <button className="btn btn-primary" style={{ width: '100%', marginTop: 16, minHeight: 54 }} onClick={() => setStart(true)} data-testid="button-start-planned"><Play size={17}/> {rx.sessionId ? 'Resume workout' : 'Start this workout'}</button>}
    {start && profile && <StartSessionModal profileId={profile.id} trainingMode={profile.trainingMode} splitDayId={dayId} scheduledWorkoutId={id} muscles={[...new Set(rx.exercises.map(x => x.muscleGroup))]} onClose={() => setStart(false)}/>}
  </main>;
}
