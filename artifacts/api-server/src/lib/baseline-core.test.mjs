import assert from "node:assert/strict";
import test from "node:test";
import { baselineExpiryAfterPauses } from "./baseline-core.ts";

test("configured six-week baseline expiry pauses for complete week-off intervals", () => {
  const result = baselineExpiryAfterPauses({
    establishedAt: new Date("2025-01-01T12:00:00.000Z"),
    expiresAt: new Date("2025-02-12T12:00:00.000Z"),
    now: new Date("2025-02-20T12:00:00.000Z"),
    pausedWeekOffCount: 0,
    weekOffIntervals: [
      { startsAt: "2025-01-20", endsAt: "2025-01-26" },
      { startsAt: "2025-02-03", endsAt: "2025-02-09" },
    ],
  });
  assert.equal(result.pausedWeekOffCount, 2);
  assert.equal(result.expiresAt.toISOString(), "2025-02-26T12:00:00.000Z");
});

test("a week off after the baseline has already expired cannot revive it", () => {
  const result = baselineExpiryAfterPauses({
    establishedAt: new Date("2025-01-01T00:00:00.000Z"),
    expiresAt: new Date("2025-02-12T00:00:00.000Z"),
    now: new Date("2025-04-01T00:00:00.000Z"),
    pausedWeekOffCount: 0,
    weekOffIntervals: [{ startsAt: "2025-03-01", endsAt: "2025-03-07" }],
  });
  assert.equal(result.pausedWeekOffCount, 0);
  assert.equal(result.expiresAt.toISOString(), "2025-02-12T00:00:00.000Z");
});