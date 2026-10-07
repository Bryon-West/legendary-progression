import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Play } from 'lucide-react';
import { Link } from 'wouter';
import {
  getGetMesocycleCalendarQueryKey, getGetMesocycleQueryKey, getGetOverviewQueryKey, getListSplitsQueryKey,
  getListWorkoutCalendarHistoryQueryKey, useGetMesocycle, useGetMesocycleCalendar,
  useListSplits, useListWorkoutCalendarHistory, useReschedulePlannedWorkout,
} from '@workspace/api-client-react';
import type { CalendarWeek, CalendarWorkout } from '@workspace/api-client-react';
import { useActiveProfile } from '@/lib/profile';
import { refreshTrainingData } from '@/lib/training-cache';
import { fmtDate, localToday, parseDate } from '@/lib/dates';
import { buildCalendarEventsByDate, getCalendarMonth, shiftCalendarMonth, shouldShowPlannedSchedule } from '@/lib/calendar-model';
import { Modal } from '@/components/modal';
import { StartSessionModal } from '@/components/start-session-modal';
import { ErrorNote, QueryError } from '@/components/ui-bits';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export default function CalendarPage() {
  const { profile } = useActiveProfile(); const pid = profile?.id ?? 0;
  const splits = useListSplits({ profileId: pid }, { query: { enabled: !!pid, queryKey: getListSplitsQueryKey({ profileId: pid }) } });
  const wanted = Number(new URLSearchParams(window.location.search).get('split')) || 0;
  const [picked, setPicked] = useState(wanted);
  const today = localToday();
  const [visibleMonth, setVisibleMonth] = useState(() => today.slice(0, 7));
  const [selectedDate, setSelectedDate] = useState(today);
  const available = splits.data ?? [];
  const defaultSplit = available.find(s => s.lifecycleStatus === 'active')
    ?? available.filter(s => s.lifecycleStatus === 'planned').at(-1)
    ?? available.at(-1);
  const splitId = available.find(s => s.id === picked)?.id ?? defaultSplit?.id ?? 0;
  const month = getCalendarMonth(visibleMonth);
  const calendarParams = { profileId: pid, splitId, from: month.startDate, to: month.endDate };
  const cal = useGetMesocycleCalendar(calendarParams, { query: { enabled: !!pid && !!splitId, queryKey: getGetMesocycleCalendarQueryKey(calendarParams) } });
  const meso = useGetMesocycle(splitId, { query: { enabled: !!splitId, queryKey: getGetMesocycleQueryKey(splitId) } });
  const history = useListWorkoutCalendarHistory(
    { profileId: pid },
    { query: { enabled: !!pid, queryKey: getListWorkoutCalendarHistoryQueryKey({ profileId: pid }) } },
  );
  const [resched, setResched] = useState<{ week: CalendarWeek; w: CalendarWorkout } | null>(null);
  const [start, setStart] = useState<CalendarWorkout | null>(null);
  const dayIdFor = (w: CalendarWorkout) => meso.data?.weeks.flatMap((x) => x.scheduledWorkouts).find((p) => p.id === w.id)?.splitDayId ?? null;
  const weeks = cal.data ?? [];
  const paused = meso.data?.lifecycleStatus === 'paused';
  const eventsByDate = useMemo(
    () => buildCalendarEventsByDate(history.data ?? [], shouldShowPlannedSchedule(meso.data?.lifecycleStatus) ? weeks : []),
    [history.data, meso.data?.lifecycleStatus, weeks],
  );
  const selectedEvents = eventsByDate.get(selectedDate) ?? [];
  const hasActiveMesocycle = available.some((split) => split.lifecycleStatus === 'active');
  const monthLabel = parseDate(`${visibleMonth}-01`).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const selectDate = (date: string) => {
    setVisibleMonth(date.slice(0, 7));
    setSelectedDate(date);
  };
  const changeMonth = (offset: number) => {
    const nextMonth = shiftCalendarMonth(visibleMonth, offset);
    setVisibleMonth(nextMonth);
    setSelectedDate(`${nextMonth}-01`);
  };
  return <main className="page-wrap enter"><div className="eyebrow">Whole mesocycle</div>
    <h1 className="display" style={{ fontSize: 48, margin: '8px 0 10px' }}>Calendar.</h1>
    {!splits.isLoading && splits.data && !hasActiveMesocycle && <p style={{ margin: '0 0 14px', fontSize: 12, color: 'hsl(var(--muted-foreground))' }} data-testid="calendar-no-active-mesocycle">No active mesocycle. Completed training remains on this calendar.</p>}
    {meso.data?.lifecycleStatus === 'paused' && <p className="notice-warn" data-testid="status-calendar-paused">Paused — your schedule and history are preserved. Resume from Plans to continue.</p>}
    {splits.isError && <QueryError retry={() => void splits.refetch()}/>}
    {splits.data && splits.data.length > 1 && <select className="field" style={{ marginBottom: 14 }} aria-label="Mesocycle" data-testid="select-calendar-split" value={splitId} onChange={(e) => setPicked(Number(e.target.value))}>{splits.data.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>}
    {history.isError && <QueryError retry={() => void history.refetch()}/>}
    {cal.isError && splitId > 0 && <QueryError retry={() => void cal.refetch()}/>}
    <section aria-label="Training calendar" data-testid="calendar-month-view">
      <div className="calendar-month-controls">
        <button type="button" className="btn btn-ghost btn-sm" aria-label="Previous month" data-testid="calendar-prev-month" onClick={() => changeMonth(-1)}><ChevronLeft size={18}/></button>
        <div className="calendar-month-title display" data-testid="calendar-month-title">{monthLabel}</div>
        <button type="button" className="btn btn-ghost btn-sm" aria-label="Next month" data-testid="calendar-next-month" onClick={() => changeMonth(1)}><ChevronRight size={18}/></button>
      </div>
      {visibleMonth !== today.slice(0, 7) && <button type="button" className="btn btn-ghost btn-sm" style={{ width: '100%', marginBottom: 8 }} data-testid="calendar-today" onClick={() => { setVisibleMonth(today.slice(0, 7)); setSelectedDate(today); }}>Go to today</button>}
      {cal.isLoading && splitId > 0 && <p style={{ margin: '0 0 8px', fontSize: 11, color: 'hsl(var(--muted-foreground))' }}>Loading planned workouts…</p>}
      {history.isLoading && <p style={{ margin: '0 0 8px', fontSize: 11, color: 'hsl(var(--muted-foreground))' }}>Loading completed history…</p>}
      <div className="calendar-month-grid" data-testid="calendar-month-grid">
        {DAYS.map((day) => <div key={day} className="calendar-weekday" aria-hidden="true">{day}</div>)}
        {Array.from({ length: month.leadingBlankDays }, (_, index) => <div key={`blank-${index}`} aria-hidden="true" className="calendar-day-spacer"/>)}
        {month.days.map((date) => {
          const events = eventsByDate.get(date) ?? [];
          const completedCount = events.filter((event) => event.kind === 'completed').length;
          const plannedCount = events.filter((event) => event.kind === 'planned').length;
          const dateLabel = fmtDate(date, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
          const eventLabel = [
            completedCount ? `${completedCount} completed ${completedCount === 1 ? 'workout' : 'workouts'}` : '',
            plannedCount ? `${plannedCount} planned ${plannedCount === 1 ? 'workout' : 'workouts'}` : '',
          ].filter(Boolean).join(', ');
          return <button
            key={date}
            type="button"
            className={`calendar-date${selectedDate === date ? ' is-selected' : ''}${today === date ? ' is-today' : ''}`}
            aria-label={`${dateLabel}${eventLabel ? `, ${eventLabel}` : ', no workouts'}`}
            aria-pressed={selectedDate === date}
            aria-current={today === date ? 'date' : undefined}
            data-testid={`calendar-date-${date}`}
            data-has-events={events.length > 0}
            onClick={() => selectDate(date)}
          >
            <span className="calendar-date-number">{parseDate(date).getDate()}</span>
            <span className="calendar-date-markers" aria-hidden="true">
              {completedCount > 0 && <span className="calendar-date-marker is-completed"/>}
              {plannedCount > 0 && <span className="calendar-date-marker is-planned"/>}
            </span>
          </button>;
        })}
      </div>
      <section className="calendar-selected-day panel" aria-live="polite" data-testid="calendar-selected-day">
        <h2 className="display">{fmtDate(selectedDate, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</h2>
        {!selectedEvents.length && <p className="calendar-no-events">No completed or planned workouts on this date.</p>}
        <div className="calendar-event-list">
          {selectedEvents.map((event) => event.kind === 'completed'
            ? <Link key={`session-${event.session.id}`} href={`/history/${event.session.id}`} className="calendar-event is-completed" data-testid={`calendar-session-${event.session.id}`}>
                <span className="calendar-event-title">{event.session.dayName || 'Training session'}</span>
                <span className="calendar-event-detail">Completed · logged workout</span>
              </Link>
            : <article key={`planned-${event.workout.id}`} className="calendar-event is-planned" data-testid={`calendar-planned-${event.workout.id}`}>
                <Link href={`/planned/${event.workout.id}`} className="calendar-event-link">
                  <span className="calendar-event-title">{event.workout.dayName}</span>
                  <span className="calendar-event-detail">{paused ? 'Paused' : event.workout.scheduledDate < today ? 'Not completed' : event.workout.scheduledDate === today ? 'Today · planned workout' : `Planned · ${fmtDate(event.workout.scheduledDate, { month: 'short', day: 'numeric' })}`}</span>
                </Link>
                <div className="calendar-event-actions">
                  {event.workout.scheduledDate === today && (!paused || event.workout.sessionId) && <button className="btn btn-primary btn-sm" onClick={() => setStart(event.workout)} data-testid={`button-start-${event.workout.id}`}><Play size={12}/> {event.workout.sessionId ? 'Resume' : 'Start'}</button>}
                  <button className="btn btn-ghost btn-sm" onClick={() => setResched({ week: event.week, w: event.workout })} data-testid={`button-reschedule-${event.workout.id}`}>Move</button>
                </div>
              </article>)}
        </div>
      </section>
    </section>
    {resched && <RescheduleModal week={resched.week} w={resched.w} pid={pid} splitId={splitId} basic={profile?.trainingMode === "basic"} onClose={() => setResched(null)}/>}
    {start && profile && <StartSessionModal profileId={profile.id} trainingMode={profile.trainingMode} splitDayId={dayIdFor(start)} scheduledWorkoutId={start.id} muscles={[...new Set(meso.data?.days.find(d => d.id === dayIdFor(start))?.exercises.map(e => e.exercise.muscleGroup) ?? [])]} onClose={() => setStart(null)}/>}
  </main>;
}

function RescheduleModal({ week, w, pid, splitId, basic, onClose }: { week: CalendarWeek; w: CalendarWorkout; pid: number; splitId: number; basic: boolean; onClose: () => void }) {
  const [date, setDate] = useState(w.scheduledDate); const [shift, setShift] = useState(false);
  const [warning, setWarning] = useState('');
  const m = useReschedulePlannedWorkout(); const qc = useQueryClient();
  const refresh = () => {
    void refreshTrainingData(qc);
    void qc.invalidateQueries({ queryKey: getGetMesocycleCalendarQueryKey({ profileId: pid, splitId }) });
    void qc.invalidateQueries({ queryKey: getGetMesocycleQueryKey(splitId) });
    void qc.invalidateQueries({ queryKey: getGetOverviewQueryKey({ profileId: pid }) });
  };
  return <Modal title={`Reschedule ${w.dayName}`} close={() => { if (warning) refresh(); onClose(); }}>
    {warning ? <><div className="notice-warn" style={{ marginBottom: 14 }} data-testid="text-recovery-warning">{warning}</div><button className="btn btn-primary" style={{ width: '100%' }} onClick={() => { refresh(); onClose(); }}>Done</button></> : <>
      <p style={{ fontSize: 12, color: 'hsl(var(--muted-foreground))', marginTop: 0 }}>Stays within this week ({fmtDate(week.startDate)} to {fmtDate(week.endDate)}). {!basic && "The week and its RIR do not change."}</p>
      <input className="field" type="date" min={week.startDate} max={week.endDate} value={date} onChange={(e) => setDate(e.target.value)} data-testid="input-reschedule-date"/>
      <label style={{ display: 'flex', gap: 9, alignItems: 'center', fontSize: 13, margin: '14px 0' }}><input type="checkbox" checked={shift} onChange={(e) => setShift(e.target.checked)}/> Move following workouts by the same amount</label>
      {m.isError && <ErrorNote message="Could not reschedule. Completed workouts cannot move, and dates must stay in the same week."/>}
      <button className="btn btn-primary" style={{ width: '100%' }} disabled={m.isPending || !date || date === w.scheduledDate} data-testid="button-confirm-reschedule" onClick={() => m.mutate({ plannedWorkoutId: w.id, data: { scheduledDate: date, shiftFollowing: shift } }, { onSuccess: (r) => { if (r.recoveryWarning && !basic) setWarning(r.warningMessage ?? 'This is close to another session for the same muscles. You can still train, just consider recovery.'); else { refresh(); onClose(); } } })}>{m.isPending ? 'Moving…' : 'Move workout'}</button>
    </>}
  </Modal>;
}
