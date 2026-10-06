import type { ExerciseMetricDefinition } from "@workspace/api-client-react";
import type { WeightUnit } from "@/lib/units";

const LB_PER_KG = 2.20462262185;
const metersPerUnit: Record<string, number> = {
  m: 1,
  km: 1000,
  mi: 1609.344,
  ft: 0.3048,
  cm: 0.01,
  in: 0.0254,
};
const secondsPerUnit: Record<string, number> = { s: 1, min: 60, h: 3600 };
const tidy = (value: number) => Number(value.toFixed(2)).toString();

export function isLegacyResistanceMetricModel(
  category: string,
  definitions: ExerciseMetricDefinition[] | null | undefined,
) {
  if (category !== "strength" && category !== "bodyweight") return false;
  if (!definitions) return true;
  return definitions.length === 2 &&
    definitions[0].type === "weight" &&
    definitions[0].unit === "profile" &&
    definitions[0].required &&
    definitions[1].type === "reps" &&
    definitions[1].unit === "reps" &&
    definitions[1].required;
}

export function isMetricDrivenExercise(
  category: string,
  definitions: ExerciseMetricDefinition[] | null | undefined,
) {
  return !!definitions?.length && !isLegacyResistanceMetricModel(category, definitions);
}

export function metricUnitLabel(
  definition: ExerciseMetricDefinition,
  profileUnit: WeightUnit,
) {
  return definition.unit === "profile" ? profileUnit : definition.unit;
}

export function metricValueToInput(
  value: number | null | undefined,
  definition: ExerciseMetricDefinition,
  profileUnit: WeightUnit,
) {
  if (value == null) return "";
  const unit = metricUnitLabel(definition, profileUnit);
  if (definition.type === "weight") {
    return tidy(unit === "lb" ? value * LB_PER_KG : value);
  }
  if (definition.type === "distance" || definition.type === "height" || definition.type === "elevation") {
    const multiplier = metersPerUnit[unit] ?? 1;
    return tidy(value / multiplier);
  }
  if (definition.type === "time") {
    const multiplier = secondsPerUnit[unit] ?? 1;
    return tidy(value / multiplier);
  }
  return tidy(value);
}

export function formatMetricValue(
  value: number | null | undefined,
  definition: ExerciseMetricDefinition,
  profileUnit: WeightUnit,
) {
  if (value == null) return "—";
  const unit = metricUnitLabel(definition, profileUnit);
  return `${metricValueToInput(value, definition, profileUnit)} ${unit}`;
}

export function formatMetricSummary(
  definitions: ExerciseMetricDefinition[] | null | undefined,
  values: (number | null)[] | null | undefined,
  profileUnit: WeightUnit,
) {
  if (!definitions?.length || !values?.length) return "";
  return definitions
    .map((definition, index) =>
      `${definition.label}: ${formatMetricValue(values[index], definition, profileUnit)}`,
    )
    .join(" · ");
}
