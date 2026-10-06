export type DefaultMesocycleWeek = {
  kind: "loading" | "deload";
  targetRir: number | null;
};

const threeWeekLoadingBlock: DefaultMesocycleWeek[] = [
  { kind: "loading", targetRir: 3 },
  { kind: "loading", targetRir: 2 },
  { kind: "loading", targetRir: 1 },
];

export const hypertrophyEightWeekPlan: DefaultMesocycleWeek[] = [
  ...threeWeekLoadingBlock,
  { kind: "deload", targetRir: null },
  ...threeWeekLoadingBlock,
  { kind: "deload", targetRir: null },
];

export const sizeTwelveWeekPlan: DefaultMesocycleWeek[] = [
  ...threeWeekLoadingBlock,
  { kind: "deload", targetRir: null },
  ...threeWeekLoadingBlock,
  { kind: "deload", targetRir: null },
  ...threeWeekLoadingBlock,
  { kind: "deload", targetRir: null },
];
