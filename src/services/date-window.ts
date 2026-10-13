/**
 * @fileoverview Calendar-day validation and bounded schedule acquisition windows.
 * @module services/date-window
 */
import { validationError } from '@cyanheads/mcp-ts-core/errors';

/** Advance an ISO calendar date without applying the machine's local timezone. */
export function addCalendarDays(date: string, days: number): string {
  const instant = new Date(`${date}T00:00:00Z`);
  instant.setUTCDate(instant.getUTCDate() + days);
  return instant.toISOString().slice(0, 10);
}

/** A dated request's original bounds and its first seven provider days. */
export function dateWindow(from?: string, to?: string) {
  const requestedDateFrom = from || to;
  if (!requestedDateFrom) return;
  const requestedDateTo = to || requestedDateFrom;
  for (const date of [requestedDateFrom, requestedDateTo]) {
    const instant = new Date(`${date}T00:00:00Z`);
    if (!Number.isFinite(instant.getTime()) || instant.toISOString().slice(0, 10) !== date)
      throw validationError('Schedule bounds must be real calendar dates in YYYY-MM-DD format.', {
        recovery: { hint: 'Check date_from and date_to and supply real calendar dates.' },
      });
  }
  if (requestedDateFrom > requestedDateTo)
    throw validationError('date_from must be on or before date_to.', {
      recovery: { hint: 'Put the earlier date in date_from and the later date in date_to.' },
    });
  const days = (Date.parse(requestedDateTo) - Date.parse(requestedDateFrom)) / 86400_000;
  const servedDateTo = addCalendarDays(requestedDateFrom, Math.min(days, 6));
  return { requestedDateFrom, requestedDateTo, servedDateFrom: requestedDateFrom, servedDateTo };
}

/** Today's date under the explicit US Eastern default-score convention, including DST. */
export function easternToday(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}
