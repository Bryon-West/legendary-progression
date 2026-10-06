import { useEffect, useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useClerk, useUser } from "@clerk/react";
import { Link } from "wouter";
import { getGetActiveWorkoutQueryKey, getListProfilesQueryKey, useGetActiveWorkout, useUpdateProfile, useUpdateProfileTrainingMode } from "@workspace/api-client-react";
import type { Profile } from "@workspace/api-client-react";
import { EngineSettings } from "@/components/engine-settings";
import { ResetTrainingData } from "@/components/reset-training-data";
import { ErrorNote, Loading, QueryError } from "@/components/ui-bits";
import { useActiveProfile } from "@/lib/profile";
import { basePath } from "@/lib/clerk";
import type { WeightUnit } from "@/lib/units";
import { Modal } from "@/components/modal";
import { clearPendingWorkoutDrafts } from "@/lib/workout-drafts";

type TrainingExperience = "beginner" | "intermediate" | "advanced";

const experienceLabels: Record<TrainingExperience, string> = {
  beginner: "New or returning",
  intermediate: "Training regularly",
  advanced: "Experienced",
};

export default function ProfilePage() {
  const { profile, profilesQuery, unit } = useActiveProfile();
  const { isLoaded: userLoaded, user } = useUser();
  const { signOut } = useClerk();
  const update = useUpdateProfile();
  const updateMode = useUpdateProfileTrainingMode();
  const queryClient = useQueryClient();
  const active = useGetActiveWorkout({ profileId: profile?.id ?? 0 }, { query: { enabled: !!profile, queryKey: getGetActiveWorkoutQueryKey({ profileId: profile?.id ?? 0 }) } });
  const [name, setName] = useState("");
  const [experience, setExperience] = useState<TrainingExperience>("beginner");
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileError, setProfileError] = useState("");
  const [saved, setSaved] = useState(false);
  const [modePrompt, setModePrompt] = useState<"basic" | "legendary_pro" | null>(null);
  const [modeError, setModeError] = useState("");
  const [modeSaving, setModeSaving] = useState(false);

  useEffect(() => {
    if (!profile) return;
    setName(profile.name);
    setExperience(profile.trainingExperience ?? "beginner");
  }, [profile?.id, profile?.name, profile?.trainingExperience]);

  if (profilesQuery.isLoading || !userLoaded) return <Loading />;
  if (profilesQuery.isError) return <main className="page-wrap"><QueryError retry={() => void profilesQuery.refetch()} /></main>;
  if (!profile || !user) return <main className="page-wrap"><ErrorNote message="Your account settings are not available yet." /></main>;

  const updateProfileCache = (updated: Profile) => {
    queryClient.setQueryData<Profile[]>(getListProfilesQueryKey(), (current) =>
      (current ?? [profile]).map((item) => (item.id === updated.id ? updated : item)),
    );
  };

  const setUnit = (next: WeightUnit) => {
    if (next === unit || update.isPending) return;
    setSaved(false);
    update.mutate(
      { profileId: profile.id, data: { weightUnit: next } },
      { onSuccess: updateProfileCache },
    );
  };

  const saveSettings = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedName = name.trim().replace(/\s+/g, " ");
    if (trimmedName.length < 2) {
      setProfileError("Enter a name with at least two characters.");
      return;
    }
    setProfileError("");
    setSaved(false);
    setSavingProfile(true);
    try {
      const updated = await update.mutateAsync({
        profileId: profile.id,
        data: { name: trimmedName, trainingExperience: experience },
      });
      updateProfileCache(updated);
      setSaved(true);
    } catch {
      setProfileError("We couldn't save those settings. Check your connection and try again.");
    } finally {
      setSavingProfile(false);
    }
  };

  const email = user.primaryEmailAddress?.emailAddress || "No email address";
  const emailVerified = user.primaryEmailAddress?.verification?.status === "verified";
  const applyMode = async (activeSessionAction?: "finish_current" | "cancel_today" | "keep_current") => {
    if (!modePrompt) return;
    setModeError("");
    setModeSaving(true);
    try {
      if (activeSessionAction === "cancel_today") {
        for (let attempt = 0; attempt < 100 && queryClient.isMutating() > 0; attempt += 1) {
          await new Promise((resolve) => window.setTimeout(resolve, 50));
        }
        if (queryClient.isMutating() > 0) throw new Error("Workout entries are still saving. Wait and try cancelling again.");
      }
      await updateMode.mutateAsync({
        profileId: profile.id,
        data: { trainingMode: modePrompt, ...(activeSessionAction ? { activeSessionAction } : {}) },
      });
      setModePrompt(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: getListProfilesQueryKey() }),
        queryClient.invalidateQueries({ queryKey: getGetActiveWorkoutQueryKey({ profileId: profile.id }) }),
      ]);
      if (activeSessionAction === "cancel_today") {
        clearPendingWorkoutDrafts();
        window.dispatchEvent(new Event("legendary-workout-cancelled"));
      }
    } catch (error) {
      setModeError(error instanceof Error && error.message.startsWith("Workout entries are still saving.")
        ? error.message
        : "The mode was not changed. Your current settings and workout are unchanged.");
    } finally {
      setModeSaving(false);
    }
  };

  return (
    <main className="page-wrap enter" data-testid="page-profile-settings">
      <div className="eyebrow">Personal settings</div>
      <h1 className="display" style={{ fontSize: 48, margin: "8px 0 20px" }}>Profile.</h1>

      <section className="panel" style={{ padding: 17, marginBottom: 14 }}>
        <div className="eyebrow">Account</div>
        <div style={{ marginTop: 10 }}>
          <strong>{email}</strong>
          <div style={{ color: "hsl(var(--muted-foreground))", fontSize: 11, marginTop: 3 }}>
            {emailVerified ? "Email verified" : "Email verification pending"}
          </div>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 14 }}>
          <Link href="/account" className="btn btn-secondary" style={{ textDecoration: "none" }} data-testid="link-account-security">
            Manage email and password
          </Link>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => void signOut({ redirectUrl: basePath || "/" })}
            data-testid="button-sign-out"
          >
            Log out
          </button>
        </div>
      </section>

      <form className="panel" style={{ padding: 17, marginBottom: 14, display: "grid", gap: 13 }} onSubmit={saveSettings}>
        <div>
          <div className="eyebrow">Training profile</div>
          <p style={{ margin: "6px 0 0", fontSize: 11, color: "hsl(var(--muted-foreground))" }}>
            This account has one private training profile.
          </p>
        </div>
        <label style={{ display: "grid", gap: 6, fontSize: 12, fontWeight: 700 }}>
          Name
          <input
            className="field"
            autoComplete="name"
            maxLength={120}
            required
            value={name}
            onChange={(event) => { setName(event.target.value); setSaved(false); }}
            data-testid="input-profile-name"
          />
        </label>
        <label style={{ display: "grid", gap: 6, fontSize: 12, fontWeight: 700 }}>
          Training experience
          <select
            className="field"
            value={experience}
            onChange={(event) => { setExperience(event.target.value as TrainingExperience); setSaved(false); }}
            data-testid="select-training-experience"
          >
            {Object.entries(experienceLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        {profileError && <ErrorNote message={profileError} />}
        {update.isError && <ErrorNote message="Could not save that setting." />}
        {saved && <div className="notice-ok" role="status">Settings saved.</div>}
        <button className="btn btn-primary" type="submit" disabled={savingProfile || update.isPending}>
          {savingProfile || update.isPending ? "Saving…" : "Save profile settings"}
        </button>
      </form>

      <section className="panel" style={{ padding: 17, marginBottom: 14 }}>
        <div className="eyebrow">Training mode · free beta</div>
        <h2 style={{ fontSize: 18, margin: "8px 0 4px" }}>{profile.trainingMode === "basic" ? "Basic" : "Legendary Pro"}</h2>
        <p style={{ fontSize: 12, color: "hsl(var(--muted-foreground))", lineHeight: 1.5, margin: "0 0 12px" }}>
          {profile.pendingTrainingMode ? `${profile.pendingTrainingMode === "basic" ? "Basic" : "Legendary Pro"} is queued for after your current workout.` : profile.trainingMode === "basic" ? "Log your own weight and reps, with your training history and records." : "Guided progression, readiness, and recovery context."}
        </p>
        <button className="btn btn-secondary" type="button" disabled={modeSaving || updateMode.isPending} onClick={() => { setModeError(""); setModePrompt(profile.trainingMode === "basic" ? "legendary_pro" : "basic"); }} data-testid="button-change-training-mode">Change training mode</button>
        {modeError && <div style={{ marginTop: 10 }}><ErrorNote message={modeError} /></div>}
      </section>

      <section className="panel" style={{ padding: 17, marginBottom: 14 }}>
        <div className="eyebrow">Build information</div>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginTop: 10, fontSize: 13 }}>
          <span>Application build</span><strong className="metric" data-testid="text-build-id">{typeof __APP_BUILD_ID__ === "string" ? __APP_BUILD_ID__ : import.meta.env.MODE}</strong>
        </div>
      </section>

      {modePrompt && <Modal title="Change training mode?" close={() => setModePrompt(null)}>
        {active.isLoading ? <div className="notice-warn">Checking for an active workout…</div> : active.isError ? <ErrorNote message="Could not confirm whether a workout is active. Try again." /> : active.data?.workout ? <>
          <p style={{ color: "hsl(var(--muted-foreground))", lineHeight: 1.55, marginTop: 0 }}>This workout stays in {active.data.workout.trainingMode === "basic" ? "Basic" : "Legendary Pro"} until it is finished or cancelled.</p>
          <div style={{ display: "grid", gap: 8 }}>
            <button className="btn btn-primary" disabled={modeSaving || updateMode.isPending} onClick={() => void applyMode("finish_current")} data-testid="button-mode-finish-current">{modeSaving ? "Saving…" : "Finish current"}</button>
            <button className="btn btn-secondary" disabled={modeSaving || updateMode.isPending} onClick={() => void applyMode("cancel_today")} data-testid="button-mode-cancel-today">{modeSaving ? "Saving…" : "Cancel today"}</button>
            <button className="btn btn-ghost" disabled={modeSaving || updateMode.isPending} onClick={() => void applyMode("keep_current")} data-testid="button-mode-keep-current">Keep current</button>
          </div>
        </> : <>
          <p style={{ color: "hsl(var(--muted-foreground))", lineHeight: 1.55, marginTop: 0 }}>Your next workout will use {modePrompt === "basic" ? "Basic" : "Legendary Pro"}.</p>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setModePrompt(null)}>Keep current</button>
            <button className="btn btn-primary" style={{ flex: 1 }} disabled={modeSaving || updateMode.isPending || active.isLoading || active.isError} onClick={() => void applyMode()}>{modeSaving ? "Saving…" : "Change mode"}</button>
          </div>
        </>}
        {(active.isError || updateMode.isError) && <ErrorNote message="Could not confirm or change the mode. Try again." />}
        {modeError && <ErrorNote message={modeError} />}
      </Modal>}

      <section className="panel" style={{ padding: 17, marginBottom: 18 }}>
        <div className="eyebrow">Weight unit</div>
        <div className="seg" style={{ gridTemplateColumns: "1fr 1fr", margin: "10px 0" }} role="group" aria-label="Weight unit">
          <button type="button" aria-pressed={unit === "lb"} disabled={update.isPending} onClick={() => setUnit("lb")} data-testid="button-unit-lb">Pounds (lb)</button>
          <button type="button" aria-pressed={unit === "kg"} disabled={update.isPending} onClick={() => setUnit("kg")} data-testid="button-unit-kg">Kilograms (kg)</button>
        </div>
        <div style={{ fontSize: 12, color: "hsl(var(--muted-foreground))", lineHeight: 1.5 }}>
          Records are stored in kilograms. Switching units converts every weight you see, including targets, history, and totals. Nothing stored changes.
        </div>
      </section>

      {profile.trainingMode === "legendary_pro" && <EngineSettings profileId={profile.id} />}
      <ResetTrainingData key={profile.id} profileId={profile.id} profileName={profile.name} />
    </main>
  );
}