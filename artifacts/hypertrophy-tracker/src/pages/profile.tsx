import { useEffect, useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useClerk, useUser } from "@clerk/react";
import { Link } from "wouter";
import { getListProfilesQueryKey, useUpdateProfile } from "@workspace/api-client-react";
import type { Profile } from "@workspace/api-client-react";
import { EngineSettings } from "@/components/engine-settings";
import { ResetTrainingData } from "@/components/reset-training-data";
import { ErrorNote, Loading, QueryError } from "@/components/ui-bits";
import { useActiveProfile } from "@/lib/profile";
import { basePath } from "@/lib/clerk";
import type { WeightUnit } from "@/lib/units";

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
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [experience, setExperience] = useState<TrainingExperience>("beginner");
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileError, setProfileError] = useState("");
  const [saved, setSaved] = useState(false);

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
    const [firstName, ...lastNameParts] = trimmedName.split(" ");
    try {
      await user.update({ firstName, lastName: lastNameParts.join(" ") });
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

      <EngineSettings profileId={profile.id} />
      <ResetTrainingData key={profile.id} profileId={profile.id} profileName={profile.name} />
    </main>
  );
}