import { describe, expect, it } from 'vitest';

import {
  demoResetInputSchema,
  goalDraftCreateInputSchema,
  historicalPriceSeriesSchema,
  planDecisionSummarySchema,
  planHealthSchema,
  productEventInputSchema,
  purchaseItemCreateInputSchema,
  purchaseTimingAssessmentSchema,
  purchaseTimingStateSchema,
  recoveryOptionsOutputSchema,
  safeBaselineInputSchema,
  safeBaselineOutputSchema,
  scenarioPreviewInputSchema,
  userDataExportSchema,
  vehicleProjectionSchema,
} from './index.js';

const firstId = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
const secondId = '01ARZ3NDEKTSV4RRFFQ69G5FAW';
const checksum = 'a'.repeat(64);

const planSummary = planDecisionSummarySchema.parse({
  safeContributionCents: 45_000,
  chosenContributionCents: 45_000,
  contributionCadence: 'monthly',
  currentSavingsCents: 100_000,
  postedPersonalContributionsCents: 25_000,
  postedModeledInterestCents: 500,
  currentTotalValueCents: 125_500,
  currentAvailableFundsCents: 125_500,
  futurePersonalContributionsCents: 450_000,
  futureModeledInterestCents: 12_000,
  projectedTargetDateBalanceCents: 587_500,
  cushionCents: 0,
  shortfallCents: 12_500,
  projectedReadinessDate: null,
  vehicleCode: 'hysa',
  assumptionVersion: 'demo-2026-08-v1',
  calculationPolicyVersion: 'product-experience-v1',
  rankingPolicyVersion: 'vehicle-fit-v2',
  rationaleVersion: 'product-experience-v1',
  rationaleCodes: ['SAFE_CONTRIBUTION_DOES_NOT_DEPEND_ON_INTEREST'],
  health: 'ATTENTION_NEEDED',
});

describe('product-experience contracts', () => {
  it('rejects operational worker claims from the strict user export boundary', () => {
    const checkRun = {
      id: '01ARZ3NDEKTSV4RRFFQ69G5FAX',
      priceWatchPolicyId: firstId,
      purchaseItemId: secondId,
      applicationDate: '2026-08-23',
      fixtureSourceVersion: 'fixture-price-history-v1',
      fixtureSourceChecksum: checksum,
      status: 'completed' as const,
      errorCode: null,
      attemptCount: 1,
      claimedAt: '2026-08-23T12:00:00.000Z',
      completedAt: '2026-08-23T12:01:00.000Z',
    };
    const exported = {
      schemaVersion: 'goalpilot-user-data-export-v2' as const,
      exportedAt: '2026-08-23T12:02:00.000Z',
      user: {
        id: firstId,
        email: 'export@example.test',
        displayName: 'Export fixture',
        createdAt: '2026-08-23T12:00:00.000Z',
        updatedAt: '2026-08-23T12:00:00.000Z',
      },
      goalDrafts: [],
      userApplicationClock: null,
      demoFixtureCapability: null,
      goals: [],
      planVersions: [],
      simulatedAccounts: [],
      ledgerEntries: [],
      scheduleOccurrences: [],
      interestPostingPeriods: [],
      purchaseTiming: {
        items: [],
        watchPolicies: [],
        checkRuns: [checkRun],
        observations: [],
        assessments: [],
      },
    };

    expect(userDataExportSchema.safeParse(exported).success).toBe(true);
    expect(
      userDataExportSchema.safeParse({
        ...exported,
        purchaseTiming: {
          ...exported.purchaseTiming,
          checkRuns: [{ ...checkRun, workerClaimToken: '01ARZ3NDEKTSV4RRFFQ69G5FAY' }],
        },
      }).success,
    ).toBe(false);
  });

  it('requires the exact destructive seeded-demo reset confirmation', () => {
    const base = { goalId: firstId, expectedGoalVersion: 1 };
    expect(demoResetInputSchema.safeParse(base).success).toBe(false);
    expect(demoResetInputSchema.safeParse({ ...base, confirmation: 'RESET_DEMO' }).success).toBe(
      false,
    );
    expect(
      demoResetInputSchema.safeParse({
        ...base,
        confirmation: 'RESET_SEEDED_STORY_DEMO',
      }).success,
    ).toBe(true);
  });

  it('requires explicit baseline schedule inputs and rejects unknown fields', () => {
    const valid = {
      targetAmountCents: 600_000,
      currentSavedCents: 100_000,
      targetDate: '2027-08-23',
      contributionCadence: 'monthly',
    };
    expect(safeBaselineInputSchema.parse(valid)).toEqual(valid);
    expect(
      safeBaselineInputSchema.safeParse({ ...valid, contributionCadence: undefined }).success,
    ).toBe(false);
    expect(safeBaselineInputSchema.safeParse({ ...valid, clientCalculatedAmount: 1 }).success).toBe(
      false,
    );
    expect(
      safeBaselineInputSchema.safeParse({ ...valid, firstContributionDate: '2026-09-23' }).success,
    ).toBe(false);
  });

  it('returns the server-derived first contribution date with a reconciled baseline result', () => {
    expect(
      safeBaselineOutputSchema.parse({
        status: 'possible',
        asOfDate: '2026-08-23',
        targetAmountCents: 600_000,
        currentSavedCents: 100_000,
        targetDate: '2027-08-23',
        contributionCadence: 'monthly',
        firstContributionDate: '2026-09-23',
        occurrenceCount: 12,
        safeContributionCents: 41_667,
        projectedBalanceCents: 600_004,
        shortfallCents: 0,
        calculationPolicyVersion: 'product-experience-v1',
      }).firstContributionDate,
    ).toBe('2026-09-23');
  });

  it('accepts owner-stored partial draft data without weakening strict input', () => {
    expect(
      goalDraftCreateInputSchema.parse({
        data: { name: 'Japan trip', targetAmountCents: 600_000 },
        lastCompletedStep: 'goal',
      }),
    ).toMatchObject({ lastCompletedStep: 'goal' });
    expect(
      goalDraftCreateInputSchema.safeParse({
        data: { name: 'Japan trip', arbitraryMetadata: {} },
        lastCompletedStep: 'goal',
      }).success,
    ).toBe(false);
  });

  it('requires a closed vehicle-fit ranking trace on every projection', () => {
    const projection = {
      vehicleCode: 'hysa',
      displayName: 'High-yield savings simulation',
      eligible: true,
      rejectionCode: null,
      rejectionMessage: null,
      requiredContributionCents: 41_000,
      safeContributionCents: 42_000,
      modelAdjustedRequiredContributionCents: 41_000,
      fitRank: 1,
      readyByTargetUsingSafeContribution: true,
      accessRequirementSatisfied: true,
      lockConflictDays: 0,
      safeContributionModeledCushionCents: 8_000,
      fitRationaleCode: 'ELIGIBLE_ACCESS_FIT',
      protectionClassification: 'SIMULATED_DEPOSIT_HELD_AS_MODELED',
      preservationRequirementSatisfied: true,
      firstMaturityDate: null,
      plannedContributionCents: 42_000,
      principalContributedCents: 504_000,
      futurePersonalContributionsCents: 404_000,
      modeledInterestCents: 8_000,
      modeledBenefitVersusCashCents: 12_000,
      endingBalanceCents: 612_000,
      shortfallCents: 0,
      surplusCents: 12_000,
      projectedCompletionDate: '2027-08-01',
      accessSummary: 'Available without a maturity lock.',
      assumption: {
        vehicleCode: 'hysa',
        displayName: 'High-yield savings simulation',
        assumptionVersion: 'demo-2026-08-v1',
        apyBasisPoints: 300,
        effectiveDate: '2026-08-01',
        reviewedDate: '2026-08-01',
        sourceType: 'reviewed_demo_assumption',
        sourceLabel: 'Reviewed demonstration assumption',
        isLive: false,
        liquidityDays: 0,
        lockDays: 0,
        minimumCents: 0,
        enabled: true,
      },
    };
    expect(vehicleProjectionSchema.safeParse(projection).success).toBe(true);
    expect(
      vehicleProjectionSchema.safeParse({
        ...projection,
        eligible: false,
        fitRank: 1,
        fitRationaleCode: 'INELIGIBLE_POLICY',
      }).success,
    ).toBe(false);
  });

  it('locks the exact plan-health vocabulary', () => {
    expect(planHealthSchema.options).toEqual([
      'AHEAD',
      'ON_TRACK',
      'ATTENTION_NEEDED',
      'FUNDED_BUT_LOCKED',
      'PURCHASE_READY',
      'PAUSED',
    ]);
    expect(planHealthSchema.safeParse('COMPLETED').success).toBe(false);
  });

  it('makes a one-change scenario structurally strict', () => {
    expect(
      scenarioPreviewInputSchema.parse({
        expectedGoalVersion: 3,
        expectedPlanVersion: 2,
        change: { changedDimension: 'CONTRIBUTION', recurringContributionCents: 50_000 },
      }).change,
    ).toEqual({ changedDimension: 'CONTRIBUTION', recurringContributionCents: 50_000 });
    expect(
      scenarioPreviewInputSchema.safeParse({
        expectedGoalVersion: 3,
        expectedPlanVersion: 2,
        change: {
          changedDimension: 'CONTRIBUTION',
          recurringContributionCents: 50_000,
          targetDate: '2028-01-01',
        },
      }).success,
    ).toBe(false);
  });

  it('limits recovery to three unique options in stable order', () => {
    const contribution = {
      availability: 'available' as const,
      order: 1 as const,
      optionType: 'CONTRIBUTION_INCREASE' as const,
      change: { changedDimension: 'CONTRIBUTION' as const, recurringContributionCents: 50_000 },
      projectedReadinessDate: '2027-08-23',
      resultingHealth: 'ON_TRACK' as const,
      personalContributionChangeCents: 5_000,
      modeledInterestChangeCents: 100,
      rationaleCode: 'INCREASE_TO_ZERO_INTEREST_SAFE_AMOUNT' as const,
    };
    const target = {
      availability: 'available' as const,
      order: 3 as const,
      optionType: 'TARGET_REDUCTION' as const,
      change: { changedDimension: 'TARGET' as const, targetAmountCents: 550_000 },
      projectedReadinessDate: '2027-08-23',
      resultingHealth: 'ON_TRACK' as const,
      personalContributionChangeCents: 0,
      modeledInterestChangeCents: 0,
      rationaleCode: 'REDUCE_TO_HIGHEST_ATTAINABLE_TARGET' as const,
    };
    expect(
      recoveryOptionsOutputSchema.safeParse({
        health: 'ATTENTION_NEEDED',
        options: [contribution, target],
      }).success,
    ).toBe(true);
    expect(
      recoveryOptionsOutputSchema.safeParse({
        health: 'ATTENTION_NEEDED',
        options: [target, contribution],
      }).success,
    ).toBe(false);
    expect(
      recoveryOptionsOutputSchema.safeParse({
        health: 'ATTENTION_NEEDED',
        options: [
          contribution,
          {
            availability: 'unavailable',
            order: 2,
            optionType: 'DEADLINE_EXTENSION',
            reasonCode: 'DEADLINE_SEARCH_LIMIT_REACHED',
          },
          target,
        ],
      }).success,
    ).toBe(true);
    expect(
      recoveryOptionsOutputSchema.safeParse({
        health: 'ATTENTION_NEEDED',
        options: [
          {
            availability: 'unavailable',
            order: 1,
            optionType: 'CONTRIBUTION_INCREASE',
            reasonCode: 'SELECTED_VEHICLE_DOES_NOT_RESTORE_READINESS',
          },
          {
            availability: 'unavailable',
            order: 2,
            optionType: 'DEADLINE_EXTENSION',
            reasonCode: 'SELECTED_VEHICLE_DOES_NOT_RESTORE_READINESS',
          },
          {
            availability: 'unavailable',
            order: 3,
            optionType: 'TARGET_REDUCTION',
            reasonCode: 'SELECTED_VEHICLE_DOES_NOT_RESTORE_READINESS',
          },
        ],
      }).success,
    ).toBe(true);
  });

  it('accepts only event-specific categorical telemetry', () => {
    expect(
      productEventInputSchema.parse({
        eventName: 'what_if_previewed',
        demo: true,
        applicationVersion: 'product-experience-v1',
        changedDimension: 'MISSED_CONTRIBUTION',
      }),
    ).toMatchObject({ eventName: 'what_if_previewed' });
    for (const prohibited of [
      { amountCents: 10_000 },
      { name: 'Japan trip' },
      { email: 'alex@example.test' },
      { url: 'https://example.test/item' },
      { resourceId: firstId },
      { metadata: { arbitrary: true } },
    ]) {
      expect(
        productEventInputSchema.safeParse({
          eventName: 'builder_started',
          demo: true,
          applicationVersion: 'product-experience-v1',
          ...prohibited,
        }).success,
      ).toBe(false);
    }
    expect(
      productEventInputSchema.safeParse({
        eventName: 'simulated_plan_activated',
        demo: true,
        applicationVersion: 'product-experience-v1',
      }).success,
    ).toBe(false);
    expect(
      productEventInputSchema.safeParse({
        eventName: 'simulated_plan_activated',
        demo: true,
        applicationVersion: 'product-experience-v1',
        vehicleCode: 'hysa',
      }).success,
    ).toBe(true);
    expect(
      productEventInputSchema.parse({
        eventName: 'purchase_timing_check_completed',
        demo: true,
        applicationVersion: 'product-experience-v1',
      }),
    ).toEqual({
      eventName: 'purchase_timing_check_completed',
      demo: true,
      applicationVersion: 'product-experience-v1',
    });
    expect(
      productEventInputSchema.safeParse({
        eventName: 'purchase_timing_check_completed',
        demo: true,
        applicationVersion: 'product-experience-v1',
        outcome: 'completed',
      }).success,
    ).toBe(false);
  });
});

describe('Purchase Timing Lab contracts', () => {
  it('locks all seven assessment states', () => {
    expect(purchaseTimingStateSchema.options).toEqual([
      'INSUFFICIENT_DATA',
      'STALE_DATA',
      'HISTORICALLY_FAVORABLE_PLAN_READY',
      'HISTORICALLY_FAVORABLE_PLAN_NOT_READY',
      'WATCH',
      'HISTORICALLY_TYPICAL',
      'HISTORICALLY_ELEVATED',
    ]);
  });

  it('accepts only the allowlisted fixture while deriving its display name server-side', () => {
    const input = {
      goalId: firstId,
      fixtureCode: 'synthetic_oled_65_v1',
      currency: 'USD',
      targetPriceCents: 120_000,
    };
    expect(purchaseItemCreateInputSchema.parse(input)).toEqual(input);
    expect(
      purchaseItemCreateInputSchema.safeParse({
        ...input,
        displayName: 'User supplied item name',
      }).success,
    ).toBe(false);
  });

  it('rejects future fixture observations before persistence', () => {
    const series = {
      fixtureCode: 'synthetic_oled_65_v1',
      displayDescriptor: '65-inch OLED television',
      currency: 'USD',
      asOfDate: '2026-08-23',
      sourceVersion: 'oled-history-v1',
      sourceChecksum: checksum,
      sourceType: 'deterministic_fixture',
      isDemoData: true,
      observations: [
        {
          observationKey: 'future-point',
          observedDate: '2026-08-24',
          priceCents: 129_900,
          currency: 'USD',
        },
      ],
    };
    expect(historicalPriceSeriesSchema.safeParse(series).success).toBe(false);
  });

  it('accepts byte-equivalent replay keys and rejects conflicting repeated keys', () => {
    const observation = {
      observationKey: 'same-logical-point',
      observedDate: '2026-08-23',
      priceCents: 129_900,
      currency: 'USD' as const,
    };
    const series = {
      fixtureCode: 'synthetic_oled_65_v1',
      displayDescriptor: '65-inch OLED television',
      currency: 'USD' as const,
      asOfDate: '2026-08-23',
      sourceVersion: 'oled-history-v1',
      sourceChecksum: checksum,
      sourceType: 'deterministic_fixture' as const,
      isDemoData: true as const,
      observations: [observation, { ...observation }],
    };
    expect(historicalPriceSeriesSchema.safeParse(series).success).toBe(true);
    expect(
      historicalPriceSeriesSchema.safeParse({
        ...series,
        observations: [observation, { ...observation, priceCents: 129_901 }],
      }).success,
    ).toBe(false);
  });

  it('keeps favorable readiness and seasonal eligibility consistent', () => {
    const assessment = {
      id: firstId,
      purchaseItemId: secondId,
      priceCheckRunId: '01ARZ3NDEKTSV4RRFFQ69G5FAX',
      asOfDate: '2026-08-23',
      assessedTargetPriceCents: 110_000,
      currentPlanVersion: 2,
      planLifecycle: 'active',
      planHealth: 'FUNDED_BUT_LOCKED',
      state: 'HISTORICALLY_FAVORABLE_PLAN_READY',
      statistics: {
        minimumPriceCents: 100_000,
        medianPriceCents: 120_000,
        maximumPriceCents: 150_000,
        currentPriceCents: 105_000,
        empiricalPercentileBasisPoints: 2_500,
        differenceFromMedianCents: -15_000,
        differenceFromTargetCents: -5_000,
        observationCount: 30,
        observationSpanDays: 90,
        freshnessDays: 0,
      },
      seasonal: null,
      rationaleCodes: ['PRICE_AT_OR_BELOW_FAVORABLE_PERCENTILE'],
      analysisPolicyVersion: 'purchase-timing-v1',
      sourceVersion: 'oled-history-v1',
      sourceChecksum: checksum,
      createdAt: '2026-08-23T12:00:00.000Z',
    };
    expect(purchaseTimingAssessmentSchema.safeParse(assessment).success).toBe(false);
    expect(
      purchaseTimingAssessmentSchema.safeParse({
        ...assessment,
        state: 'HISTORICALLY_FAVORABLE_PLAN_NOT_READY',
      }).success,
    ).toBe(true);
    expect(
      purchaseTimingAssessmentSchema.safeParse({
        ...assessment,
        planLifecycle: 'archived',
        planHealth: null,
        state: 'HISTORICALLY_FAVORABLE_PLAN_NOT_READY',
        rationaleCodes: ['PRICE_AT_OR_BELOW_FAVORABLE_PERCENTILE', 'PLAN_NOT_PURCHASE_READY'],
      }).success,
    ).toBe(true);
  });

  it('keeps plan summary reconciliation strict', () => {
    expect(planSummary.currentTotalValueCents).toBe(125_500);
    expect(
      planDecisionSummarySchema.safeParse({ ...planSummary, currentTotalValueCents: 125_501 })
        .success,
    ).toBe(false);
  });
});
