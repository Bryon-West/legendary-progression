import { useEffect, useState } from "react";
import { ArrowRight, Dumbbell, LayoutTemplate } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useUser } from "@clerk/react";
import { getListProfilesQueryKey, useUpdateProfile } from "@workspace/api-client-react";
import type { Profile } from "@workspace/api-client-react";
import { useLocation } from "wouter";
import { useActiveProfile } from "@/lib/profile";
import { ErrorNote, Loading } from "@/components/ui-bits";

type TrainingExperience = "beginner" | "intermediate" | "advanced";
type WeightUnit = "lb" | "kg";

const experienceOptions: Array<{ value: TrainingExperience; label: string; detail: string }> = [
  { value: "beginner", label: "New or returning", detail: "I’m new to structured training or rebuilding consistency." },
  { value: "intermediate", label: "Training regularly", detail: "I have a steady routine and understand the main lifts." },
  { value: "advanced", label: "Experienced", detail: "I have years of consistent training and follow planned progression." },
];

export default function OnboardingPage() {
  const { profile, profilesQuery } = useActiveProfile();
  const { isLoaded: userLoaded, user } = useUser();
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const update = useUpdateProfile();
  const [unit, setUnit] = useState<WeightUnit>("kg");
  const [experience, setExperience] = useState<TrainingExperience | null>(null);
  const [error, setError] = useState("");
  const [starting, setStarting] = useState<"template" | "build" | null>(null);

  useEffect(() => {
    if (!profile) return;
    setUnit(profile.weightUnit === "lb" ? "lb" : "kg");
    setExperience(profile.trainingExperience ?? null);
  }, [profile?.id, profile?.weightUnit, profile?.trainingExperience]);

  if (profilesQuery.isLoading || !userLoaded) return <Loading />;
  if (profilesQuery.isError) {
    return <main className="page-wrap"><ErrorNote message="We couldn't load your account profile. Reload and try again." /></main>;
  }
  if (!profile) {
    return <main className="page-wrap"><ErrorNote message="Your account profile is not available yet. Reload and try again." /></main>;
  }

  const startTraining = (destination: "template" | "build") => {
    setError("");
    if (!experience) {
      setError("Choose your training experience before continuing.");
      return;
    }
    const name = profile.name.trim() || user?.fullName?.trim() || "Athlete";
    setStarting(destination);
    update.mutate(
      {
        profileId: profile.id,
        data: {
          name,
          weightUnit: unit,
          trainingExperience: experience,
          onboardingComplete: true,
        },
      },
      {
        onSuccess: (updated) => {
          queryClient.setQueryData<Profile[]>(getListProfilesQueryKey(), (current) =>
            (current ?? [profile]).map((item) => (item.id === updated.id ? updated : item)),
          );
          navigate(destination === "template" ? "/splits/new?start=template" : "/splits/new?start=build");
        },
        onError: () => setError("We couldn't save your setup. Please try again."),
        onSettled: () => setStarting(null),
      },
    );
  };

  return (
    <main className="page-wrap enter" data-testid="page-onboarding">
      <div className="eyebrow">Your training account</div>
      <h1 className="display" style={{ fontSize: 46, margin: "8px 0 6px" }}>Set your defaults.</h1>
      <p style={{ color: "hsl(var(--muted-foreground))", fontSize: 13, lineHeight: 1.6, margin: "0 0 20px" }}>
        Welcome, {profile.name.trim() || user?.fullName || "Athlete"}. These choices are yours and can be changed later.
      </p>

      <section className="panel" style={{ padding: 17, marginBottom: 14 }}>
        <div className="eyebrow">Weight units</div>
        <div className="seg" style={{ gridTemplateColumns: "1fr 1fr", margin: "10px 0 5px" }} role="group" aria-label="Choose your weight units">
          <button type="button" aria-pressed={unit === "lb"} onClick={() => setUnit("lb")} data-testid="onboarding-unit-lb">Pounds (lb)</button>
          <button type="button" aria-pressed={unit === "kg"} onClick={() => setUnit("kg")} data-testid="onboarding-unit-kg">Kilograms (kg)</button>
        </div>
        <p style={{ fontSize: 11, color: "hsl(var(--muted-foreground))", lineHeight: 1.5, margin: "8px 0 0" }}>
          You can change this later. Stored training loads remain unchanged.
        </p>
      </section>

      <section className="panel" style={{ padding: 17, marginBottom: 20 }}>
        <div className="eyebrow">Training experience</div>
        <div style={{ display: "grid", gap: 8, marginTop: 10 }} role="group" aria-label="Choose your training experience">
          {experienceOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              className="panel"
              aria-pressed={experience === option.value}
              onClick={() => setExperience(option.value)}
              data-testid={`onboarding-experience-${option.value}`}
              style={{
                display: "grid",
                gap: 4,
                padding: 12,
                borderColor: experience === option.value ? "hsl(var(--primary))" : undefined,
                background: experience === option.value ? "hsl(var(--primary) / .08)" : undefined,
                color: "hsl(var(--foreground))",
                textAlign: "left",
                cursor: "pointer",
              }}
            >
              <strong style={{ fontSize: 13 }}>{option.label}</strong>
              <span style={{ fontSize: 11, lineHeight: 1.45, color: "hsl(var(--muted-foreground))" }}>{option.detail}</span>
            </button>
          ))}
        </div>
      </section>

      <div className="eyebrow" style={{ marginBottom: 9 }}>How would you like to start?</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <button
          type="button"
          className="btn btn-primary"
          style={{ minHeight: 82, justifyContent: "space-between", textAlign: "left", padding: 14 }}
          disabled={update.isPending || !userLoaded}
          onClick={() => startTraining("template")}
          data-testid="onboarding-start-template"
        >
          <span style={{ display: "grid", gap: 4 }}><strong>Start from a template</strong><small style={{ fontWeight: 500 }}>Choose a plan, then edit it</small></span>
          {starting === "template" ? <span>Saving…</span> : <LayoutTemplate size={19} />}
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          style={{ minHeight: 82, justifyContent: "space-between", textAlign: "left", padding: 14 }}
          disabled={update.isPending || !userLoaded}
          onClick={() => startTraining("build")}
          data-testid="onboarding-build-own"
        >
          <span style={{ display: "grid", gap: 4 }}><strong>Build my own</strong><small style={{ fontWeight: 500 }}>Start with a blank plan</small></span>
          {starting === "build" ? <span>Saving…</span> : <Dumbbell size={19} />}
        </button>
      </div>
      {error && <div style={{ marginTop: 12 }}><ErrorNote message={error} /></div>}
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 14, color: "hsl(var(--muted-foreground))", fontSize: 11 }}>
        Your plan will open as an editable draft. <ArrowRight size={14} />
      </div>
    </main>
  );
}