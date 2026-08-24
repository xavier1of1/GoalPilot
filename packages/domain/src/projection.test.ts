import { describe, expect, it } from 'vitest';

import { validGoalFixture } from '@goalpilot/test-support';

import { illustrativeAssumptions } from './assumptions.js';
import { addCalendarMonths, generateContributionDates } from './dates.js';
import {
  calculatePostedInterest,
  calculateMaturityInterestPosting,
  calculateZeroInterestBaseline,
  compareVehicles,
  roundAccruedInterestMicros,
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
    const vehicles = compareVehicles(fundedGoal, '2026-08-23', illustrativeAssumptions).vehicles;
    expect(
      vehicles.map((vehicle) => ({
        vehicleCode: vehicle.vehicleCode,
        principalContributedCents: vehicle.principalContributedCents,
        modeledInterestCents: vehicle.modeledInterestCents,
        endingBalanceCents: vehicle.endingBalanceCents,
        projectedCompletionDate: vehicle.projectedCompletionDate,
      })),
    ).toEqual([
      {
        vehicleCode: 'cash',
        principalContributedCents: 600_000,
        modeledInterestCents: 0,
        endingBalanceCents: 600_000,
        projectedCompletionDate: '2026-08-23',
      },
      {
        vehicleCode: 'hysa',
        principalContributedCents: 600_000,
        modeledInterestCents: 0,
        endingBalanceCents: 600_000,
        projectedCompletionDate: '2026-08-23',
      },
      {
        vehicleCode: 'cd_ladder',
        principalContributedCents: 600_000,
        modeledInterestCents: 26_623,
        endingBalanceCents: 626_623,
        projectedCompletionDate: '2027-08-23',
      },
      {
        vehicleCode: 'treasury_ladder',
        principalContributedCents: 600_000,
        modeledInterestCents: 25_429,
        endingBalanceCents: 625_429,
        projectedCompletionDate: '2027-08-23',
      },
    ]);
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

  it('matches the reviewed exact golden vector for every illustrative vehicle', () => {
    const result = compareVehicles(validGoalFixture, '2026-08-23', illustrativeAssumptions);
    expect(
      result.vehicles.map(
        ({
          vehicleCode,
          requiredContributionCents,
          principalContributedCents,
          modeledInterestCents,
          endingBalanceCents,
          projectedCompletionDate,
          surplusCents,
        }) => ({
          vehicleCode,
          requiredContributionCents,
          principalContributedCents,
          modeledInterestCents,
          endingBalanceCents,
          projectedCompletionDate,
          surplusCents,
        }),
      ),
    ).toEqual([
      {
        vehicleCode: 'cash',
        requiredContributionCents: 41_667,
        principalContributedCents: 640_000,
        modeledInterestCents: 0,
        endingBalanceCents: 640_000,
        projectedCompletionDate: '2027-08-23',
        surplusCents: 40_000,
      },
      {
        vehicleCode: 'hysa',
        requiredContributionCents: 41_667,
        principalContributedCents: 595_000,
        modeledInterestCents: 10_443,
        endingBalanceCents: 605_443,
        projectedCompletionDate: '2027-07-23',
        surplusCents: 5_443,
      },
      {
        vehicleCode: 'cd_ladder',
        requiredContributionCents: 40_849,
        principalContributedCents: 640_000,
        modeledInterestCents: 10_359,
        endingBalanceCents: 650_359,
        projectedCompletionDate: '2027-08-23',
        surplusCents: 50_359,
      },
      {
        vehicleCode: 'treasury_ladder',
        requiredContributionCents: 40_708,
        principalContributedCents: 640_000,
        modeledInterestCents: 12_266,
        endingBalanceCents: 652_266,
        projectedCompletionDate: '2027-08-23',
        surplusCents: 52_266,
      },
    ]);
  });

  it('does not post accrued deposit interest merely because principal reaches the target', () => {
    const result = compareVehicles(
      {
        ...validGoalFixture,
        targetAmountCents: 100_000,
        currentSavedCents: 99_999,
        recurringContributionCents: 1,
        contributionCadence: 'weekly',
        targetDate: '2026-12-31',
      },
      '2026-08-23',
      illustrativeAssumptions,
    );
    expect(result.vehicles.find((vehicle) => vehicle.vehicleCode === 'hysa')).toMatchObject({
      principalContributedCents: 100_000,
      modeledInterestCents: 0,
      endingBalanceCents: 100_000,
      projectedCompletionDate: '2026-08-30',
    });
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
    expect(roundAccruedInterestMicros(500_000)).toBe(0);
    expect(roundAccruedInterestMicros(1_500_000)).toBe(2);
    expect(calculateMaturityInterestPosting(10_000, 425, 91, 1)).toBe(104);
    expect(calculateMaturityInterestPosting(10_000, 425, 91, 4)).toBe(108);
    expect(() => calculatePostedInterest(100_000, -1, 1)).toThrow(RangeError);
  });
});
