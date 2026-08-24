import { describe, expect, it, vi } from 'vitest';

import type { PriceCheckRunSummary } from '@goalpilot/contracts';
import {
  type DuePriceWatch,
  type PlanExperienceSnapshot,
  StateConflictError,
} from '@goalpilot/data-access';
import { compareVehicles, illustrativeAssumptions } from '@goalpilot/domain';

import { resolveImmutablePlanHealth, runDuePriceChecks } from './purchase-timing-use-case.js';

const dueWatch: DuePriceWatch = {
  item: {
    id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
    goalId: '01ARZ3NDEKTSV4RRFFQ69G5FAW',
    fixtureCode: 'synthetic_oled_65_v1',
    displayName: '65-inch OLED television',
    currency: 'USD',
    targetPriceCents: 150_000,
    lifecycle: 'active',
    version: 1,
    createdAt: '2026-08-23T00:00:00.000Z',
    updatedAt: '2026-08-23T00:00:00.000Z',
  },
  policy: {
    id: '01ARZ3NDEKTSV4RRFFQ69G5FAX',
    purchaseItemId: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
    version: 1,
    cadence: 'weekly',
    nextDueDate: '2026-08-23',
    freshnessLimitDays: 14,
    analysisPolicyVersion: 'purchase-timing-v1',
    enabled: true,
    createdAt: '2026-08-23T00:00:00.000Z',
  },
  plan: {
    goalId: '01ARZ3NDEKTSV4RRFFQ69G5FAW',
    goalVersion: 1,
    goalStatus: 'draft',
    targetAmountCents: 600_000,
    targetDate: '2027-08-23',
    contributionCadence: 'monthly',
    planVersionId: null,
    planVersion: null,
    vehicleCode: null,
    normalizedInput: null,
    calculationOutput: null,
    accountStatus: null,
    nextContributionDate: null,
    lastProcessedDate: null,
    lastAccrualDate: null,
    accruedInterestMicros: 0,
    ledgerBalanceCents: 0,
    ledgerEntryCount: 0,
    availableBalanceCents: 0,
  },
};

const validHistory = {
  fixtureCode: 'synthetic_oled_65_v1',
  displayDescriptor: '65-inch OLED television',
  currency: 'USD',
  asOfDate: '2026-08-23',
  sourceVersion: 'fixture-price-history-v1',
  sourceChecksum: 'a'.repeat(64),
  sourceType: 'deterministic_fixture',
  isDemoData: true,
  observations: [
    {
      observationKey: 'oled-day-0001',
      observedDate: '2026-08-23',
      priceCents: 150_000,
      currency: 'USD',
    },
  ],
} as const;

type RunDependencies = Parameters<typeof runDuePriceChecks>[0];

function runDependencies(
  input: {
    readonly dueWatches?: readonly DuePriceWatch[];
    readonly claimStatuses?: readonly ('claimed' | 'in_progress' | 'completed' | 'failed')[];
    readonly failedClaimErrorCodes?: readonly PriceCheckRunSummary['errorCodes'][number][];
    readonly getHistory?: RunDependencies['historicalPriceProvider']['getHistory'];
    readonly completePriceCheck?: RunDependencies['timingRepository']['completePriceCheck'];
    readonly failPriceCheck?: RunDependencies['timingRepository']['failPriceCheck'];
  } = {},
): {
  readonly dependencies: RunDependencies;
  readonly failPriceCheck: ReturnType<typeof vi.fn>;
  readonly recordOutcomeEvent: ReturnType<typeof vi.fn>;
} {
  const statuses = [...(input.claimStatuses ?? ['claimed'])];
  const failedClaimErrorCodes = [...(input.failedClaimErrorCodes ?? ['ASSESSMENT_FAILURE'])];
  const failPriceCheck = vi.fn(input.failPriceCheck ?? (() => Promise.resolve(true)));
  const recordOutcomeEvent = vi.fn(() => Promise.resolve());
  return {
    dependencies: {
      timingRepository: {
        listDuePriceWatches: vi.fn(() => Promise.resolve(input.dueWatches ?? [dueWatch])),
        claimPriceCheck: vi.fn(() => {
          const status = statuses.shift() ?? 'claimed';
          return Promise.resolve({
            runId: '01ARZ3NDEKTSV4RRFFQ69G5FAY',
            status,
            claimToken: status === 'claimed' ? '01ARZ3NDEKTSV4RRFFQ69G5FAX' : null,
            replayed: status === 'completed' || status === 'in_progress',
            sourceVersion: status === 'completed' ? validHistory.sourceVersion : null,
            sourceChecksum: status === 'completed' ? validHistory.sourceChecksum : null,
            errorCode: status === 'failed' ? (failedClaimErrorCodes.shift() ?? null) : null,
          });
        }),
        failPriceCheck,
        completePriceCheck:
          input.completePriceCheck ??
          vi.fn(() => Promise.reject(new Error('Unexpected assessment completion.'))),
      },
      planRepository: {
        getCurrentPlan: vi.fn(() => Promise.resolve(null)),
        getFixedTermProjectionLots: vi.fn(() => Promise.resolve([])),
      },
      goalAccountProvider: { summary: vi.fn(() => Promise.resolve(null)) },
      historicalPriceProvider: {
        getHistory: input.getHistory ?? vi.fn(() => Promise.resolve(validHistory)),
      },
      recordOutcomeEvent,
    },
    failPriceCheck,
    recordOutcomeEvent,
  };
}

describe('immutable purchase-timing plan health provenance', () => {
  it('keeps a draft plan unready without asking for an account snapshot', async () => {
    const getCurrentPlan = vi.fn(() => Promise.resolve(null));
    const summary = vi.fn(() => {
      throw new Error('A draft has no account snapshot.');
    });
    await expect(
      resolveImmutablePlanHealth(
        {
          planRepository: {
            getCurrentPlan,
            getFixedTermProjectionLots: vi.fn(() => Promise.resolve([])),
          },
          goalAccountProvider: { summary },
        },
        {
          userId: '01ARZ3NDEKTSV4RRFFQ69G5FAZ',
          applicationDate: '2026-09-23',
          plan: dueWatch.plan,
        },
      ),
    ).resolves.toEqual({ health: null, plan: dueWatch.plan });
    expect(getCurrentPlan).toHaveBeenCalledOnce();
    expect(summary).not.toHaveBeenCalled();
  });

  it('derives an overdue active plan without re-running an invalid past-target projection', async () => {
    const goal = {
      id: dueWatch.plan.goalId,
      name: 'Overdue plan',
      targetAmountCents: 200_000,
      currentSavedCents: 100_000,
      targetDate: '2026-08-22',
      recurringContributionCents: 10_000,
      contributionCadence: 'monthly' as const,
      liquidityNeed: 'anytime' as const,
      preservationPreference: 'required' as const,
      confidence: 'expected' as const,
      status: 'active' as const,
      version: 1,
      archivedAt: null,
      archiveReason: null,
      createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-01T00:00:00.000Z',
    };
    const projection = compareVehicles(goal, '2026-07-01', illustrativeAssumptions);
    const selected = projection.vehicles.find((vehicle) => vehicle.vehicleCode === 'hysa');
    if (selected === undefined) throw new Error('Expected the illustrative HYSA projection.');
    const snapshot: PlanExperienceSnapshot = {
      goal,
      planVersionId: '01ARZ3NDEKTSV4RRFFQ69G5FB0',
      planVersion: 1,
      vehicleCode: 'hysa',
      assumptionVersion: selected.assumption.assumptionVersion,
      applicationDate: '2026-07-01',
      scheduleAnchorDate: '2026-07-01',
      omittedContributionDates: [],
      calculationPolicyVersion: 'product-experience-v1',
      rankingPolicyVersion: 'vehicle-fit-v2',
      healthPolicyVersion: 'plan-health-v1',
      changeKind: 'initial_activation',
      changedField: null,
      changeReasonCode: 'INITIAL_ACTIVATION',
      changePayload: null,
      basePlanVersionId: null,
      normalizedInput: goal,
      calculationContext: {
        contextVersion: 'plan-calculation-context-v1',
        personalPrincipalCents: 100_000,
        totalLedgerValueCents: 100_000,
        currentAvailableFundsCents: 100_000,
        currentAccruedInterestMicros: 0,
        applicationDate: '2026-07-01',
        scheduleAnchorDate: '2026-07-01',
        omittedContributionDates: [],
        fixedTermLots: [],
      },
      projection,
      storedDecisionSummary: null,
      activatedAt: '2026-07-01T00:00:00.000Z',
      account: {
        id: '01ARZ3NDEKTSV4RRFFQ69G5FB1',
        status: 'active',
        nextContributionDate: null,
        lastProcessedDate: '2026-08-23',
        lastAccrualDate: '2026-08-23',
        openingSavingsCents: 100_000,
        postedContributionsCents: 0,
        postedInterestCents: 0,
        ledgerBalanceCents: 100_000,
        ledgerEntryCount: 1,
        accruedInterestMicros: 0,
      },
    };
    const fixedTermLots = vi.fn(() => Promise.resolve([]));
    await expect(
      resolveImmutablePlanHealth(
        {
          planRepository: {
            getCurrentPlan: vi.fn(() => Promise.resolve(snapshot)),
            getFixedTermProjectionLots: fixedTermLots,
          },
          goalAccountProvider: {
            summary: vi.fn(() =>
              Promise.resolve({
                id: snapshot.account.id,
                goalId: goal.id,
                status: 'active' as const,
                vehicleCode: 'hysa' as const,
                principalContributedCents: 100_000,
                interestEarnedCents: 0,
                currentLedgerBalanceCents: 100_000,
                principalCompositionBasisPoints: 10_000,
                availableBalanceCents: 100_000,
                pendingContributionCents: 0,
                nextContributionDate: null,
                currentIllustrativeApyBasisPoints: selected.assumption.apyBasisPoints,
                progressPercent: 50,
                projectedCompletionDate: selected.projectedCompletionDate,
                assumptionVersion: selected.assumption.assumptionVersion,
                assumptionReviewedDate: selected.assumption.reviewedDate,
                assumptionIsStale: false,
              }),
            ),
          },
        },
        {
          userId: dueWatch.plan.goalId,
          applicationDate: '2026-08-23',
          plan: dueWatch.plan,
        },
      ),
    ).resolves.toMatchObject({
      health: 'ATTENTION_NEEDED',
      plan: { goalStatus: 'active', ledgerBalanceCents: 100_000 },
    });
    expect(fixedTermLots).not.toHaveBeenCalled();
  });

  it('summarizes no work and terminal claim replays without calling a provider', async () => {
    const empty = runDependencies({ dueWatches: [] });
    await expect(
      runDuePriceChecks(empty.dependencies, {
        userId: '01ARZ3NDEKTSV4RRFFQ69G5FAZ',
        applicationDate: '2026-08-23',
      }),
    ).resolves.toMatchObject({ status: 'no_due_policies', duePolicyCount: 0 });
    expect(empty.recordOutcomeEvent).toHaveBeenCalledWith({
      userId: '01ARZ3NDEKTSV4RRFFQ69G5FAZ',
      applicationDate: '2026-08-23',
      eventName: 'purchase_timing_check_no_due',
    });

    const terminal = runDependencies({
      dueWatches: [dueWatch, dueWatch],
      claimStatuses: ['completed', 'failed'],
      failedClaimErrorCodes: ['FUTURE_OBSERVATION'],
    });
    await expect(
      runDuePriceChecks(terminal.dependencies, {
        userId: '01ARZ3NDEKTSV4RRFFQ69G5FAZ',
        applicationDate: '2026-08-23',
      }),
    ).resolves.toMatchObject({
      status: 'failed',
      duePolicyCount: 2,
      replayedRunCount: 1,
      failedRunCount: 1,
      errorCodes: ['FUTURE_OBSERVATION'],
    });
    expect(terminal.recordOutcomeEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventName: 'purchase_timing_check_failed' }),
    );

    const replayGetHistory = vi.fn(() => Promise.resolve(validHistory));
    const replayOnly = runDependencies({
      claimStatuses: ['completed'],
      getHistory: replayGetHistory,
    });
    await expect(
      runDuePriceChecks(replayOnly.dependencies, {
        userId: '01ARZ3NDEKTSV4RRFFQ69G5FAZ',
        applicationDate: '2026-08-23',
      }),
    ).resolves.toMatchObject({
      status: 'replayed',
      completedRunCount: 0,
      replayedRunCount: 1,
      failedRunCount: 0,
    });
    expect(replayGetHistory).not.toHaveBeenCalled();
    expect(replayOnly.recordOutcomeEvent).toHaveBeenCalledWith({
      userId: '01ARZ3NDEKTSV4RRFFQ69G5FAZ',
      applicationDate: '2026-08-23',
      eventName: 'purchase_timing_check_replayed',
    });

    const inProgressGetHistory = vi.fn(() => Promise.resolve(validHistory));
    const inProgress = runDependencies({
      claimStatuses: ['in_progress'],
      getHistory: inProgressGetHistory,
    });
    await expect(
      runDuePriceChecks(inProgress.dependencies, {
        userId: '01ARZ3NDEKTSV4RRFFQ69G5FAZ',
        applicationDate: '2026-08-23',
      }),
    ).resolves.toMatchObject({
      status: 'in_progress',
      completedRunCount: 0,
      inProgressRunCount: 1,
      replayedRunCount: 0,
      failedRunCount: 0,
    });
    expect(inProgressGetHistory).not.toHaveBeenCalled();
    expect(inProgress.failPriceCheck).not.toHaveBeenCalled();
    expect(inProgress.recordOutcomeEvent).not.toHaveBeenCalled();
  });

  it('records provider and future-observation failures with bounded codes', async () => {
    const providerFailure = runDependencies({
      getHistory: vi.fn(() => Promise.reject(new Error('Provider unavailable.'))),
    });
    await expect(
      runDuePriceChecks(providerFailure.dependencies, {
        userId: '01ARZ3NDEKTSV4RRFFQ69G5FAZ',
        applicationDate: '2026-08-23',
      }),
    ).resolves.toMatchObject({ status: 'failed', errorCodes: ['PROVIDER_FAILURE'] });
    expect(providerFailure.failPriceCheck).toHaveBeenCalledWith(
      expect.objectContaining({ errorCode: 'PROVIDER_FAILURE' }),
    );

    const futureObservation = runDependencies({
      getHistory: vi.fn(() =>
        Promise.resolve({
          ...validHistory,
          observations: [
            {
              ...validHistory.observations[0],
              observedDate: '2026-08-24',
            },
          ],
        }),
      ),
    });
    await expect(
      runDuePriceChecks(futureObservation.dependencies, {
        userId: '01ARZ3NDEKTSV4RRFFQ69G5FAZ',
        applicationDate: '2026-08-23',
      }),
    ).resolves.toMatchObject({ status: 'failed', errorCodes: ['FUTURE_OBSERVATION'] });
    expect(futureObservation.failPriceCheck).toHaveBeenCalledWith({
      userId: '01ARZ3NDEKTSV4RRFFQ69G5FAZ',
      runId: '01ARZ3NDEKTSV4RRFFQ69G5FAY',
      claimToken: '01ARZ3NDEKTSV4RRFFQ69G5FAX',
      errorCode: 'FUTURE_OBSERVATION',
    });
    expect(
      futureObservation.dependencies.timingRepository.completePriceCheck,
    ).not.toHaveBeenCalled();
  });

  it('does not report a stale worker failure after its claim token is superseded', async () => {
    const staleWorker = runDependencies({
      getHistory: vi.fn(() => Promise.reject(new Error('Late provider failure.'))),
      failPriceCheck: vi.fn(() => Promise.resolve(false)),
    });

    await expect(
      runDuePriceChecks(staleWorker.dependencies, {
        userId: '01ARZ3NDEKTSV4RRFFQ69G5FAZ',
        applicationDate: '2026-08-23',
      }),
    ).resolves.toMatchObject({
      status: 'in_progress',
      failedRunCount: 0,
      inProgressRunCount: 1,
      errorCodes: [],
    });
    expect(staleWorker.recordOutcomeEvent).not.toHaveBeenCalled();
  });

  it('fails a claimed run when an adapter returns malformed observations instead of throwing 500', async () => {
    const malformed = runDependencies({
      getHistory: vi.fn(() =>
        Promise.resolve({
          ...validHistory,
          observations: { unexpected: 'not-an-array' },
        } as never),
      ),
    });

    await expect(
      runDuePriceChecks(malformed.dependencies, {
        userId: '01ARZ3NDEKTSV4RRFFQ69G5FAZ',
        applicationDate: '2026-08-23',
      }),
    ).resolves.toMatchObject({
      status: 'failed',
      failedRunCount: 1,
      completedRunCount: 0,
      errorCodes: ['INVALID_PRICE_BATCH'],
    });
    expect(malformed.failPriceCheck).toHaveBeenCalledOnce();
    expect(malformed.failPriceCheck).toHaveBeenCalledWith({
      userId: '01ARZ3NDEKTSV4RRFFQ69G5FAZ',
      runId: '01ARZ3NDEKTSV4RRFFQ69G5FAY',
      claimToken: '01ARZ3NDEKTSV4RRFFQ69G5FAX',
      errorCode: 'INVALID_PRICE_BATCH',
    });
    expect(malformed.dependencies.timingRepository.completePriceCheck).not.toHaveBeenCalled();
    expect(malformed.recordOutcomeEvent).toHaveBeenCalledWith({
      userId: '01ARZ3NDEKTSV4RRFFQ69G5FAZ',
      applicationDate: '2026-08-23',
      eventName: 'purchase_timing_check_failed',
    });
  });

  it('fails a claimed assessment when stored observation provenance conflicts', async () => {
    const conflicting = runDependencies({
      completePriceCheck: vi.fn(() =>
        Promise.reject(
          new StateConflictError('A historical observation conflicts with stored data.'),
        ),
      ),
    });
    await expect(
      runDuePriceChecks(conflicting.dependencies, {
        userId: '01ARZ3NDEKTSV4RRFFQ69G5FAZ',
        applicationDate: '2026-08-23',
      }),
    ).resolves.toMatchObject({ status: 'failed', errorCodes: ['CONFLICTING_OBSERVATION'] });
    expect(conflicting.failPriceCheck).toHaveBeenCalledWith(
      expect.objectContaining({ errorCode: 'CONFLICTING_OBSERVATION' }),
    );
  });
});
