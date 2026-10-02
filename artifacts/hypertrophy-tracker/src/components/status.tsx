import { ArrowDown, ArrowUp, Check, Minus } from 'lucide-react';
import { STATUS_META } from '@/lib/labels';

export type TargetStatus = 'target_met' | 'above_target' | 'below_target';
export function StatusIcon({ status, size = 17 }: { status: TargetStatus | null | undefined; size?: number }) {
  if (status === 'target_met') return <Check size={size} strokeWidth={3}/>;
  if (status === 'above_target') return <ArrowUp size={size} strokeWidth={3}/>;
  if (status === 'below_target') return <ArrowDown size={size} strokeWidth={3}/>;
  return <Minus size={size}/>;
}
export const statusClass = (s: TargetStatus | null | undefined) => (s ? STATUS_META[s].cls : 'status-none');
export const statusLabel = (s: TargetStatus | null | undefined) => (s ? STATUS_META[s].label : 'Not rated');
