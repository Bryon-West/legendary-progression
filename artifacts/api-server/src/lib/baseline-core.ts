export type BaselinePauseInterval = { startsAt: string; endsAt: string };

export function baselineExpiryAfterPauses(input: {
  expiresAt: Date;
  establishedAt: Date;
  now: Date;
  pausedWeekOffCount: number;
  weekOffIntervals: BaselinePauseInterval[];
}) {
  const uniqueIntervals = new Map(input.weekOffIntervals.map((interval) => [
    `${interval.startsAt}/${interval.endsAt}`,
    {
      start: new Date(`${interval.startsAt}T00:00:00.000Z`),
      end: new Date(`${interval.endsAt}T23:59:59.999Z`),
    },
  ]));
  const completedIntervals = [...uniqueIntervals.values()]
    .filter((interval) =>
      interval.start.toISOString().slice(0, 10) >= input.establishedAt.toISOString().slice(0, 10) &&
      interval.start.getTime() <= input.expiresAt.getTime() &&
      interval.end.getTime() < input.now.getTime(),
    )
    .sort((left, right) => left.start.getTime() - right.start.getTime());
  let expiresAt = new Date(input.expiresAt);
  let pausedWeekOffCount = input.pausedWeekOffCount;
  for (const [index, interval] of completedIntervals.entries()) {
    if (index < input.pausedWeekOffCount) continue;
    if (interval.start.getTime() <= expiresAt.getTime()) {
      expiresAt = new Date(expiresAt.getTime() + 7 * 86400000);
      pausedWeekOffCount += 1;
    }
  }
  return { expiresAt, pausedWeekOffCount };
}