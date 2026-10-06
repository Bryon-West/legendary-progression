import { createContext, useContext, useMemo, useRef } from 'react';

type DraftSaver = () => Promise<void>;
type DraftRegistry = {
  register: (id: number, save: DraftSaver) => () => void;
  flush: () => Promise<void>;
};

const pendingDraftsKey = "legendary-workout-drafts-pending";
export function hasPendingWorkoutDrafts() {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(pendingDraftsKey) || "[]");
    if (!Array.isArray(parsed)) return true;
    const ids = parsed as number[];
    return ids.length > 0;
  } catch { return true; }
}
export function markWorkoutDraftPending(id: number, pending: boolean) {
  try {
    const current = JSON.parse(window.localStorage.getItem(pendingDraftsKey) || "[]") as number[];
    const next = pending ? [...new Set([...current, id])] : current.filter((value) => value !== id);
    if (next.length) window.localStorage.setItem(pendingDraftsKey, JSON.stringify(next));
    else window.localStorage.removeItem(pendingDraftsKey);
    window.dispatchEvent(new Event("legendary-drafts-changed"));
  } catch {
    // Draft values remain in their inputs; storage is only the update-safety signal.
  }
}
export function clearPendingWorkoutDrafts() {
  try {
    window.localStorage.removeItem(pendingDraftsKey);
    window.dispatchEvent(new Event("legendary-drafts-changed"));
  } catch {
    // The active workout is already gone; the registry is only an update-safety signal.
  }
}

export const WorkoutDraftsContext = createContext<DraftRegistry | null>(null);
export const useWorkoutDrafts = () => useContext(WorkoutDraftsContext);

/** A finish action must save all row drafts, including earlier failed saves. */
export function useWorkoutDraftRegistry(): DraftRegistry {
  const savers = useRef(new Map<number, DraftSaver>());
  return useMemo(() => ({
    register(id: number, save: DraftSaver) {
      savers.current.set(id, save);
      return () => { savers.current.delete(id); };
    },
    async flush() {
      const results = await Promise.allSettled([...savers.current.values()].map((save) => save()));
      if (results.some((result) => result.status === 'rejected')) {
        throw new Error('Some set entries could not be saved. Review them and retry before finishing.');
      }
    },
  }), []);
}