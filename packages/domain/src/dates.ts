import type { ContributionCadence } from '@goalpilot/contracts';

const millisecondsPerDay = 86_400_000;

export function parseCalendarDate(value: string): Date {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1));
}

export function formatCalendarDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round(
    (parseCalendarDate(to).getTime() - parseCalendarDate(from).getTime()) / millisecondsPerDay,
  );
}

export function addCalendarDays(value: string, days: number): string {
  const date = parseCalendarDate(value);
  date.setUTCDate(date.getUTCDate() + days);
  return formatCalendarDate(date);
}

export function addCalendarMonths(value: string, months: number): string {
  const source = parseCalendarDate(value);
  const sourceDay = source.getUTCDate();
  const sourceMonthLastDay = new Date(
    Date.UTC(source.getUTCFullYear(), source.getUTCMonth() + 1, 0),
  ).getUTCDate();
  const targetFirst = new Date(Date.UTC(source.getUTCFullYear(), source.getUTCMonth() + months, 1));
  const targetLastDay = new Date(
    Date.UTC(targetFirst.getUTCFullYear(), targetFirst.getUTCMonth() + 1, 0),
  ).getUTCDate();
  targetFirst.setUTCDate(
    sourceDay === sourceMonthLastDay ? targetLastDay : Math.min(sourceDay, targetLastDay),
  );
  return formatCalendarDate(targetFirst);
}

export function generateContributionDates(
  asOfDate: string,
  targetDate: string,
  cadence: ContributionCadence,
): readonly string[] {
  if (daysBetween(asOfDate, targetDate) <= 0) return [];
  const dates: string[] = [];
  let occurrence = 1;
  let next = contributionDateAt(asOfDate, cadence, occurrence);
  while (next <= targetDate) {
    dates.push(next);
    occurrence += 1;
    next = contributionDateAt(asOfDate, cadence, occurrence);
  }
  return dates;
}

function contributionDateAt(
  anchorDate: string,
  cadence: ContributionCadence,
  occurrence: number,
): string {
  return cadence === 'weekly'
    ? addCalendarDays(anchorDate, 7 * occurrence)
    : cadence === 'biweekly'
      ? addCalendarDays(anchorDate, 14 * occurrence)
      : addCalendarMonths(anchorDate, occurrence);
}

export function isMonthEnd(value: string): boolean {
  return addCalendarDays(value, 1).slice(5, 7) !== value.slice(5, 7);
}
