import { useEffect } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Link, Route, Switch } from 'wouter';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Shell } from '@/components/shell';
import { ProfileProvider } from '@/lib/profile';
import HomePage from '@/pages/home';
import WorkoutPage from '@/pages/workout';
import { HistoryPage, HistoryDetailPage } from '@/pages/history';
import ExercisesPage from '@/pages/library';
import MesocyclesPage from '@/pages/mesocycles';
import MesocycleEditorPage from '@/pages/mesocycle-editor';
import CalendarPage from '@/pages/calendar';
import MesocycleNewPage from '@/pages/mesocycle-new';
import PlannedPage from '@/pages/planned';
import ProfilesPage from '@/pages/profile';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { refetchOnWindowFocus: true, refetchOnMount: 'always', refetchOnReconnect: 'always', retry: 1, staleTime: 12_000 },
    mutations: { networkMode: 'always' },
  },
});

function NotFound() { return <main className="page-wrap"><div className="eyebrow">Not found</div><h1 className="display" style={{ fontSize: 48 }}>Wrong turn.</h1><Link href="/" className="btn btn-primary" style={{ textDecoration: 'none' }}>Back to today</Link></main>; }

function Router() {
  return <ErrorBoundary resetKey={window.location.pathname}><Shell><Switch>
    <Route path="/" component={HomePage}/>
    <Route path="/workout/:sessionId" component={WorkoutPage}/>
    <Route path="/history" component={HistoryPage}/>
    <Route path="/history/:sessionId" component={HistoryDetailPage}/>
    <Route path="/exercises" component={ExercisesPage}/>
    <Route path="/splits" component={MesocyclesPage}/>
    <Route path="/splits/new" component={MesocycleNewPage}/>
    <Route path="/calendar" component={CalendarPage}/>
    <Route path="/splits/:splitId" component={MesocycleEditorPage}/>
    <Route path="/planned/:plannedId" component={PlannedPage}/>
    <Route path="/profiles" component={ProfilesPage}/>
    <Route component={NotFound}/>
  </Switch></Shell></ErrorBoundary>;
}
function App() {
  useEffect(() => {
    const refreshed = () => { void queryClient.invalidateQueries(); };
    const storageChanged = (event: StorageEvent) => { if (event.key === 'legendary-training-revision') refreshed(); };
    window.addEventListener('storage', storageChanged);
    window.addEventListener('pageshow', refreshed);
    if ('serviceWorker' in navigator) void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, { updateViaCache: 'none' }).catch(() => undefined);
    return () => { window.removeEventListener('storage', storageChanged); window.removeEventListener('pageshow', refreshed); };
  }, []);
  return <QueryClientProvider client={queryClient}><TooltipProvider><ProfileProvider><Router/></ProfileProvider><Toaster/></TooltipProvider></QueryClientProvider>;
}
export default App;
