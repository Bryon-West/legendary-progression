export type MetricType =
  | "weight"
  | "reps"
  | "distance"
  | "time"
  | "height"
  | "elevation"
  | "calories"
  | "steps";

export type MetricUnit =
  | "profile"
  | "kg"
  | "lb"
  | "reps"
  | "m"
  | "km"
  | "mi"
  | "ft"
  | "cm"
  | "in"
  | "s"
  | "min"
  | "h"
  | "kcal"
  | "steps";

export interface MetricDefinition {
  type: MetricType;
  label: string;
  unit: MetricUnit;
  required: boolean;
}

const LB_TO_KG = 0.45359237;
const DISTANCE_TO_METERS: Record<string, number> = {
  m: 1,
  km: 1000,
  mi: 1609.344,
  ft: 0.3048,
  cm: 0.01,
  in: 0.0254,
};
const TIME_TO_SECONDS: Record<string, number> = {
  s: 1,
  min: 60,
  h: 3600,
};

export function isLegacyResistanceMetricModel(
  category: string,
  definitions: unknown,
): boolean {
  if (category !== "strength" && category !== "bodyweight") return false;
  if (definitions == null) return true;
  if (!Array.isArray(definitions) || definitions.length !== 2) return false;
  const [weight, reps] = definitions as Partial<MetricDefinition>[];
  return weight?.type === "weight" &&
    weight.unit === "profile" &&
    weight.required === true &&
    reps?.type === "reps" &&
    reps.unit === "reps" &&
    reps.required === true;
}

export function isMetricDrivenExercise(
  category: string,
  definitions: unknown,
): definitions is MetricDefinition[] {
  return Array.isArray(definitions) &&
    definitions.length > 0 &&
    !isLegacyResistanceMetricModel(category, definitions);
}

function canonicalMultiplier(definition: MetricDefinition, weightUnit: "kg" | "lb") {
  if (definition.type === "weight") {
    const unit = definition.unit === "profile" ? weightUnit : definition.unit;
    if (unit === "kg") return 1;
    if (unit === "lb") return LB_TO_KG;
    throw new Error(`Unsupported weight unit: ${unit}`);
  }
  if (definition.type === "distance") {
    const multiplier = DISTANCE_TO_METERS[definition.unit];
    if (multiplier !== undefined && ["m", "km", "mi", "ft"].includes(definition.unit)) {
      return multiplier;
    }
    throw new Error(`Unsupported distance unit: ${definition.unit}`);
  }
  if (definition.type === "height" || definition.type === "elevation") {
    const multiplier = DISTANCE_TO_METERS[definition.unit];
    if (multiplier !== undefined) return multiplier;
    throw new Error(`Unsupported ${definition.type} unit: ${definition.unit}`);
  }
  if (definition.type === "time") {
    const multiplier = TIME_TO_SECONDS[definition.unit];
    if (multiplier !== undefined) return multiplier;
    throw new Error(`Unsupported time unit: ${definition.unit}`);
  }
  if (definition.type === "calories" && definition.unit === "kcal") return 1;
  if (definition.type === "reps" && definition.unit === "reps") return 1;
  if (definition.type === "steps" && definition.unit === "steps") return 1;
  throw new Error(`Unsupported ${definition.type} unit: ${definition.unit}`);
}

export function validateMetricDefinitions(definitions: MetricDefinition[]) {
  if (definitions.length < 1 || definitions.length > 2) {
    throw new Error("Configure one or two exercise metrics.");
  }
  for (const definition of definitions) {
    if (!definition.label.trim()) throw new Error("Metric labels cannot be blank.");
    canonicalMultiplier(definition, "kg");
  }
}

export function normalizeMetricValues(
  values: unknown,
  definitions: MetricDefinition[],
  weightUnit: "kg" | "lb",
  requireRequired: boolean,
): (number | null)[] {
  if (!Array.isArray(values) || values.length !== definitions.length) {
    throw new Error("Metric values must match this exercise's configured metrics.");
  }
  return values.map((value, index) => {
    const definition = definitions[index];
    if (value === null || value === undefined) {
      if (requireRequired && definition.required) {
        throw new Error(`${definition.label} is required.`);
      }
      return null;
    }
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
      throw new Error(`${definition.label} must be a non-negative number.`);
    }
    return value * canonicalMultiplier(definition, weightUnit);
  });
}

export function normalizedMetricValuesAreComplete(
  values: unknown,
  definitions: MetricDefinition[],
): values is (number | null)[] {
  return Array.isArray(values) &&
    values.length === definitions.length &&
    values.every((value, index) =>
      value === null
        ? !definitions[index].required
        : typeof value === "number" && Number.isFinite(value) && value >= 0,
    );
}
