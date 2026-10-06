import assert from "node:assert/strict";
import test from "node:test";
import {
  hypertrophyEightWeekPlan,
  sizeTwelveWeekPlan,
} from "./mesocycle-template-plan.ts";

const kinds = (plan) => plan.map((week) => week.kind);
const rirs = (plan) => plan.map((week) => week.targetRir);

test("8-week hypertrophy alternates two three-week loading blocks with deloads", () => {
  assert.equal(hypertrophyEightWeekPlan.length, 8);
  assert.deepEqual(kinds(hypertrophyEightWeekPlan), [
    "loading", "loading", "loading", "deload",
    "loading", "loading", "loading", "deload",
  ]);
  assert.deepEqual(rirs(hypertrophyEightWeekPlan), [3, 2, 1, null, 3, 2, 1, null]);
});

test("12-week Size uses three loading weeks followed by a deload in every block", () => {
  assert.equal(sizeTwelveWeekPlan.length, 12);
  assert.deepEqual(kinds(sizeTwelveWeekPlan), [
    "loading", "loading", "loading", "deload",
    "loading", "loading", "loading", "deload",
    "loading", "loading", "loading", "deload",
  ]);
  assert.deepEqual(rirs(sizeTwelveWeekPlan), [3, 2, 1, null, 3, 2, 1, null, 3, 2, 1, null]);
});
