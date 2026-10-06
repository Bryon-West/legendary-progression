import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowRight } from 'lucide-react';
import { getGetActiveWorkoutQueryKey, getGetOverviewQueryKey, useStartWorkout } from '@workspace/api-client-react';
import { useLocation } from 'wouter';
import { Modal } from '@/components/modal';
import { ErrorNote } from '@/components/ui-bits';
import { READINESS, RECOVERY, type Readiness, type RecoveryStatus } from '@/lib/labels';

export function StartSessionModal({ profileId, trainingMode, splitDayId, scheduledWorkoutId, muscles, onClose }: { profileId: number; trainingMode: "basic" | "legendary_pro"; splitDayId: number | null; scheduledWorkoutId?: number; muscles: string[]; onClose: () => void }) {
  const [readiness, setReadiness] = useState<Readiness>('normal');
  const [recovery, setRecovery] = useState<Record<string, RecoveryStatus>>({});
  const start = useStartWorkout();
  const qc = useQueryClient();
  const [, navigate] = useLocation();
  const go = () => {
    const muscleRecovery = trainingMode === "legendary_pro" ? muscles.filter((m) => recovery[m]).map((m) => ({ muscleGroup: m, status: recovery[m] })) : [];
    start.mutate({ data: { profileId, splitDayId, ...(scheduledWorkoutId ? { scheduledWorkoutId } : {}), ...(trainingMode === "legendary_pro" ? { readiness, ...(muscleRecovery.length ? { muscleRecovery } : {}) } : {}) } }, {
      onSuccess: (w) => {
        void qc.invalidateQueries({ queryKey: getGetActiveWorkoutQueryKey({ profileId }) });
        void qc.invalidateQueries({ queryKey: getGetOverviewQueryKey({ profileId }) });
        onClose();
        navigate(`/workout/${w.id}`);
      },
    });
  };
  if (trainingMode === "basic") return <Modal title="Start a Basic workout" close={onClose}>
    <p style={{ color: "hsl(var(--muted-foreground))", lineHeight: 1.55, marginTop: 0 }}>Log the weight and reps you perform. Your training history and personal records stay with you.</p>
    <button className="btn btn-primary" style={{ width: "100%", marginTop: 12 }} disabled={start.isPending} onClick={go} data-testid="button-confirm-start">{start.isPending ? "Starting…" : "Start workout"}<ArrowRight size={18}/></button>
    {start.isError && <ErrorNote message="Could not start this session. Try again."/>}
  </Modal>;

  return <Modal title="How ready do you feel?" close={onClose}>
    <div className="seg" style={{ gridTemplateColumns: '1fr 1fr' }} role="group" aria-label="Readiness to train today">
      {READINESS.map((r) => <button key={r.value} type="button" aria-pressed={readiness === r.value} onClick={() => setReadiness(r.value)} data-testid={`button-readiness-${r.value}`}>{r.label}</button>)}
    </div>
    {muscles.length > 0 && <div style={{ marginTop: 18 }}>
      <div className="eyebrow" style={{ marginBottom: 8 }}>Optional: muscle recovery</div>
      {muscles.map((m) => <label key={m} style={{ display: 'grid', gap: 6, fontSize: 13, marginBottom: 10 }}>How recovered does your {m.toLowerCase()} feel from its last session?
        <select className="field" value={recovery[m] ?? ''} onChange={(e) => { const v = e.target.value as RecoveryStatus | ''; setRecovery((cur) => { const n = { ...cur }; if (v) n[m] = v; else delete n[m]; return n; }); }} data-testid={`select-recovery-${m}`}>
          <option value="">Skip</option>
          {RECOVERY.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
        </select></label>)}
    </div>}
    <button className="btn btn-primary" style={{ width: '100%', marginTop: 14 }} disabled={start.isPending} onClick={go} data-testid="button-confirm-start">{start.isPending ? 'Starting…' : 'Start workout'}<ArrowRight size={18}/></button>
    {start.isError && <ErrorNote message="Could not start this session. Try again."/>}
  </Modal>;
}
