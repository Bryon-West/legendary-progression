import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useResetTrainingData } from '@workspace/api-client-react';
import { Modal } from '@/components/modal';
import { ErrorNote } from '@/components/ui-bits';
import { mutationError, refreshTrainingData } from '@/lib/training-cache';

export function ResetTrainingData({ profileId, profileName }: { profileId: number; profileName: string }) {
  const client = useQueryClient();
  const reset = useResetTrainingData();
  const [open, setOpen] = useState(false);
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState('');
  const close = () => { if (!reset.isPending) { setOpen(false); setConfirmation(''); setError(''); } };
  return <section className="panel" style={{ padding: 17, marginTop: 20 }}>
    <strong>Training data</strong>
    <p style={{ fontSize: 13, color: 'hsl(var(--muted-foreground))' }}>Reset workouts and progression for your account only. Your exercise library and settings stay.</p>
    <button className="btn btn-danger" onClick={() => { setError(''); setConfirmation(''); setOpen(true); }} data-testid="button-reset-training">RESET TRAINING DATA</button>
    {open && <Modal title="RESET ALL TRAINING DATA?" close={close}>
      <p>This permanently deletes your workout history, mesocycles, records and progression data. Your profile and exercise library will remain.</p>
      <p><strong>Selected profile: {profileName}</strong></p>
      <label htmlFor="reset-confirmation">Type RESET to confirm</label>
      <input id="reset-confirmation" className="field" autoComplete="off" value={confirmation} disabled={reset.isPending} onChange={event => setConfirmation(event.target.value)} data-testid="input-reset-confirmation"/>
      {error && <ErrorNote message={error}/>}
      <div style={{ display: 'flex', gap: 9, marginTop: 16 }}>
        <button className="btn btn-secondary" disabled={reset.isPending} onClick={close}>CANCEL</button>
        <button className="btn btn-danger" disabled={confirmation !== 'RESET' || reset.isPending} data-testid="button-confirm-reset-training"
          onClick={() => reset.mutate({ profileId, data: { confirmation: 'RESET' } }, {
            onSuccess: async () => { await refreshTrainingData(client, true); setOpen(false); setConfirmation(''); },
            onError: error => setError(mutationError(error)),
          })}>{reset.isPending ? 'Resetting…' : 'RESET TRAINING DATA'}</button>
      </div>
    </Modal>}
  </section>;
}