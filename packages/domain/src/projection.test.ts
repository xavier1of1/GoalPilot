import { describe, expect, it } from 'vitest';

import { previewOutputSchema } from '@goalpilot/contracts';
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
        modeledInterestCents: 23_963,
        endingBalanceCents: 623_963,
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

  it('uses authoritative posted principal for an active vehicle minimum', () => {
    const initialGoal = {
      ...validGoalFixture,
      currentSavedCents: 0,
      recurringContributionCents: 50_000,
      targetDate: '2027-08-23',
    };
    expect(
      compareVehicles(initialGoal, '2026-08-23', illustrativeAssumptions).vehicles.find(
        (vehicle) => vehicle.vehicleCode === 'cd_ladder',
      ),
    ).toMatchObject({ eligible: true });

    const activeGoal = { ...initialGoal, recurringContributionCents: 0 };
    expect(
      compareVehicles(activeGoal, '2026-09-23', illustrativeAssumptions, {
        scheduleAnchorDate: '2026-08-23',
        personalPrincipalCents: 50_000,
        totalLedgerValueCents: 50_000,
        currentAvailableFundsCents: 0,
        fixedTermVehicleCode: 'cd_ladder',
        fixedTermLots: [
          {
            personalPrincipalCents: 50_000,
            currentBalanceCents: 50_000,
            firstMaturityDate: '2027-03-22',
            nextMaturityDate: '2027-03-22',
            nextMaturityInterestEligible: true,
          },
        ],
      }).vehicles.find((vehicle) => vehicle.vehicleCode === 'cd_ladder'),
    ).toMatchObject({ eligible: true });
  });

  it('keeps a late fixed-term contribution locked until its first maturity after target', () => {
    const omittedContributionDates = [
      '2026-09-23',
      '2026-10-23',
      '2026-11-23',
      '2026-12-23',
      '2027-01-23',
      '2027-02-23',
      '2027-03-23',
      '2027-04-23',
      '2027-05-23',
      '2027-06-23',
    ];
    const result = compareVehicles(
      {
        ...validGoalFixture,
        targetAmountCents: 100_000,
        currentSavedCents: 0,
        recurringContributionCents: 100_000,
        targetDate: '2027-08-23',
      },
      '2026-08-23',
      illustrativeAssumptions,
      { omittedContributionDates },
    );
    expect(result.vehicles.find((vehicle) => vehicle.vehicleCode === 'cd_ladder')).toMatchObject({
      principalContributedCents: 100_000,
      modeledInterestCents: 0,
      endingBalanceCents: 100_000,
      projectedCompletionDate: '2028-01-19',
      readyByTargetUsingSafeContribution: false,
    });
  });

  it('does not let already-posted modeled interest lower the safe contribution', () => {
    const goal = {
      ...validGoalFixture,
      currentSavedCents: 100_000,
      targetAmountCents: 600_000,
      targetDate: '2027-08-23',
    };
    const withoutPostedInterest = compareVehicles(goal, '2026-08-23', illustrativeAssumptions, {
      personalPrincipalCents: 200_000,
      totalLedgerValueCents: 200_000,
      currentAvailableFundsCents: 200_000,
    });
    const withPostedInterest = compareVehicles(goal, '2026-08-23', illustrativeAssumptions, {
      personalPrincipalCents: 200_000,
      totalLedgerValueCents: 225_000,
      currentAvailableFundsCents: 225_000,
    });
    expect(withPostedInterest.zeroInterestBaseline).toEqual(
      withoutPostedInterest.zeroInterestBaseline,
    );
    expect(withPostedInterest.zeroInterestBaseline.requiredContributionCents).toBe(33_334);
    expect(
      withPostedInterest.vehicles.find((vehicle) => vehicle.vehicleCode === 'hysa')
        ?.endingBalanceCents,
    ).toBeGreaterThan(
      withoutPostedInterest.vehicles.find((vehicle) => vehicle.vehicleCode === 'hysa')
        ?.endingBalanceCents ?? 0,
    );
  });

  it('carries unposted deposit accrual to the next posting boundary without changing ledger totals', () => {
    const zeroRateAssumptions = illustrativeAssumptions.map((assumption) => ({
      ...assumption,
      apyBasisPoints: 0,
    }));
    const result = compareVehicles(
      {
        ...validGoalFixture,
        targetAmountCents: 200_000,
        currentSavedCents: 100_000,
        recurringContributionCents: 0,
        targetDate: '2026-08-31',
      },
      '2026-08-30',
      zeroRateAssumptions,
      {
        personalPrincipalCents: 100_000,
        totalLedgerValueCents: 100_000,
        currentAvailableFundsCents: 100_000,
        currentAccruedInterestMicros: 1_500_000,
        fixedTermVehicleCode: 'hysa',
      },
    );
    expect(result.vehicles.find((vehicle) => vehicle.vehicleCode === 'cash')).toMatchObject({
      modeledInterestCents: 0,
      endingBalanceCents: 100_000,
    });
    expect(result.vehicles.find((vehicle) => vehicle.vehicleCode === 'hysa')).toMatchObject({
      modeledInterestCents: 2,
      endingBalanceCents: 100_002,
      modeledBenefitVersusCashCents: 2,
    });
  });

  it('derives card contribution, maturity, benefit, and protection fields on the server', () => {
    const result = compareVehicles(validGoalFixture, '2026-08-23', illustrativeAssumptions);
    const cash = result.vehicles.find((vehicle) => vehicle.vehicleCode === 'cash');
    expect(cash).toMatchObject({
      firstMaturityDate: null,
      protectionClassification: 'SIMULATED_CASH',
      preservationRequirementSatisfied: true,
      modeledBenefitVersusCashCents: 0,
    });
    for (const vehicle of result.vehicles) {
      expect(vehicle.futurePersonalContributionsCents).toBe(
        vehicle.principalContributedCents - validGoalFixture.currentSavedCents,
      );
      expect(vehicle.modeledBenefitVersusCashCents).toBe(
        vehicle.endingBalanceCents - (cash?.endingBalanceCents ?? 0),
      );
    }
    expect(result.vehicles.find((vehicle) => vehicle.vehicleCode === 'cd_ladder')).toMatchObject({
      firstMaturityDate: '2027-02-19',
      protectionClassification: 'SIMULATED_DEPOSIT_HELD_AS_MODELED',
      preservationRequirementSatisfied: true,
    });
    expect(
      result.vehicles.find((vehicle) => vehicle.vehicleCode === 'treasury_ladder'),
    ).toMatchObject({
      firstMaturityDate: '2026-11-22',
      protectionClassification: 'SIMULATED_TREASURY_HELD_TO_MATURITY',
      preservationRequirementSatisfied: true,
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
    expect(previewOutputSchema.safeParse(result).success).toBe(true);
    expect(
      result.vehicles.map(
        ({
          vehicleCode,
          principalContributedCents,
          modeledInterestCents,
          endingBalanceCents,
          projectedCompletionDate,
          surplusCents,
        }) => ({
          vehicleCode,
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
        principalContributedCents: 640_000,
        modeledInterestCents: 0,
        endingBalanceCents: 640_000,
        projectedCompletionDate: '2027-08-23',
        surplusCents: 40_000,
      },
      {
        vehicleCode: 'hysa',
        principalContributedCents: 595_000,
        modeledInterestCents: 13_854,
        endingBalanceCents: 608_854,
        projectedCompletionDate: '2027-07-23',
        surplusCents: 8_854,
      },
      {
        vehicleCode: 'cd_ladder',
        principalContributedCents: 595_000,
        modeledInterestCents: 10_359,
        endingBalanceCents: 605_359,
        projectedCompletionDate: '2028-01-19',
        surplusCents: 5_359,
      },
      {
        vehicleCode: 'treasury_ladder',
        principalContributedCents: 595_000,
        modeledInterestCents: 12_266,
        endingBalanceCents: 607_266,
        projectedCompletionDate: '2027-10-22',
        surplusCents: 7_266,
      },
    ]);
  });

  it('matches vehicle-fit-v2 using one zero-interest safe commitment for every model', () => {
    const result = compareVehicles(validGoalFixture, '2026-08-23', illustrativeAssumptions);
    expect(result.rankingPolicyVersion).toBe('vehicle-fit-v2');
    expect(result.recommendedVehicleCode).toBe('hysa');
    expect(
      result.vehicles.map(
        ({
          vehicleCode,
          safeContributionCents,
          modelAdjustedRequiredContributionCents,
          fitRank,
          readyByTargetUsingSafeContribution,
          accessRequirementSatisfied,
          lockConflictDays,
          safeContributionModeledCushionCents,
          fitRationaleCode,
        }) => ({
          vehicleCode,
          safeContributionCents,
          modelAdjustedRequiredContributionCents,
          fitRank,
          readyByTargetUsingSafeContribution,
          accessRequirementSatisfied,
          lockConflictDays,
          safeContributionModeledCushionCents,
          fitRationaleCode,
        }),
      ),
    ).toEqual([
      {
        vehicleCode: 'cash',
        safeContributionCents: 41_667,
        modelAdjustedRequiredContributionCents: 41_667,
        fitRank: 2,
        readyByTargetUsingSafeContribution: true,
        accessRequirementSatisfied: true,
        lockConflictDays: 0,
        safeContributionModeledCushionCents: 4,
        fitRationaleCode: 'CASH_BASELINE',
      },
      {
        vehicleCode: 'hysa',
        safeContributionCents: 41_667,
        modelAdjustedRequiredContributionCents: 41_667,
        fitRank: 1,
        readyByTargetUsingSafeContribution: true,
        accessRequirementSatisfied: true,
        lockConflictDays: 0,
        safeContributionModeledCushionCents: 13_135,
        fitRationaleCode: 'ELIGIBLE_ACCESS_FIT',
      },
      {
        vehicleCode: 'cd_ladder',
        safeContributionCents: 41_667,
        modelAdjustedRequiredContributionCents: null,
        fitRank: 4,
        readyByTargetUsingSafeContribution: false,
        accessRequirementSatisfied: true,
        lockConflictDays: 0,
        safeContributionModeledCushionCents: 9_925,
        fitRationaleCode: 'ELIGIBLE_ACCESS_FIT',
      },
      {
        vehicleCode: 'treasury_ladder',
        safeContributionCents: 41_667,
        modelAdjustedRequiredContributionCents: null,
        fitRank: 3,
        readyByTargetUsingSafeContribution: false,
        accessRequirementSatisfied: true,
        lockConflictDays: 0,
        safeContributionModeledCushionCents: 11_684,
        fitRationaleCode: 'ELIGIBLE_ACCESS_FIT',
      },
    ]);
  });

  it('assigns invariant v2 ranks independent of assumption input order', () => {
    const forward = compareVehicles(validGoalFixture, '2026-08-23', illustrativeAssumptions);
    const reversed = compareVehicles(
      validGoalFixture,
      '2026-08-23',
      [...illustrativeAssumptions].reverse(),
    );
    const ranks = (result: typeof forward) =>
      Object.fromEntries(result.vehicles.map((vehicle) => [vehicle.vehicleCode, vehicle.fitRank]));
    expect(ranks(reversed)).toEqual(ranks(forward));
    expect(reversed.recommendedVehicleCode).toBe(forward.recommendedVehicleCode);
  });

  it('keeps ineligible models and cash visible while withholding ineligible ranks', () => {
    const result = compareVehicles(
      { ...validGoalFixture, liquidityNeed: 'anytime' },
      '2026-08-23',
      illustrativeAssumptions,
    );
    expect(result.vehicles).toHaveLength(4);
    expect(result.vehicles.some((vehicle) => vehicle.vehicleCode === 'cash')).toBe(true);
    expect(
      result.vehicles
        .filter((vehicle) => !vehicle.eligible)
        .map((vehicle) => ({
          vehicleCode: vehicle.vehicleCode,
          fitRank: vehicle.fitRank,
          accessRequirementSatisfied: vehicle.accessRequirementSatisfied,
          fitRationaleCode: vehicle.fitRationaleCode,
        })),
    ).toEqual([
      {
        vehicleCode: 'cd_ladder',
        fitRank: null,
        accessRequirementSatisfied: false,
        fitRationaleCode: 'INELIGIBLE_POLICY',
      },
      {
        vehicleCode: 'treasury_ladder',
        fitRank: null,
        accessRequirementSatisfied: false,
        fitRationaleCode: 'INELIGIBLE_POLICY',
      },
    ]);
  });

  it('continues deposit interest to its normal posting boundaries after readiness', () => {
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
      modeledInterestCents: 1_405,
      endingBalanceCents: 101_405,
      projectedCompletionDate: '2026-08-30',
    });
  });

  it('keeps variable yield as a buffer and does not lower its required installment', () => {
    const result = compareVehicles(validGoalFixture, '2026-08-23', illustrativeAssumptions);
    const hysa = result.vehicles.find((vehicle) => vehicle.vehicleCode === 'hysa');
    expect(hysa?.safeContributionCents).toBe(result.zeroInterestBaseline.requiredContributionCents);
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
