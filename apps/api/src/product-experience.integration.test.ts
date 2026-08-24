import { createHash } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ulid } from 'ulid';

import {
  type DemoRunSummary,
  type GoalInput,
  planCalculationContextSchema,
  type PreviewOutput,
  type RecoveryOption,
  type VehicleAssumption,
} from '@goalpilot/contracts';
import {
  createDatabaseClient,
  PlanExperienceRepository,
  type DatabaseClient,
} from '@goalpilot/data-access';
import { compareVehicles, illustrativeAssumptions } from '@goalpilot/domain';
import type { HistoricalPriceProvider } from '@goalpilot/provider-ports';
import {
  ControlledApplicationClock,
  FixtureHistoricalPriceProvider,
} from '@goalpilot/provider-simulators';

import { buildApp } from './app.js';
import { loadConfiguration } from './config.js';

interface AuthenticatedSession {
  readonly userId: string;
  readonly cookie: string;
  readonly csrf: string;
}

function cookiesFrom(response: { readonly headers: Readonly<Record<string, unknown>> }): string {
  const value = response.headers['set-cookie'];
  const cookies = Array.isArray(value) ? value : [value];
  return cookies
    .filter((cookie): cookie is string => typeof cookie === 'string')
    .map((cookie) => cookie.split(';')[0])
    .join('; ');
}

function recordPerformance(name: string, durationMs: number, ceilingMs: number): void {
  process.stdout.write(
    `[performance] ${name}=${durationMs.toFixed(1)}ms ceiling=${String(ceilingMs)}ms\n`,
  );
  expect(durationMs).toBeLessThan(ceilingMs);
}

describe('product-experience API integration', () => {
  const baseConfiguration = loadConfiguration();
  const runKey = ulid().toLowerCase();
  const fixtureProvider = new FixtureHistoricalPriceProvider();
  let injectFutureObservation = false;
  let database: DatabaseClient;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let owner: AuthenticatedSession | null = null;
  let other: AuthenticatedSession | null = null;
  let rateCatalog: readonly VehicleAssumption[] = illustrativeAssumptions;
  let rejectCatalogReads = false;
  let historicalPriceBarrier: {
    readonly markStarted: () => void;
    readonly release: Promise<void>;
  } | null = null;
  let goalId = '';

  const historicalPriceProvider: HistoricalPriceProvider = {
    getHistory: async (input) => {
      const fixture = await fixtureProvider.getHistory(input);
      const barrier = historicalPriceBarrier;
      if (barrier !== null) {
        barrier.markStarted();
        await barrier.release;
      }
      if (!injectFutureObservation) return fixture;
      return {
        ...fixture,
        sourceChecksum: 'f'.repeat(64),
        observations: [
          ...fixture.observations,
          {
            observationKey: 'future-observation-test',
            observedDate: '2026-08-24',
            priceCents: 149_900,
            currency: 'USD',
          },
        ],
      };
    },
  };

  const register = async (label: string): Promise<AuthenticatedSession> => {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/register',
      headers: { origin: baseConfiguration.WEB_ORIGIN },
      payload: {
        email: `${label}-${runKey}@example.test`,
        password: 'GoalPilot-Product-2026!',
        displayName: `${label} Product Test`,
      },
    });
    expect(response.statusCode, response.body).toBe(201);
    const body = response.json<{ user: { id: string }; csrfToken: string }>();
    const clocks = await database<{ application_date: string | Date }[]>`
      SELECT application_date FROM user_application_clocks WHERE user_id = ${body.user.id}
    `;
    const applicationDate = clocks[0]?.application_date;
    expect(
      typeof applicationDate === 'string'
        ? applicationDate
        : applicationDate?.toISOString().slice(0, 10),
    ).toBe('2026-08-23');
    return {
      userId: body.user.id,
      cookie: cookiesFrom(response),
      csrf: body.csrfToken,
    };
  };

  const mutationHeaders = (
    session: AuthenticatedSession,
    idempotencyKey?: string,
  ): Record<string, string> => ({
    origin: baseConfiguration.WEB_ORIGIN,
    cookie: session.cookie,
    'x-csrf-token': session.csrf,
    ...(idempotencyKey === undefined ? {} : { 'idempotency-key': idempotencyKey }),
  });

  beforeAll(async () => {
    database = createDatabaseClient(baseConfiguration.DATABASE_URL, 6);
    app = await buildApp({
      configuration: {
        ...baseConfiguration,
        LOG_LEVEL: 'silent',
        DEMO_STORY_ENABLED: false,
        PURCHASE_TIMING_LAB_ENABLED: true,
      },
      database,
      clock: new ControlledApplicationClock('2026-08-23'),
      rateProvider: {
        getCatalog: () => {
          if (rejectCatalogReads)
            return Promise.reject(new Error('Current catalog must not evaluate immutable plans.'));
          return Promise.resolve(rateCatalog);
        },
      },
      historicalPriceProvider,
    });
    owner = await register('owner');
    other = await register('other');
  });

  afterAll(async () => {
    for (const session of [owner, other]) {
      if (session === null) continue;
      await app.inject({
        method: 'POST',
        url: '/api/v1/account-deletion',
        headers: mutationHeaders(session),
        payload: {},
      });
    }
    await app.close();
    await database.end();
  });

  it('activates a progressive draft and preserves immutable, owned, replayable plan evolution', async () => {
    if (owner === null || other === null) throw new Error('Test sessions were not initialized.');
    const incompleteDraftRequest = {
      method: 'POST',
      url: '/api/v1/goal-drafts',
      headers: mutationHeaders(owner, `incomplete-draft-${runKey}`),
      payload: { data: { name: 'Resume this draft' }, lastCompletedStep: null },
    } as const;
    const incompleteDraft = await app.inject(incompleteDraftRequest);
    expect(incompleteDraft.statusCode, incompleteDraft.body).toBe(201);
    const incompleteDraftId = incompleteDraft.json<{ id: string }>().id;
    const incompleteDraftReplay = await app.inject(incompleteDraftRequest);
    expect(incompleteDraftReplay.statusCode, incompleteDraftReplay.body).toBe(201);
    expect(incompleteDraftReplay.headers['idempotency-replayed']).toBe('true');
    expect(incompleteDraftReplay.json()).toEqual(incompleteDraft.json());
    const changedIncompleteDraftReplay = await app.inject({
      ...incompleteDraftRequest,
      payload: { data: { name: 'Changed replay body' }, lastCompletedStep: null },
    });
    expect(changedIncompleteDraftReplay.statusCode).toBe(409);
    const resumedDraft = await app.inject({
      method: 'GET',
      url: `/api/v1/goal-drafts/${incompleteDraftId}`,
      headers: { cookie: owner.cookie },
    });
    expect(resumedDraft.statusCode, resumedDraft.body).toBe(200);
    expect(resumedDraft.json()).toMatchObject({
      id: incompleteDraftId,
      data: { name: 'Resume this draft' },
      lastCompletedStep: null,
      version: 1,
    });
    const missingBudgetFitActivation = await app.inject({
      method: 'POST',
      url: `/api/v1/goal-drafts/${incompleteDraftId}/activate`,
      headers: mutationHeaders(owner, `incomplete-draft-activate-${runKey}`),
      payload: { expectedDraftVersion: 1, vehicleCode: 'hysa' },
    });
    expect(missingBudgetFitActivation.statusCode, missingBudgetFitActivation.body).toBe(400);
    const continueDraftRequest = {
      method: 'PATCH',
      url: `/api/v1/goal-drafts/${incompleteDraftId}`,
      headers: mutationHeaders(owner, `incomplete-draft-update-${runKey}`),
      payload: {
        expectedVersion: 1,
        data: { name: 'Resume this draft', targetAmountCents: 200_000, budgetFit: 'lower' },
        lastCompletedStep: null,
      },
    } as const;
    const continuedDraft = await app.inject(continueDraftRequest);
    expect(continuedDraft.statusCode, continuedDraft.body).toBe(200);
    expect(continuedDraft.json()).toMatchObject({
      lastCompletedStep: null,
      version: 2,
    });
    const continuedDraftReplay = await app.inject(continueDraftRequest);
    expect(continuedDraftReplay.statusCode, continuedDraftReplay.body).toBe(200);
    expect(continuedDraftReplay.headers['idempotency-replayed']).toBe('true');
    expect(continuedDraftReplay.json()).toEqual(continuedDraft.json());
    const changedContinuedDraftReplay = await app.inject({
      ...continueDraftRequest,
      payload: {
        ...continueDraftRequest.payload,
        data: { ...continueDraftRequest.payload.data, name: 'Changed after replay' },
      },
    });
    expect(changedContinuedDraftReplay.statusCode).toBe(409);
    const staleContinuedDraft = await app.inject({
      ...continueDraftRequest,
      headers: mutationHeaders(owner, `stale-draft-update-${runKey}`),
      payload: { ...continueDraftRequest.payload, expectedVersion: 1 },
    });
    expect(staleContinuedDraft.statusCode).toBe(409);
    const missingRequiredStepsActivation = await app.inject({
      method: 'POST',
      url: `/api/v1/goal-drafts/${incompleteDraftId}/activate`,
      headers: mutationHeaders(owner, `partial-draft-activate-${runKey}`),
      payload: { expectedDraftVersion: 2, vehicleCode: 'hysa' },
    });
    expect(missingRequiredStepsActivation.statusCode, missingRequiredStepsActivation.body).toBe(
      400,
    );
    const listedDrafts = await app.inject({
      method: 'GET',
      url: '/api/v1/goal-drafts',
      headers: { cookie: owner.cookie },
    });
    expect(listedDrafts.statusCode, listedDrafts.body).toBe(200);
    expect(listedDrafts.json()).toMatchObject({ drafts: [{ id: incompleteDraftId, version: 2 }] });
    const staleDiscard = await app.inject({
      method: 'DELETE',
      url: `/api/v1/goal-drafts/${incompleteDraftId}`,
      headers: mutationHeaders(owner, `stale-draft-delete-${runKey}`),
      payload: { expectedVersion: 1 },
    });
    expect(staleDiscard.statusCode).toBe(409);
    const discardRequest = {
      method: 'DELETE' as const,
      url: `/api/v1/goal-drafts/${incompleteDraftId}`,
      headers: mutationHeaders(owner, `incomplete-draft-delete-${runKey}`),
      payload: { expectedVersion: 2 },
    };
    const discarded = await app.inject(discardRequest);
    expect(discarded.statusCode, discarded.body).toBe(204);
    const discardedReplay = await app.inject(discardRequest);
    expect(discardedReplay.statusCode, discardedReplay.body).toBe(204);
    expect(discardedReplay.headers['idempotency-replayed']).toBe('true');
    const changedDiscardReplay = await app.inject({
      ...discardRequest,
      payload: { expectedVersion: 1 },
    });
    expect(changedDiscardReplay.statusCode).toBe(409);
    const missingDraftRead = await app.inject({
      method: 'GET',
      url: `/api/v1/goal-drafts/${incompleteDraftId}`,
      headers: { cookie: owner.cookie },
    });
    expect(missingDraftRead.statusCode).toBe(404);
    const missingDraftUpdate = await app.inject({
      ...continueDraftRequest,
      headers: mutationHeaders(owner, `missing-draft-update-${runKey}`),
      payload: { ...continueDraftRequest.payload, expectedVersion: 2 },
    });
    expect(missingDraftUpdate.statusCode).toBe(404);
    const missingDraftDiscard = await app.inject({
      ...discardRequest,
      headers: mutationHeaders(owner, `missing-draft-delete-${runKey}`),
    });
    expect(missingDraftDiscard.statusCode).toBe(404);
    const draftPayload = {
      data: {
        name: 'Product experience goal',
        targetAmountCents: 600_000,
        targetDate: '2027-08-23',
        currentSavedCents: 100_000,
        contributionCadence: 'monthly',
        firstContributionDate: '2026-09-23',
        safeContributionCents: 41_667,
        recurringContributionCents: 10_000,
        budgetFit: 'lower',
        liquidityNeed: 'anytime',
        preservationPreference: 'required',
        confidence: 'expected',
      },
      lastCompletedStep: 'review',
    } as const;

    const missingCsrf = await app.inject({
      method: 'POST',
      url: '/api/v1/goal-drafts',
      headers: {
        origin: baseConfiguration.WEB_ORIGIN,
        cookie: owner.cookie,
        'idempotency-key': `draft-no-csrf-${runKey}`,
      },
      payload: draftPayload,
    });
    expect(missingCsrf.statusCode).toBe(403);

    const capabilities = await app.inject({
      method: 'GET',
      url: '/api/v1/capabilities',
      headers: { cookie: owner.cookie },
    });
    expect(capabilities.statusCode, capabilities.body).toBe(200);
    expect(capabilities.json()).toEqual({
      demoStory: false,
      purchaseTimingLab: true,
      applicationDate: '2026-08-23',
    });
    const productEventRequest = {
      method: 'POST' as const,
      url: '/api/v1/product-events',
      headers: mutationHeaders(owner, `product-event-${runKey}`),
      payload: {
        eventName: 'builder_started',
        demo: true,
        applicationVersion: 'product-experience-v1',
      },
    };
    const recordedEvent = await app.inject(productEventRequest);
    expect(recordedEvent.statusCode, recordedEvent.body).toBe(202);
    const recordedEventReplay = await app.inject(productEventRequest);
    expect(recordedEventReplay.statusCode, recordedEventReplay.body).toBe(202);
    expect(recordedEventReplay.headers['idempotency-replayed']).toBe('true');
    const changedEventReplay = await app.inject({
      ...productEventRequest,
      payload: { ...productEventRequest.payload, demo: false },
    });
    expect(changedEventReplay.statusCode).toBe(409);
    const eventFlags = await database<{ is_demo: boolean }[]>`
      SELECT is_demo FROM product_events
      WHERE event_name = 'builder_started'
      ORDER BY occurred_at DESC, id DESC LIMIT 1
    `;
    expect(eventFlags).toEqual([{ is_demo: false }]);

    const createdDraft = await app.inject({
      method: 'POST',
      url: '/api/v1/goal-drafts',
      headers: mutationHeaders(owner, `draft-create-${runKey}`),
      payload: draftPayload,
    });
    expect(createdDraft.statusCode, createdDraft.body).toBe(201);
    const draftId = createdDraft.json<{ id: string }>().id;
    const activationRequest = {
      method: 'POST' as const,
      url: `/api/v1/goal-drafts/${draftId}/activate`,
      headers: mutationHeaders(owner, `draft-activate-${runKey}`),
      payload: { expectedDraftVersion: 1, vehicleCode: 'hysa' },
    };
    const activated = await app.inject(activationRequest);
    expect(activated.statusCode, activated.body).toBe(201);
    const activation = activated.json<{
      goalId: string;
      goalVersion: number;
      planVersion: number;
      summary: { assumptionVersion: string; health: string };
    }>();
    goalId = activation.goalId;
    expect(activation).toMatchObject({
      goalVersion: 1,
      planVersion: 1,
      summary: { health: 'ATTENTION_NEEDED' },
    });

    const activationReplay = await app.inject(activationRequest);
    expect(activationReplay.statusCode, activationReplay.body).toBe(201);
    expect(activationReplay.headers['idempotency-replayed']).toBe('true');
    expect(activationReplay.json()).toEqual(activated.json());
    const changedActivationReplay = await app.inject({
      ...activationRequest,
      payload: { expectedDraftVersion: 1, vehicleCode: 'cash' },
    });
    expect(changedActivationReplay.statusCode).toBe(409);

    const contributed = await app.inject({
      method: 'POST',
      url: `/api/v1/goals/${goalId}/contributions`,
      headers: mutationHeaders(owner, `post-activation-contribution-${runKey}`),
      payload: { amountCents: 12_345, effectiveDate: '2026-08-23' },
    });
    expect(contributed.statusCode, contributed.body).toBe(201);
    await database`
      UPDATE simulated_accounts SET accrued_interest_micros = 1_500_000
      WHERE goal_id = ${goalId} AND user_id = ${owner.userId}
    `;

    const crossUserSummary = await app.inject({
      method: 'GET',
      url: `/api/v1/goals/${goalId}/plan/summary`,
      headers: { cookie: other.cookie },
    });
    expect(crossUserSummary.statusCode).toBe(404);

    rateCatalog = illustrativeAssumptions.map((assumption) => ({
      ...assumption,
      assumptionVersion: 'unpersisted-catalog-v2',
      apyBasisPoints: assumption.vehicleCode === 'cash' ? 2_000 : assumption.apyBasisPoints,
    }));
    const missedChange = {
      changedDimension: 'MISSED_CONTRIBUTION',
      missedContributionDate: '2026-09-23',
    } as const;
    const missedPayload = {
      expectedGoalVersion: 1,
      expectedPlanVersion: 1,
      change: missedChange,
    };
    const previewStartedAt = performance.now();
    const preview = await app.inject({
      method: 'POST',
      url: `/api/v1/goals/${goalId}/what-if/preview`,
      headers: mutationHeaders(owner),
      payload: missedPayload,
    });
    recordPerformance('what-if-preview', performance.now() - previewStartedAt, 1_000);
    expect(preview.statusCode, preview.body).toBe(200);
    expect(preview.json()).toMatchObject({
      comparison: {
        changedDimension: 'MISSED_CONTRIBUTION',
        proposed: { assumptionVersion: activation.summary.assumptionVersion },
      },
    });

    const missedApplyRequest = {
      method: 'POST' as const,
      url: `/api/v1/goals/${goalId}/what-if/apply`,
      headers: mutationHeaders(owner, `missed-apply-${runKey}`),
      payload: missedPayload,
    };
    // The spy must invoke the exact prototype implementation with the runtime repository instance.
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const originalApplyScenario = PlanExperienceRepository.prototype.applyScenario;
    let markScenarioStarted: (() => void) | undefined;
    let releaseScenario: (() => void) | undefined;
    const scenarioStarted = new Promise<void>((resolve) => {
      markScenarioStarted = resolve;
    });
    const scenarioRelease = new Promise<void>((resolve) => {
      releaseScenario = resolve;
    });
    const delayedApply = vi
      .spyOn(PlanExperienceRepository.prototype, 'applyScenario')
      .mockImplementation(async function (this: PlanExperienceRepository, input) {
        markScenarioStarted?.();
        await scenarioRelease;
        return await originalApplyScenario.call(this, input);
      });
    const racedApplyPromise = app.inject(missedApplyRequest);
    await scenarioStarted;
    const concurrentContribution = await app.inject({
      method: 'POST',
      url: `/api/v1/goals/${goalId}/contributions`,
      headers: mutationHeaders(owner, `scenario-race-contribution-${runKey}`),
      payload: { amountCents: 100, effectiveDate: '2026-08-23' },
    });
    releaseScenario?.();
    const racedApply = await racedApplyPromise;
    delayedApply.mockRestore();
    expect(concurrentContribution.statusCode, concurrentContribution.body).toBe(201);
    expect(racedApply.statusCode, racedApply.body).toBe(409);
    expect(racedApply.json<{ error: { message: string } }>().error.message).toContain(
      'account changed',
    );
    const rowsAfterRejectedRace = await database<
      { readonly plan_count: string; readonly change_count: string }[]
    >`
      SELECT
        (SELECT COUNT(*) FROM plan_versions
         WHERE goal_id = ${goalId} AND user_id = ${owner.userId}) AS plan_count,
        (SELECT COUNT(*) FROM ledger_entries entry
         JOIN simulated_accounts account ON account.id = entry.account_id
         WHERE account.goal_id = ${goalId} AND entry.user_id = ${owner.userId}
           AND entry.entry_type = 'plan_changed') AS change_count
    `;
    expect(rowsAfterRejectedRace).toEqual([{ plan_count: '1', change_count: '0' }]);

    const missedApplied = await app.inject(missedApplyRequest);
    expect(missedApplied.statusCode, missedApplied.body).toBe(201);
    expect(missedApplied.json()).toMatchObject({ goalVersion: 2, planVersion: 2 });
    const storedScenarioRows = await database<
      {
        readonly application_date: string | Date;
        readonly normalized_input: GoalInput;
        readonly vehicle_code: PreviewOutput['vehicles'][number]['vehicleCode'];
        readonly calculation_context: unknown;
        readonly calculation_output: PreviewOutput & { readonly decisionSummary: unknown };
      }[]
    >`
      SELECT application_date, normalized_input, vehicle_code, calculation_context,
             calculation_output
      FROM plan_versions
      WHERE goal_id = ${goalId} AND user_id = ${owner.userId} AND version = 2
    `;
    const storedScenario = storedScenarioRows[0];
    if (storedScenario === undefined) throw new Error('Scenario version was not stored.');
    const calculationContext = planCalculationContextSchema.parse(
      storedScenario.calculation_context,
    );
    expect(storedScenario.normalized_input.currentSavedCents).toBe(100_000);
    expect(calculationContext).toMatchObject({
      personalPrincipalCents: 112_445,
      totalLedgerValueCents: 112_445,
      currentAvailableFundsCents: 112_445,
      currentAccruedInterestMicros: 1_500_000,
      applicationDate: '2026-08-23',
      scheduleAnchorDate: '2026-08-23',
      omittedContributionDates: ['2026-09-23'],
    });
    const { decisionSummary: _storedDecisionSummary, ...storedProjection } =
      storedScenario.calculation_output;
    void _storedDecisionSummary;
    const replayedProjection = compareVehicles(
      storedScenario.normalized_input,
      typeof storedScenario.application_date === 'string'
        ? storedScenario.application_date
        : storedScenario.application_date.toISOString().slice(0, 10),
      storedProjection.vehicles.map((vehicle) => vehicle.assumption),
      {
        scheduleAnchorDate: calculationContext.scheduleAnchorDate,
        omittedContributionDates: calculationContext.omittedContributionDates,
        personalPrincipalCents: calculationContext.personalPrincipalCents,
        totalLedgerValueCents: calculationContext.totalLedgerValueCents,
        currentAvailableFundsCents: calculationContext.currentAvailableFundsCents,
        currentAccruedInterestMicros: calculationContext.currentAccruedInterestMicros,
        fixedTermLots: calculationContext.fixedTermLots,
        fixedTermVehicleCode: storedScenario.vehicle_code,
      },
    );
    expect(replayedProjection).toEqual(storedProjection);
    const missedReplay = await app.inject(missedApplyRequest);
    expect(missedReplay.statusCode, missedReplay.body).toBe(201);
    expect(missedReplay.headers['idempotency-replayed']).toBe('true');
    expect(missedReplay.json()).toEqual(missedApplied.json());
    const changedMissedReplay = await app.inject({
      ...missedApplyRequest,
      payload: {
        ...missedPayload,
        change: { changedDimension: 'TARGET', targetAmountCents: 550_000 },
      },
    });
    expect(changedMissedReplay.statusCode).toBe(409);
    const stalePreview = await app.inject({
      method: 'POST',
      url: `/api/v1/goals/${goalId}/what-if/preview`,
      headers: mutationHeaders(owner),
      payload: missedPayload,
    });
    expect(stalePreview.statusCode).toBe(409);
    const staleApply = await app.inject({
      ...missedApplyRequest,
      headers: mutationHeaders(owner, `stale-missed-apply-${runKey}`),
    });
    expect(staleApply.statusCode).toBe(409);

    const health = await app.inject({
      method: 'GET',
      url: `/api/v1/goals/${goalId}/plan/health`,
      headers: { cookie: owner.cookie },
    });
    expect(health.statusCode, health.body).toBe(200);
    expect(health.json()).toMatchObject({ health: 'ATTENTION_NEEDED' });
    const recovery = await app.inject({
      method: 'GET',
      url: `/api/v1/goals/${goalId}/recovery`,
      headers: { cookie: owner.cookie },
    });
    expect(recovery.statusCode, recovery.body).toBe(200);
    const available = recovery
      .json<{ options: readonly RecoveryOption[] }>()
      .options.find((option) => option.availability === 'available');
    expect(available).toBeDefined();
    if (available?.availability !== 'available') throw new Error('No recovery option available.');
    expect(available.change.changedDimension).not.toBe('MISSED_CONTRIBUTION');
    const recovered = await app.inject({
      method: 'POST',
      url: `/api/v1/goals/${goalId}/recovery/apply`,
      headers: mutationHeaders(owner, `recovery-apply-${runKey}`),
      payload: {
        expectedGoalVersion: 2,
        expectedPlanVersion: 2,
        change: available.change,
      },
    });
    expect(recovered.statusCode, recovered.body).toBe(201);
    expect(recovered.json()).toMatchObject({ goalVersion: 3, planVersion: 3 });

    const history = await app.inject({
      method: 'GET',
      url: `/api/v1/goals/${goalId}/plan/history`,
      headers: { cookie: owner.cookie },
    });
    expect(history.statusCode, history.body).toBe(200);
    expect(history.json()).toMatchObject({
      currentGoalVersion: 3,
      versions: [
        { version: 1, activatedDate: '2026-08-23', changeReason: 'INITIAL_ACTIVATION' },
        {
          version: 2,
          activatedDate: '2026-08-23',
          changedDimension: 'MISSED_CONTRIBUTION',
          changeReason: 'WHAT_IF_APPLIED',
        },
        { version: 3, activatedDate: '2026-08-23', changeReason: 'RECOVERY_APPLIED' },
      ],
    });
    const crossUserHistory = await app.inject({
      method: 'GET',
      url: `/api/v1/goals/${goalId}/plan/history`,
      headers: { cookie: other.cookie },
    });
    expect(crossUserHistory.statusCode).toBe(404);
  }, 20_000);

  it('owns, validates, runs, replays, and safely fails deterministic Timing Lab checks', async () => {
    if (owner === null || other === null || goalId.length === 0)
      throw new Error('The product plan fixture was not initialized.');
    rejectCatalogReads = true;
    const createKey = `timing-create-${runKey}`;
    const itemPayload = {
      goalId,
      fixtureCode: 'synthetic_oled_65_v1',
      currency: 'USD',
      targetPriceCents: 150_000,
    } as const;
    const missingCsrf = await app.inject({
      method: 'POST',
      url: '/api/v1/timing-lab/purchase-items',
      headers: {
        origin: baseConfiguration.WEB_ORIGIN,
        cookie: owner.cookie,
        'idempotency-key': `timing-no-csrf-${runKey}`,
      },
      payload: itemPayload,
    });
    expect(missingCsrf.statusCode).toBe(403);
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/timing-lab/purchase-items',
      headers: mutationHeaders(owner, createKey),
      payload: itemPayload,
    });
    expect(created.statusCode, created.body).toBe(201);
    const itemId = created.json<{ id: string }>().id;
    const updateRequest = {
      method: 'PATCH' as const,
      url: `/api/v1/timing-lab/purchase-items/${itemId}`,
      headers: mutationHeaders(owner, `timing-update-${runKey}`),
      payload: { expectedVersion: 1, targetPriceCents: 149_000 },
    };
    const updated = await app.inject(updateRequest);
    expect(updated.statusCode, updated.body).toBe(200);
    expect(updated.json()).toMatchObject({ id: itemId, version: 2, targetPriceCents: 149_000 });
    const updatedReplay = await app.inject(updateRequest);
    expect(updatedReplay.statusCode, updatedReplay.body).toBe(200);
    expect(updatedReplay.headers['idempotency-replayed']).toBe('true');
    const staleUpdate = await app.inject({
      ...updateRequest,
      headers: mutationHeaders(owner, `timing-stale-update-${runKey}`),
      payload: { expectedVersion: 1, targetPriceCents: 148_000 },
    });
    expect(staleUpdate.statusCode).toBe(409);
    const crossUserUpdate = await app.inject({
      ...updateRequest,
      headers: mutationHeaders(other, `timing-cross-update-${runKey}`),
      payload: { expectedVersion: 2, targetPriceCents: 148_000 },
    });
    expect(crossUserUpdate.statusCode).toBe(404);
    const changedCreateReplay = await app.inject({
      method: 'POST',
      url: '/api/v1/timing-lab/purchase-items',
      headers: mutationHeaders(owner, createKey),
      payload: { ...itemPayload, targetPriceCents: 140_000 },
    });
    expect(changedCreateReplay.statusCode).toBe(409);
    const crossUserLatest = await app.inject({
      method: 'GET',
      url: `/api/v1/timing-lab/purchase-items/${itemId}/latest`,
      headers: { cookie: other.cookie },
    });
    expect(crossUserLatest.statusCode).toBe(404);

    const watch = await app.inject({
      method: 'POST',
      url: `/api/v1/timing-lab/purchase-items/${itemId}/watch-policies`,
      headers: mutationHeaders(owner, `watch-create-${runKey}`),
      payload: { cadence: 'weekly', nextDueDate: '2026-08-23', enabled: true },
    });
    expect(watch.statusCode, watch.body).toBe(201);
    const runRequest = {
      method: 'POST' as const,
      url: '/api/v1/timing-lab/run-due-price-checks',
      headers: mutationHeaders(owner, `timing-run-${runKey}`),
      payload: {},
    };
    const timingStartedAt = performance.now();
    const run = await app.inject(runRequest);
    recordPerformance(
      'timing-assessment-731-observations',
      performance.now() - timingStartedAt,
      5_000,
    );
    expect(run.statusCode, run.body).toBe(200);
    expect(run.json()).toMatchObject({
      asOfDate: '2026-08-23',
      status: 'completed',
      duePolicyCount: 1,
      completedRunCount: 1,
      failedRunCount: 0,
      observationsInserted: 731,
      assessmentsCreated: 1,
      errorCodes: [],
    });
    const replay = await app.inject(runRequest);
    expect(replay.statusCode, replay.body).toBe(200);
    expect(replay.headers['idempotency-replayed']).toBe('true');
    expect(replay.json()).toEqual(run.json());
    const latest = await app.inject({
      method: 'GET',
      url: `/api/v1/timing-lab/purchase-items/${itemId}/latest`,
      headers: { cookie: owner.cookie },
    });
    expect(latest.statusCode, latest.body).toBe(200);
    expect(latest.json()).toMatchObject({
      item: { id: itemId, displayName: '65-inch OLED television' },
      assessment: {
        asOfDate: '2026-08-23',
        analysisPolicyVersion: 'purchase-timing-v1',
        currentPlanVersion: 3,
        planHealth: 'ON_TRACK',
      },
    });

    injectFutureObservation = true;
    const futureItem = await app.inject({
      method: 'POST',
      url: '/api/v1/timing-lab/purchase-items',
      headers: mutationHeaders(owner, `future-item-${runKey}`),
      payload: { ...itemPayload, targetPriceCents: 145_000 },
    });
    expect(futureItem.statusCode, futureItem.body).toBe(201);
    const futureItemId = futureItem.json<{ id: string }>().id;
    const futureWatch = await app.inject({
      method: 'POST',
      url: `/api/v1/timing-lab/purchase-items/${futureItemId}/watch-policies`,
      headers: mutationHeaders(owner, `future-watch-${runKey}`),
      payload: { cadence: 'weekly', nextDueDate: '2026-08-23', enabled: true },
    });
    expect(futureWatch.statusCode, futureWatch.body).toBe(201);
    const futureRun = await app.inject({
      method: 'POST',
      url: '/api/v1/timing-lab/run-due-price-checks',
      headers: mutationHeaders(owner, `future-run-${runKey}`),
      payload: {},
    });
    expect(futureRun.statusCode, futureRun.body).toBe(200);
    expect(futureRun.json()).toMatchObject({
      status: 'failed',
      duePolicyCount: 1,
      failedRunCount: 1,
      assessmentsCreated: 0,
      errorCodes: ['FUTURE_OBSERVATION'],
    });
    const outcomeEvents = await database<
      {
        readonly event_name: string;
        readonly is_demo: boolean;
        readonly builder_step: string | null;
        readonly vehicle_code: string | null;
        readonly rejection_code: string | null;
        readonly changed_dimension: string | null;
      }[]
    >`
      SELECT event_name, is_demo, builder_step, vehicle_code, rejection_code, changed_dimension
      FROM product_events
      WHERE subject_hash = ${createHash('sha256')
        .update(`product-event:${owner.userId}:${baseConfiguration.SESSION_SECRET}`)
        .digest('hex')}
        AND event_name LIKE 'purchase_timing_check_%'
      ORDER BY event_name
    `;
    expect(outcomeEvents).toEqual([
      {
        event_name: 'purchase_timing_check_completed',
        is_demo: false,
        builder_step: null,
        vehicle_code: null,
        rejection_code: null,
        changed_dimension: null,
      },
      {
        event_name: 'purchase_timing_check_failed',
        is_demo: false,
        builder_step: null,
        vehicle_code: null,
        rejection_code: null,
        changed_dimension: null,
      },
    ]);
    const futureLatest = await app.inject({
      method: 'GET',
      url: `/api/v1/timing-lab/purchase-items/${futureItemId}/latest`,
      headers: { cookie: owner.cookie },
    });
    expect(futureLatest.statusCode, futureLatest.body).toBe(200);
    expect(futureLatest.json()).toMatchObject({ assessment: null });

    const crossUserArchive = await app.inject({
      method: 'POST',
      url: `/api/v1/timing-lab/purchase-items/${futureItemId}/archive`,
      headers: mutationHeaders(other, `timing-cross-archive-${runKey}`),
      payload: { expectedVersion: 1 },
    });
    expect(crossUserArchive.statusCode).toBe(404);
    const itemArchiveRequest = {
      method: 'POST' as const,
      url: `/api/v1/timing-lab/purchase-items/${futureItemId}/archive`,
      headers: mutationHeaders(owner, `timing-item-archive-${runKey}`),
      payload: { expectedVersion: 1 },
    };
    const itemArchived = await app.inject(itemArchiveRequest);
    expect(itemArchived.statusCode, itemArchived.body).toBe(200);
    expect(itemArchived.json()).toMatchObject({
      id: futureItemId,
      lifecycle: 'archived',
      version: 2,
    });
    const itemArchiveReplay = await app.inject(itemArchiveRequest);
    expect(itemArchiveReplay.statusCode, itemArchiveReplay.body).toBe(200);
    expect(itemArchiveReplay.headers['idempotency-replayed']).toBe('true');

    const otherItems = await app.inject({
      method: 'GET',
      url: '/api/v1/timing-lab/purchase-items',
      headers: { cookie: other.cookie },
    });
    expect(otherItems.statusCode, otherItems.body).toBe(200);
    expect(otherItems.json()).toEqual({ items: [] });

    injectFutureObservation = false;
    const raceItem = await app.inject({
      method: 'POST',
      url: '/api/v1/timing-lab/purchase-items',
      headers: mutationHeaders(owner, `timing-race-item-${runKey}`),
      payload: { ...itemPayload, targetPriceCents: 147_000 },
    });
    expect(raceItem.statusCode, raceItem.body).toBe(201);
    const raceItemId = raceItem.json<{ id: string }>().id;
    const raceWatch = await app.inject({
      method: 'POST',
      url: `/api/v1/timing-lab/purchase-items/${raceItemId}/watch-policies`,
      headers: mutationHeaders(owner, `timing-race-watch-${runKey}`),
      payload: { cadence: 'weekly', nextDueDate: '2026-08-23', enabled: true },
    });
    expect(raceWatch.statusCode, raceWatch.body).toBe(201);
    let markProviderStarted: (() => void) | undefined;
    let releaseProvider: (() => void) | undefined;
    const providerStarted = new Promise<void>((resolve) => {
      markProviderStarted = resolve;
    });
    const providerRelease = new Promise<void>((resolve) => {
      releaseProvider = resolve;
    });
    historicalPriceBarrier = {
      markStarted: () => markProviderStarted?.(),
      release: providerRelease,
    };
    const raceRunPromise = app.inject({
      method: 'POST',
      url: '/api/v1/timing-lab/run-due-price-checks',
      headers: mutationHeaders(owner, `timing-race-run-${runKey}`),
      payload: {},
    });
    await providerStarted;
    const archiveRequest = {
      method: 'POST' as const,
      url: `/api/v1/goals/${goalId}/archive`,
      headers: mutationHeaders(owner, `goal-archive-${runKey}`),
      payload: { expectedGoalVersion: 3, reasonCode: 'USER_REQUESTED' },
    };
    const archived = await app.inject(archiveRequest);
    releaseProvider?.();
    expect(archived.statusCode, archived.body).toBe(200);
    expect(archived.json()).toMatchObject({ goal: { id: goalId, status: 'archived', version: 4 } });
    const archivedDetail = await app.inject({
      method: 'GET',
      url: `/api/v1/goals/${goalId}`,
      headers: { cookie: owner.cookie },
    });
    expect(archivedDetail.statusCode, archivedDetail.body).toBe(200);
    expect(archivedDetail.json()).toMatchObject({
      goal: { status: 'archived', archiveReason: 'USER_REQUESTED' },
      account: { status: 'archived', principalCompositionBasisPoints: 10_000 },
    });
    expect(
      archivedDetail.json<{ account: { progressPercent: number } }>().account.progressPercent,
    ).toBeLessThan(100);
    const terminalGoalItemCreate = await app.inject({
      method: 'POST',
      url: '/api/v1/timing-lab/purchase-items',
      headers: mutationHeaders(owner, `timing-terminal-create-${runKey}`),
      payload: { ...itemPayload, targetPriceCents: 146_000 },
    });
    expect(terminalGoalItemCreate.statusCode).toBe(404);
    const terminalGoalItemUpdate = await app.inject({
      method: 'PATCH',
      url: `/api/v1/timing-lab/purchase-items/${raceItemId}`,
      headers: mutationHeaders(owner, `timing-terminal-update-${runKey}`),
      payload: { expectedVersion: 1, targetPriceCents: 146_000 },
    });
    expect(terminalGoalItemUpdate.statusCode).toBe(409);
    const terminalGoalItemArchive = await app.inject({
      method: 'POST',
      url: `/api/v1/timing-lab/purchase-items/${raceItemId}/archive`,
      headers: mutationHeaders(owner, `timing-terminal-item-archive-${runKey}`),
      payload: { expectedVersion: 1 },
    });
    expect(terminalGoalItemArchive.statusCode).toBe(409);
    const terminalGoalWatchCreate = await app.inject({
      method: 'POST',
      url: `/api/v1/timing-lab/purchase-items/${raceItemId}/watch-policies`,
      headers: mutationHeaders(owner, `timing-terminal-watch-${runKey}`),
      payload: { cadence: 'weekly', nextDueDate: '2026-08-23', enabled: true },
    });
    expect(terminalGoalWatchCreate.statusCode).toBe(404);
    const raceRun = await raceRunPromise;
    historicalPriceBarrier = null;
    expect(raceRun.statusCode, raceRun.body).toBe(200);
    expect(raceRun.json()).toMatchObject({
      status: 'completed',
      duePolicyCount: 1,
      completedRunCount: 1,
      assessmentsCreated: 1,
    });
    const raceLatest = await app.inject({
      method: 'GET',
      url: `/api/v1/timing-lab/purchase-items/${raceItemId}/latest`,
      headers: { cookie: owner.cookie },
    });
    expect(raceLatest.statusCode, raceLatest.body).toBe(200);
    const raceAssessment = raceLatest.json<{
      assessment: {
        planLifecycle: string;
        currentPlanVersion: number | null;
        planHealth: string | null;
        rationaleCodes: readonly string[];
      };
    }>().assessment;
    expect(raceAssessment.planLifecycle).toBe('archived');
    expect(raceAssessment.currentPlanVersion).toBe(3);
    expect(raceAssessment.planHealth).toBeNull();
    expect(raceAssessment.rationaleCodes).toContain('PRICE_ABOVE_TARGET');
    const archiveReplay = await app.inject(archiveRequest);
    expect(archiveReplay.statusCode, archiveReplay.body).toBe(200);
    expect(archiveReplay.headers['idempotency-replayed']).toBe('true');
    expect(archiveReplay.json()).toEqual(archived.json());
    const changedArchiveReplay = await app.inject({
      ...archiveRequest,
      payload: { expectedGoalVersion: 3, reasonCode: 'NO_LONGER_PURSUED' },
    });
    expect(changedArchiveReplay.statusCode).toBe(409);
    const archivedHistory = await app.inject({
      method: 'GET',
      url: `/api/v1/goals/${goalId}/plan/history`,
      headers: { cookie: owner.cookie },
    });
    expect(archivedHistory.statusCode, archivedHistory.body).toBe(200);
    expect(archivedHistory.json()).toMatchObject({ currentGoalVersion: 4 });
  }, 20_000);

  it('activates an already-funded liquid draft directly as purchase ready', async () => {
    if (owner === null) throw new Error('The owner session was not initialized.');
    rejectCatalogReads = false;
    rateCatalog = illustrativeAssumptions;
    const fundedDraft = await app.inject({
      method: 'POST',
      url: '/api/v1/goal-drafts',
      headers: mutationHeaders(owner, `funded-draft-${runKey}`),
      payload: {
        data: {
          name: 'Already-funded purchase',
          targetAmountCents: 100_000,
          currentSavedCents: 100_000,
          targetDate: '2027-08-23',
          recurringContributionCents: 1,
          contributionCadence: 'monthly',
          firstContributionDate: '2026-09-23',
          safeContributionCents: 0,
          budgetFit: 'higher',
          liquidityNeed: 'anytime',
          preservationPreference: 'required',
          confidence: 'expected',
        },
        lastCompletedStep: 'review',
      },
    });
    expect(fundedDraft.statusCode, fundedDraft.body).toBe(201);
    const draft = fundedDraft.json<{ id: string; version: number }>();
    const activated = await app.inject({
      method: 'POST',
      url: `/api/v1/goal-drafts/${draft.id}/activate`,
      headers: mutationHeaders(owner, `funded-activate-${runKey}`),
      payload: { expectedDraftVersion: draft.version, vehicleCode: 'hysa' },
    });
    expect(activated.statusCode, activated.body).toBe(201);
    const fundedGoalId = activated.json<{ goalId: string }>().goalId;
    const detail = await app.inject({
      method: 'GET',
      url: `/api/v1/goals/${fundedGoalId}`,
      headers: { cookie: owner.cookie },
    });
    expect(detail.statusCode, detail.body).toBe(200);
    expect(detail.json()).toMatchObject({
      goal: { id: fundedGoalId, status: 'purchase_ready', version: 1 },
      account: { status: 'purchase_ready', nextContributionDate: null },
    });
    const archived = await app.inject({
      method: 'POST',
      url: `/api/v1/goals/${fundedGoalId}/archive`,
      headers: mutationHeaders(owner, `funded-archive-${runKey}`),
      payload: { expectedGoalVersion: 1, reasonCode: 'NO_LONGER_PURSUED' },
    });
    expect(archived.statusCode, archived.body).toBe(200);
  });

  it('recalculates and persists a fixed-term lot when its plan deadline changes', async () => {
    if (owner === null) throw new Error('The owner session was not initialized.');
    rejectCatalogReads = false;
    rateCatalog = illustrativeAssumptions;
    const fixedTermDraft = await app.inject({
      method: 'POST',
      url: '/api/v1/goal-drafts',
      headers: mutationHeaders(owner, `fixed-term-draft-${runKey}`),
      payload: {
        data: {
          name: 'Fixed-term scenario goal',
          targetAmountCents: 600_000,
          currentSavedCents: 100_000,
          targetDate: '2027-08-23',
          recurringContributionCents: 45_000,
          contributionCadence: 'monthly',
          firstContributionDate: '2026-09-23',
          safeContributionCents: 41_667,
          budgetFit: 'higher',
          liquidityNeed: 'goal_date',
          preservationPreference: 'required',
          confidence: 'expected',
        },
        lastCompletedStep: 'review',
      },
    });
    expect(fixedTermDraft.statusCode, fixedTermDraft.body).toBe(201);
    const draft = fixedTermDraft.json<{ id: string; version: number }>();
    const activated = await app.inject({
      method: 'POST',
      url: `/api/v1/goal-drafts/${draft.id}/activate`,
      headers: mutationHeaders(owner, `fixed-term-activate-${runKey}`),
      payload: { expectedDraftVersion: draft.version, vehicleCode: 'cd_ladder' },
    });
    expect(activated.statusCode, activated.body).toBe(201);
    const fixedTermGoalId = activated.json<{ goalId: string }>().goalId;

    const scenarioPayload = {
      expectedGoalVersion: 1,
      expectedPlanVersion: 1,
      change: { changedDimension: 'DEADLINE', targetDate: '2028-02-23' },
    } as const;
    const preview = await app.inject({
      method: 'POST',
      url: `/api/v1/goals/${fixedTermGoalId}/what-if/preview`,
      headers: mutationHeaders(owner),
      payload: scenarioPayload,
    });
    expect(preview.statusCode, preview.body).toBe(200);
    expect(preview.json()).toMatchObject({
      goalVersion: 1,
      planVersion: 1,
      comparison: { changedDimension: 'DEADLINE', accessConsequence: 'AVAILABLE_LATER' },
    });

    const applied = await app.inject({
      method: 'POST',
      url: `/api/v1/goals/${fixedTermGoalId}/what-if/apply`,
      headers: mutationHeaders(owner, `fixed-term-deadline-${runKey}`),
      payload: scenarioPayload,
    });
    expect(applied.statusCode, applied.body).toBe(201);
    expect(applied.json()).toMatchObject({ goalVersion: 2, planVersion: 2 });

    const persistedContexts = await database<{ calculation_context: unknown }[]>`
      SELECT calculation_context
      FROM plan_versions
      WHERE goal_id = ${fixedTermGoalId} AND user_id = ${owner.userId} AND version = 2
    `;
    const persistedContext = planCalculationContextSchema.parse(
      persistedContexts[0]?.calculation_context,
    );
    expect(persistedContext).toMatchObject({
      currentAvailableFundsCents: 0,
      fixedTermLots: [
        {
          personalPrincipalCents: 100_000,
          currentBalanceCents: 100_000,
          firstMaturityDate: '2027-02-19',
          nextMaturityDate: '2027-02-19',
          nextMaturityInterestEligible: true,
        },
      ],
    });

    const history = await app.inject({
      method: 'GET',
      url: `/api/v1/goals/${fixedTermGoalId}/plan/history`,
      headers: { cookie: owner.cookie },
    });
    expect(history.statusCode, history.body).toBe(200);
    expect(history.json()).toMatchObject({
      currentGoalVersion: 2,
      versions: [
        { version: 1, changeReason: 'INITIAL_ACTIVATION' },
        {
          version: 2,
          changedDimension: 'DEADLINE',
          change: { changedDimension: 'DEADLINE', targetDate: '2028-02-23' },
          changeReason: 'WHAT_IF_APPLIED',
        },
      ],
    });

    const archived = await app.inject({
      method: 'POST',
      url: `/api/v1/goals/${fixedTermGoalId}/archive`,
      headers: mutationHeaders(owner, `fixed-term-archive-${runKey}`),
      payload: { expectedGoalVersion: 2, reasonCode: 'NO_LONGER_PURSUED' },
    });
    expect(archived.statusCode, archived.body).toBe(200);
  });

  it('advances and resets only the seeded demo with scoped, replayable commands', async () => {
    if (other === null) throw new Error('The cross-user session was not initialized.');
    const demoApp = await buildApp({
      configuration: {
        ...baseConfiguration,
        LOG_LEVEL: 'silent',
        DEMO_STORY_ENABLED: true,
        PURCHASE_TIMING_LAB_ENABLED: true,
      },
      database,
      clock: new ControlledApplicationClock('2026-08-23'),
    });
    try {
      const login = await demoApp.inject({
        method: 'POST',
        url: '/auth/login',
        headers: { origin: baseConfiguration.WEB_ORIGIN },
        payload: {
          email: 'demo.japan@example.test',
          password: 'GoalPilot-Demo-2026!',
        },
      });
      expect(login.statusCode, login.body).toBe(200);
      const demoBody = login.json<{ user: { id: string }; csrfToken: string }>();
      const demoSession: AuthenticatedSession = {
        userId: demoBody.user.id,
        cookie: cookiesFrom(login),
        csrf: demoBody.csrfToken,
      };
      const goals = await demoApp.inject({
        method: 'GET',
        url: '/api/v1/goals',
        headers: { cookie: demoSession.cookie },
      });
      expect(goals.statusCode, goals.body).toBe(200);
      const demoGoal = goals
        .json<{ goals: readonly { id: string; version: number }[] }>()
        .goals.at(0);
      expect(demoGoal).toBeDefined();
      if (demoGoal === undefined) throw new Error('The seeded demo goal is missing.');

      const missingCsrf = await demoApp.inject({
        method: 'POST',
        url: '/api/v1/demo/advance',
        headers: {
          origin: baseConfiguration.WEB_ORIGIN,
          cookie: demoSession.cookie,
          'idempotency-key': `demo-no-csrf-${runKey}`,
        },
        payload: { goalId: demoGoal.id, milestone: 'NEXT_CONTRIBUTION' },
      });
      expect(missingCsrf.statusCode).toBe(403);
      const advanceRequest = {
        method: 'POST' as const,
        url: '/api/v1/demo/advance',
        headers: mutationHeaders(demoSession, `demo-advance-${runKey}`),
        payload: { goalId: demoGoal.id, milestone: 'NEXT_CONTRIBUTION' },
      };
      const advanced = await demoApp.inject(advanceRequest);
      expect(advanced.statusCode, advanced.body).toBe(200);
      const advancedBody = advanced.json<DemoRunSummary>();
      expect(advancedBody).toMatchObject({
        milestone: 'NEXT_CONTRIBUTION',
        fromDate: '2026-08-23',
        toDate: '2026-09-23',
        contributionsPosted: 1,
        failureCodes: [],
      });
      expect(advancedBody.modeledInterestAddedCents).toBeGreaterThanOrEqual(0);
      const advanceReplay = await demoApp.inject(advanceRequest);
      expect(advanceReplay.statusCode, advanceReplay.body).toBe(200);
      expect(advanceReplay.headers['idempotency-replayed']).toBe('true');
      expect(advanceReplay.json()).toEqual(advancedBody);
      const changedAdvanceReplay = await demoApp.inject({
        ...advanceRequest,
        payload: { goalId: demoGoal.id, milestone: 'ONE_MONTH' },
      });
      expect(changedAdvanceReplay.statusCode).toBe(409);

      const crossUserReset = await demoApp.inject({
        method: 'POST',
        url: '/api/v1/demo/reset',
        headers: mutationHeaders(other, `cross-demo-reset-${runKey}`),
        payload: {
          goalId: demoGoal.id,
          expectedGoalVersion: demoGoal.version,
          confirmation: 'RESET_SEEDED_STORY_DEMO',
        },
      });
      expect(crossUserReset.statusCode).toBe(404);
      const crossUserCapabilities = await demoApp.inject({
        method: 'GET',
        url: '/api/v1/capabilities',
        headers: { cookie: other.cookie },
      });
      expect(crossUserCapabilities.statusCode, crossUserCapabilities.body).toBe(200);
      expect(crossUserCapabilities.json()).toMatchObject({ demoStory: false });
      const resetRequest = {
        method: 'POST' as const,
        url: '/api/v1/demo/reset',
        headers: mutationHeaders(demoSession, `demo-reset-${runKey}`),
        payload: {
          goalId: demoGoal.id,
          expectedGoalVersion: demoGoal.version,
          confirmation: 'RESET_SEEDED_STORY_DEMO',
        },
      };
      const reset = await demoApp.inject(resetRequest);
      expect(reset.statusCode, reset.body).toBe(200);
      expect(reset.json()).toMatchObject({ reset: true });
      const resetReplay = await demoApp.inject(resetRequest);
      expect(resetReplay.statusCode, resetReplay.body).toBe(200);
      expect(resetReplay.headers['idempotency-replayed']).toBe('true');
      expect(resetReplay.json()).toEqual(reset.json());

      const noMaturityAdvance = await demoApp.inject({
        method: 'POST',
        url: '/api/v1/demo/advance',
        headers: mutationHeaders(demoSession, `demo-no-maturity-${runKey}`),
        payload: { goalId: demoGoal.id, milestone: 'NEXT_MATURITY' },
      });
      expect(noMaturityAdvance.statusCode, noMaturityAdvance.body).toBe(200);
      expect(noMaturityAdvance.json()).toMatchObject({
        milestone: 'NEXT_MATURITY',
        fromDate: '2026-08-23',
        toDate: '2026-08-23',
        contributionsPosted: 0,
        interestPostings: 0,
        modeledInterestAddedCents: 0,
        skippedDuplicates: 0,
        purchaseReadyTransitions: 0,
        failureCodes: ['NO_EVENT_DUE'],
      });

      const oneMonthAdvance = await demoApp.inject({
        method: 'POST',
        url: '/api/v1/demo/advance',
        headers: mutationHeaders(demoSession, `demo-one-month-${runKey}`),
        payload: { goalId: demoGoal.id, milestone: 'ONE_MONTH' },
      });
      expect(oneMonthAdvance.statusCode, oneMonthAdvance.body).toBe(200);
      const oneMonthBody = oneMonthAdvance.json<DemoRunSummary>();
      expect(oneMonthBody).toMatchObject({
        milestone: 'ONE_MONTH',
        fromDate: '2026-08-23',
        toDate: '2026-09-23',
        contributionsPosted: 1,
        failureCodes: [],
      });
      expect(oneMonthBody.modeledInterestAddedCents).toBeGreaterThanOrEqual(0);
      const resetAfterOneMonth = await demoApp.inject({
        method: 'POST',
        url: '/api/v1/demo/reset',
        headers: mutationHeaders(demoSession, `demo-after-one-month-reset-${runKey}`),
        payload: {
          goalId: demoGoal.id,
          expectedGoalVersion: demoGoal.version,
          confirmation: 'RESET_SEEDED_STORY_DEMO',
        },
      });
      expect(resetAfterOneMonth.statusCode, resetAfterOneMonth.body).toBe(200);

      const sixMonthStartedAt = performance.now();
      const sixMonthAdvance = await demoApp.inject({
        method: 'POST',
        url: '/api/v1/demo/advance',
        headers: mutationHeaders(demoSession, `demo-six-months-${runKey}`),
        payload: { goalId: demoGoal.id, milestone: 'SIX_MONTHS' },
      });
      recordPerformance(
        'owner-scoped-autopilot-six-months',
        performance.now() - sixMonthStartedAt,
        10_000,
      );
      expect(sixMonthAdvance.statusCode, sixMonthAdvance.body).toBe(200);
      const sixMonthBody = sixMonthAdvance.json<DemoRunSummary>();
      expect(sixMonthBody).toMatchObject({
        milestone: 'SIX_MONTHS',
        fromDate: '2026-08-23',
        toDate: '2027-02-23',
        contributionsPosted: 6,
        failureCodes: [],
      });
      expect(sixMonthBody.modeledInterestAddedCents).toBeGreaterThanOrEqual(0);
      const finalReset = await demoApp.inject({
        method: 'POST',
        url: '/api/v1/demo/reset',
        headers: mutationHeaders(demoSession, `demo-final-reset-${runKey}`),
        payload: {
          goalId: demoGoal.id,
          expectedGoalVersion: demoGoal.version,
          confirmation: 'RESET_SEEDED_STORY_DEMO',
        },
      });
      expect(finalReset.statusCode, finalReset.body).toBe(200);
      const capabilities = await demoApp.inject({
        method: 'GET',
        url: '/api/v1/capabilities',
        headers: { cookie: demoSession.cookie },
      });
      expect(capabilities.statusCode, capabilities.body).toBe(200);
      expect(capabilities.json()).toMatchObject({ applicationDate: '2026-08-23' });
    } finally {
      await demoApp.close();
    }
  }, 30_000);

  it('repairs a post-commit pending day without completing or overshooting the indeterminate command', async () => {
    let injectFinalDayFailure = true;
    const recoveryApp = await buildApp({
      configuration: {
        ...baseConfiguration,
        LOG_LEVEL: 'silent',
        DEMO_STORY_ENABLED: true,
        PURCHASE_TIMING_LAB_ENABLED: true,
      },
      database,
      clock: new ControlledApplicationClock('2026-08-23'),
      demoAutopilotBeforeClockAdvance: (processingDate) => {
        if (processingDate === '2026-09-23' && injectFinalDayFailure) {
          injectFinalDayFailure = false;
          throw new Error('Injected post-commit, pre-clock-advance failure.');
        }
      },
    });
    let demoSession: AuthenticatedSession | null = null;
    try {
      const login = await recoveryApp.inject({
        method: 'POST',
        url: '/auth/login',
        headers: { origin: baseConfiguration.WEB_ORIGIN },
        payload: {
          email: 'demo.japan@example.test',
          password: 'GoalPilot-Demo-2026!',
        },
      });
      expect(login.statusCode, login.body).toBe(200);
      const demoBody = login.json<{ user: { id: string }; csrfToken: string }>();
      demoSession = {
        userId: demoBody.user.id,
        cookie: cookiesFrom(login),
        csrf: demoBody.csrfToken,
      };
      const goalsBeforeReset = await recoveryApp.inject({
        method: 'GET',
        url: '/api/v1/goals',
        headers: { cookie: demoSession.cookie },
      });
      const goalBeforeReset = goalsBeforeReset
        .json<{ goals: readonly { id: string; version: number }[] }>()
        .goals.at(0);
      if (goalBeforeReset === undefined) throw new Error('The seeded demo goal is missing.');
      const reset = await recoveryApp.inject({
        method: 'POST',
        url: '/api/v1/demo/reset',
        headers: mutationHeaders(demoSession, `demo-recovery-reset-${runKey}`),
        payload: {
          goalId: goalBeforeReset.id,
          expectedGoalVersion: goalBeforeReset.version,
          confirmation: 'RESET_SEEDED_STORY_DEMO',
        },
      });
      expect(reset.statusCode, reset.body).toBe(200);

      const goals = await recoveryApp.inject({
        method: 'GET',
        url: '/api/v1/goals',
        headers: { cookie: demoSession.cookie },
      });
      const demoGoal = goals
        .json<{ goals: readonly { id: string; version: number }[] }>()
        .goals.at(0);
      if (demoGoal === undefined) throw new Error('The reset demo goal is missing.');
      const commandKey = `demo-final-day-crash-${runKey}`;
      const advanceRequest = {
        method: 'POST' as const,
        url: '/api/v1/demo/advance',
        headers: mutationHeaders(demoSession, commandKey),
        payload: { goalId: demoGoal.id, milestone: 'ONE_MONTH' },
      };

      const interrupted = await recoveryApp.inject(advanceRequest);
      expect(interrupted.statusCode, interrupted.body).toBe(500);
      const interruptedClock = await database<{ application_date: string | Date }[]>`
        SELECT application_date FROM user_application_clocks
        WHERE user_id = ${demoSession.userId}
      `;
      const interruptedApplicationDate = interruptedClock[0]?.application_date;
      expect(
        typeof interruptedApplicationDate === 'string'
          ? interruptedApplicationDate.slice(0, 10)
          : interruptedApplicationDate?.toISOString().slice(0, 10),
      ).toBe('2026-09-22');
      const committedContributions = await database<{ readonly count: string }[]>`
        SELECT COUNT(*)::text AS count
        FROM ledger_entries entry
        JOIN simulated_accounts account ON account.id = entry.account_id
        WHERE account.goal_id = ${demoGoal.id} AND entry.user_id = ${demoSession.userId}
          AND entry.entry_type = 'contribution_posted'
          AND entry.effective_date = '2026-09-23'
      `;
      expect(committedContributions[0]?.count).toBe('1');

      await database`
        UPDATE application_command_claims
        SET lease_expires_at = now() - interval '1 second'
        WHERE user_id = ${demoSession.userId} AND operation = 'demo.advance'
          AND key = ${commandKey}
      `;
      const claimBeforeRepair = await database<
        {
          readonly state: string;
          readonly claim_token: string | null;
          readonly request_hash: string;
          readonly lease_expires_at: Date;
        }[]
      >`
        SELECT state, claim_token, request_hash, lease_expires_at
        FROM application_command_claims
        WHERE user_id = ${demoSession.userId} AND operation = 'demo.advance'
          AND key = ${commandKey}
      `;
      expect(claimBeforeRepair).toHaveLength(1);

      const repaired = await recoveryApp.inject(advanceRequest);
      expect(repaired.statusCode, repaired.body).toBe(409);
      expect(repaired.json()).toMatchObject({
        error: {
          code: 'CONFLICT',
          message:
            'GoalPilot repaired the pending Story day through 2026-09-23. Refresh before starting a new milestone.',
        },
      });
      const repairedClock = await database<{ application_date: string | Date }[]>`
        SELECT application_date FROM user_application_clocks
        WHERE user_id = ${demoSession.userId}
      `;
      const repairedApplicationDate = repairedClock[0]?.application_date;
      expect(
        typeof repairedApplicationDate === 'string'
          ? repairedApplicationDate.slice(0, 10)
          : repairedApplicationDate?.toISOString().slice(0, 10),
      ).toBe('2026-09-23');
      const claimAfterRepair = await database<
        {
          readonly state: string;
          readonly claim_token: string | null;
          readonly request_hash: string;
          readonly lease_expires_at: Date;
        }[]
      >`
        SELECT state, claim_token, request_hash, lease_expires_at
        FROM application_command_claims
        WHERE user_id = ${demoSession.userId} AND operation = 'demo.advance'
          AND key = ${commandKey}
      `;
      expect(claimAfterRepair).toEqual(claimBeforeRepair);
      const falseSuccess = await database<{ readonly count: string }[]>`
        SELECT COUNT(*)::text AS count FROM idempotency_records
        WHERE user_id = ${demoSession.userId} AND operation = 'demo.advance'
          AND key = ${commandKey}
      `;
      expect(falseSuccess[0]?.count).toBe('0');
      const contributionsAfterRepair = await database<{ readonly count: string }[]>`
        SELECT COUNT(*)::text AS count
        FROM ledger_entries entry
        JOIN simulated_accounts account ON account.id = entry.account_id
        WHERE account.goal_id = ${demoGoal.id} AND entry.user_id = ${demoSession.userId}
          AND entry.entry_type = 'contribution_posted'
          AND entry.effective_date = '2026-09-23'
      `;
      expect(contributionsAfterRepair[0]?.count).toBe('1');
    } finally {
      if (demoSession !== null) {
        const goals = await recoveryApp.inject({
          method: 'GET',
          url: '/api/v1/goals',
          headers: { cookie: demoSession.cookie },
        });
        const demoGoal = goals
          .json<{ goals: readonly { id: string; version: number }[] }>()
          .goals.at(0);
        if (demoGoal !== undefined) {
          await recoveryApp.inject({
            method: 'POST',
            url: '/api/v1/demo/reset',
            headers: mutationHeaders(demoSession, `demo-recovery-cleanup-${runKey}`),
            payload: {
              goalId: demoGoal.id,
              expectedGoalVersion: demoGoal.version,
              confirmation: 'RESET_SEEDED_STORY_DEMO',
            },
          });
        }
      }
      await recoveryApp.close();
    }
  }, 30_000);

  it('completes two-phase idempotent work with a one-connection pool and hides disabled routes', async () => {
    const singleConnectionDatabase = createDatabaseClient(baseConfiguration.DATABASE_URL, 1);
    const enabledApp = await buildApp({
      configuration: {
        ...baseConfiguration,
        LOG_LEVEL: 'silent',
        DEMO_STORY_ENABLED: false,
        PURCHASE_TIMING_LAB_ENABLED: true,
      },
      database: singleConnectionDatabase,
      clock: new ControlledApplicationClock('2026-08-23'),
    });
    let session: AuthenticatedSession | null = null;
    try {
      const registration = await enabledApp.inject({
        method: 'POST',
        url: '/auth/register',
        headers: { origin: baseConfiguration.WEB_ORIGIN },
        payload: {
          email: `single-pool-${runKey}@example.test`,
          password: 'GoalPilot-SinglePool-2026!',
          displayName: 'Single Pool Test',
        },
      });
      expect(registration.statusCode, registration.body).toBe(201);
      const registrationBody = registration.json<{
        user: { id: string };
        csrfToken: string;
      }>();
      session = {
        userId: registrationBody.user.id,
        cookie: cookiesFrom(registration),
        csrf: registrationBody.csrfToken,
      };
      await singleConnectionDatabase`
        UPDATE user_application_clocks SET application_date = '2026-08-24', version = version + 1
        WHERE user_id = ${session.userId}
      `;
      const ownerBaseline = await enabledApp.inject({
        method: 'POST',
        url: '/api/v1/baselines',
        headers: mutationHeaders(session),
        payload: {
          targetAmountCents: 600_000,
          currentSavedCents: 100_000,
          targetDate: '2027-08-24',
          contributionCadence: 'monthly',
        },
      });
      expect(ownerBaseline.statusCode, ownerBaseline.body).toBe(200);
      expect(ownerBaseline.json()).toMatchObject({ baseline: { asOfDate: '2026-08-24' } });
      const staleExplicitPreview = await enabledApp.inject({
        method: 'POST',
        url: '/api/v1/previews',
        headers: mutationHeaders(session),
        payload: {
          name: 'Stale explicit preview',
          targetAmountCents: 600_000,
          currentSavedCents: 100_000,
          targetDate: '2027-08-24',
          recurringContributionCents: 45_000,
          contributionCadence: 'monthly',
          liquidityNeed: 'anytime',
          preservationPreference: 'required',
          confidence: 'expected',
          asOfDate: '2026-08-23',
        },
      });
      expect(staleExplicitPreview.statusCode).toBe(400);
      const run = await enabledApp.inject({
        method: 'POST',
        url: '/api/v1/timing-lab/run-due-price-checks',
        headers: mutationHeaders(session, `single-pool-run-${runKey}`),
        payload: {},
      });
      expect(run.statusCode, run.body).toBe(200);
      expect(run.json()).toMatchObject({
        asOfDate: '2026-08-24',
        status: 'no_due_policies',
        duePolicyCount: 0,
      });
      const replay = await enabledApp.inject({
        method: 'POST',
        url: '/api/v1/timing-lab/run-due-price-checks',
        headers: mutationHeaders(session, `single-pool-run-${runKey}`),
        payload: {},
      });
      expect(replay.statusCode, replay.body).toBe(200);
      expect(replay.headers['idempotency-replayed']).toBe('true');
      expect(replay.json()).toEqual(run.json());
      await enabledApp.inject({
        method: 'POST',
        url: '/api/v1/account-deletion',
        headers: mutationHeaders(session),
        payload: {},
      });
      session = null;
    } finally {
      if (session !== null) {
        await enabledApp.inject({
          method: 'POST',
          url: '/api/v1/account-deletion',
          headers: mutationHeaders(session),
          payload: {},
        });
      }
      await enabledApp.close();
    }

    const disabledApp = await buildApp({
      configuration: {
        ...baseConfiguration,
        LOG_LEVEL: 'silent',
        DEMO_STORY_ENABLED: false,
        PURCHASE_TIMING_LAB_ENABLED: false,
      },
      database: singleConnectionDatabase,
      clock: new ControlledApplicationClock('2026-08-23'),
    });
    try {
      const hiddenRead = await disabledApp.inject({
        method: 'GET',
        url: '/api/v1/timing-lab/purchase-items',
      });
      expect(hiddenRead.statusCode).toBe(404);
      const hiddenMutation = await disabledApp.inject({
        method: 'POST',
        url: '/api/v1/timing-lab/run-due-price-checks',
        headers: { origin: baseConfiguration.WEB_ORIGIN },
        payload: {},
      });
      expect(hiddenMutation.statusCode).toBe(404);
    } finally {
      await disabledApp.close();
      await singleConnectionDatabase.end();
    }
  }, 15_000);
});
