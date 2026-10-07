import { useEffect, useMemo, useRef, useState } from "react";
import { ClerkProvider, useAuth, useClerk } from "@clerk/react";
import { QueryClient, QueryClientProvider, useIsMutating, useQueryClient } from "@tanstack/react-query";
import { Link, Redirect, Route, Router as WouterRouter, Switch, useLocation } from "wouter";
import { ErrorBoundary } from "@/components/error-boundary";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Shell } from "@/components/shell";
import { clerkAppearance, clerkPubKey, clerkProxyUrl, basePath, stripBase } from "@/lib/clerk";
import { getGetActiveWorkoutQueryKey, getListProfilesQueryKey, useGetActiveWorkout, useListProfiles } from "@workspace/api-client-react";
import { hasPendingWorkoutDrafts } from "@/lib/workout-drafts";
import { useActiveProfile } from "@/lib/profile";
import { Loading, QueryError } from "@/components/ui-bits";
import Welcome from "@/pages/welcome";
import { SignInPage, SignUpPage } from "@/pages/auth";
import ForgotPasswordPage from "@/pages/forgot-password";
import AccountPage from "@/pages/account";
import OnboardingPage from "@/pages/onboarding";
import ProfileSettingsPage from "@/pages/profile";
import HomePage from "@/pages/home";
import WorkoutPage from "@/pages/workout";
import { HistoryPage, HistoryDetailPage } from "@/pages/history";
import { PersonalRecordsPage, PersonalRecordDetailPage } from "@/pages/personal-records";
import ExercisesPage from "@/pages/library";
import MesocyclesPage from "@/pages/mesocycles";
import MesocycleEditorPage from "@/pages/mesocycle-editor";
import CalendarPage from "@/pages/calendar";
import MesocycleNewPage from "@/pages/mesocycle-new";
import PlannedPage from "@/pages/planned";
import BetaFeedbackPage from "@/pages/beta-feedback";
import BetaFeedbackManagersPage from "@/pages/beta-feedback-managers";

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { refetchOnWindowFocus: true, refetchOnMount: "always", refetchOnReconnect: "always", retry: 1, staleTime: 12_000 },
      mutations: { networkMode: "always" },
    },
  });
}

function NotFound() {
  return (
    <main className="page-wrap">
      <div className="eyebrow">Not found</div>
      <h1 className="display" style={{ fontSize: 48 }}>Wrong turn.</h1>
      <Link href="/" className="btn btn-primary" style={{ textDecoration: "none" }}>Back to today</Link>
    </main>
  );
}

function ProtectedRouter() {
  return (
    <ErrorBoundary resetKey={window.location.pathname}>
      <Shell>
        <Switch>
          <Route path="/" component={HomePage} />
          <Route path="/workout/:sessionId" component={WorkoutPage} />
          <Route path="/history" component={HistoryPage} />
          <Route path="/history/prs" component={PersonalRecordsPage} />
          <Route path="/history/prs/:exerciseId" component={PersonalRecordDetailPage} />
          <Route path="/history/:sessionId" component={HistoryDetailPage} />
          <Route path="/exercises" component={ExercisesPage} />
          <Route path="/splits" component={MesocyclesPage} />
          <Route path="/splits/new" component={MesocycleNewPage} />
          <Route path="/calendar" component={CalendarPage} />
          <Route path="/splits/:splitId" component={MesocycleEditorPage} />
          <Route path="/planned/:plannedId" component={PlannedPage} />
          <Route path="/feedback/managers" component={BetaFeedbackManagersPage} />
          <Route path="/feedback" component={BetaFeedbackPage} />
          <Route path="/profiles" component={ProfileSettingsPage} />
          <Route path="/account/*?" component={AccountPage} />
          <Route component={NotFound} />
        </Switch>
      </Shell>
    </ErrorBoundary>
  );
}

function PublicSignInRoute() {
  const { isLoaded, isSignedIn } = useAuth();
  if (!isLoaded) return <Loading />;
  if (isSignedIn) return <Redirect to="/" />;
  return <SignInPage />;
}

function PublicSignUpRoute() {
  const { isLoaded, isSignedIn } = useAuth();
  if (!isLoaded) return <Loading />;
  if (isSignedIn) return <Redirect to="/" />;
  return <SignUpPage />;
}

function PublicForgotPasswordRoute() {
  const { isLoaded, isSignedIn } = useAuth();
  if (!isLoaded) return <Loading />;
  if (isSignedIn) return <Redirect to="/" />;
  return <ForgotPasswordPage />;
}

function UnauthenticatedFlow() {
  const [, navigate] = useLocation();
  return (
    <Welcome
      onCreateAccount={() => navigate("/sign-up")}
      onLogIn={() => navigate("/sign-in")}
    />
  );
}

function AuthenticatedFlow() {
  const { profile, profilesQuery } = useActiveProfile();
  const [location] = useLocation();

  if (profilesQuery.isLoading) return <Loading />;
  if (profilesQuery.isError) {
    return <main className="page-wrap"><QueryError retry={() => void profilesQuery.refetch()} /></main>;
  }
  if (!profile) {
    return <main className="page-wrap"><p role="alert">Your account profile is not available. Reload and try again.</p></main>;
  }
  if (!profile.onboardingComplete) {
    return location === "/onboarding" ? <OnboardingPage /> : <Redirect to="/onboarding" />;
  }
  if (location === "/onboarding") return <Redirect to="/" />;
  return <ProtectedRouter />;
}

function AccountFlow() {
  const { isLoaded, isSignedIn } = useAuth();
  if (!isLoaded) return <Loading />;
  return isSignedIn ? <AuthenticatedFlow /> : <UnauthenticatedFlow />;
}

function AppRoutes() {
  return (
    <Switch>
      <Route path="/forgot-password" component={PublicForgotPasswordRoute} />
      {/* Required Wouter syntax: Clerk also routes through nested auth paths. */}
      <Route path="/sign-in/*?" component={PublicSignInRoute} />
      <Route path="/sign-up/*?" component={PublicSignUpRoute} />
      <Route component={AccountFlow} />
    </Switch>
  );
}

function ClerkQueryClientCacheInvalidator() {
  const { addListener } = useClerk();
  const queryClient = useQueryClient();
  const previousUserId = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const unsubscribe = addListener(({ user }) => {
      const userId = user?.id ?? null;
      if (previousUserId.current !== undefined && previousUserId.current !== userId) {
        queryClient.clear();
      }
      previousUserId.current = userId;
    });
    return unsubscribe;
  }, [addListener, queryClient]);

  return null;
}

function ServiceWorkerUpdates() {
  const { isLoaded, isSignedIn } = useAuth();
  const profilesQuery = useListProfiles({ query: { enabled: !!isSignedIn, queryKey: getListProfilesQueryKey() } });
  const profile = profilesQuery.data?.[0] ?? null;
  const profileId = profile?.id ?? 0;
  const activeQuery = useGetActiveWorkout(
    { profileId },
    { query: { enabled: !!profile, queryKey: getGetActiveWorkoutQueryKey({ profileId }) } },
  );
  const mutating = useIsMutating();
  const [registration, setRegistration] = useState<ServiceWorkerRegistration | null>(null);
  const [registrationRevision, setRegistrationRevision] = useState(0);
  const [draftRevision, setDraftRevision] = useState(0);
  const applyRequested = useRef(false);
  const safeToReload = useRef(false);
  safeToReload.current = (!isLoaded ? false : !isSignedIn ? true : profile ? !activeQuery.isLoading && !activeQuery.isError && !activeQuery.data?.workout : !profilesQuery.isLoading && !profilesQuery.isError)
    && mutating === 0 && !hasPendingWorkoutDrafts();

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    let timer: number | undefined;
    let disposed = false;
    const findRegistration = async () => {
      const current = await navigator.serviceWorker.getRegistration();
      if (disposed) return;
      if (current) {
        setRegistration(current);
        current.addEventListener("updatefound", () => {
          current.installing?.addEventListener("statechange", () => setRegistrationRevision((value) => value + 1));
          setRegistrationRevision((value) => value + 1);
        });
        window.clearInterval(timer);
      }
    };
    void findRegistration();
    timer = window.setInterval(() => void findRegistration(), 1000);
    return () => { disposed = true; window.clearInterval(timer); };
  }, []);

  useEffect(() => {
    if (!registration) return;
    const checkForUpdate = () => {
      if (document.visibilityState === "visible") void registration.update().catch(() => undefined);
    };
    window.addEventListener("focus", checkForUpdate);
    document.addEventListener("visibilitychange", checkForUpdate);
    return () => {
      window.removeEventListener("focus", checkForUpdate);
      document.removeEventListener("visibilitychange", checkForUpdate);
    };
  }, [registration]);

  useEffect(() => {
    const draftsChanged = () => setDraftRevision((value) => value + 1);
    window.addEventListener("legendary-drafts-changed", draftsChanged);
    return () => window.removeEventListener("legendary-drafts-changed", draftsChanged);
  }, []);

  useEffect(() => {
    if (!registration?.waiting || !safeToReload.current || applyRequested.current) return;
    applyRequested.current = true;
    registration.waiting.postMessage({ type: "APPLY_UPDATE" });
  }, [registration, registrationRevision, draftRevision, activeQuery.data, activeQuery.isLoading, activeQuery.isError, mutating, profile, profilesQuery.isLoading, profilesQuery.isError]);

  useEffect(() => {
    const refresh = () => {
      if (profile) void activeQuery.refetch();
    };
    const controllerChanged = () => {
      if (applyRequested.current && safeToReload.current) window.location.reload();
    };
    navigator.serviceWorker?.addEventListener("controllerchange", controllerChanged);
    window.addEventListener("legendary-workout-finished", refresh);
    window.addEventListener("legendary-workout-cancelled", refresh);
    return () => {
      navigator.serviceWorker?.removeEventListener("controllerchange", controllerChanged);
      window.removeEventListener("legendary-workout-finished", refresh);
      window.removeEventListener("legendary-workout-cancelled", refresh);
    };
  }, [profile, activeQuery.refetch]);
  return null;
}

function IdentityBoundary() {
  const { isLoaded, isSignedIn, userId } = useAuth();
  const identity = isLoaded ? (isSignedIn ? userId ?? null : null) : undefined;
  const queryClient = useMemo(() => createQueryClient(), [identity]);
  const previousQueryClient = useRef<QueryClient | null>(null);
  const [readyForIdentity, setReadyForIdentity] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    if (identity === undefined || readyForIdentity === identity) return;
    previousQueryClient.current?.clear();
    queryClient.clear();
    previousQueryClient.current = queryClient;
    try {
      window.localStorage.removeItem("training-profile");
    } catch {
      // The old profile picker preference is no longer used.
    }
    setReadyForIdentity(identity);
  }, [identity, queryClient, readyForIdentity]);

  useEffect(() => {
    const refresh = () => { void queryClient.invalidateQueries(); };
    const pageHidden = () => {
      queryClient.clear();
      document.documentElement.dataset.authPageHidden = "true";
    };
    const pageShown = () => {
      delete document.documentElement.dataset.authPageHidden;
      refresh();
    };
    const storageChanged = (event: StorageEvent) => {
      if (event.key === "legendary-training-revision") refresh();
    };
    window.addEventListener("storage", storageChanged);
    window.addEventListener("pagehide", pageHidden);
    window.addEventListener("pageshow", pageShown);
    return () => {
      window.removeEventListener("storage", storageChanged);
      window.removeEventListener("pagehide", pageHidden);
      window.removeEventListener("pageshow", pageShown);
    };
  }, [queryClient]);

  if (!isLoaded || readyForIdentity !== identity) return <Loading />;

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <ClerkQueryClientCacheInvalidator />
        <ServiceWorkerUpdates />
        <AppRoutes />
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

function ClerkRouter() {
  const [, setLocation] = useLocation();
  return (
    <ClerkProvider
      publishableKey={clerkPubKey}
      proxyUrl={clerkProxyUrl}
      appearance={clerkAppearance}
      signInUrl={`${basePath}/sign-in`}
      signUpUrl={`${basePath}/sign-up`}
      localization={{
        signIn: { start: { title: "Welcome back", subtitle: "Sign in to access your training account" } },
        signUp: { start: { title: "Create your account", subtitle: "Start building your training record" } },
      }}
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
    >
      <IdentityBoundary />
    </ClerkProvider>
  );
}

function App() {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      void navigator.serviceWorker
        .register(`${import.meta.env.BASE_URL}sw.js`, { updateViaCache: "none" })
        .catch(() => undefined);
    }
  }, []);

  return (
    <WouterRouter base={basePath}>
      <ClerkRouter />
    </WouterRouter>
  );
}

export default App;