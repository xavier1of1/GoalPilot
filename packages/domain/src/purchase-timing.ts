import { Decimal } from 'decimal.js';

import { addCalendarDays, daysBetween, formatCalendarDate, parseCalendarDate } from './dates.js';
import type { PlanHealthCode } from './plan-health.js';

export const purchaseTimingPolicyVersion = 'purchase-timing-v1' as const;

export type PurchaseTimingState =
  | 'INSUFFICIENT_DATA'
  | 'STALE_DATA'
  | 'HISTORICALLY_FAVORABLE_PLAN_READY'
  | 'HISTORICALLY_FAVORABLE_PLAN_NOT_READY'
  | 'HISTORICALLY_ELEVATED'
  | 'WATCH'
  | 'HISTORICALLY_TYPICAL';

export type PurchaseTimingValidationCode =
  | 'INVALID_AS_OF_DATE'
  | 'INVALID_OBSERVATION_DATE'
  | 'FUTURE_OBSERVATION'
  | 'NONPOSITIVE_PRICE'
  | 'CURRENCY_MISMATCH'
  | 'SOURCE_VERSION_MISMATCH'
  | 'CONFLICTING_DUPLICATE';

export class PurchaseTimingValidationError extends RangeError {
  public readonly code: PurchaseTimingValidationCode;

  public constructor(code: PurchaseTimingValidationCode, message: string) {
    super(message);
    this.name = 'PurchaseTimingValidationError';
    this.code = code;
  }
}

export interface HistoricalPriceObservation {
  readonly observationKey: string;
  readonly observationDate: string;
  readonly priceCents: number;
  readonly currency: string;
  readonly sourceVersion: string;
}

export interface PurchaseTimingAssessmentInput {
  readonly asOfDate: string;
  readonly currency: string;
  readonly sourceVersion: string;
  readonly targetPriceCents: number;
  readonly planHealth: PlanHealthCode | null;
  readonly observations: readonly HistoricalPriceObservation[];
}

export interface PurchaseTimingStatistics {
  readonly minimumPriceCents: number;
  readonly medianPriceCents: number;
  readonly maximumPriceCents: number;
  readonly currentPriceCents: number;
  readonly currentEmpiricalPercentileBasisPoints: number;
  readonly differenceFromMedianCents: number;
  readonly differenceFromTargetCents: number;
  readonly observationCount: number;
  readonly dataSpanDays: number;
  readonly freshnessDays: number;
  readonly earliestObservationDate: string;
  readonly latestObservationDate: string;
}

export interface SeasonalMonthStatistics {
  readonly calendarMonth: string;
  readonly observationCount: number;
  readonly medianPriceCents: number;
}

export interface PurchaseTimingAssessment {
  readonly policyVersion: typeof purchaseTimingPolicyVersion;
  readonly sourceVersion: string;
  readonly currency: string;
  readonly asOfDate: string;
  readonly planHealth: PlanHealthCode | null;
  readonly state: PurchaseTimingState;
  readonly rationaleCodes: readonly string[];
  readonly currentObservation: HistoricalPriceObservation | null;
  readonly statistics: PurchaseTimingStatistics | null;
  readonly seasonalMonths: readonly SeasonalMonthStatistics[] | null;
  readonly validObservations: readonly HistoricalPriceObservation[];
}

function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  try {
    return formatCalendarDate(parseCalendarDate(value)) === value;
  } catch {
    return false;
  }
}

function medianCents(sortedPrices: readonly number[]): number {
  const upperIndex = Math.floor(sortedPrices.length / 2);
  const upper = sortedPrices[upperIndex];
  if (upper === undefined) throw new RangeError('A median requires at least one price.');
  if (sortedPrices.length % 2 === 1) return upper;
  const lower = sortedPrices[upperIndex - 1];
  if (lower === undefined) throw new RangeError('A median requires at least one price.');
  return new Decimal(lower)
    .plus(upper)
    .dividedBy(2)
    .toDecimalPlaces(0, Decimal.ROUND_HALF_EVEN)
    .toNumber();
}

function equalObservations(
  left: HistoricalPriceObservation,
  right: HistoricalPriceObservation,
): boolean {
  return (
    left.observationKey === right.observationKey &&
    left.observationDate === right.observationDate &&
    left.priceCents === right.priceCents &&
    left.currency === right.currency &&
    left.sourceVersion === right.sourceVersion
  );
}

function compareObservations(
  left: HistoricalPriceObservation,
  right: HistoricalPriceObservation,
): number {
  if (left.observationDate !== right.observationDate) {
    return left.observationDate < right.observationDate ? -1 : 1;
  }
  if (left.observationKey === right.observationKey) return 0;
  return left.observationKey < right.observationKey ? -1 : 1;
}

function validateAndWindow(
  input: PurchaseTimingAssessmentInput,
): readonly HistoricalPriceObservation[] {
  if (!isCalendarDate(input.asOfDate)) {
    throw new PurchaseTimingValidationError('INVALID_AS_OF_DATE', 'asOfDate is invalid.');
  }
  if (!Number.isSafeInteger(input.targetPriceCents) || input.targetPriceCents <= 0) {
    throw new RangeError('targetPriceCents must be a positive safe integer number of cents.');
  }

  const byKey = new Map<string, HistoricalPriceObservation>();
  for (const observation of input.observations) {
    if (!isCalendarDate(observation.observationDate)) {
      throw new PurchaseTimingValidationError(
        'INVALID_OBSERVATION_DATE',
        'An observation date is invalid.',
      );
    }
    if (observation.observationDate > input.asOfDate) {
      throw new PurchaseTimingValidationError(
        'FUTURE_OBSERVATION',
        'An observation cannot be after asOfDate.',
      );
    }
    if (!Number.isSafeInteger(observation.priceCents) || observation.priceCents <= 0) {
      throw new PurchaseTimingValidationError(
        'NONPOSITIVE_PRICE',
        'Observation prices must be positive integer cents.',
      );
    }
    if (observation.currency !== input.currency) {
      throw new PurchaseTimingValidationError(
        'CURRENCY_MISMATCH',
        'All observations must use the assessment currency.',
      );
    }
    if (observation.sourceVersion !== input.sourceVersion) {
      throw new PurchaseTimingValidationError(
        'SOURCE_VERSION_MISMATCH',
        'All observations must use the assessment source version.',
      );
    }
    const existing = byKey.get(observation.observationKey);
    if (existing !== undefined) {
      if (equalObservations(existing, observation)) continue;
      throw new PurchaseTimingValidationError(
        'CONFLICTING_DUPLICATE',
        'A logical observation key has conflicting values.',
      );
    }
    byKey.set(observation.observationKey, observation);
  }

  const windowStart = addCalendarDays(input.asOfDate, -730);
  return [...byKey.values()]
    .filter((observation) => observation.observationDate >= windowStart)
    .sort(compareObservations);
}

function calculateStatistics(
  observations: readonly HistoricalPriceObservation[],
  asOfDate: string,
  targetPriceCents: number,
): PurchaseTimingStatistics | null {
  const current = observations.at(-1);
  const earliest = observations[0];
  if (current === undefined || earliest === undefined) return null;
  const sortedPrices = observations
    .map((observation) => observation.priceCents)
    .sort((a, b) => a - b);
  const minimumPriceCents = sortedPrices[0];
  const maximumPriceCents = sortedPrices.at(-1);
  if (minimumPriceCents === undefined || maximumPriceCents === undefined) return null;
  const currentPriceCents = current.priceCents;
  const lessCount = sortedPrices.filter((price) => price < currentPriceCents).length;
  const equalCount = sortedPrices.filter((price) => price === currentPriceCents).length;
  const currentEmpiricalPercentileBasisPoints = new Decimal(lessCount)
    .plus(new Decimal(equalCount).times('0.5'))
    .dividedBy(sortedPrices.length)
    .times(10_000)
    .toDecimalPlaces(0, Decimal.ROUND_HALF_EVEN)
    .toNumber();
  const medianPriceCents = medianCents(sortedPrices);

  return {
    minimumPriceCents,
    medianPriceCents,
    maximumPriceCents,
    currentPriceCents,
    currentEmpiricalPercentileBasisPoints,
    differenceFromMedianCents: currentPriceCents - medianPriceCents,
    differenceFromTargetCents: currentPriceCents - targetPriceCents,
    observationCount: observations.length,
    dataSpanDays: daysBetween(earliest.observationDate, current.observationDate),
    freshnessDays: daysBetween(current.observationDate, asOfDate),
    earliestObservationDate: earliest.observationDate,
    latestObservationDate: current.observationDate,
  };
}

function calculateSeasonalMonths(
  observations: readonly HistoricalPriceObservation[],
  statistics: PurchaseTimingStatistics | null,
): readonly SeasonalMonthStatistics[] | null {
  if (statistics === null || statistics.dataSpanDays < 730) return null;
  const byMonth = new Map<string, number[]>();
  for (let month = 1; month <= 12; month += 1) {
    byMonth.set(String(month).padStart(2, '0'), []);
  }
  for (const observation of observations) {
    const month = observation.observationDate.slice(5, 7);
    byMonth.get(month)?.push(observation.priceCents);
  }

  const months: SeasonalMonthStatistics[] = [];
  for (let month = 1; month <= 12; month += 1) {
    const calendarMonth = String(month).padStart(2, '0');
    const prices = byMonth.get(calendarMonth) ?? [];
    if (prices.length < 3) return null;
    prices.sort((left, right) => left - right);
    months.push({
      calendarMonth,
      observationCount: prices.length,
      medianPriceCents: medianCents(prices),
    });
  }
  return months;
}

function determineState(
  statistics: PurchaseTimingStatistics | null,
  planHealth: PlanHealthCode | null,
): { readonly state: PurchaseTimingState; readonly rationaleCodes: readonly string[] } {
  if (statistics === null || statistics.observationCount < 30) {
    return { state: 'INSUFFICIENT_DATA', rationaleCodes: ['INSUFFICIENT_OBSERVATION_COUNT'] };
  }
  if (statistics.dataSpanDays < 90) {
    return { state: 'INSUFFICIENT_DATA', rationaleCodes: ['INSUFFICIENT_OBSERVATION_SPAN'] };
  }
  if (statistics.freshnessDays > 14) {
    return { state: 'STALE_DATA', rationaleCodes: ['LATEST_OBSERVATION_STALE'] };
  }
  if (statistics.currentEmpiricalPercentileBasisPoints <= 2_500) {
    if (planHealth === 'PURCHASE_READY') {
      return {
        state: 'HISTORICALLY_FAVORABLE_PLAN_READY',
        rationaleCodes: ['PRICE_AT_OR_BELOW_FAVORABLE_PERCENTILE', 'PLAN_PURCHASE_READY'],
      };
    }
    const readinessRationale =
      planHealth === 'PAUSED'
        ? 'PLAN_PAUSED'
        : planHealth === 'FUNDED_BUT_LOCKED'
          ? 'PLAN_FUNDED_BUT_LOCKED'
          : 'PLAN_NOT_PURCHASE_READY';
    return {
      state: 'HISTORICALLY_FAVORABLE_PLAN_NOT_READY',
      rationaleCodes: ['PRICE_AT_OR_BELOW_FAVORABLE_PERCENTILE', readinessRationale],
    };
  }
  if (statistics.currentEmpiricalPercentileBasisPoints >= 7_500) {
    return {
      state: 'HISTORICALLY_ELEVATED',
      rationaleCodes: ['PRICE_AT_OR_ABOVE_ELEVATED_PERCENTILE'],
    };
  }
  if (statistics.differenceFromTargetCents > 0) {
    return { state: 'WATCH', rationaleCodes: ['PRICE_ABOVE_TARGET'] };
  }
  return { state: 'HISTORICALLY_TYPICAL', rationaleCodes: ['PRICE_WITHIN_TYPICAL_RANGE'] };
}

/** Calculates purchase-timing-v1 from validated, fixture-normalized historical prices. */
export function assessPurchaseTiming(
  input: PurchaseTimingAssessmentInput,
): PurchaseTimingAssessment {
  const observations = validateAndWindow(input);
  const statistics = calculateStatistics(observations, input.asOfDate, input.targetPriceCents);
  const stateResult = determineState(statistics, input.planHealth);
  return {
    policyVersion: purchaseTimingPolicyVersion,
    sourceVersion: input.sourceVersion,
    currency: input.currency,
    asOfDate: input.asOfDate,
    planHealth: input.planHealth,
    ...stateResult,
    currentObservation: observations.at(-1) ?? null,
    statistics,
    seasonalMonths: calculateSeasonalMonths(observations, statistics),
    validObservations: observations,
  };
}
