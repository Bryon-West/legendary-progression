import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronUp, Play } from 'lucide-react';
import { Link } from 'wouter';
import {
  getGetMesocycleCalendarQueryKey, getGetMesocycleQueryKey, getGetOverviewQueryKey, getListSplitsQueryKey,
  useGetMesocycle, useGetMesocycleCalendar, useListSplits, useReschedulePlannedWorkout,
} from '@workspace/api-client-react';
import type { CalendarWeek, CalendarWorkout } from '@workspace/api-client-react';
import { useActiveProfile } from '@/lib/profile';
import { fmtWeight } from '@/lib/units';
import { fmtDate, localToday } from '@/lib/dates';
import { weekLabel } from '@/lib/labels';
import { Modal } from '@/components/modal';
import { StartSessionModal } from '@/components/start-session-modal';
import { Empty, ErrorNote, QueryError } from '@/components/ui-bits';

export default function CalendarPage() {
  const { profile, unit } = useActiveProfile(); const pid = profile?.id ?? 0;
  const splits = useListSplits({ profileId: pid }, { query: { enabled: !!pid, queryKey: getListSplitsQueryKey({ profileId: pid }) } });
  const wanted = Number(new URLSearchParams(window.location.search).get('split')) || 0;
  const [picked, setPicked] = useState(wanted);
  const splitId = picked || splits.data?.[0]?.id || 0;
  const cal = useGetMesocycleCalendar({ profileId: pid, splitId }, { query: { enabled: !!pid && !!splitId, queryKey: getGetMesocycleCalendarQueryKey({ profileId: pid, splitId }) } });
  const meso = useGetMesocycle(splitId, { query: { enabled: !!splitId, queryKey: getGetMesocycleQueryKey(splitId) } });
  const [open, setOpen] = useState<number | null>(null);
  const [resched, setResched] = useState<{ week: CalendarWeek; w: CalendarWorkout } | null>(null);
  const [start, setStart] = useState<CalendarWorkout | null>(null);
  const today = localToday();
  const dayIdFor = (w: CalendarWorkout) => meso.data?.weeks.flatMap((x) => x.scheduledWorkouts).find((p) => p.id === w.id)?.splitDayId ?? null;
  return <main className="page-wrap enter"><div className="eyebrow">Planned workouts</div>
    <h1 className="display" style={{ fontSize: 48, margin: '8px 0 14px' }}>Calendar.</h1>
    {splits.isError && <QueryError retry={() => void splits.refetch()}/>}
    {splits.data && splits.data.length > 1 && <select className="field" style={{ marginBottom: 14 }} aria-label="Mesocycle" data-testid="select-calendar-split" value={splitId} onChange={(e) => setPicked(Number(e.target.value))}>{splits.data.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>}
    {splits.data && !splits.data.length && <Empty title="No mesocycle to schedule" detail="Create a mesocycle and its weeks appear here." action={<Link href="/splits/new" className="btn btn-primary" style={{ textDecoration: 'none' }}>New mesocycle</Link>}/>}
    {cal.isLoading && <div className="skeleton" style={{ height: 160 }}/>}
    {cal.isError && <QueryError retry={() => void cal.refetch()}/>}
    <div style={{ display: 'grid', gap: 18 }}>{cal.data?.map((week) => <section key={week.weekId} data-testid={`calendar-week-${week.weekIndex}`}>
      <div className={`week-head ${week.kind === 'loading' ? '' : 'recovery'}`}><div><div style={{ fontWeight: 800, fontSize: 13 }}>{weekLabel(week.kind, week.weekIndex, week.targetRir)}</div><div style={{ fontSize: 11, color: 'hsl(var(--muted-foreground))' }}>{fmtDate(week.startDate)} to {fmtDate(week.endDate)}</div></div><span className="badge">{week.status.replace('_', ' ')}</span></div>
      <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
        {week.kind === 'week_off' && <div className="panel" style={{ padding: 14, fontSize: 13, color: 'hsl(var(--muted-foreground))' }}>Week off. Rest, nothing scheduled, nothing missed.</div>}
        {week.scheduledWorkouts.map((w) => {
          const done = w.status === 'completed' && w.sessionId != null; const isToday = w.scheduledDate === today || w.isToday;
          const missed = !done && w.status !== 'cancelled' && w.scheduledDate < today;
          const expanded = open === w.id;
          return <article key={w.id} className="panel" style={{ padding: 13, borderColor: isToday ? 'hsl(var(--primary))' : undefined }} data-testid={`card-planned-${w.id}`}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
              <div><div className="eyebrow">{fmtDate(w.scheduledDate)}{isToday ? ' · today' : ''}</div><div style={{ fontWeight: 800, fontSize: 16, marginTop: 3 }}>{w.dayName}</div>
                {w.originalScheduledDate !== w.scheduledDate && <div style={{ fontSize: 10, color: 'hsl(var(--muted-foreground))' }}>Moved from {fmtDate(w.originalScheduledDate)}</div>}</div>
              {done ? <Link href={`/history/${w.sessionId}`} className="badge badge-red" style={{ textDecoration: 'none' }} data-testid={`link-history-${w.id}`}>Completed · view log</Link>
                : missed ? <span className="badge">Not completed</span> : null}
            </div>
            <div style={{ display: 'flex', gap: 7, marginTop: 10, flexWrap: 'wrap' }}>
              {!done && isToday && <button className="btn btn-primary btn-sm" style={{ flex: 1 }} onClick={() => setStart(w)} data-testid={`button-start-${w.id}`}><Play size={14}/> {w.sessionId ? 'Resume' : 'Start'}</button>}
              {!done && w.status !== 'cancelled' && <button className="btn btn-secondary btn-sm" onClick={() => setResched({ week, w })} data-testid={`button-reschedule-${w.id}`}>{missed ? 'Not completed / Reschedule' : 'Reschedule'}</button>}
              {!done && <button className="btn btn-ghost btn-sm" onClick={() => setOpen(expanded ? null : w.id)} aria-expanded={expanded}>{expanded ? <ChevronUp size={14}/> : <ChevronDown size={14}/>} Preview</button>}
            </div>
            {expanded && <div style={{ marginTop: 10, display: 'grid', gap: 6 }}>{w.projectedExercises.map((x) => <div key={x.exerciseId} style={{ fontSize: 12, padding: 9, borderRadius: 10, background: 'hsl(var(--background))' }}>
              <b>{x.exerciseName}</b> · {x.targetSets} sets
              {x.calibrationMode ? <div style={{ color: 'hsl(var(--muted-foreground))', marginTop: 3 }}>{x.calibrationInstruction ?? 'Calibration: choose a weight you believe you can perform at approximately 3 RIR.'}</div>
                : <div className="metric" style={{ marginTop: 3 }}>{x.targetWeight != null ? fmtWeight(x.targetWeight, unit) : ''} {x.targetRepsMin}–{x.targetRepsMax} reps · {x.targetRir} RIR</div>}
              {x.recommendationExplanation && !x.calibrationMode && <div style={{ color: 'hsl(var(--muted-foreground))', marginTop: 3 }}>{x.recommendationExplanation}</div>}
            </div>)}</div>}
          </article>;
        })}
      </div>
    </section>)}</div>
    {resched && <RescheduleModal week={resched.week} w={resched.w} pid={pid} splitId={splitId} onClose={() => setResched(null)}/>}
    {start && profile && <StartSessionModal profileId={profile.id} splitDayId={dayIdFor(start)} scheduledWorkoutId={start.id} muscles={[]} onClose={() => setStart(null)}/>}
  </main>;
}

function RescheduleModal({ week, w, pid, splitId, onClose }: { week: CalendarWeek; w: CalendarWorkout; pid: number; splitId: number; onClose: () => void }) {
  const [date, setDate] = useState(w.scheduledDate); const [shift, setShift] = useState(false);
  const [warning, setWarning] = useState('');
  const m = useReschedulePlannedWorkout(); const qc = useQueryClient();
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: getGetMesocycleCalendarQueryKey({ profileId: pid, splitId }) });
    void qc.invalidateQueries({ queryKey: getGetMesocycleQueryKey(splitId) });
    void qc.invalidateQueries({ queryKey: getGetOverviewQueryKey({ profileId: pid }) });
  };
  return <Modal title={`Reschedule ${w.dayName}`} close={() => { if (warning) refresh(); onClose(); }}>
    {warning ? <><div className="notice-warn" style={{ marginBottom: 14 }} data-testid="text-recovery-warning">{warning}</div><button className="btn btn-primary" style={{ width: '100%' }} onClick={() => { refresh(); onClose(); }}>Done</button></> : <>
      <p style={{ fontSize: 12, color: 'hsl(var(--muted-foreground))', marginTop: 0 }}>Stays within this week ({fmtDate(week.startDate)} to {fmtDate(week.endDate)}). The week and its RIR do not change.</p>
      <input className="field" type="date" min={week.startDate} max={week.endDate} value={date} onChange={(e) => setDate(e.target.value)} data-testid="input-reschedule-date"/>
      <label style={{ display: 'flex', gap: 9, alignItems: 'center', fontSize: 13, margin: '14px 0' }}><input type="checkbox" checked={shift} onChange={(e) => setShift(e.target.checked)}/> Move following workouts by the same amount</label>
      {m.isError && <ErrorNote message="Could not reschedule. Completed workouts cannot move, and dates must stay in the same week."/>}
      <button className="btn btn-primary" style={{ width: '100%' }} disabled={m.isPending || !date || date === w.scheduledDate} data-testid="button-confirm-reschedule" onClick={() => m.mutate({ plannedWorkoutId: w.id, data: { scheduledDate: date, shiftFollowing: shift } }, { onSuccess: (r) => { if (r.recoveryWarning) setWarning(r.warningMessage ?? 'This is close to another session for the same muscles. You can still train, just consider recovery.'); else { refresh(); onClose(); } } })}>{m.isPending ? 'Moving…' : 'Move workout'}</button>
    </>}
  </Modal>;
}
