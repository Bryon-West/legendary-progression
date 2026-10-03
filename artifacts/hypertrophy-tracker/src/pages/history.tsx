import { useParams } from 'wouter';
import { getGetWorkoutQueryKey, getListWorkoutsQueryKey, useGetWorkout, useListWorkouts } from '@workspace/api-client-react';
import { useActiveProfile } from '@/lib/profile';
import { Empty, Loading, QueryError } from '@/components/ui-bits';
import { WorkoutSummaryCard } from '@/components/workout-summary-card';
import { CompletedWorkout } from '@/components/completed-workout';
import { Link } from 'wouter';

export function HistoryPage() {
  const { profile, unit } = useActiveProfile();
  const list = useListWorkouts({ profileId: profile?.id ?? 0 }, { query: { enabled: !!profile, queryKey: getListWorkoutsQueryKey({ profileId: profile?.id ?? 0 }) } });
  if (list.isLoading) return <Loading/>;
   return <main className="page-wrap enter"><div className="eyebrow">Your training record</div><h1 className="display" style={{ fontSize: 48, margin: '8px 0 16px' }}>The log.</h1>
     <div style={{ display: 'flex', gap: 8, borderBottom: '1px solid hsl(var(--border))', marginBottom: 16 }}>
       <Link href="/history" className="log-tab active" data-testid="link-log-history">HISTORY</Link>
       <Link href="/history/prs" className="log-tab" data-testid="link-log-prs">PRs</Link>
     </div>
     {list.isError ? <QueryError retry={() => void list.refetch()}/> : list.data?.length ? <div style={{ display: 'grid', gap: 10 }}>{list.data.map((w) => <WorkoutSummaryCard key={w.id} item={w} unit={unit}/>)}</div> : <Empty title="Nothing logged yet" detail="Completed workouts will live here, with the sets and total weight lifted behind them."/>}</main>;
}
export function HistoryDetailPage() {
  const { sessionId } = useParams<{ sessionId: string }>(); const id = Number(sessionId); const { unit } = useActiveProfile();
  const q = useGetWorkout(id, { query: { enabled: !!id, queryKey: getGetWorkoutQueryKey(id) } });
  if (q.isLoading) return <Loading/>;
  if (q.isError || !q.data) return <main className="page-wrap"><QueryError retry={() => void q.refetch()}/></main>;
  return <CompletedWorkout workout={q.data} unit={unit}/>;
}
