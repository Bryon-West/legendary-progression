import { Link } from 'wouter';
import type { WorkoutSummary } from '@workspace/api-client-react';
import { READINESS, labelOf } from '@/lib/labels';
import { fmtTotal, type WeightUnit } from '@/lib/units';

export function WorkoutSummaryCard({ item, unit }: { item: WorkoutSummary; unit: WeightUnit }) {
  return <Link href={`/history/${item.id}`} data-testid={`link-session-${item.id}`} style={{ textDecoration: 'none', color: 'inherit' }}><article className="panel" style={{ padding: 15, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
    <div><div style={{ fontWeight: 700 }}>{item.dayName || item.splitName || 'Training session'}</div>
      <div style={{ color: 'hsl(var(--muted-foreground))', fontSize: 12, marginTop: 4 }}>{new Date(item.startedAt).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })} · {item.workingSetCount} sets</div>
      <div style={{ display: 'flex', gap: 5, marginTop: 7, flexWrap: 'wrap' }}>{item.mesocycleWeek != null && <span className="badge badge-red">Week {item.mesocycleWeek}</span>}{item.readiness && <span className="badge">Ready: {labelOf(READINESS, String(item.readiness))}</span>}</div></div>
    <div style={{ textAlign: 'right' }}><div className="metric" style={{ fontWeight: 700 }}>{fmtTotal(item.totalVolume, unit)}</div><div style={{ color: 'hsl(var(--muted-foreground))', fontSize: 10, marginTop: 4 }}>total weight lifted</div></div>
  </article></Link>;
}
