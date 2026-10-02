export type MuscleVolume = {
  muscleGroup: string;
  totalWeightLifted: number;
};

export function primaryMuscleVolume(
  contributions: Array<{ muscleGroup: string; weight: number; reps: number }>,
): { muscleTotals: MuscleVolume[]; totalVolume: number } {
  const totals = new Map<string, number>();
  for (const contribution of contributions) {
    totals.set(
      contribution.muscleGroup,
      (totals.get(contribution.muscleGroup) ?? 0) + contribution.weight * contribution.reps,
    );
  }
  const muscleTotals = [...totals.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([muscleGroup, totalWeightLifted]) => ({ muscleGroup, totalWeightLifted }));
  return {
    muscleTotals,
    totalVolume: muscleTotals.reduce((total, item) => total + item.totalWeightLifted, 0),
  };
}