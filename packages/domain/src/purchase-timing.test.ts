import { describe, expect, it } from 'vitest';

import { addCalendarDays } from './dates.js';
import {
  assessPurchaseTiming,
  type HistoricalPriceObservation,
  type PurchaseTimingAssessmentInput,
  PurchaseTimingValidationError,
} from './purchase-timing.js';

const asOfDate = '2026-08-23';

function makeHistory(
  options: {
    readonly count?: number;
    readonly spanDays?: number;
    readonly freshnessDays?: number;
    readonly lessThanCurrentCount?: number;
  } = {},
): readonly HistoricalPriceObservation[] {
  const count = options.count ?? 30;
  const spanDays = options.spanDays ?? 90;
  const freshnessDays = options.freshnessDays ?? 0;
  const lessThanCurrentCount = options.lessThanCurrentCount ?? 14;
  const latestDate = addCalendarDays(asOfDate, -freshnessDays);
  const earliestDate = addCalendarDays(latestDate, -spanDays);
  const observations: HistoricalPriceObservation[] = [];
  for (let index = 0; index < count - 1; index += 1) {
    const offset = count <= 2 ? 0 : Math.floor((index * Math.max(0, spanDays - 1)) / (count - 2));
    observations.push({
      observationKey: `history-${String(index).padStart(3, '0')}`,
      observationDate: addCalendarDays(earliestDate, offset),
      priceCents: index < lessThanCurrentCount ? 9_000 : 11_000,
      currency: 'USD',
      sourceVersion: 'oled-history-v1',
    });
  }
  if (count > 0) {
    observations.push({
      observationKey: 'zz-current',
      observationDate: latestDate,
      priceCents: 10_000,
      currency: 'USD',
      sourceVersion: 'oled-history-v1',
    });
  }
  return observations;
}

function input(
  observations: readonly HistoricalPriceObservation[],
  overrides: Partial<PurchaseTimingAssessmentInput> = {},
): PurchaseTimingAssessmentInput {
  return {
    asOfDate,
    currency: 'USD',
    sourceVersion: 'oled-history-v1',
    targetPriceCents: 9_500,
    planHealth: 'ON_TRACK',
    observations,
    ...overrides,
  };
}

describe('purchase-timing-v1 statistics', () => {
  it('calculates exact integer-cent statistics, signed differences, span, and freshness', () => {
    const observations: readonly HistoricalPriceObservation[] = [
      {
        observationKey: 'a',
        observationDate: '2026-05-25',
        priceCents: 99,
        currency: 'USD',
        sourceVersion: 'oled-history-v1',
      },
      {
        observationKey: 'b',
        observationDate: '2026-06-01',
        priceCents: 100,
        currency: 'USD',
        sourceVersion: 'oled-history-v1',
      },
      {
        observationKey: 'c',
        observationDate: '2026-07-01',
        priceCents: 200,
        currency: 'USD',
        sourceVersion: 'oled-history-v1',
      },
      {
        observationKey: 'd',
        observationDate: '2026-08-22',
        priceCents: 101,
        currency: 'USD',
        sourceVersion: 'oled-history-v1',
      },
    ];
    expect(assessPurchaseTiming(input(observations, { targetPriceCents: 105 })).statistics).toEqual(
      {
        minimumPriceCents: 99,
        medianPriceCents: 100,
        maximumPriceCents: 200,
        currentPriceCents: 101,
        currentEmpiricalPercentileBasisPoints: 6_250,
        differenceFromMedianCents: 1,
        differenceFromTargetCents: -4,
        observationCount: 4,
        dataSpanDays: 89,
        freshnessDays: 1,
        earliestObservationDate: '2026-05-25',
        latestObservationDate: '2026-08-22',
      },
    );
  });

  it('uses the stable final observation on the latest date as current', () => {
    const observations = [
      ...makeHistory(),
      {
        observationKey: 'zzzz-latest-final',
        observationDate: asOfDate,
        priceCents: 12_345,
        currency: 'USD',
        sourceVersion: 'oled-history-v1',
      },
    ];
    const result = assessPurchaseTiming(input(observations));
    expect(result.currentObservation?.observationKey).toBe('zzzz-latest-final');
    expect(result.statistics?.currentPriceCents).toBe(12_345);
  });
});

describe('purchase-timing-v1 state precedence and boundaries', () => {
  it('applies the exact 29/30 point and 89/90 day sufficiency gates first', () => {
    expect(assessPurchaseTiming(input(makeHistory({ count: 29 }))).state).toBe('INSUFFICIENT_DATA');
    expect(assessPurchaseTiming(input(makeHistory({ spanDays: 89 }))).state).toBe(
      'INSUFFICIENT_DATA',
    );
    expect(assessPurchaseTiming(input(makeHistory({ count: 29, freshnessDays: 15 }))).state).toBe(
      'INSUFFICIENT_DATA',
    );
    expect(assessPurchaseTiming(input(makeHistory())).state).not.toBe('INSUFFICIENT_DATA');
  });

  it('uses the exact 14/15 day freshness boundary', () => {
    expect(assessPurchaseTiming(input(makeHistory({ freshnessDays: 14 }))).state).not.toBe(
      'STALE_DATA',
    );
    expect(assessPurchaseTiming(input(makeHistory({ freshnessDays: 15 }))).state).toBe(
      'STALE_DATA',
    );
  });

  it('covers favorable readiness without allowing price history to override plan health', () => {
    const favorable = makeHistory({ lessThanCurrentCount: 7 });
    const ready = assessPurchaseTiming(input(favorable, { planHealth: 'PURCHASE_READY' }));
    expect(ready.statistics?.currentEmpiricalPercentileBasisPoints).toBe(2_500);
    expect(ready.state).toBe('HISTORICALLY_FAVORABLE_PLAN_READY');

    const paused = assessPurchaseTiming(input(favorable, { planHealth: 'PAUSED' }));
    expect(paused.state).toBe('HISTORICALLY_FAVORABLE_PLAN_NOT_READY');
    expect(paused.rationaleCodes).toContain('PLAN_PAUSED');

    const locked = assessPurchaseTiming(input(favorable, { planHealth: 'FUNDED_BUT_LOCKED' }));
    expect(locked.state).toBe('HISTORICALLY_FAVORABLE_PLAN_NOT_READY');
    expect(locked.rationaleCodes).toContain('PLAN_FUNDED_BUT_LOCKED');

    const noActivePlan = assessPurchaseTiming(input(favorable, { planHealth: null }));
    expect(noActivePlan.state).toBe('HISTORICALLY_FAVORABLE_PLAN_NOT_READY');
    expect(noActivePlan.rationaleCodes).toContain('PLAN_NOT_PURCHASE_READY');
  });

  it('covers the elevated boundary, watch, and typical remaining states', () => {
    const elevated = assessPurchaseTiming(input(makeHistory({ lessThanCurrentCount: 22 })));
    expect(elevated.statistics?.currentEmpiricalPercentileBasisPoints).toBe(7_500);
    expect(elevated.state).toBe('HISTORICALLY_ELEVATED');

    expect(assessPurchaseTiming(input(makeHistory())).state).toBe('WATCH');
    expect(assessPurchaseTiming(input(makeHistory(), { targetPriceCents: 10_500 })).state).toBe(
      'HISTORICALLY_TYPICAL',
    );
  });
});

describe('purchase-timing-v1 deterministic input policy', () => {
  it('is input-order invariant and collapses byte-equivalent replay', () => {
    const observations = makeHistory();
    const firstObservation = observations[0];
    if (firstObservation === undefined) throw new Error('Expected deterministic price history.');
    const first = assessPurchaseTiming(input(observations));
    const reversed = assessPurchaseTiming(input([...observations].reverse()));
    expect(reversed).toEqual(first);
    const replayed = assessPurchaseTiming(input([...observations, firstObservation]));
    expect(replayed).toEqual(first);
  });

  it.each([
    ['FUTURE_OBSERVATION', { observationDate: '2026-08-24' }],
    ['NONPOSITIVE_PRICE', { priceCents: 0 }],
    ['CURRENCY_MISMATCH', { currency: 'EUR' }],
    ['SOURCE_VERSION_MISMATCH', { sourceVersion: 'other-source' }],
  ] as const)('rejects %s before producing an assessment', (code, change) => {
    const observations = makeHistory();
    const firstObservation = observations[0];
    if (firstObservation === undefined) throw new Error('Expected deterministic price history.');
    const changed = { ...firstObservation, ...change };
    expect(() => assessPurchaseTiming(input([changed, ...observations.slice(1)]))).toThrow(
      expect.objectContaining({ code }),
    );
  });

  it('rejects a conflicting logical duplicate', () => {
    const observations = makeHistory();
    const firstObservation = observations[0];
    if (firstObservation === undefined) throw new Error('Expected deterministic price history.');
    const conflict = { ...firstObservation, priceCents: firstObservation.priceCents + 1 };
    try {
      assessPurchaseTiming(input([...observations, conflict]));
      throw new Error('Expected a conflicting duplicate error.');
    } catch (error) {
      expect(error).toBeInstanceOf(PurchaseTimingValidationError);
      expect(error).toMatchObject({ code: 'CONFLICTING_DUPLICATE' });
    }
  });

  it('rejects malformed assessment dates and target amounts', () => {
    expect(() => assessPurchaseTiming(input(makeHistory(), { asOfDate: '2026/08/23' }))).toThrow(
      'asOfDate',
    );
    expect(() => assessPurchaseTiming(input(makeHistory(), { targetPriceCents: 0 }))).toThrow(
      'targetPriceCents',
    );
    expect(() => assessPurchaseTiming(input(makeHistory(), { targetPriceCents: 0.5 }))).toThrow(
      'targetPriceCents',
    );
    const first = makeHistory()[0];
    if (first === undefined) throw new Error('Expected a deterministic observation fixture.');
    expect(() =>
      assessPurchaseTiming(
        input([{ ...first, observationDate: 'not-a-date' }, ...makeHistory().slice(1)]),
      ),
    ).toThrow(expect.objectContaining({ code: 'INVALID_OBSERVATION_DATE' }));
  });

  it('returns an explicit no-history assessment without fabricated statistics', () => {
    expect(assessPurchaseTiming(input([]))).toMatchObject({
      currentObservation: null,
      statistics: null,
      seasonalMonths: null,
      state: 'INSUFFICIENT_DATA',
    });
  });
});

function makeSeasonalHistory(): readonly HistoricalPriceObservation[] {
  const observations: HistoricalPriceObservation[] = [];
  observations.push({
    observationKey: 'season-start',
    observationDate: '2024-12-31',
    priceCents: 100_00,
    currency: 'USD',
    sourceVersion: 'oled-history-v1',
  });
  for (const year of [2025, 2026]) {
    for (let month = 1; month <= 12; month += 1) {
      for (const day of [1, 10, 20]) {
        observations.push({
          observationKey: `season-${String(year)}-${String(month).padStart(2, '0')}-${String(day)}`,
          observationDate: `${String(year)}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
          priceCents: 100_00 + month * 10 + day,
          currency: 'USD',
          sourceVersion: 'oled-history-v1',
        });
      }
    }
  }
  observations.push({
    observationKey: 'season-end',
    observationDate: '2026-12-31',
    priceCents: 101_00,
    currency: 'USD',
    sourceVersion: 'oled-history-v1',
  });
  return observations;
}

describe('purchase-timing-v1 seasonal detail', () => {
  it('requires a full 730-day history and at least three observations in every month', () => {
    const seasonalInput = input(makeSeasonalHistory(), {
      asOfDate: '2026-12-31',
      targetPriceCents: 100_00,
    });
    const eligible = assessPurchaseTiming(seasonalInput);
    expect(eligible.statistics?.dataSpanDays).toBe(730);
    expect(eligible.seasonalMonths).toHaveLength(12);
    expect(eligible.seasonalMonths?.every((month) => month.observationCount >= 3)).toBe(true);

    const twentyThreeMonths = makeSeasonalHistory().filter(
      (observation) => observation.observationDate >= '2025-01-31',
    );
    expect(
      assessPurchaseTiming({ ...seasonalInput, observations: twentyThreeMonths }).seasonalMonths,
    ).toBeNull();

    const underSampledJanuary = makeSeasonalHistory().filter(
      (observation, index) => observation.observationDate.slice(5, 7) !== '01' || index % 3 === 0,
    );
    expect(
      assessPurchaseTiming({ ...seasonalInput, observations: underSampledJanuary }).seasonalMonths,
    ).toBeNull();

    const missingJanuary = makeSeasonalHistory().filter(
      (observation) => observation.observationDate.slice(5, 7) !== '01',
    );
    expect(
      assessPurchaseTiming({ ...seasonalInput, observations: missingJanuary }).seasonalMonths,
    ).toBeNull();
  });
});
