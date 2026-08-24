import { describe, expect, it } from 'vitest';

import type { VehicleCode } from '@goalpilot/contracts';

import { illustrativeAssumptions } from './assumptions.js';
import { generateContributionDates } from './dates.js';
import { derivePlanHealth, type PlanHealthInput } from './plan-health.js';
import {
  analyzeZeroInterestPlan,
  buildRecoveryOptions,
  evaluatePlanScenario,
  type ZeroInterestPlanInput,
} from './plan-scenarios.js';
import { calculateSafeContribution } from './safe-contribution.js';
import { compareVehicles } from './projection.js';
import { rankVehicleFits, type VehicleFitCandidate } from './vehicle-fit.js';

describe('safe zero-interest contribution', () => {
  it('matches the reviewed Japan baseline without any vehicle or rate input', () => {
    const contributionDates = generateContributionDates('2026-08-23', '2027-08-23', 'monthly');
    expect(
      calculateSafeContribution({
        currentSavedCents: 100_000,
        targetAmountCents: 600_000,
        contributionDates,
      }),
    ).toEqual({
      status: 'possible',
      occurrenceCount: 12,
      safeContributionCents: 41_667,
      projectedBalanceCents: 600_004,
      shortfallCents: 0,
    });
  });

  it('distinguishes already-funded and no-remaining-occurrence plans', () => {
    expect(
      calculateSafeContribution({
        currentSavedCents: 600_000,
        targetAmountCents: 600_000,
        contributionDates: ['2026-09-23'],
      }),
    ).toEqual({
      status: 'already_funded',
      occurrenceCount: 0,
      safeContributionCents: 0,
      projectedBalanceCents: 600_000,
      shortfallCents: 0,
    });
    expect(
      calculateSafeContribution({
        currentSavedCents: 100_000,
        targetAmountCents: 600_000,
        contributionDates: [],
      }),
    ).toEqual({
      status: 'no_remaining_occurrences',
      occurrenceCount: 0,
      safeContributionCents: null,
      projectedBalanceCents: 100_000,
      shortfallCents: 500_000,
    });
  });

  it('has the minimal-cent reachability property over varied shortfalls and schedules', () => {
    for (let shortfall = 1; shortfall <= 250; shortfall += 7) {
      for (let occurrenceCount = 1; occurrenceCount <= 24; occurrenceCount += 1) {
        const contributionDates = Array.from(
          { length: occurrenceCount },
          (_, index) => `date-${String(index)}`,
        );
        const result = calculateSafeContribution({
          currentSavedCents: 12_345,
          targetAmountCents: 12_345 + shortfall,
          contributionDates,
        });
        expect(result.status).toBe('possible');
        if (result.status !== 'possible') continue;
        expect(12_345 + result.safeContributionCents * occurrenceCount).toBeGreaterThanOrEqual(
          12_345 + shortfall,
        );
        expect(12_345 + (result.safeContributionCents - 1) * occurrenceCount).toBeLessThan(
          12_345 + shortfall,
        );
      }
    }
  });

  it('never requires a higher safe contribution when the deadline is extended', () => {
    const deadlines = ['2027-02-23', '2027-08-23', '2028-02-23'] as const;
    const contributions = deadlines.map((targetDate) =>
      calculateSafeContribution({
        currentSavedCents: 100_000,
        targetAmountCents: 900_000,
        contributionDates: generateContributionDates('2026-08-23', targetDate, 'monthly'),
      }),
    );
    const safeAmounts = contributions.map((result) => {
      expect(result.status).toBe('possible');
      if (result.status !== 'possible') throw new Error('Expected a reachable test plan.');
      return result.safeContributionCents;
    });
    const [sixMonths, twelveMonths, eighteenMonths] = safeAmounts;
    if (sixMonths === undefined || twelveMonths === undefined || eighteenMonths === undefined)
      throw new Error('Expected all deadline scenarios.');
    expect(twelveMonths).toBeLessThanOrEqual(sixMonths);
    expect(eighteenMonths).toBeLessThanOrEqual(twelveMonths);
  });

  it('keeps the displayed safe commitment independent of every modeled interest rate', () => {
    const goal = {
      name: 'Rate-independent commitment',
      targetAmountCents: 900_000,
      currentSavedCents: 150_000,
      targetDate: '2028-02-23',
      recurringContributionCents: 40_050,
      contributionCadence: 'monthly' as const,
      liquidityNeed: 'within_30_days' as const,
      preservationPreference: 'required' as const,
      confidence: 'expected' as const,
    };
    const ordinary = compareVehicles(goal, '2026-08-23', illustrativeAssumptions);
    const exaggeratedRates = illustrativeAssumptions.map((assumption, index) => ({
      ...assumption,
      apyBasisPoints: index * 2_500,
    }));
    const exaggerated = compareVehicles(goal, '2026-08-23', exaggeratedRates);
    expect(exaggerated.zeroInterestBaseline.requiredContributionCents).toBe(
      ordinary.zeroInterestBaseline.requiredContributionCents,
    );
    expect(exaggerated.vehicles.every((vehicle) => vehicle.safeContributionCents === 41_667)).toBe(
      true,
    );
  });

  it('rejects negative, fractional, and overflowing cent inputs', () => {
    expect(() =>
      calculateSafeContribution({
        currentSavedCents: -1,
        targetAmountCents: 100,
        contributionDates: ['2026-09-23'],
      }),
    ).toThrow('currentSavedCents');
    expect(() =>
      calculateSafeContribution({
        currentSavedCents: 0.5,
        targetAmountCents: 100,
        contributionDates: ['2026-09-23'],
      }),
    ).toThrow('currentSavedCents');
    expect(() =>
      calculateSafeContribution({
        currentSavedCents: 0,
        targetAmountCents: Number.MAX_SAFE_INTEGER,
        contributionDates: ['2026-09-23', '2026-10-23'],
      }),
    ).toThrow('projected balance');
  });
});

describe('plan-health-v1 precedence', () => {
  const base: PlanHealthInput = {
    paused: false,
    currentAvailableFundsCents: 10_000,
    currentTotalValueCents: 10_000,
    targetAmountCents: 100_000,
    accessConditionsSatisfied: true,
    projectedPurchaseReadyDate: '2027-08-23',
    targetDate: '2027-08-23',
    contributionCadence: 'monthly',
  };

  it('applies PAUSED before every readiness condition', () => {
    expect(
      derivePlanHealth({
        ...base,
        paused: true,
        currentAvailableFundsCents: 100_000,
        currentTotalValueCents: 100_000,
      }).code,
    ).toBe('PAUSED');
  });

  it('applies purchase-ready before funded-but-locked', () => {
    expect(
      derivePlanHealth({
        ...base,
        currentAvailableFundsCents: 100_000,
        currentTotalValueCents: 120_000,
      }).code,
    ).toBe('PURCHASE_READY');
    expect(
      derivePlanHealth({
        ...base,
        currentAvailableFundsCents: 99_999,
        currentTotalValueCents: 100_000,
      }).code,
    ).toBe('FUNDED_BUT_LOCKED');
  });

  it('uses attention before ahead/on-track and handles impossible readiness', () => {
    expect(derivePlanHealth({ ...base, projectedPurchaseReadyDate: null }).code).toBe(
      'ATTENTION_NEEDED',
    );
    expect(derivePlanHealth({ ...base, projectedPurchaseReadyDate: '2027-08-24' }).code).toBe(
      'ATTENTION_NEEDED',
    );
  });

  it('requires at least one full cadence interval for AHEAD', () => {
    expect(derivePlanHealth({ ...base, projectedPurchaseReadyDate: '2027-07-23' }).code).toBe(
      'AHEAD',
    );
    expect(derivePlanHealth({ ...base, projectedPurchaseReadyDate: '2027-07-24' }).code).toBe(
      'ON_TRACK',
    );
    expect(derivePlanHealth(base).code).toBe('ON_TRACK');
  });

  it('uses the weekly and biweekly cadence boundaries and rejects malformed cents', () => {
    expect(
      derivePlanHealth({
        ...base,
        contributionCadence: 'weekly',
        projectedPurchaseReadyDate: '2027-08-16',
      }).code,
    ).toBe('AHEAD');
    expect(
      derivePlanHealth({
        ...base,
        contributionCadence: 'biweekly',
        projectedPurchaseReadyDate: '2027-08-09',
      }).code,
    ).toBe('AHEAD');
    expect(() => derivePlanHealth({ ...base, currentTotalValueCents: -1 })).toThrow(
      'currentTotalValueCents',
    );
    expect(() => derivePlanHealth({ ...base, currentTotalValueCents: 0.5 })).toThrow(
      'currentTotalValueCents',
    );
  });
});

describe('vehicle-fit-v2', () => {
  const candidates: readonly VehicleFitCandidate[] = [
    {
      vehicleCode: 'cash',
      eligible: true,
      safeContributionPurchaseReadyDate: '2027-08-23',
      accessRequirementSatisfied: true,
      lockConflictDays: 0,
      modeledTargetDateBalanceCents: 600_000,
    },
    {
      vehicleCode: 'hysa',
      eligible: true,
      safeContributionPurchaseReadyDate: '2027-08-23',
      accessRequirementSatisfied: true,
      lockConflictDays: 0,
      modeledTargetDateBalanceCents: 605_000,
    },
    {
      vehicleCode: 'cd_ladder',
      eligible: true,
      safeContributionPurchaseReadyDate: '2027-08-23',
      accessRequirementSatisfied: false,
      lockConflictDays: 30,
      modeledTargetDateBalanceCents: 650_000,
    },
    {
      vehicleCode: 'treasury_ladder',
      eligible: false,
      safeContributionPurchaseReadyDate: '2027-08-23',
      accessRequirementSatisfied: true,
      lockConflictDays: 0,
      modeledTargetDateBalanceCents: 660_000,
    },
  ];

  function rankMap(input: readonly VehicleFitCandidate[]): Record<VehicleCode, number | null> {
    return Object.fromEntries(
      rankVehicleFits({
        targetAmountCents: 600_000,
        targetDate: '2027-08-23',
        candidates: input,
      }).map((vehicle) => [vehicle.vehicleCode, vehicle.rank]),
    ) as Record<VehicleCode, number | null>;
  }

  it('prioritizes readiness/access/lock before cushion and keeps every vehicle visible', () => {
    const ranked = rankVehicleFits({
      targetAmountCents: 600_000,
      targetDate: '2027-08-23',
      candidates,
    });
    expect(ranked.map((vehicle) => vehicle.vehicleCode)).toEqual([
      'cash',
      'hysa',
      'cd_ladder',
      'treasury_ladder',
    ]);
    expect(rankMap(candidates)).toEqual({
      cash: 2,
      hysa: 1,
      cd_ladder: 3,
      treasury_ladder: null,
    });
  });

  it('is input-order invariant and uses vehicle code as the final total tie-break', () => {
    expect(rankMap([...candidates].reverse())).toEqual(rankMap(candidates));
    const tied = candidates.slice(0, 2).map((candidate) => ({
      ...candidate,
      modeledTargetDateBalanceCents: 600_000,
    }));
    expect(rankMap(tied)).toMatchObject({ cash: 1, hysa: 2 });
  });

  it('rejects duplicate candidates and malformed ranking amounts', () => {
    const firstCandidate = candidates[0];
    if (firstCandidate === undefined) throw new Error('Expected a vehicle candidate fixture.');
    const rank = (candidateOverrides: Partial<VehicleFitCandidate> = {}, target = 600_000) =>
      rankVehicleFits({
        targetAmountCents: target,
        targetDate: '2027-08-23',
        candidates: [{ ...firstCandidate, ...candidateOverrides }],
      });

    expect(() => rank({}, -1)).toThrow('targetAmountCents');
    expect(() => rank({}, 0.5)).toThrow('targetAmountCents');
    expect(() => rank({ lockConflictDays: -1 })).toThrow('lockConflictDays');
    expect(() => rank({ lockConflictDays: 0.5 })).toThrow('lockConflictDays');
    expect(() => rank({ modeledTargetDateBalanceCents: -1 })).toThrow(
      'modeledTargetDateBalanceCents',
    );
    expect(() => rank({ modeledTargetDateBalanceCents: 0.5 })).toThrow(
      'modeledTargetDateBalanceCents',
    );
    expect(() =>
      rankVehicleFits({
        targetAmountCents: 600_000,
        targetDate: '2027-08-23',
        candidates: [firstCandidate, firstCandidate],
      }),
    ).toThrow('Duplicate vehicle candidate');
  });
});

describe('stateless one-change scenarios and recovery', () => {
  const plan: ZeroInterestPlanInput = {
    asOfDate: '2026-08-23',
    currentSavedCents: 50_000,
    targetAmountCents: 200_000,
    targetDate: '2026-11-23',
    recurringContributionCents: 40_000,
    contributionCadence: 'monthly',
  };

  it('evaluates each permitted single dimension without mutating the plan', () => {
    const original = structuredClone(plan);
    expect(
      evaluatePlanScenario(plan, {
        kind: 'contribution',
        newRecurringContributionCents: 50_000,
      }).proposed.projectedPurchaseReadyDate,
    ).toBe('2026-11-23');
    expect(
      evaluatePlanScenario(plan, { kind: 'deadline', newTargetDate: '2026-12-23' }).proposed
        .projectedPurchaseReadyDate,
    ).toBe('2026-12-23');
    expect(
      evaluatePlanScenario(plan, { kind: 'target', newTargetAmountCents: 170_000 }).proposed
        .projectedPurchaseReadyDate,
    ).toBe('2026-11-23');
    expect(
      evaluatePlanScenario(plan, {
        kind: 'missed_contribution',
        contributionDate: '2026-09-23',
      }).proposed,
    ).toMatchObject({
      plannedPersonalContributionsCents: 80_000,
      projectedTargetDateBalanceCents: 130_000,
      projectedPurchaseReadyDate: null,
    });
    expect(plan).toEqual(original);
  });

  it('never produces a later readiness date when the contribution increases', () => {
    const readinessDates = [10_000, 20_000, 30_000, 40_000, 50_000, 60_000].map(
      (recurringContributionCents) =>
        analyzeZeroInterestPlan({ ...plan, recurringContributionCents })
          .projectedPurchaseReadyDate ?? '9999-12-31',
    );
    for (let index = 1; index < readinessDates.length; index += 1) {
      const current = readinessDates[index];
      const previous = readinessDates[index - 1];
      if (current === undefined || previous === undefined)
        throw new Error('Expected adjacent contribution scenarios.');
      expect(current <= previous).toBe(true);
    }
  });

  it('never lets omitting a planned contribution improve readiness', () => {
    const currentReadiness = analyzeZeroInterestPlan({
      ...plan,
      recurringContributionCents: 50_000,
    }).projectedPurchaseReadyDate;
    expect(currentReadiness).not.toBeNull();
    for (const contributionDate of ['2026-09-23', '2026-10-23', '2026-11-23']) {
      const missedReadiness = evaluatePlanScenario(
        { ...plan, recurringContributionCents: 50_000 },
        { kind: 'missed_contribution', contributionDate },
      ).proposed.projectedPurchaseReadyDate;
      expect((missedReadiness ?? '9999-12-31') >= (currentReadiness ?? '9999-12-31')).toBe(true);
    }
  });

  it('rejects no-ops and a missed date outside the plan', () => {
    expect(() =>
      evaluatePlanScenario(plan, {
        kind: 'contribution',
        newRecurringContributionCents: 40_000,
      }),
    ).toThrow('no-op');
    expect(() =>
      evaluatePlanScenario(plan, {
        kind: 'missed_contribution',
        contributionDate: '2026-09-24',
      }),
    ).toThrow('planned contribution date');
    expect(() =>
      evaluatePlanScenario(plan, { kind: 'deadline', newTargetDate: plan.targetDate }),
    ).toThrow('no-op');
    expect(() =>
      evaluatePlanScenario(plan, { kind: 'deadline', newTargetDate: '2026-08-22' }),
    ).toThrow('before asOfDate');
    expect(() =>
      evaluatePlanScenario(plan, { kind: 'target', newTargetAmountCents: plan.targetAmountCents }),
    ).toThrow('no-op');
  });

  it('rejects malformed and overflowing scenario inputs', () => {
    expect(() => analyzeZeroInterestPlan({ ...plan, currentSavedCents: -1 })).toThrow(
      'currentSavedCents',
    );
    expect(() => analyzeZeroInterestPlan({ ...plan, currentSavedCents: 0.5 })).toThrow(
      'currentSavedCents',
    );
    expect(() =>
      analyzeZeroInterestPlan({
        ...plan,
        currentSavedCents: 1,
        targetAmountCents: Number.MAX_SAFE_INTEGER,
        recurringContributionCents: Number.MAX_SAFE_INTEGER,
        targetDate: '2026-09-23',
      }),
    ).toThrow('projected balance');
    expect(() =>
      buildRecoveryOptions({
        plan,
        planHealth: 'ATTENTION_NEEDED',
        maximumDeadlineExtensionMonths: 0,
      }),
    ).toThrow('positive integer');
    expect(() =>
      buildRecoveryOptions({
        plan,
        planHealth: 'ATTENTION_NEEDED',
        maximumDeadlineExtensionMonths: 1.5,
      }),
    ).toThrow('positive integer');
  });

  it('preserves the original calendar anchor after the controlled clock advances', () => {
    const anchoredPlan: ZeroInterestPlanInput = {
      ...plan,
      asOfDate: '2026-02-28',
      scheduleAnchorDate: '2026-01-30',
      targetDate: '2026-04-30',
    };
    expect(analyzeZeroInterestPlan(anchoredPlan).contributionDates).toEqual([
      '2026-03-30',
      '2026-04-30',
    ]);
    expect(
      compareVehicles(
        {
          name: 'Anchored plan',
          targetAmountCents: 100_000,
          currentSavedCents: 50_000,
          targetDate: '2026-04-30',
          recurringContributionCents: 25_000,
          contributionCadence: 'monthly',
          liquidityNeed: 'anytime',
          preservationPreference: 'required',
          confidence: 'expected',
        },
        '2026-02-28',
        illustrativeAssumptions,
        {
          scheduleAnchorDate: '2026-01-30',
          missedContributionDate: '2026-03-30',
        },
      ).zeroInterestBaseline.occurrenceCount,
    ).toBe(1);
  });

  it('returns no more than the three conservative policy-ordered recovery dimensions', () => {
    const options = buildRecoveryOptions({ plan, planHealth: 'ATTENTION_NEEDED' });
    expect(options).toHaveLength(3);
    expect(options.map((option) => [option.order, option.kind, option.availability])).toEqual([
      [1, 'contribution', 'available'],
      [2, 'deadline', 'available'],
      [3, 'target', 'available'],
    ]);
    expect(options[0]).toMatchObject({
      scenario: { kind: 'contribution', newRecurringContributionCents: 50_000 },
    });
    expect(options[1]).toMatchObject({
      scenario: { kind: 'deadline', newTargetDate: '2026-12-23' },
    });
    expect(options[2]).toMatchObject({
      scenario: { kind: 'target', newTargetAmountCents: 170_000 },
    });
    expect(buildRecoveryOptions({ plan, planHealth: 'ON_TRACK' })).toEqual([]);
    expect(analyzeZeroInterestPlan(plan).shortfallCents).toBe(30_000);
  });

  it('treats an already-funded scenario as ready now with no deadline recovery needed', () => {
    const fundedPlan = { ...plan, currentSavedCents: plan.targetAmountCents };
    expect(analyzeZeroInterestPlan(fundedPlan).projectedPurchaseReadyDate).toBe(plan.asOfDate);
    expect(buildRecoveryOptions({ plan: fundedPlan, planHealth: 'ATTENTION_NEEDED' })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'deadline',
          availability: 'unavailable',
          reasonCode: 'NO_DEADLINE_EXTENSION_NEEDED',
        }),
      ]),
    );
  });

  it('explains bounded recovery options that cannot safely change a plan', () => {
    const noRemaining = buildRecoveryOptions({
      plan: { ...plan, targetDate: plan.asOfDate },
      planHealth: 'ATTENTION_NEEDED',
      maximumDeadlineExtensionMonths: 1,
    });
    expect(noRemaining).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'contribution',
          availability: 'unavailable',
          reasonCode: 'NO_REMAINING_CONTRIBUTIONS',
        }),
      ]),
    );

    const zeroContribution = buildRecoveryOptions({
      plan: { ...plan, recurringContributionCents: 0 },
      planHealth: 'ATTENTION_NEEDED',
    });
    expect(zeroContribution).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'deadline',
          availability: 'unavailable',
          reasonCode: 'ZERO_CONTRIBUTION_CANNOT_RECOVER_BY_EXTENSION',
        }),
      ]),
    );

    const boundedSearch = buildRecoveryOptions({
      plan: { ...plan, targetAmountCents: 900_000, recurringContributionCents: 1 },
      planHealth: 'ATTENTION_NEEDED',
      maximumDeadlineExtensionMonths: 1,
      minimumTargetAmountCents: 100_000,
    });
    expect(boundedSearch).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'deadline',
          availability: 'unavailable',
          reasonCode: 'DEADLINE_SEARCH_LIMIT_REACHED',
        }),
        expect.objectContaining({
          kind: 'target',
          availability: 'unavailable',
          reasonCode: 'ATTAINABLE_TARGET_BELOW_POLICY_MINIMUM',
        }),
      ]),
    );
  });
});
