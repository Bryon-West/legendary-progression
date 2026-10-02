import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useListProfiles } from '@workspace/api-client-react';
import type { WeightUnit } from '@/lib/units';

const ProfileSelection = createContext<{ profileId: number | null; setProfileId: (id: number | null) => void } | null>(null);

export function ProfileProvider({ children }: { children: ReactNode }) {
  const [profileId, setProfileId] = useState<number | null>(() => {
    const saved = Number(window.localStorage.getItem('training-profile'));
    return Number.isFinite(saved) && saved > 0 ? saved : null;
  });
  return <ProfileSelection.Provider value={{ profileId, setProfileId }}>{children}</ProfileSelection.Provider>;
}

export function useActiveProfile() {
  const selection = useContext(ProfileSelection);
  const profileId = selection?.profileId ?? null;
  const setProfileId = selection?.setProfileId ?? (() => undefined);
  const profiles = useListProfiles();
  const selected = profiles.data?.find((p) => p.id === profileId) ?? profiles.data?.[0] ?? null;
  useEffect(() => {
    if (selected && selected.id !== profileId) setProfileId(selected.id);
    if (selected) window.localStorage.setItem('training-profile', String(selected.id));
  }, [profileId, selected, setProfileId]);
  const unit: WeightUnit = selected?.weightUnit === 'lb' ? 'lb' : 'kg';
  return { profile: selected, profiles: profiles.data ?? [], profilesQuery: profiles, setProfileId, unit };
}
