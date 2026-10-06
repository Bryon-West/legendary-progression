import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const base = JSON.parse(await readFile(new URL('../../../../lib/db/exercise-library-v21.json', import.meta.url), 'utf8'));
const additions = JSON.parse(await readFile(new URL('../../../../lib/db/src/exercise-library-v22-additions.json', import.meta.url), 'utf8'));
const catalog = [...base, ...additions];
const normalize = (value) => value.toLowerCase().replace(/[^a-z0-9]/g, '');

test('exercise catalog retains its existing entries and adds broad activity coverage', () => {
  assert.equal(base.length, 185);
  assert.equal(additions.length, 73);
  assert.equal(catalog.length, 258);
  for (const category of ['strength', 'bodyweight', 'calisthenics', 'cardio', 'plyometric', 'carry', 'sled']) {
    assert.ok(catalog.some((exercise) => exercise.category === category), `missing ${category} exercises`);
  }
});

test('exercise names and aliases remain unambiguous', () => {
  const names = new Map();
  for (const exercise of catalog) {
    for (const candidate of [exercise.name, ...(exercise.aliases ?? [])]) {
      const key = normalize(candidate);
      const existing = names.get(key);
      assert.ok(!existing || existing === exercise.name, `${candidate} collides with ${existing}`);
      names.set(key, exercise.name);
    }
  }
});

test('new non-resistance activities define one or two valid logging metrics', () => {
  const metricCategories = new Set(['calisthenics', 'cardio', 'plyometric', 'carry', 'sled']);
  for (const exercise of additions.filter((item) => metricCategories.has(item.category))) {
    assert.ok(exercise.metricDefinitions?.length >= 1 && exercise.metricDefinitions.length <= 2, `${exercise.name} has an invalid metric count`);
    for (const metric of exercise.metricDefinitions) {
      assert.ok(metric.label.trim().length > 0, `${exercise.name} has an empty metric label`);
      assert.equal(typeof metric.required, 'boolean');
    }
  }
});
