import { ArrowLeft } from 'lucide-react';
import { Link } from 'wouter';
import type { WorkoutSession } from '@workspace/api-client-react';
import { MuscleTotals } from '@/components/muscle-totals';
import { StatusIcon, statusClass, statusLabel, type TargetStatus } from '@/components/status';
import { READINESS, RECOVERY, labelOf, weekLabel } from '@/lib/labels';
import { fmtTotal, fmtWeight, type WeightUnit } from '@/lib/units';

export function SessionContext({ workout }: { workout: Pick<WorkoutSession, 'readiness' | 'mesocycleWeek' | 'muscleRecovery'> & Partial<Pick<WorkoutSession, 'weekKindSnapshot' | 'targetRirSnapshot' | 'recoveryMode'>> }) {
  const rec = workout.muscleRecovery ?? [];
  return <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 14 }} data-testid="session-context">
    {workout.mesocycleWeek != null && <span className="badge badge-red">{workout.weekKindSnapshot && workout.weekKindSnapshot !== 'loading' ? weekLabel(workout.weekKindSnapshot) : `Week ${workout.mesocycleWeek}${workout.targetRirSnapshot != null ? ` — ${workout.targetRirSnapshot} RIR` : ''}`}</span>}
    {workout.readiness && <span className="badge">Readiness: {labelOf(READINESS, String(workout.readiness))}</span>}
    {rec.map((m) => <span key={m.muscleGroup} className="badge">{m.muscleGroup}: {labelOf(RECOVERY, String(m.status))}</span>)}
  </div>;
}

export function CompletedWorkout({ workout, unit }: { workout: WorkoutSession; unit: WeightUnit }) {
  return <main className="page-wrap enter">
    <Link href="/history" className="btn btn-ghost" style={{ textDecoration: 'none', padding: 0 }}><ArrowLeft size={17}/> Training log</Link>
    <div className="eyebrow" style={{ marginTop: 20 }}>Completed session</div>
    <h1 className="display" style={{ fontSize: 44, margin: '8px 0 14px' }}>{workout.dayName || 'Workout'}</h1>
    <SessionContext workout={workout}/>
    <div className="panel" style={{ padding: 17, marginBottom: 14 }}>
      <div className="eyebrow">Total weight lifted</div>
      <div className="display metric" style={{ fontSize: 38, margin: '8px 0 12px' }} data-testid="text-session-total">{fmtTotal(workout.totalVolume, unit)}</div>
      {(workout.muscleTotals ?? []).length > 0 && <MuscleTotals totalKg={workout.totalVolume} muscleTotals={workout.muscleTotals ?? []} unit={unit}/>}
      <div style={{ fontSize: 11, color: 'hsl(var(--muted-foreground))', marginTop: 10 }}>Working sets only. Warm-ups, skipped and removed sets are excluded.</div>
    </div>
    {workout.exercises.map((exercise) => <section className="panel" key={exercise.id} style={{ padding: 16, marginBottom: 10, opacity: exercise.skipped ? .75 : 1 }}>
      <div className="eyebrow">{exercise.muscleGroup}</div>
      <h3 style={{ margin: '5px 0 8px' }}>{exercise.exerciseName}</h3>
      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 8 }}>
        {exercise.skipped && <span className="badge badge-warning">Skipped</span>}
        {exercise.superseded && <span className="badge">Replaced mid-session</span>}
        {exercise.painReported && <span className="badge badge-warning">Discomfort noted{exercise.painNote ? `: ${exercise.painNote}` : ''}</span>}
      </div>
      {exercise.sets.filter((s) => !s.removed).map((set) => {
        const st = (set.targetStatus ?? null) as TargetStatus | null;
        return <div key={set.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '7px 0', borderTop: '1px solid hsl(var(--border))', fontSize: 13 }}>
          <span>{set.setType === 'warmup' ? `Warm-up ${set.setNumber}` : `Set ${set.setNumber}`}</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><span className="metric">{fmtWeight(set.actualWeight, unit)} × {set.actualReps ?? '—'} · RIR {set.actualRir ?? '—'}</span>
            {set.setType === 'work' && set.completed && <span className={`status-btn ${statusClass(st)}`} style={{ width: 26, height: 26 }} title={statusLabel(st)} aria-label={statusLabel(st)}><StatusIcon status={st} size={14}/></span>}</span>
        </div>;
      })}
    </section>)}
  </main>;
}
