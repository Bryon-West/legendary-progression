import type {
  CalendarWeek,
  CalendarWorkout,
  WorkoutCalendarHistoryEntry,
} from "@workspace/api-client-react";
import { toDateString } from "./dates";

export type CalendarHistorySession = Pick<
  WorkoutCalendarHistoryEntry,
  "id" | "dayName" | "startedAt"
>;

export type CalendarDayEvent =
  | { kind: "completed"; session: CalendarHistorySession }
  | { kind: "planned"; week: CalendarWeek; workout: CalendarWorkout };

export function getCalendarMonth(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  if (!year || !monthNumber || monthNumber > 12 || monthNumber < 1) {
    throw new Error(`Invalid calendar month: ${month}`);
  }
  const firstDay = new Date(year, monthNumber - 1, 1);
  const dayCount = new Date(year, monthNumber, 0).getDate();
  return {
    startDate: toDateString(firstDay),
    endDate: toDateString(new Date(year, monthNumber - 1, dayCount)),
    leadingBlankDays: (firstDay.getDay() + 6) % 7,
    days: Array.from({ length: dayCount }, (_, index) =>
      toDateString(new Date(year, monthNumber - 1, index + 1)),
    ),
  };
}

export function shiftCalendarMonth(month: string, offset: number) {
  const [year, monthNumber] = month.split("-").map(Number);
  if (!year || !monthNumber || monthNumber > 12 || monthNumber < 1) {
    throw new Error(`Invalid calendar month: ${month}`);
  }
  return toDateString(new Date(year, monthNumber - 1 + offset, 1)).slice(0, 7);
}

export function localSessionDate(startedAt: string | Date) {
  return toDateString(startedAt instanceof Date ? startedAt : new Date(startedAt));
}

export function shouldShowPlannedSchedule(lifecycleStatus: string | undefined) {
  return lifecycleStatus === "planned"
    || lifecycleStatus === "active"
    || lifecycleStatus === "paused";
}

export function buildCalendarEventsByDate(
  history: CalendarHistorySession[],
  weeks: CalendarWeek[],
) {
  const events = new Map<string, CalendarDayEvent[]>();
  const add = (date: string, event: CalendarDayEvent) => {
    const dayEvents = events.get(date) ?? [];
    dayEvents.push(event);
    events.set(date, dayEvents);
  };

  for (const session of history) {
    add(localSessionDate(session.startedAt), { kind: "completed", session });
  }
  for (const week of weeks) {
    for (const workout of week.scheduledWorkouts) {
      // Completed occurrences are represented by their persisted session's
      // actual start date, which may differ from the scheduled date.
      if (workout.status === "scheduled") {
        add(workout.scheduledDate, { kind: "planned", week, workout });
      }
    }
  }
  return events;
}
