import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
import {
  getGetActiveWorkoutQueryKey,
  getListProfilesQueryKey,
  useGetActiveWorkout,
  useUpdateProfileTrainingMode,
} from "@workspace/api-client-react";
import type { Profile } from "@workspace/api-client-react";
import { useActiveProfile } from "@/lib/profile";
import { ErrorNote } from "@/components/ui-bits";
import { Modal } from "@/components/modal";
import { clearPendingWorkoutDrafts } from "@/lib/workout-drafts";
import { EducationInfo } from "@/components/education-info";

type TrainingMode = "basic" | "legendary_pro";
type SessionAction = "finish_current" | "cancel_today" | "keep_current";

export function TrainingModeControl() {
  const { profile } = useActiveProfile();
  const queryClient = useQueryClient();
  const updateMode = useUpdateProfileTrainingMode();
  const [requestedMode, setRequestedMode] = useState<TrainingMode | null>(null);
  const [error, setError] = useState("");
  const pid = profile?.id ?? 0;
  const active = useGetActiveWorkout(
    { profileId: pid },
    { query: { enabled: !!profile, queryKey: getGetActiveWorkoutQueryKey({ profileId: pid }) } },
  );

  if (!profile) return null;
  const activeMode: TrainingMode = profile.trainingMode === "basic" ? "basic" : "legendary_pro";
  const pendingMode = profile.pendingTrainingMode;

  const persistMode = async (mode: TrainingMode, activeSessionAction?: SessionAction) => {
    setError("");
    try {
      const result = await updateMode.mutateAsync({
        profileId: profile.id,
        data: { trainingMode: mode, ...(activeSessionAction ? { activeSessionAction } : {}) },
      });
      queryClient.setQueryData<Profile[]>(getListProfilesQueryKey(), (current) =>
        (current ?? [profile]).map((item) => item.id === result.profile.id ? result.profile : item),
      );
      setRequestedMode(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: getListProfilesQueryKey() }),
        queryClient.invalidateQueries({ queryKey: getGetActiveWorkoutQueryKey({ profileId: profile.id }) }),
      ]);
      if (activeSessionAction === "cancel_today") {
        clearPendingWorkoutDrafts();
        window.dispatchEvent(new Event("legendary-workout-cancelled"));
      }
    } catch {
      setRequestedMode(null);
      await active.refetch();
      setError("Mode wasn't changed. Your saved mode and workout are unchanged. Try again.");
    }
  };

  const chooseMode = (next: TrainingMode) => {
    if (updateMode.isPending || next === activeMode && !pendingMode) return;
    setError("");
    if (active.isLoading || active.isError || active.data?.workout) {
      setRequestedMode(next);
      return;
    }
    void persistMode(next);
  };

  useEffect(() => {
    if (
      !requestedMode ||
      active.isLoading ||
      active.isError ||
      active.data?.workout
    ) return;
    const mode = requestedMode;
    setRequestedMode(null);
    void persistMode(mode);
  }, [requestedMode, active.isLoading, active.isError, active.data?.workout]);

  const sliderMode = requestedMode ?? activeMode;

  return (
    <>
      <section className={`mode-control mode-${activeMode}`} aria-label="Training mode">
        <EducationInfo term="basic" currentMode={activeMode === "basic" ? activeMode : undefined} testId="info-mode-basic" className={`mode-control__label ${activeMode === "basic" ? "is-active" : ""}`}><span>BASIC</span></EducationInfo>
        <div className="mode-control__slider-wrap">
          <div className="mode-control__slider" data-value={sliderMode === "basic" ? "0" : "1"}>
            <span className="mode-control__thumb" aria-hidden="true" />
            <input
              type="range"
              min="0"
              max="1"
              step="1"
              value={sliderMode === "basic" ? 0 : 1}
              disabled={updateMode.isPending}
              aria-label="Training mode"
              aria-valuetext={sliderMode === "basic" ? "Basic" : "Legendary Pro"}
              onChange={(event) => chooseMode(Number(event.currentTarget.value) === 0 ? "basic" : "legendary_pro")}
              data-testid="slider-training-mode"
            />
          </div>
        </div>
        <EducationInfo term="legendary_pro" currentMode={activeMode === "legendary_pro" ? activeMode : undefined} testId="info-mode-legendary-pro" className={`mode-control__label mode-control__label--right ${activeMode === "legendary_pro" ? "is-active" : ""}`}><span>LEGENDARY PRO</span></EducationInfo>
        <div className="mode-control__meta">
          {pendingMode && <span>Switch to {pendingMode === "basic" ? "Basic" : "Legendary Pro"} queued</span>}
          <span>FREE BETA</span>
        </div>
        {error && !requestedMode && <div className="mode-control__error"><ErrorNote message={error} /></div>}
      </section>

      {requestedMode && <Modal title="Change training mode?" close={() => { if (!updateMode.isPending) setRequestedMode(null); }}>
        {active.isLoading ? <div className="skeleton" style={{ height: 82 }} aria-label="Checking for an active workout" /> : active.isError ? <>
          <p style={{ color: "hsl(var(--muted-foreground))", lineHeight: 1.5, marginTop: 0 }}>We need to confirm your active workout before changing modes.</p>
          <button type="button" className="btn btn-secondary" onClick={() => void active.refetch()} data-testid="button-retry-active-workout">Try again</button>
        </> : active.data?.workout ? <>
          <div className="notice-warn" style={{ marginBottom: 13 }}>
            This workout stays in {active.data.workout.trainingMode === "basic" ? "Basic" : "Legendary Pro"}. Choose what happens to today’s session.
          </div>
          <div style={{ display: "grid", gap: 8 }}>
            <button type="button" className="btn btn-primary" disabled={updateMode.isPending} onClick={() => void persistMode(requestedMode, "finish_current")} data-testid="button-mode-finish-current">
              {updateMode.isPending ? "Saving…" : "Finish Current Workout"} <ArrowRight size={16} />
            </button>
            <p style={{ margin: "-3px 0 3px", color: "hsl(var(--muted-foreground))", fontSize: 11 }}>Queue the switch for when this workout ends.</p>
            <button type="button" className="btn btn-secondary" disabled={updateMode.isPending} onClick={() => void persistMode(requestedMode, "cancel_today")} data-testid="button-mode-cancel-today">
              Cancel Today's Workout
            </button>
            <p style={{ margin: "-3px 0 3px", color: "hsl(var(--muted-foreground))", fontSize: 11 }}>End today’s session and switch now.</p>
            <button type="button" className="btn btn-ghost" disabled={updateMode.isPending} onClick={() => void persistMode(activeMode, "keep_current")} data-testid="button-mode-keep-current">
              Keep Current Mode
            </button>
            <p style={{ margin: "-3px 0 0", color: "hsl(var(--muted-foreground))", fontSize: 11 }}>Clear any queued switch and return to {activeMode === "basic" ? "Basic" : "Legendary Pro"}.</p>
          </div>
        </> : <>
          <p style={{ color: "hsl(var(--muted-foreground))", lineHeight: 1.5, marginTop: 0 }}>
            Checking your current workout before switching. The mode saved on your profile remains the source of truth.
          </p>
        </>}
        {error && <ErrorNote message={error} />}
      </Modal>}
    </>
  );
}
