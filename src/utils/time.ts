/** Timezone helpers. Uses the Intl API so this works for any IANA zone an admin configures. */

export function getTimeZoneOffsetMinutes(instant: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = dtf.formatToParts(instant).reduce<Record<string, string>>((acc, p) => {
    acc[p.type] = p.value;
    return acc;
  }, {});
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour === "24" ? "0" : parts.hour),
    Number(parts.minute),
    Number(parts.second)
  );
  return (asUtc - instant.getTime()) / 60000;
}

/** Returns the wall-clock date/time parts of `instant` as seen in `timeZone`. */
export function getZonedParts(instant: Date, timeZone: string) {
  const offsetMin = getTimeZoneOffsetMinutes(instant, timeZone);
  const shifted = new Date(instant.getTime() + offsetMin * 60000);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    weekday: shifted.getUTCDay(), // 0=Sunday..6=Saturday
    daysInMonth: new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, 0)).getUTCDate(),
  };
}

/** Converts local wall-clock date/time in `timeZone` to a UTC Date instant. */
export function zonedTimeToUtc(
  parts: { year: number; month: number; day: number; hour: number; minute: number },
  timeZone: string
): Date {
  const guessUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, 0);
  const offsetMin = getTimeZoneOffsetMinutes(new Date(guessUtc), timeZone);
  return new Date(guessUtc - offsetMin * 60000);
}

export function startOfDayInZone(instant: Date, timeZone: string): Date {
  const p = getZonedParts(instant, timeZone);
  return zonedTimeToUtc({ year: p.year, month: p.month, day: p.day, hour: 0, minute: 0 }, timeZone);
}

/** Rolling window start: `days` days before `instant` (e.g. "last 7 days"), not the calendar period start. */
export function daysBeforeInstant(instant: Date, days: number): Date {
  return new Date(instant.getTime() - days * 24 * 60 * 60 * 1000);
}

/** True if `instant`, in `timeZone`, falls exactly `daysBefore` days before the last day of its month. */
export function isDaysBeforeMonthEnd(instant: Date, timeZone: string, daysBefore: number): boolean {
  const p = getZonedParts(instant, timeZone);
  return p.day === p.daysInMonth - daysBefore;
}
