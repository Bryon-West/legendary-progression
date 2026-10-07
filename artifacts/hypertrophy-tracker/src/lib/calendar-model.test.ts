import assert from "node:assert/strict";
import test from "node:test";
import type { CalendarWeek, CalendarWorkout } from "@workspace/api-client-react";
import {
  buildCalendarEventsByDate,
  getCalendarMonth,
  localSessionDate,
  shouldShowPlannedSchedule,
  shiftCalendarMonth,
} from "./calendar-model";

function planWeek(workouts: CalendarWorkout[] = []) {
  return {
    weekId: 10,
    weekIndex: 1,
    kind: "loading",
    targetRir: 2,
    status: "in_progress",
    startDate: "2026-10-05",
    endDate: "2026-10-11",
    scheduledWorkouts: workouts,
  } as CalendarWeek;
}

function plannedWorkout(overrides: Partial<CalendarWorkout> = {}) {
  return {
    id: 22,
    splitId: 4,
    weekId: 10,
    weekIndex: 1,
    weekKind: "loading",
    targetRir: 2,
    dayName: "Upper A",
    scheduledDate: "2026-10-06",
    originalScheduledDate: "2026-10-06",
    status: "scheduled",
    sessionId: null,
    isToday: false,
    projectedExercises: [],
    ...overrides,
  } as CalendarWorkout;
}

test("an empty account still has a complete, navigable month grid", () => {
  const month = getCalendarMonth("2026-10");
  assert.equal(month.days.length, 31);
  assert.equal(month.startDate, "2026-10-01");
  assert.equal(month.endDate, "2026-10-31");
  assert.equal(month.leadingBlankDays, 3);
  assert.deepEqual([...buildCalendarEventsByDate([], []).keys()], []);
  assert.equal(shiftCalendarMonth("2026-10", -1), "2026-09");
  assert.equal(shiftCalendarMonth("2026-12", 1), "2027-01");
});

test("completed open-session history is placed on its actual local start date without a mesocycle", () => {
  const session = {
    id: 41,
    dayName: "Open workout",
    startedAt: "2026-10-06T18:30:00.000Z",
  };
  const events = buildCalendarEventsByDate([session], []);
  assert.equal(events.get(localSessionDate(session.startedAt))?.[0]?.kind, "completed");
  assert.equal(events.get("2026-10-06")?.length, 1);
});

test("active planned sessions overlay actual completed history without duplicating completed plans", () => {
  const history = [{
    id: 41,
    dayName: "Upper A",
    startedAt: "2026-10-07T15:30:00.000Z",
  }];
  const weeks = [planWeek([
    plannedWorkout({ status: "completed", sessionId: 41 }),
    plannedWorkout({ id: 23, dayName: "Lower B", scheduledDate: "2026-10-09" }),
  ])];
  const events = buildCalendarEventsByDate(history, weeks);
  assert.equal(events.get("2026-10-06"), undefined);
  assert.equal(events.get("2026-10-07")?.[0]?.kind, "completed");
  assert.equal(events.get("2026-10-09")?.[0]?.kind, "planned");
});

test("actual history remains visible after plans end or are deleted and is mode-independent", () => {
  const sessions = [{
    id: 51,
    dayName: "Pull",
    startedAt: "2026-10-08T16:00:00.000Z",
  }];
  for (const mode of ["basic", "legendary_pro"]) {
    const events = buildCalendarEventsByDate(sessions, []);
    assert.equal(events.get("2026-10-08")?.[0]?.kind, "completed", `${mode} retains history`);
  }
  assert.equal(shouldShowPlannedSchedule("completed"), false);
  assert.equal(shouldShowPlannedSchedule("ended_early"), false);
  assert.equal(shouldShowPlannedSchedule("active"), true);
  assert.equal(shouldShowPlannedSchedule("paused"), true);
});

test("Log and Calendar use the same persisted startedAt date for a session", () => {
  const logSession = {
    id: 61,
    dayName: "Upper B",
    startedAt: "2026-10-06T19:15:00.000Z",
  };
  const events = buildCalendarEventsByDate([logSession], []);
  assert.ok(events.get(localSessionDate(logSession.startedAt))?.some(
    (event) => event.kind === "completed" && event.session.id === logSession.id,
  ));
});
