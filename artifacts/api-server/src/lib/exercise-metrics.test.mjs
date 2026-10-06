import assert from "node:assert/strict";
import test from "node:test";
import {
  isLegacyResistanceMetricModel,
  isMetricDrivenExercise,
  normalizeMetricValues,
  normalizedMetricValuesAreComplete,
} from "./exercise-metrics.ts";

test("legacy strength metrics keep the existing progression input model", () => {
  const definitions = [
    { type: "weight", label: "Weight", unit: "profile", required: true },
    { type: "reps", label: "Reps", unit: "reps", required: true },
  ];
  assert.equal(isLegacyResistanceMetricModel("strength", definitions), true);
  assert.equal(isMetricDrivenExercise("strength", definitions), false);
  assert.equal(isLegacyResistanceMetricModel("cardio", definitions), false);
});

test("distance and time normalize to meters and seconds", () => {
  assert.deepEqual(
    normalizeMetricValues(
      [1.5, 2],
      [
        { type: "distance", label: "Distance", unit: "mi", required: true },
        { type: "time", label: "Time", unit: "min", required: true },
      ],
      "kg",
      true,
    ),
    [2414.016, 120],
  );
});

test("profile and fixed weight units normalize to kilograms", () => {
  assert.deepEqual(
    normalizeMetricValues(
      [100, 45],
      [
        { type: "weight", label: "Load", unit: "profile", required: true },
        { type: "weight", label: "Added load", unit: "lb", required: false },
      ],
      "lb",
      true,
    ),
    [45.359237, 20.41165665],
  );
});

test("required metrics are enforced while optional metrics may be blank", () => {
  const definitions = [
    { type: "reps", label: "Reps", unit: "reps", required: true },
    { type: "height", label: "Height", unit: "cm", required: false },
  ];
  assert.throws(
    () => normalizeMetricValues([null, 45], definitions, "kg", true),
    /Reps is required/,
  );
  assert.deepEqual(
    normalizeMetricValues([8, null], definitions, "kg", true),
    [8, null],
  );
  assert.equal(
    normalizedMetricValuesAreComplete([8, null], definitions),
    true,
  );
  assert.equal(
    normalizedMetricValuesAreComplete([null, null], definitions),
    false,
  );
});

test("metric input rejects negative or non-finite values", () => {
  const definitions = [
    { type: "distance", label: "Distance", unit: "km", required: true },
  ];
  assert.throws(() => normalizeMetricValues([-1], definitions, "kg", true), /non-negative/);
  assert.throws(() => normalizeMetricValues([Infinity], definitions, "kg", true), /non-negative/);
});
