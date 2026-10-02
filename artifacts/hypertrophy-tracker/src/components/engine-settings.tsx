import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getGetProfileEngineSettingsQueryKey, useGetProfileEngineSettings, useUpdateProfileEngineSettings } from '@workspace/api-client-react';
import type { ProfileEngineSettings } from '@workspace/api-client-react';
import { ErrorNote, FieldLabel, QueryError } from '@/components/ui-bits';

const DEFAULTS = { baselineExpiryWeeks: '6', loadIncrementLb: '2.5', loadIncrementKg: '2.5', deloadSetFraction: '50', deloadLoadFraction: '90', deloadRir: '4' };
const toForm = (s: ProfileEngineSettings) => ({ baselineExpiryWeeks: String(s.baselineExpiryWeeks), loadIncrementLb: String(s.loadIncrementLb), loadIncrementKg: String(s.loadIncrementKg), deloadSetFraction: String(+(s.deloadSetFraction * 100).toFixed(2)), deloadLoadFraction: String(+(s.deloadLoadFraction * 100).toFixed(2)), deloadRir: String(s.deloadRir) });

function Form({ profileId, initial }: { profileId: number; initial: ProfileEngineSettings }) {
  const [f, setF] = useState(toForm(initial)); const [saved, setSaved] = useState(false); const [err, setErr] = useState('');
  const m = useUpdateProfileEngineSettings(); const qc = useQueryClient();
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => { setSaved(false); setF({ ...f, [k]: e.target.value }); };
  const submit = () => {
    const n = (k: keyof typeof f) => (f[k].trim() === '' ? NaN : Number(f[k]));
    const weeks = n('baselineExpiryWeeks'), lb = n('loadIncrementLb'), kg = n('loadIncrementKg'), sf = n('deloadSetFraction'), lf = n('deloadLoadFraction'), rir = n('deloadRir');
    if (!Number.isInteger(weeks) || weeks < 1 || weeks > 104) return setErr('Baseline expiry must be a whole number of weeks from 1 to 104.');
    if (!(lb > 0) || !(kg > 0)) return setErr('Load increments must be greater than 0.');
    if (!(sf > 0 && sf <= 100) || !(lf > 0 && lf <= 100)) return setErr('Deload fractions must be above 0% and at most 100%.');
    if (!Number.isInteger(rir) || rir < 0 || rir > 10) return setErr('Deload RIR must be a whole number from 0 to 10.');
    setErr('');
    m.mutate({ profileId, data: { baselineExpiryWeeks: weeks, loadIncrementLb: lb, loadIncrementKg: kg, deloadSetFraction: sf / 100, deloadLoadFraction: lf / 100, deloadRir: rir } }, { onSuccess: (s) => { qc.setQueryData(getGetProfileEngineSettingsQueryKey(profileId), s); setSaved(true); } });
  };
  const fld = (label: string, k: keyof typeof f, step = '1') => <FieldLabel label={label}><input className="field" type="number" step={step} inputMode="decimal" value={f[k]} onChange={set(k)}/></FieldLabel>;
  return <section className="panel" style={{ padding: 17, marginBottom: 18 }} data-testid="section-engine-settings">
    <div className="eyebrow">Progression engine</div>
    <p style={{ fontSize: 12, color: 'hsl(var(--muted-foreground))', lineHeight: 1.5 }}>Used for this profile only. Baselines older than the expiry window return to calibration.</p>
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
      {fld('BASELINE EXPIRY (WEEKS)', 'baselineExpiryWeeks')}{fld('DELOAD RIR', 'deloadRir')}
      {fld('INCREMENT (LB)', 'loadIncrementLb', 'any')}{fld('INCREMENT (KG)', 'loadIncrementKg', 'any')}
      {fld('DELOAD SETS (% OF NORMAL)', 'deloadSetFraction', 'any')}{fld('DELOAD LOAD (% OF NORMAL)', 'deloadLoadFraction', 'any')}
    </div>
    {err && <div role="alert" className="notice-warn" style={{ marginTop: 10 }}>{err}</div>}
    {m.isError && <ErrorNote message="Could not save engine settings."/>}
    {saved && <div className="notice-ok" style={{ marginTop: 10 }}>Settings saved.</div>}
    <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
      <button className="btn btn-secondary btn-sm" onClick={() => { setF(DEFAULTS); setSaved(false); }} data-testid="button-engine-defaults">Reset to defaults</button>
      <button className="btn btn-primary btn-sm" style={{ flex: 1 }} disabled={m.isPending} onClick={submit} data-testid="button-save-engine">{m.isPending ? 'Saving…' : 'Save settings'}</button>
    </div>
  </section>;
}

export function EngineSettings({ profileId }: { profileId: number }) {
  const q = useGetProfileEngineSettings(profileId, { query: { queryKey: getGetProfileEngineSettingsQueryKey(profileId) } });
  if (q.isLoading) return <div className="skeleton" style={{ height: 160, marginBottom: 18 }}/>;
  if (q.isError || !q.data) return <QueryError retry={() => void q.refetch()}/>;
  return <Form key={`${profileId}-${q.dataUpdatedAt}`} profileId={profileId} initial={q.data}/>;
}
