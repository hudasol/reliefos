// Timezone-correct conversion between a wall-clock time in an IANA zone and UTC, using only Intl.

function offsetMinutes(utc: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(utc);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return Math.round((asUtc - utc.getTime()) / 60_000);
}

/** The UTC instant at which the wall clock in `timeZone` reads `date` `time` (YYYY-MM-DD, HH:MM). */
export function zonedToUtc(date: string, time: string, timeZone: string): Date {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const [hh, mm] = time.split(':').map(Number) as [number, number];
  const guess = new Date(Date.UTC(y, m - 1, d, hh, mm));
  // Two passes handle DST boundaries.
  let utc = new Date(guess.getTime() - offsetMinutes(guess, timeZone) * 60_000);
  utc = new Date(guess.getTime() - offsetMinutes(utc, timeZone) * 60_000);
  return utc;
}

/** Wall-clock parts of an instant in `timeZone`. */
export function utcToZonedParts(instant: Date | string, timeZone: string): { date: string; time: string } {
  const d = typeof instant === 'string' ? new Date(instant) : instant;
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
  return { date: `${get('year')}-${get('month')}-${get('day')}`, time: `${get('hour')}:${get('minute')}` };
}

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** "4:40 PM EDT" in the given zone; falls back to ISO when no zone is known. */
export function localTime(instant: Date | string, timeZone: string | undefined): string {
  const d = typeof instant === 'string' ? new Date(instant) : instant;
  if (!timeZone) return d.toISOString();
  return new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(d);
}
