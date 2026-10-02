import { useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useLocation, useParams } from 'wouter';
import {
  getGetMesocycleCalendarQueryKey, getGetMesocycleQueryKey, getGetOverviewQueryKey, getListSplitsQueryKey,
  useGetMesocycle, useGetProfileEngineSettings, getGetProfileEngineSettingsQueryKey, useSaveMesocycle,
} from '@workspace/api-client-react';
import type { Mesocycle } from '@workspace/api-client-react';
import { useActiveProfile } from '@/lib/profile';
import { inputValue, type WeightUnit } from '@/lib/units';
import { MesocycleBuilder, nk, type Draft, type DraftDay, type DraftWeek } from '@/components/mesocycle-builder';
import { Loading, QueryError } from '@/components/ui-bits';

function toDraft(m: Mesocycle, unit: WeightUnit): Draft {
  const days: DraftDay[] = [...m.days].sort((a, b) => a.dayIndex - b.dayIndex).map((d) => ({
    key: nk(), id: d.id, name: d.name,
    exercises: [...d.exercises].sort((a, b) => a.orderIndex - b.orderIndex).map((x) => ({
      key: nk(), id: x.id, exerciseId: x.exerciseId, name: x.exercise.name, muscle: x.exercise.muscleGroup,
      sets: String(x.targetSets), minSets: String(x.minimumWorkingSets), maxSets: String(x.maximumWorkingSets),
      repsMin: String(x.targetRepsMin), repsMax: String(x.targetRepsMax), rir: String(x.targetRir), weight: inputValue(x.targetWeight, unit),
    })),
  }));
  const keyById = new Map(days.map((d) => [d.id, d.key]));
  const weeks: DraftWeek[] = [...m.weeks].sort((a, b) => a.weekIndex - b.weekIndex).map((w) => ({
    key: nk(), id: w.id, kind: w.kind, rir: String(w.targetRir), state: w.status,
    occ: w.scheduledWorkouts.filter((o) => o.status !== 'cancelled' && keyById.has(o.splitDayId)).map((o) => ({ id: o.id, dayKey: keyById.get(o.splitDayId) as string, date: o.scheduledDate })),
  }));
  return { name: m.name, startDate: m.startDate, days, weeks };
}

export default function MesocycleEditorPage() {
  const { splitId } = useParams<{ splitId: string }>(); const id = Number(splitId);
  const { profile, unit } = useActiveProfile(); const pid = profile?.id ?? 0;
  const query = useGetMesocycle(id, { query: { enabled: !!id, queryKey: getGetMesocycleQueryKey(id) } });
  const settings = useGetProfileEngineSettings(pid, { query: { enabled: !!pid, queryKey: getGetProfileEngineSettingsQueryKey(pid) } });
  const save = useSaveMesocycle(); const qc = useQueryClient(); const [, navigate] = useLocation();
  // Built once per loaded record; the builder owns unsaved edits so refetches never clobber them.
  const initial = useMemo(() => (query.data ? toDraft(query.data, unit) : null), [query.data?.id, unit]); // eslint-disable-line react-hooks/exhaustive-deps
  if (query.isLoading || (query.data && !initial)) return <Loading/>;
  if (query.isError || !query.data || !initial) return <main className="page-wrap"><QueryError retry={() => void query.refetch()}/></main>;
  return <MesocycleBuilder key={`${query.data.id}-${unit}`} initial={initial} mode="edit" splitId={id} profileId={pid} unit={unit} deloadRir={settings.data?.deloadRir ?? 4}
    saving={save.isPending} saveError={save.isError}
    banner={query.data.sourceDescription ? <div className="badge" style={{ margin: '10px 0' }} data-testid="text-source-trace">{query.data.sourceDescription}</div> : undefined}
    onCancel={() => navigate('/splits')}
    onSave={(input) => save.mutate({ splitId: id, data: input }, { onSuccess: () => {
      void qc.invalidateQueries({ queryKey: getGetMesocycleQueryKey(id) });
      void qc.invalidateQueries({ queryKey: getGetMesocycleCalendarQueryKey({ profileId: pid, splitId: id }) });
      void qc.invalidateQueries({ queryKey: getListSplitsQueryKey({ profileId: pid }) });
      void qc.invalidateQueries({ queryKey: getGetOverviewQueryKey({ profileId: pid }) });
      void qc.invalidateQueries({ queryKey: ['/api/splits', id] });
      navigate('/splits');
    } })}/>;
}
