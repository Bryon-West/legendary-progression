export type CatalogMetric = {
  type: "weight" | "reps" | "distance" | "time" | "height" | "elevation" | "calories" | "steps";
  label: string;
  unit: string;
  required: boolean;
};

export type CatalogMetadata = {
  name: string;
  secondaryMuscles: string[];
  aliases: string[];
  defaultRepMin: number;
  defaultRepMax: number;
  loadIncrementLb: number | null;
  loadIncrementKg: number | null;
  metricDefinitions?: CatalogMetric[];
};

export type ExistingCatalogMetadata = {
  name: string;
  secondaryMuscles: string[];
  aliases: string[];
  defaultRepMin: number;
  defaultRepMax: number;
  loadIncrementLb: number | null;
  loadIncrementKg: number | null;
  metricDefinitions: CatalogMetric[] | null;
};

const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");

export function needsCatalogMetadataUpdate(existing: ExistingCatalogMetadata, seed: CatalogMetadata): boolean {
  const needsCanonicalAlias =
    normalize(existing.name) !== normalize(seed.name) &&
    !existing.aliases.some((alias) => normalize(alias) === normalize(seed.name));

  return (
    (existing.secondaryMuscles.length === 0 && seed.secondaryMuscles.length > 0) ||
    (existing.aliases.length === 0 && seed.aliases.length > 0) ||
    needsCanonicalAlias ||
    (existing.defaultRepMin === 8 && existing.defaultRepMax === 12 &&
      (existing.defaultRepMin !== seed.defaultRepMin || existing.defaultRepMax !== seed.defaultRepMax)) ||
    (existing.loadIncrementLb === null && seed.loadIncrementLb !== null) ||
    (existing.loadIncrementKg === null && seed.loadIncrementKg !== null) ||
    (existing.metricDefinitions === null && seed.metricDefinitions != null)
  );
}
