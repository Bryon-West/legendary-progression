import { ArrowRight, CalendarDays, Plus } from 'lucide-react';
import { Link } from 'wouter';
import { getListSplitsQueryKey, useListSplits } from '@workspace/api-client-react';
import { useActiveProfile } from '@/lib/profile';
import { Empty, QueryError } from '@/components/ui-bits';
import { fmtDate } from '@/lib/dates';

export default function MesocyclesPage() {
  const { profile } = useActiveProfile(); const pid = profile?.id ?? 0;
  const list = useListSplits({ profileId: pid }, { query: { enabled: !!profile, queryKey: getListSplitsQueryKey({ profileId: pid }) } });
  return <main className="page-wrap enter"><div className="eyebrow">Programming</div>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'end', margin: '8px 0 19px' }}><h1 className="display" style={{ fontSize: 48, margin: 0 }}>Mesocycles.</h1>
      <Link href="/splits/new" className="btn btn-primary" style={{ textDecoration: 'none', minHeight: 43, padding: '0 14px' }} data-testid="link-new-mesocycle"><Plus size={17}/> New</Link></div>
    {list.isLoading ? <div className="skeleton" style={{ height: 110 }}/> : list.isError ? <QueryError retry={() => void list.refetch()}/> : list.data?.length ? <div style={{ display: 'grid', gap: 10, marginBottom: 20 }}>{list.data.map((split) => <article key={split.id} className="panel" style={{ padding: 17 }}>
      <Link href={`/splits/${split.id}`} data-testid={`link-mesocycle-${split.id}`} style={{ textDecoration: 'none', color: 'inherit', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><div><div className="eyebrow">{split.days.length} training days · week {split.currentWeek} of {split.cycleLengthWeeks}</div><h2 style={{ margin: '5px 0 0', fontSize: 18 }}>{split.name}</h2><div style={{ fontSize: 11, color: 'hsl(var(--muted-foreground))', marginTop: 4 }}>Started {fmtDate(split.startDate, { month: 'short', day: 'numeric', year: 'numeric' })}</div></div><ArrowRight size={18} color="hsl(var(--primary))"/></Link>
      <Link href={`/calendar?split=${split.id}`} className="btn btn-secondary btn-sm" style={{ textDecoration: 'none', marginTop: 12 }} data-testid={`link-calendar-${split.id}`}><CalendarDays size={14}/> Calendar</Link>
    </article>)}</div> : <Empty title="Build your first mesocycle" detail="Start from an original template, copy a finished block, or build your own." action={<Link href="/splits/new" className="btn btn-primary" style={{ textDecoration: 'none' }}><Plus size={16}/> New mesocycle</Link>}/>}
  </main>;
}
