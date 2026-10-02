import { reconcileTotals, type WeightUnit } from '@/lib/units';

export function MuscleTotals({ totalKg, muscleTotals, unit }: { totalKg: number; muscleTotals: { muscleGroup: string; totalWeightLifted: number }[]; unit: WeightUnit }) {
  const { total, parts } = reconcileTotals(totalKg, muscleTotals.map((m) => ({ label: m.muscleGroup, kg: m.totalWeightLifted })), unit);
  return <div data-testid="table-muscle-totals">
    {parts.map((p) => <div key={p.label} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderTop: '1px solid hsl(var(--border))', fontSize: 14 }}><span>{p.label}</span><span className="metric">{p.value.toLocaleString()} {unit}</span></div>)}
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0 0', borderTop: '2px solid hsl(var(--foreground) / .5)', fontWeight: 700 }}><span>TOTAL</span><span className="metric" data-testid="text-total-weight">{total.toLocaleString()} {unit}</span></div>
  </div>;
}
