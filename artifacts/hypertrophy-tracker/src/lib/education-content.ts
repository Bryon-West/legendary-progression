import { MAX_E1RM_QUALIFYING_REPS } from '@workspace/api-zod/constants';

export type EducationKey =
  | 'basic'
  | 'legendary_pro'
  | 'rir'
  | 'pr'
  | 'e1rm'
  | 'mesocycle'
  | 'deload'
  | 'total_weight_lifted';

export type EducationContent = {
  title: string;
  subtitle?: string;
  definition: string;
  example?: string;
  takeaway?: string;
  accent: 'basic' | 'pro' | 'neutral';
  beta?: boolean;
};

export const EDUCATION_CONTENT: Record<EducationKey, EducationContent> = {
  basic: {
    title: 'BASIC',
    subtitle: 'Manual Training',
    definition:
      'Track your workouts your way. Includes editable workout plans and routines, exercise library, warm-up and working sets, weight and rep logging, Calendar and workout history, personal records, Total Weight Lifted, and manual workout and plan changes. Basic records what you do; it does not automatically choose when to increase load, reps, sets, or training difficulty.',
    takeaway: 'YOU CONTROL YOUR PROGRESSION. BASIC IS A COMPLETE MANUAL WORKOUT TRACKER.',
    accent: 'basic',
    beta: true,
  },
  legendary_pro: {
    title: 'LEGENDARY PRO',
    subtitle: 'Guided Progression',
    definition:
      'Everything in Basic, plus guidance about what to do next when the plan and exercise history support it. Legendary Pro includes RIR-based targets, set-by-set performance evaluation, load and repetition guidance, recovery check-ins and adjustments, training target indicators, multiweek plan progression, and configurable deload guidance.',
    takeaway:
      'LEGENDARY PRO DOESN’T JUST RECORD YOUR TRAINING. IT HELPS DETERMINE WHAT YOU SHOULD DO NEXT.',
    accent: 'pro',
    beta: true,
  },
  rir: {
    title: 'RIR — Reps in Reserve',
    definition:
      'RIR is how many more good reps you believe you could have completed before reaching failure.',
    example:
      'You complete 6 reps, but feel you could have completed 9 reps with good form. 9 − 6 = 3, so that set was 3 RIR.',
    takeaway: 'If you couldn’t have completed another good rep, that’s 0 RIR.',
    accent: 'pro',
  },
  pr: {
    title: 'PR — Personal Record',
    definition:
      'A user’s best recorded performance for an exercise. This app tracks heaviest load separately from the best e1RM-based strength performance when eligible. A heavier set is not automatically the best estimated strength performance.',
    accent: 'neutral',
  },
  e1rm: {
    title: 'e1RM — Estimated 1-Rep Max',
    definition:
      'An estimate of the weight a person may be able to lift for one rep, based on a completed working set. It is an estimate, not an actual tested 1RM.',
    example: `Legendary uses qualifying completed working sets of 1–${MAX_E1RM_QUALIFYING_REPS} reps.`,
    accent: 'pro',
  },
  mesocycle: {
    title: 'Mesocycle',
    definition:
      'A planned training block made up of multiple weeks. The app uses it to organize scheduled training; in Pro mode its week targets also guide progression. Plans may include loading weeks, deload weeks, and/or week-off weeks when configured.',
    accent: 'neutral',
  },
  deload: {
    title: 'Deload',
    definition:
      'A planned easier period used to reduce accumulated fatigue. In Pro, the app uses the athlete’s configured deload settings to adjust week RIR, working-set count and recommended load; settings control the amount of change.',
    accent: 'pro',
  },
  total_weight_lifted: {
    title: 'Total Weight Lifted',
    definition:
      'The total of actual load × reps across completed working sets in the session or selected period. Warm-up, incomplete, skipped and removed sets are excluded.',
    example: '100 lb × 10 reps = 1,000 lb for that set.',
    accent: 'neutral',
  },
};
