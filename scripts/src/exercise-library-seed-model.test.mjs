import assert from 'node:assert/strict';
import test from 'node:test';
import { needsCatalogMetadataUpdate } from './exercise-library-seed-model.ts';

const seed = {
  name: 'Dumbbell Row',
  secondaryMuscles: ['Biceps'],
  aliases: ['One-arm row'],
  defaultRepMin: 8,
  defaultRepMax: 12,
  loadIncrementLb: 5,
  loadIncrementKg: 2.5,
  metricDefinitions: undefined,
};
const existing = {
  name: 'Dumbbell Row',
  secondaryMuscles: ['Biceps'],
  aliases: ['One-arm row'],
  defaultRepMin: 8,
  defaultRepMax: 12,
  loadIncrementLb: 5,
  loadIncrementKg: 2.5,
  metricDefinitions: null,
};

test('seed dry-run detects only metadata that the additive update would fill', () => {
  assert.equal(needsCatalogMetadataUpdate(existing, seed), false);
  assert.equal(needsCatalogMetadataUpdate({ ...existing, metricDefinitions: null }, { ...seed, metricDefinitions: [{ type: 'reps', label: 'Reps', unit: 'reps', required: true }] }), true);
  assert.equal(needsCatalogMetadataUpdate({ ...existing, loadIncrementLb: null }, seed), true);
  assert.equal(needsCatalogMetadataUpdate({ ...existing, name: 'One-arm row', aliases: [] }, seed), true);
});

test('seed metadata detection preserves populated custom values', () => {
  assert.equal(needsCatalogMetadataUpdate(
    { ...existing, defaultRepMin: 6, defaultRepMax: 10, loadIncrementLb: 10, aliases: ['Custom name'] },
    { ...seed, defaultRepMin: 8, defaultRepMax: 12, loadIncrementLb: 5 },
  ), false);
});
