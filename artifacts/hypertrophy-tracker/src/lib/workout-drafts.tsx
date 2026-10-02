import { createContext, useContext, useMemo, useRef } from 'react';

type DraftSaver = () => Promise<void>;
type DraftRegistry = {
  register: (id: number, save: DraftSaver) => () => void;
  flush: () => Promise<void>;
};

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