import { describe, expect, it } from 'vitest';

import { validGoalFixture } from '@goalpilot/test-support';

import { illustrativeAssumptions } from './assumptions.js';
import { addCalendarMonths, generateContributionDates } from './dates.js';
import {
  calculatePostedInterest,
  calculateMaturityInterestPosting,
  calculateZeroInterestBaseline,
  compareVehicles,
} from './projection.js';

describe('contribution schedules', () => {
  it('preserves month-end across leap-year February', () => {
    expect(addCalendarMonths('2027-01-31', 1)).toBe('2027-02-28');
    expect(addCalendarMonths('2028-01-31', 1)).toBe('2028-02-29');
  });

  it('preserves the original monthly anchor after a short month', () => {
    expect(generateContributionDates('2027-01-30', '2027-04-30', 'monthly')).toEqual([
      '2027-02-28',
      '2027-03-30',
      '2027-04-30',
    ]);
  });

  it('generates ordered, unique weekly and biweekly dates through the deadline', () => {
    expect(generateContributionDates('2026-08-23', '2026-09-20', 'weekly')).toEqual([
      '2026-08-30',
      '2026-09-06',
      '2026-09-13',
      '2026-09-20',
    ]);
    expect(generateContributionDates('2026-08-23', '2026-09-20', 'biweekly')).toEqual([
      '2026-09-06',
      '2026-09-20',
    ]);
  });

  it('returns no occurrences for same-day or past deadlines', () => {
    expect(generateContributionDates('2026-08-23', '2026-08-23', 'monthly')).toEqual([]);
    expect(generateContributionDates('2026-08-23', '2026-08-22', 'monthly')).toEqual([]);
  });
});

describe('financial projections', () => {
  it('calculates the hand-checkable zero-interest baseline', () => {
    const result = calculateZeroInterestBaseline(
      {
        ...validGoalFixture,
        targetAmountCents: 220_000,
        currentSavedCents: 100_000,
        recurringContributionCents: 10_000,
        targetDate: '2027-08-23',
      },
      '2026-08-23',
    );
    expect(result).toEqual({
      feasible: true,
      occurrenceCount: 12,
      requiredContributionCents: 10_000,
      projectedBalanceCents: 220_000,
      shortfallCents: 0,
    });
  });

  it('treats an already-funded goal as requiring zero contributions', () => {
    const fundedGoal = {
      ...validGoalFixture,
      currentSavedCents: validGoalFixture.targetAmountCents,
    };
    const result = calculateZeroInterestBaseline(fundedGoal, '2026-08-23');
    expect(result.requiredContributionCents).toBe(0);
    expect(result.feasible).toBe(true);
    expect(result.occurrenceCount).toBe(0);
    expect(result.projectedBalanceCents).toBe(validGoalFixture.targetAmountCents);
    expect(compareVehicles(fundedGoal, '2026-08-23', illustrativeAssumptions).vehicles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          principalContributedCents: validGoalFixture.targetAmountCents,
          modeledInterestCents: 0,
          projectedCompletionDate: '2026-08-23',
        }),
      ]),
    );
  });

  it('compounds fixed-term lots from each cent-rounded maturity posting', () => {
    const result = compareVehicles(
      {
        ...validGoalFixture,
        targetAmountCents: 1_000_000,
        currentSavedCents: 50_000,
        recurringContributionCents: 0,
        targetDate: '2027-08-18',
      },
      '2026-08-23',
      illustrativeAssumptions,
    );
    expect(result.vehicles.find((vehicle) => vehicle.vehicleCode === 'cd_ladder')).toMatchObject({
      principalContributedCents: 50_000,
      modeledInterestCents: 2_218,
      endingBalanceCents: 52_218,
    });
    expect(calculateMaturityInterestPosting(50_000, 450, 180, 1)).toBe(1_097);
    expect(calculateMaturityInterestPosting(50_000, 450, 180, 2)).toBe(1_121);
  });

  it('does not call locked fixed-term principal purchase-ready before the goal date', () => {
    const result = compareVehicles(
      {
        ...validGoalFixture,
        targetAmountCents: 100_000,
        currentSavedCents: 50_000,
        recurringContributionCents: 50_000,
        targetDate: '2027-08-23',
      },
      '2026-08-23',
      illustrativeAssumptions,
    );
    expect(result.vehicles.find((vehicle) => vehicle.vehicleCode === 'cd_ladder')).toMatchObject({
      projectedCompletionDate: '2027-08-23',
    });
  });

  it('is deterministic for equal goal, assumption version, and date', () => {
    const first = compareVehicles(validGoalFixture, '2026-08-23', illustrativeAssumptions);
    const second = compareVehicles(validGoalFixture, '2026-08-23', illustrativeAssumptions);
    expect(second).toEqual(first);
    expect(first.vehicles).toHaveLength(4);
    expect(first.vehicles.map((vehicle) => vehicle.assumption.isLive)).toEqual([
      false,
      false,
      false,
      false,
    ]);
  });

  it('keeps variable yield as a buffer and does not lower its required installment', () => {
    const result = compareVehicles(validGoalFixture, '2026-08-23', illustrativeAssumptions);
    const hysa = result.vehicles.find((vehicle) => vehicle.vehicleCode === 'hysa');
    expect(hysa?.requiredContributionCents).toBe(
      result.zeroInterestBaseline.requiredContributionCents,
    );
    expect(hysa?.modeledInterestCents).toBeGreaterThan(0);
  });

  it('keeps ineligible locked vehicles visible with stable reasons', () => {
    const result = compareVehicles(
      { ...validGoalFixture, liquidityNeed: 'anytime' },
      '2026-08-23',
      illustrativeAssumptions,
    );
    expect(result.vehicles.find((vehicle) => vehicle.vehicleCode === 'cd_ladder')).toMatchObject({
      eligible: false,
      rejectionCode: 'LIQUIDITY_CONFLICT',
    });
  });

  it('rejects stale illustrative assumptions', () => {
    const stale = illustrativeAssumptions.map((assumption) => ({
      ...assumption,
      reviewedDate: '2024-01-01',
    }));
    const result = compareVehicles(validGoalFixture, '2026-08-23', stale);
    expect(result.vehicles.find((vehicle) => vehicle.vehicleCode === 'cash')).toMatchObject({
      eligible: true,
      rejectionCode: null,
    });
    expect(
      result.vehicles
        .filter((vehicle) => vehicle.vehicleCode !== 'cash')
        .every((vehicle) => vehicle.rejectionCode === 'ASSUMPTION_STALE'),
    ).toBe(true);
    expect(result.recommendedVehicleCode).toBe('cash');
  });

  it('rounds posted interest to cents with banker rounding', () => {
    expect(calculatePostedInterest(100_000, 400, 365)).toBe(4_000);
    expect(() => calculatePostedInterest(100_000, -1, 1)).toThrow(RangeError);
  });
});
