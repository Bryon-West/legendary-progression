import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Play } from 'lucide-react';
import { Link } from 'wouter';
import {
  getGetMesocycleCalendarQueryKey, getGetMesocycleQueryKey, getGetOverviewQueryKey, getListSplitsQueryKey,
  useGetMesocycle, useGetMesocycleCalendar, useListSplits, useReschedulePlannedWorkout,
} from '@workspace/api-client-react';
import type { CalendarWeek, CalendarWorkout } from '@workspace/api-client-react';
import { useActiveProfile } from '@/lib/profile';
import { fmtDate, localToday, parseDate } from '@/lib/dates';
import { weekLabel } from '@/lib/labels';
import { Modal } from '@/components/modal';
import { StartSessionModal } from '@/components/start-session-modal';
import { Empty, ErrorNote, QueryError } from '@/components/ui-bits';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const dow = (date: string) => (parseDate(date).getDay() + 6) % 7;

export default function CalendarPage() {
  const { profile } = useActiveProfile(); const pid = profile?.id ?? 0;
  const splits = useListSplits({ profileId: pid }, { query: { enabled: !!pid, queryKey: getListSplitsQueryKey({ profileId: pid }) } });
  const wanted = Number(new URLSearchParams(window.location.search).get('split')) || 0;
  const [picked, setPicked] = useState(wanted);
  const splitId = picked || splits.data?.[0]?.id || 0;
  const cal = useGetMesocycleCalendar({ profileId: pid, splitId }, { query: { enabled: !!pid && !!splitId, queryKey: getGetMesocycleCalendarQueryKey({ profileId: pid, splitId }) } });
  const meso = useGetMesocycle(splitId, { query: { enabled: !!splitId, queryKey: getGetMesocycleQueryKey(splitId) } });
  const [resched, setResched] = useState<{ week: CalendarWeek; w: CalendarWorkout } | null>(null);
  const [start, setStart] = useState<CalendarWorkout | null>(null);
  const today = localToday();
  const dayIdFor = (w: CalendarWorkout) => meso.data?.weeks.flatMap((x) => x.scheduledWorkouts).find((p) => p.id === w.id)?.splitDayId ?? null;
  const weeks = cal.data ?? [];
  return <main className="page-wrap enter"><div className="eyebrow">Whole mesocycle</div>
    <h1 className="display" style={{ fontSize: 48, margin: '8px 0 14px' }}>Calendar.</h1>
    {splits.isError && <QueryError retry={() => void splits.refetch()}/>}
    {splits.data && splits.data.length > 1 && <select className="field" style={{ marginBottom: 14 }} aria-label="Mesocycle" data-testid="select-calendar-split" value={splitId} onChange={(e) => setPicked(Number(e.target.value))}>{splits.data.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>}
    {splits.data && !splits.data.length && <Empty title="No mesocycle to schedule" detail="Create a mesocycle and its weeks appear here." action={<Link href="/splits/new" className="btn btn-primary" style={{ textDecoration: 'none' }}>New mesocycle</Link>}/>}
    {cal.isLoading && <div className="skeleton" style={{ height: 220 }}/>}
    {cal.isError && <QueryError retry={() => void cal.refetch()}/>}
    {weeks.length > 0 && <div style={{ overflowX: 'auto', border: '1px solid hsl(var(--border))', borderRadius: 16, maxWidth: '100%' }} data-testid="calendar-matrix">
      <div style={{ display: 'grid', gridTemplateColumns: `64px repeat(${weeks.length}, minmax(132px, 1fr))`, minWidth: 64 + weeks.length * 132 }}>
        <div style={{ position: 'sticky', left: 0, zIndex: 3, background: 'hsl(var(--card))', borderBottom: '1px solid hsl(var(--border))' }}/>
        {weeks.map((week) => <div key={week.weekId} data-testid={`calendar-week-${week.weekIndex}`} style={{ padding: '10px 10px', borderBottom: '1px solid hsl(var(--border))', borderLeft: '1px solid hsl(var(--border))', background: week.kind === 'loading' ? undefined : 'hsl(var(--secondary))' }}>
          <div style={{ fontWeight: 800, fontSize: 12 }}>{weekLabel(week.kind, week.weekIndex, week.targetRir)}</div>
          <div style={{ fontSize: 10, color: 'hsl(var(--muted-foreground))' }}>{fmtDate(week.startDate, { month: 'short', day: 'numeric' })} to {fmtDate(week.endDate, { month: 'short', day: 'numeric' })}</div>
        </div>)}
        {DAYS.map((label, d) => <div key={label} style={{ display: 'contents' }}>
          <div style={{ position: 'sticky', left: 0, zIndex: 2, background: 'hsl(var(--card))', padding: '12px 10px', fontSize: 11, fontWeight: 800, letterSpacing: '.06em', borderBottom: '1px solid hsl(var(--border))' }} data-testid={`label-weekday-${label}`}>{label.toUpperCase()}</div>
          {weeks.map((week) => {
            const items = week.scheduledWorkouts.filter((w) => w.status !== 'cancelled' && dow(w.scheduledDate) === d);
            return <div key={week.weekId} style={{ padding: 6, minHeight: 64, borderLeft: '1px solid hsl(var(--border))', borderBottom: '1px solid hsl(var(--border))', display: 'grid', gap: 5, alignContent: 'start' }}>
              {items.map((w) => {
                const done = w.status === 'completed' && w.sessionId != null; const isToday = w.scheduledDate === today || w.isToday;
                const missed = !done && w.scheduledDate < today;
                return <div key={w.id} style={{ borderRadius: 10, border: `1px solid ${isToday ? 'hsl(var(--primary))' : 'hsl(var(--border))'}`, background: done ? 'hsl(var(--primary) / .12)' : 'hsl(var(--background))', padding: 7 }} data-testid={`card-planned-${w.id}`}>
                  <Link href={done ? `/history/${w.sessionId}` : `/planned/${w.id}`} data-testid={done ? `link-history-${w.id}` : `link-planned-${w.id}`} style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}>
                    <div style={{ fontWeight: 800, fontSize: 12 }}>{w.dayName}</div>
                    <div style={{ fontSize: 10, color: 'hsl(var(--muted-foreground))', marginTop: 2 }}>{done ? 'Completed · log' : missed ? 'Not completed' : isToday ? 'Today' : fmtDate(w.scheduledDate, { month: 'short', day: 'numeric' })}</div>
                  </Link>
                  {!done && <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
                    {isToday && <button className="btn btn-primary btn-sm" style={{ flex: 1, minHeight: 28, fontSize: 11, padding: '0 6px' }} onClick={() => setStart(w)} data-testid={`button-start-${w.id}`}><Play size={11}/> {w.sessionId ? 'Resume' : 'Start'}</button>}
                    <button className="btn btn-ghost btn-sm" style={{ minHeight: 28, fontSize: 10, padding: '0 6px' }} onClick={() => setResched({ week, w })} data-testid={`button-reschedule-${w.id}`}>Move</button>
                  </div>}
                </div>;
              })}
            </div>;
          })}
        </div>)}
      </div>
    </div>}
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
