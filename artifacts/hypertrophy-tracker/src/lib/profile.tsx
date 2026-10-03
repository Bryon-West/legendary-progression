import { useListProfiles } from "@workspace/api-client-react";
import type { WeightUnit } from "@/lib/units";

export function useActiveProfile() {
  const profilesQuery = useListProfiles();
  const profiles = profilesQuery.data ?? [];
  const profile = profiles[0] ?? null;
  const unit: WeightUnit = profile?.weightUnit === "lb" ? "lb" : "kg";

  return { profile, profiles, profilesQuery, unit };
}