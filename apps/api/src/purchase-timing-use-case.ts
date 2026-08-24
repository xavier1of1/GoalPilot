import { z } from 'zod';

import {
  calendarDateSchema,
  historicalPriceSeriesSchema,
  type HistoricalPriceSeries,
  type PlanHealth,
  previewOutputSchema,
  priceCheckRunSummarySchema,
  type PriceCheckRunSummary,
  type ProductEventName,
  purchaseTimingRationaleCodeSchema,
} from '@goalpilot/contracts';
import {
  type PlanExperienceRepository,
  type PurchaseTimingPlanContext,
  type PurchaseTimingRepository,
  StateConflictError,
} from '@goalpilot/data-access';
import {
  addCalendarDays,
  addCalendarMonths,
  assessPurchaseTiming,
  compareVehicles,
  derivePlanHealth,
  PurchaseTimingValidationError,
} from '@goalpilot/domain';
import type { GoalAccountProvider, HistoricalPriceProvider } from '@goalpilot/provider-ports';

const providerObservationDatesSchema = z
  .object({
    observations: z.array(
      z
        .object({
          observedDate: calendarDateSchema,
        })
        .loose(),
    ),
  })
  .loose();

type HistoricalProviderValidation =
  | { readonly success: true; readonly data: HistoricalPriceSeries }
  | {
      readonly success: false;
      readonly errorCode: 'FUTURE_OBSERVATION' | 'INVALID_PRICE_BATCH';
    };

function validateHistoricalProviderOutput(
  providerOutput: unknown,
  applicationDate: string,
): HistoricalProviderValidation {
  try {
    const observationDates = providerObservationDatesSchema.safeParse(providerOutput);
    const hasFutureObservation =
      observationDates.success &&
      observationDates.data.observations.some(
        (observation) => observation.observedDate > applicationDate,
      );
    const validated = historicalPriceSeriesSchema.safeParse(providerOutput);
    if (!validated.success || validated.data.asOfDate !== applicationDate) {
      return {
        success: false,
        errorCode: hasFutureObservation ? 'FUTURE_OBSERVATION' : 'INVALID_PRICE_BATCH',
      };
    }
    if (hasFutureObservation) {
      return { success: false, errorCode: 'FUTURE_OBSERVATION' };
    }
    return { success: true, data: validated.data };
  } catch {
    // An adapter may violate the port at runtime (including throwing getters/proxies).
    // Never dereference it or leave a claimed run open after boundary validation fails.
    return { success: false, errorCode: 'INVALID_PRICE_BATCH' };
  }
}

interface ImmutablePlanHealthDependencies {
  readonly planRepository: Pick<
    PlanExperienceRepository,
    'getCurrentPlan' | 'getFixedTermProjectionLots'
  >;
  readonly goalAccountProvider: Pick<GoalAccountProvider, 'summary'>;
}

export async function resolveImmutablePlanHealth(
  dependencies: ImmutablePlanHealthDependencies,
  input: {
    readonly userId: string;
    readonly applicationDate: string;
    readonly plan: PurchaseTimingPlanContext;
  },
): Promise<{
  readonly health: PlanHealth | null;
  readonly plan: PurchaseTimingPlanContext;
}> {
  const snapshot = await dependencies.planRepository.getCurrentPlan(
    input.userId,
    input.plan.goalId,
    input.applicationDate,
  );
  if (snapshot === null) return { health: null, plan: input.plan };
  const account = await dependencies.goalAccountProvider.summary(
    input.userId,
    input.plan.goalId,
    input.applicationDate,
  );
  if (account === null) throw new Error('The authoritative simulated account is unavailable.');
  const storedProjection = previewOutputSchema.parse(snapshot.projection);
  const authoritativePlan: PurchaseTimingPlanContext = {
    goalId: snapshot.goal.id,
    goalVersion: snapshot.goal.version,
    goalStatus: snapshot.goal.status,
    targetAmountCents: snapshot.goal.targetAmountCents,
    targetDate: snapshot.goal.targetDate,
    contributionCadence: snapshot.goal.contributionCadence,
    planVersionId: snapshot.planVersionId,
    planVersion: snapshot.planVersion,
    vehicleCode: snapshot.vehicleCode,
    normalizedInput: snapshot.normalizedInput,
    calculationOutput: storedProjection,
    accountStatus: snapshot.account.status,
    nextContributionDate: snapshot.account.nextContributionDate,
    lastProcessedDate: snapshot.account.lastProcessedDate,
    lastAccrualDate: snapshot.account.lastAccrualDate,
    accruedInterestMicros: snapshot.account.accruedInterestMicros,
    ledgerBalanceCents: snapshot.account.ledgerBalanceCents,
    ledgerEntryCount: snapshot.account.ledgerEntryCount,
    availableBalanceCents: account.availableBalanceCents,
  };
  if (snapshot.goal.status === 'completed' || snapshot.goal.status === 'archived') {
    return { health: null, plan: authoritativePlan };
  }
  const targetHasPassed = snapshot.goal.targetDate < input.applicationDate;
  const projection = targetHasPassed
    ? storedProjection
    : compareVehicles(
        snapshot.goal,
        input.applicationDate,
        storedProjection.vehicles.map((vehicle) => vehicle.assumption),
        {
          scheduleAnchorDate: snapshot.scheduleAnchorDate,
          omittedContributionDates: snapshot.omittedContributionDates,
          personalPrincipalCents:
            snapshot.account.openingSavingsCents + snapshot.account.postedContributionsCents,
          totalLedgerValueCents: snapshot.account.ledgerBalanceCents,
          currentAvailableFundsCents: account.availableBalanceCents,
          currentAccruedInterestMicros: snapshot.account.accruedInterestMicros,
          fixedTermLots: await dependencies.planRepository.getFixedTermProjectionLots(
            input.userId,
            input.plan.goalId,
            input.applicationDate,
          ),
          fixedTermVehicleCode: snapshot.vehicleCode,
        },
      );
  const selected = projection.vehicles.find(
    (vehicle) => vehicle.vehicleCode === snapshot.vehicleCode,
  );
  if (selected === undefined) throw new Error('The selected immutable plan model is unavailable.');
  const expiredReadinessDate =
    account.availableBalanceCents >= snapshot.goal.targetAmountCents &&
    selected.accessRequirementSatisfied
      ? input.applicationDate
      : null;
  return {
    plan: authoritativePlan,
    health: derivePlanHealth({
      paused: snapshot.account.status === 'paused',
      currentAvailableFundsCents: account.availableBalanceCents,
      currentTotalValueCents: snapshot.account.ledgerBalanceCents,
      targetAmountCents: snapshot.goal.targetAmountCents,
      accessConditionsSatisfied: selected.accessRequirementSatisfied,
      projectedPurchaseReadyDate: targetHasPassed
        ? expiredReadinessDate
        : selected.projectedCompletionDate,
      targetDate: snapshot.goal.targetDate,
      contributionCadence: snapshot.goal.contributionCadence,
    }).code,
  };
}

export interface RunDuePriceChecksDependencies extends ImmutablePlanHealthDependencies {
  readonly timingRepository: Pick<
    PurchaseTimingRepository,
    'listDuePriceWatches' | 'claimPriceCheck' | 'failPriceCheck' | 'completePriceCheck'
  >;
  readonly historicalPriceProvider: HistoricalPriceProvider;
  readonly recordOutcomeEvent: (input: {
    readonly userId: string;
    readonly applicationDate: string;
    readonly eventName: Extract<
      ProductEventName,
      | 'purchase_timing_check_completed'
      | 'purchase_timing_check_failed'
      | 'purchase_timing_check_replayed'
      | 'purchase_timing_check_no_due'
    >;
  }) => Promise<void>;
}

export async function runDuePriceChecks(
  dependencies: RunDuePriceChecksDependencies,
  input: { readonly userId: string; readonly applicationDate: string },
): Promise<PriceCheckRunSummary> {
  const dueWatches = await dependencies.timingRepository.listDuePriceWatches(
    input.userId,
    input.applicationDate,
  );
  let completedRunCount = 0;
  let inProgressRunCount = 0;
  let replayedRunCount = 0;
  let failedRunCount = 0;
  let observationsInserted = 0;
  let assessmentsCreated = 0;
  const errorCodes: PriceCheckRunSummary['errorCodes'][number][] = [];
  const recordClaimedFailure = async (failure: {
    readonly runId: string;
    readonly claimToken: string;
    readonly errorCode: PriceCheckRunSummary['errorCodes'][number];
  }): Promise<void> => {
    const retainedClaim = await dependencies.timingRepository.failPriceCheck({
      userId: input.userId,
      ...failure,
    });
    if (retainedClaim) {
      failedRunCount += 1;
      errorCodes.push(failure.errorCode);
    } else {
      // Another bounded worker generation now owns or has finished this run.
      // Do not report the stale worker's local error as an immutable run failure.
      inProgressRunCount += 1;
    }
  };

  for (const due of dueWatches) {
    const claim = await dependencies.timingRepository.claimPriceCheck({
      userId: input.userId,
      itemId: due.item.id,
      policyId: due.policy.id,
      applicationDate: input.applicationDate,
    });
    if (claim.status === 'in_progress') {
      inProgressRunCount += 1;
      continue;
    }
    if (claim.status === 'completed') {
      replayedRunCount += 1;
      continue;
    }
    if (claim.status === 'failed') {
      if (claim.errorCode === null) {
        throw new Error('A failed price check is missing its stored safe error code.');
      }
      failedRunCount += 1;
      errorCodes.push(claim.errorCode);
      continue;
    }
    if (claim.claimToken === null) {
      throw new StateConflictError('The price check worker claim is unavailable.');
    }

    let providerData: unknown;
    try {
      providerData = await dependencies.historicalPriceProvider.getHistory({
        fixtureCode: due.item.fixtureCode,
        asOfDate: input.applicationDate,
      });
    } catch {
      await recordClaimedFailure({
        runId: claim.runId,
        claimToken: claim.claimToken,
        errorCode: 'PROVIDER_FAILURE',
      });
      continue;
    }

    const validated = validateHistoricalProviderOutput(providerData, input.applicationDate);
    if (!validated.success) {
      const { errorCode } = validated;
      await recordClaimedFailure({
        runId: claim.runId,
        claimToken: claim.claimToken,
        errorCode,
      });
      continue;
    }

    try {
      const authoritative = await resolveImmutablePlanHealth(dependencies, {
        userId: input.userId,
        applicationDate: input.applicationDate,
        plan: due.plan,
      });
      const assessment = assessPurchaseTiming({
        asOfDate: input.applicationDate,
        currency: validated.data.currency,
        sourceVersion: validated.data.sourceVersion,
        targetPriceCents: due.item.targetPriceCents,
        planHealth: authoritative.health,
        observations: validated.data.observations.map((observation) => ({
          observationKey: observation.observationKey,
          observationDate: observation.observedDate,
          priceCents: observation.priceCents,
          currency: observation.currency,
          sourceVersion: validated.data.sourceVersion,
        })),
      });
      if (assessment.statistics === null) {
        throw new PurchaseTimingValidationError(
          'INVALID_OBSERVATION_DATE',
          'A timing assessment requires at least one valid observation.',
        );
      }
      const rationaleCodes = z
        .array(purchaseTimingRationaleCodeSchema)
        .min(1)
        .parse(assessment.rationaleCodes);
      let nextDueDate = due.policy.nextDueDate;
      do {
        nextDueDate =
          due.policy.cadence === 'weekly'
            ? addCalendarDays(nextDueDate, 7)
            : addCalendarMonths(nextDueDate, 1);
      } while (nextDueDate <= input.applicationDate);
      const completed = await dependencies.timingRepository.completePriceCheck({
        userId: input.userId,
        item: due.item,
        policy: due.policy,
        runId: claim.runId,
        claimToken: claim.claimToken,
        applicationDate: input.applicationDate,
        sourceVersion: validated.data.sourceVersion,
        sourceChecksum: validated.data.sourceChecksum,
        observations: assessment.validObservations.map((observation) => ({
          observationKey: observation.observationKey,
          observedDate: observation.observationDate,
          priceCents: observation.priceCents,
          currency: 'USD',
        })),
        expectedPlan: authoritative.plan,
        assessment: {
          currentPlanVersionId: authoritative.plan.planVersionId,
          currentPlanVersion: authoritative.plan.planVersion,
          planLifecycle:
            authoritative.plan.goalStatus === 'draft'
              ? 'draft'
              : authoritative.plan.goalStatus === 'completed'
                ? 'completed'
                : authoritative.plan.goalStatus === 'archived'
                  ? 'archived'
                  : 'active',
          planHealth: assessment.planHealth,
          state: assessment.state,
          rationaleCodes,
          statistics: {
            minimumPriceCents: assessment.statistics.minimumPriceCents,
            medianPriceCents: assessment.statistics.medianPriceCents,
            maximumPriceCents: assessment.statistics.maximumPriceCents,
            currentPriceCents: assessment.statistics.currentPriceCents,
            empiricalPercentileBasisPoints:
              assessment.statistics.currentEmpiricalPercentileBasisPoints,
            differenceFromMedianCents: assessment.statistics.differenceFromMedianCents,
            differenceFromTargetCents: assessment.statistics.differenceFromTargetCents,
            observationCount: assessment.statistics.observationCount,
            observationSpanDays: assessment.statistics.dataSpanDays,
            freshnessDays: assessment.statistics.freshnessDays,
          },
          seasonal:
            assessment.seasonalMonths === null
              ? null
              : {
                  months: assessment.seasonalMonths.map((month) => ({
                    month: Number(month.calendarMonth),
                    observationCount: month.observationCount,
                    medianPriceCents: month.medianPriceCents,
                  })),
                },
        },
        nextDueDate,
      });
      completedRunCount += 1;
      observationsInserted += completed.observationsInserted;
      assessmentsCreated += 1;
    } catch (error) {
      const errorCode =
        error instanceof PurchaseTimingValidationError
          ? error.code === 'FUTURE_OBSERVATION'
            ? 'FUTURE_OBSERVATION'
            : error.code === 'CURRENCY_MISMATCH'
              ? 'CURRENCY_MISMATCH'
              : error.code === 'CONFLICTING_DUPLICATE'
                ? 'CONFLICTING_OBSERVATION'
                : 'INVALID_PRICE_BATCH'
          : error instanceof StateConflictError &&
              error.message.includes('conflicts with stored data')
            ? 'CONFLICTING_OBSERVATION'
            : 'ASSESSMENT_FAILURE';
      await recordClaimedFailure({
        runId: claim.runId,
        claimToken: claim.claimToken,
        errorCode,
      });
    }
  }

  const summary = priceCheckRunSummarySchema.parse({
    asOfDate: input.applicationDate,
    status:
      dueWatches.length === 0
        ? 'no_due_policies'
        : failedRunCount > 0
          ? 'failed'
          : inProgressRunCount > 0
            ? 'in_progress'
            : completedRunCount > 0
              ? 'completed'
              : 'replayed',
    duePolicyCount: dueWatches.length,
    completedRunCount,
    inProgressRunCount,
    replayedRunCount,
    failedRunCount,
    observationsInserted,
    assessmentsCreated,
    errorCodes: [...new Set(errorCodes)],
  });
  const outcomeEvent = {
    completed: 'purchase_timing_check_completed',
    failed: 'purchase_timing_check_failed',
    replayed: 'purchase_timing_check_replayed',
    no_due_policies: 'purchase_timing_check_no_due',
  } as const;
  if (summary.status !== 'in_progress') {
    await dependencies.recordOutcomeEvent({
      userId: input.userId,
      applicationDate: input.applicationDate,
      eventName: outcomeEvent[summary.status],
    });
  }
  return summary;
}
