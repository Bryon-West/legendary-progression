import assert from "node:assert/strict";
import test from "node:test";
import { beatsComparablePerformance, derivePersonalRecords } from "./personal-records-core.ts";

const candidate = (overrides = {}) => ({
  exerciseId: 7,
  exerciseName: "Barbell Bench Press",
  sessionId: 1,
  sessionDate: "2026-09-25T16:00:00.000Z",
  sessionStatus: "completed",
  setId: 1,
  setNumber: 1,
  setType: "work",
  completed: true,
  removed: false,
  skipped: false,
  actualWeight: 225,
  actualReps: 8,
  actualRir: 3,
  ...overrides,
});

test("a completed working set establishes the initial load and performance records", () => {
  const [record] = derivePersonalRecords([candidate()], "lb");
  assert.equal(record.heaviestLoad?.setId, 1);
  assert.equal(record.bestPerformance?.setId, 1);
  assert.equal(record.history[0].heaviestLoadRecord, true);
  assert.equal(record.history[0].legendaryPerformanceRecord, true);
});

test("225 x 8 to 230 x 8 at the same RIR is a comparable performance PR", () => {
  const records = derivePersonalRecords([
    candidate(),
    candidate({
      sessionId: 2,
      setId: 2,
      sessionDate: "2026-10-02T16:00:00.000Z",
      actualWeight: 230,
      actualReps: 8,
      actualRir: 3,
    }),
  ], "lb");
  assert.equal(records[0].bestPerformance?.setId, 2);
  assert.equal(records[0].history[1].legendaryPerformanceRecord, true);
  assert.equal(records[0].history[1].heaviestLoadRecord, true);
});

test("RIR affects performance comparison and the ±20 lb range is enforced", () => {
  assert.equal(beatsComparablePerformance(
    { actualWeight: 230, actualReps: 8, actualRir: 2 },
    { weight: 225, reps: 8, rir: 2 },
    "lb",
  ), true);
  assert.equal(beatsComparablePerformance(
    { actualWeight: 230, actualReps: 7, actualRir: 2 },
    { weight: 225, reps: 8, rir: 2 },
    "lb",
  ), false);
  assert.equal(beatsComparablePerformance(
    { actualWeight: 250, actualReps: 12, actualRir: 0 },
    { weight: 225, reps: 8, rir: 2 },
    "lb",
  ), false);
});

test("kilogram records use the same five-pound equivalence rule", () => {
  assert.equal(beatsComparablePerformance(
    { actualWeight: 104.326, actualReps: 8, actualRir: 2 },
    { weight: 102.058, reps: 8, rir: 2 },
    "kg",
  ), true);
});

test("warmups, incomplete, removed, and skipped sets are excluded while a completed active set qualifies", () => {
  const rows = [
    candidate(),
    candidate({ setId: 2, setType: "warmup", actualWeight: 240 }),
    candidate({ setId: 3, completed: false, actualWeight: 250 }),
    candidate({ setId: 4, removed: true, actualWeight: 260 }),
    candidate({ setId: 5, skipped: true, actualWeight: 270 }),
    candidate({ setId: 6, sessionId: 2, sessionStatus: "active", actualWeight: 230 }),
  ];
  const [record] = derivePersonalRecords(rows, "lb");
  assert.deepEqual(record.history.map((entry) => entry.setId), [1, 6]);
  assert.equal(record.history[1].legendaryPerformanceRecord, true);
});

test("record milestones remain in actual workout-date order", () => {
  const [record] = derivePersonalRecords([
    candidate({ sessionId: 3, setId: 3, sessionDate: "2026-10-09T16:00:00.000Z", actualWeight: 235, actualRir: 2 }),
    candidate({ sessionId: 1, setId: 1, sessionDate: "2026-09-25T16:00:00.000Z", actualRir: 2 }),
    candidate({ sessionId: 2, setId: 2, sessionDate: "2026-10-02T16:00:00.000Z", actualWeight: 230, actualRir: 2 }),
  ], "lb");
  assert.deepEqual(record.history.map((entry) => entry.sessionId), [1, 2, 3]);
  assert.deepEqual(record.history.filter((entry) => entry.legendaryPerformanceRecord).map((entry) => entry.sessionDate.slice(0, 10)), [
    "2026-09-25",
    "2026-10-02",
    "2026-10-09",
  ]);
});