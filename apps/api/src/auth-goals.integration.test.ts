import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ulid } from 'ulid';

import type { VehicleAssumption } from '@goalpilot/contracts';
import { createDatabaseClient, type DatabaseClient } from '@goalpilot/data-access';
import { illustrativeAssumptions } from '@goalpilot/domain';
import { ControlledApplicationClock } from '@goalpilot/provider-simulators';

import { buildApp } from './app.js';
import { loadConfiguration } from './config.js';

interface AuthenticatedSession {
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

describe('authenticated goal API integration', () => {
  const configuration = loadConfiguration();
  let database: DatabaseClient;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let alex: AuthenticatedSession;
  let sam: AuthenticatedSession;
  let goalId = '';
  let clock: ControlledApplicationClock;
  let rateCatalog: readonly VehicleAssumption[];
  const runKey = ulid();

  beforeAll(async () => {
    database = createDatabaseClient(configuration.DATABASE_URL, 3);
    clock = new ControlledApplicationClock('2026-08-23');
    rateCatalog = illustrativeAssumptions;
    app = await buildApp({
      configuration: { ...configuration, LOG_LEVEL: 'silent' },
      database,
      clock,
      rateProvider: { getCatalog: () => Promise.resolve(rateCatalog) },
    });
    const login = async (email: string, password: string): Promise<AuthenticatedSession> => {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/login',
        headers: { origin: configuration.WEB_ORIGIN },
        payload: { email, password },
      });
      expect(response.statusCode).toBe(200);
      const body = response.json<{ csrfToken: string }>();
      return { cookie: cookiesFrom(response), csrf: body.csrfToken };
    };
    alex = await login('alex@example.test', 'GoalPilot-Alex-2026!');
    sam = await login('sam@example.test', 'GoalPilot-Sam-2026!');
  });

  afterAll(async () => {
    if (goalId.length > 0) {
      await database`DELETE FROM goals WHERE id = ${goalId}`;
    }
    await app.close();
    await database.end();
  });

  it('creates, isolates, activates, and idempotently contributes to a simulated account', async () => {
    const createRequest = {
      method: 'POST',
      url: '/api/v1/goals',
      headers: {
        origin: configuration.WEB_ORIGIN,
        cookie: alex.cookie,
        'x-csrf-token': alex.csrf,
        'idempotency-key': `integration-goal-${runKey}`,
      },
      payload: {
        name: 'API integration trip',
        targetAmountCents: 600_000,
        currentSavedCents: 100_000,
        targetDate: '2027-08-23',
        recurringContributionCents: 45_000,
        contributionCadence: 'monthly',
        liquidityNeed: 'goal_date',
        preservationPreference: 'required',
        confidence: 'expected',
      },
    } as const;
    const createResponse = await app.inject(createRequest);
    expect(createResponse.statusCode).toBe(201);
    goalId = createResponse.json<{ id: string }>().id;

    const createReplay = await app.inject(createRequest);
    expect(createReplay.statusCode).toBe(201);
    expect(createReplay.headers['idempotency-replayed']).toBe('true');
    expect(createReplay.json<{ id: string }>().id).toBe(goalId);

    const changedReplay = await app.inject({
      ...createRequest,
      payload: { ...createRequest.payload, name: 'Different request' },
    });
    expect(changedReplay.statusCode).toBe(409);

    const editRequest = {
      method: 'PATCH',
      url: `/api/v1/goals/${goalId}`,
      headers: {
        origin: configuration.WEB_ORIGIN,
        cookie: alex.cookie,
        'x-csrf-token': alex.csrf,
        'idempotency-key': `integration-edit-${runKey}`,
      },
      payload: { version: 1, name: 'Edited API integration trip' },
    } as const;
    const edit = await app.inject(editRequest);
    expect(edit.statusCode, edit.body).toBe(200);
    expect(edit.json()).toMatchObject({ name: 'Edited API integration trip', version: 2 });
    const editReplay = await app.inject(editRequest);
    expect(editReplay.statusCode, editReplay.body).toBe(200);
    expect(editReplay.headers['idempotency-replayed']).toBe('true');
    expect(editReplay.json()).toEqual(edit.json());
    const changedEditReplay = await app.inject({
      ...editRequest,
      payload: { version: 1, name: 'Changed replay' },
    });
    expect(changedEditReplay.statusCode).toBe(409);

    const crossUser = await app.inject({
      method: 'GET',
      url: `/api/v1/goals/${goalId}`,
      headers: { cookie: sam.cookie },
    });
    expect(crossUser.statusCode).toBe(404);
    const crossUserEdit = await app.inject({
      method: 'PATCH',
      url: `/api/v1/goals/${goalId}`,
      headers: {
        origin: configuration.WEB_ORIGIN,
        cookie: sam.cookie,
        'x-csrf-token': sam.csrf,
        'idempotency-key': `integration-cross-edit-${runKey}`,
      },
      payload: { version: 2, name: 'Cross-user edit' },
    });
    expect(crossUserEdit.statusCode).toBe(404);
    const crossUserDelete = await app.inject({
      method: 'DELETE',
      url: `/api/v1/goals/${goalId}`,
      headers: {
        origin: configuration.WEB_ORIGIN,
        cookie: sam.cookie,
        'x-csrf-token': sam.csrf,
      },
      payload: {},
    });
    expect(crossUserDelete.statusCode).toBe(404);
    const crossUserActivity = await app.inject({
      method: 'GET',
      url: `/api/v1/goals/${goalId}/ledger`,
      headers: { cookie: sam.cookie },
    });
    expect(crossUserActivity.statusCode).toBe(404);
    const crossUserContribution = await app.inject({
      method: 'POST',
      url: `/api/v1/goals/${goalId}/contributions`,
      headers: {
        origin: configuration.WEB_ORIGIN,
        cookie: sam.cookie,
        'x-csrf-token': sam.csrf,
        'idempotency-key': `integration-cross-user-${runKey}`,
      },
      payload: { amountCents: 10_000, effectiveDate: '2026-08-23' },
    });
    expect(crossUserContribution.statusCode).toBe(404);
    const crossUserActivation = await app.inject({
      method: 'POST',
      url: `/api/v1/goals/${goalId}/activate`,
      headers: {
        origin: configuration.WEB_ORIGIN,
        cookie: sam.cookie,
        'x-csrf-token': sam.csrf,
        'idempotency-key': `integration-cross-activation-${runKey}`,
      },
      payload: { vehicleCode: 'hysa', expectedGoalVersion: 2 },
    });
    expect(crossUserActivation.statusCode).toBe(404);
    for (const action of ['pause', 'resume', 'complete'] as const) {
      const crossUserStateChange = await app.inject({
        method: 'POST',
        url: `/api/v1/goals/${goalId}/${action}`,
        headers: {
          origin: configuration.WEB_ORIGIN,
          cookie: sam.cookie,
          'x-csrf-token': sam.csrf,
          'idempotency-key': `integration-cross-${action}-${runKey}`,
        },
        payload: { expectedGoalVersion: 3 },
      });
      expect(crossUserStateChange.statusCode).toBe(404);
    }
    const crossUserArchive = await app.inject({
      method: 'POST',
      url: `/api/v1/goals/${goalId}/archive`,
      headers: {
        origin: configuration.WEB_ORIGIN,
        cookie: sam.cookie,
        'x-csrf-token': sam.csrf,
        'idempotency-key': `integration-cross-user-archive-${runKey}`,
      },
      payload: { expectedGoalVersion: 1, reasonCode: 'USER_REQUESTED' },
    });
    expect(crossUserArchive.statusCode).toBe(404);

    const activationRequest = {
      method: 'POST',
      url: `/api/v1/goals/${goalId}/activate`,
      headers: {
        origin: configuration.WEB_ORIGIN,
        cookie: alex.cookie,
        'x-csrf-token': alex.csrf,
        'idempotency-key': `integration-activation-${runKey}`,
      },
      payload: { vehicleCode: 'hysa', expectedGoalVersion: 2 },
    } as const;
    const activate = await app.inject(activationRequest);
    expect(activate.statusCode, activate.body).toBe(201);
    expect(
      activate.json<{
        account: {
          goalId: string;
          principalContributedCents: number;
          principalCompositionBasisPoints: number;
          currentLedgerBalanceCents: number;
        };
      }>().account,
    ).toMatchObject({
      goalId,
      principalContributedCents: 100_000,
      currentLedgerBalanceCents: 100_000,
    });

    const repeatedActivation = await app.inject(activationRequest);
    expect(repeatedActivation.statusCode, repeatedActivation.body).toBe(201);
    expect(repeatedActivation.headers['idempotency-replayed']).toBe('true');
    expect(repeatedActivation.json()).toEqual(activate.json());
    const changedActivation = await app.inject({
      ...activationRequest,
      payload: { vehicleCode: 'cash', expectedGoalVersion: 2 },
    });
    expect(changedActivation.statusCode).toBe(409);

    const unsafeActiveEdit = await app.inject({
      method: 'PATCH',
      url: `/api/v1/goals/${goalId}`,
      headers: {
        origin: configuration.WEB_ORIGIN,
        cookie: alex.cookie,
        'x-csrf-token': alex.csrf,
        'idempotency-key': `integration-unsafe-edit-${runKey}`,
      },
      payload: { version: 3, currentSavedCents: 200_000 },
    });
    expect(unsafeActiveEdit.statusCode).toBe(409);

    const contributionRequest = {
      method: 'POST' as const,
      url: `/api/v1/goals/${goalId}/contributions`,
      headers: {
        origin: configuration.WEB_ORIGIN,
        cookie: alex.cookie,
        'x-csrf-token': alex.csrf,
        'idempotency-key': `integration-contribution-${runKey}`,
      },
      payload: { amountCents: 25_000, effectiveDate: '2026-08-23' },
    };
    const first = await app.inject(contributionRequest);
    const replay = await app.inject(contributionRequest);
    expect(first.statusCode).toBe(201);
    expect(replay.statusCode).toBe(200);
    const firstContribution = first.json<{ activityId: string }>();
    expect(replay.json<{ duplicate: boolean; activityId: string }>()).toMatchObject({
      duplicate: true,
      activityId: firstContribution.activityId,
    });
    const changedContributionReplay = await app.inject({
      ...contributionRequest,
      payload: { amountCents: 26_000, effectiveDate: '2026-08-23' },
    });
    expect(changedContributionReplay.statusCode).toBe(409);

    const detail = await app.inject({
      method: 'GET',
      url: `/api/v1/goals/${goalId}`,
      headers: { cookie: alex.cookie },
    });
    expect(
      detail.json<{
        account: { principalContributedCents: number; currentLedgerBalanceCents: number };
      }>().account,
    ).toMatchObject({
      principalContributedCents: 125_000,
      currentLedgerBalanceCents: 125_000,
    });

    const pause = await app.inject({
      method: 'POST',
      url: `/api/v1/goals/${goalId}/pause`,
      headers: {
        origin: configuration.WEB_ORIGIN,
        cookie: alex.cookie,
        'x-csrf-token': alex.csrf,
        'idempotency-key': `integration-pause-${runKey}`,
      },
      payload: { expectedGoalVersion: 3 },
    });
    expect(pause.statusCode).toBe(200);
    const pauseReplay = await app.inject({
      method: 'POST',
      url: `/api/v1/goals/${goalId}/pause`,
      headers: {
        origin: configuration.WEB_ORIGIN,
        cookie: alex.cookie,
        'x-csrf-token': alex.csrf,
        'idempotency-key': `integration-pause-${runKey}`,
      },
      payload: { expectedGoalVersion: 3 },
    });
    expect(pauseReplay.statusCode, pauseReplay.body).toBe(200);
    expect(pauseReplay.headers['idempotency-replayed']).toBe('true');
    expect(pauseReplay.json()).toEqual(pause.json());
    const changedPauseReplay = await app.inject({
      method: 'POST',
      url: `/api/v1/goals/${goalId}/pause`,
      headers: {
        origin: configuration.WEB_ORIGIN,
        cookie: alex.cookie,
        'x-csrf-token': alex.csrf,
        'idempotency-key': `integration-pause-${runKey}`,
      },
      payload: { expectedGoalVersion: 4 },
    });
    expect(changedPauseReplay.statusCode).toBe(409);
    const pausedContribution = await app.inject({
      method: 'POST',
      url: `/api/v1/goals/${goalId}/contributions`,
      headers: {
        origin: configuration.WEB_ORIGIN,
        cookie: alex.cookie,
        'x-csrf-token': alex.csrf,
        'idempotency-key': `integration-paused-${runKey}`,
      },
      payload: { amountCents: 10_000, effectiveDate: '2026-08-23' },
    });
    expect(pausedContribution.statusCode, pausedContribution.body).toBe(409);
    const resume = await app.inject({
      method: 'POST',
      url: `/api/v1/goals/${goalId}/resume`,
      headers: {
        origin: configuration.WEB_ORIGIN,
        cookie: alex.cookie,
        'x-csrf-token': alex.csrf,
        'idempotency-key': `integration-resume-${runKey}`,
      },
      payload: { expectedGoalVersion: 4 },
    });
    expect(resume.statusCode).toBe(200);

    const failed = await app.inject({
      method: 'POST',
      url: `/api/v1/goals/${goalId}/contributions`,
      headers: {
        origin: configuration.WEB_ORIGIN,
        cookie: alex.cookie,
        'x-csrf-token': alex.csrf,
        'idempotency-key': `integration-failed-${runKey}`,
      },
      payload: { amountCents: 25_000, effectiveDate: '2026-08-23', simulateFailure: true },
    });
    expect(failed.statusCode).toBe(201);
    expect(failed.json()).toMatchObject({ posted: false, duplicate: false });

    const completingRequest = {
      method: 'POST' as const,
      url: `/api/v1/goals/${goalId}/contributions`,
      headers: {
        origin: configuration.WEB_ORIGIN,
        cookie: alex.cookie,
        'x-csrf-token': alex.csrf,
        'idempotency-key': `integration-completing-${runKey}`,
      },
      payload: { amountCents: 475_000, effectiveDate: '2026-08-23' },
    };
    const completing = await app.inject(completingRequest);
    expect(completing.statusCode).toBe(201);
    const completingReplay = await app.inject(completingRequest);
    expect(completingReplay.statusCode).toBe(200);
    expect(completingReplay.json()).toMatchObject({ duplicate: true });

    const readyDetail = await app.inject({
      method: 'GET',
      url: `/api/v1/goals/${goalId}`,
      headers: { cookie: alex.cookie },
    });
    expect(
      readyDetail.json<{
        account: {
          status: string;
          principalContributedCents: number;
          currentLedgerBalanceCents: number;
          projectedCompletionDate: string | null;
        };
      }>().account,
    ).toMatchObject({
      status: 'purchase_ready',
      principalContributedCents: 600_000,
      principalCompositionBasisPoints: 10_000,
      currentLedgerBalanceCents: 600_000,
      projectedCompletionDate: '2027-07-23',
    });
    const activity = await app.inject({
      method: 'GET',
      url: `/api/v1/goals/${goalId}/ledger`,
      headers: { cookie: alex.cookie },
    });
    expect(activity.json<{ activity: readonly unknown[] }>().activity).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'contribution_failed', principalCents: 0 }),
      ]),
    );

    const complete = await app.inject({
      method: 'POST',
      url: `/api/v1/goals/${goalId}/complete`,
      headers: {
        origin: configuration.WEB_ORIGIN,
        cookie: alex.cookie,
        'x-csrf-token': alex.csrf,
        'idempotency-key': `integration-complete-${runKey}`,
      },
      payload: { expectedGoalVersion: 6 },
    });
    expect(complete.statusCode).toBe(200);
    const completedGoal = complete.json<{ goal: { status: string; version: number } }>().goal;
    expect(completedGoal).toMatchObject({
      status: 'completed',
    });

    const completedDetail = await app.inject({
      method: 'GET',
      url: `/api/v1/goals/${goalId}`,
      headers: { cookie: alex.cookie },
    });
    expect(
      completedDetail.json<{
        account: {
          status: string;
          principalContributedCents: number;
          currentLedgerBalanceCents: number;
          progressPercent: number;
        };
      }>().account,
    ).toMatchObject({
      status: 'completed',
      principalContributedCents: 600_000,
      currentLedgerBalanceCents: 0,
      progressPercent: 100,
    });
    const completedActivity = await app.inject({
      method: 'GET',
      url: `/api/v1/goals/${goalId}/ledger`,
      headers: { cookie: alex.cookie },
    });
    expect(
      completedActivity.json<{ activity: readonly { type: string; principalCents: number }[] }>()
        .activity,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'goal_completed', principalCents: 0 }),
        expect.objectContaining({ type: 'simulated_withdrawal', principalCents: -600_000 }),
      ]),
    );
    for (const endpoint of ['plan/summary', 'plan/health'] as const) {
      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/goals/${goalId}/${endpoint}`,
        headers: { cookie: alex.cookie },
      });
      expect(response.statusCode, response.body).toBe(200);
    }
    const completedRecovery = await app.inject({
      method: 'GET',
      url: `/api/v1/goals/${goalId}/recovery`,
      headers: { cookie: alex.cookie },
    });
    expect(completedRecovery.statusCode, completedRecovery.body).toBe(200);
    expect(completedRecovery.json()).toMatchObject({ options: [] });

    const archive = await app.inject({
      method: 'POST',
      url: `/api/v1/goals/${goalId}/archive`,
      headers: {
        origin: configuration.WEB_ORIGIN,
        cookie: alex.cookie,
        'x-csrf-token': alex.csrf,
        'idempotency-key': `integration-archive-${runKey}`,
      },
      payload: { expectedGoalVersion: completedGoal.version, reasonCode: 'GOAL_COMPLETED' },
    });
    expect(archive.statusCode, archive.body).toBe(200);
    const archivedGoal = archive.json<{ goal: { status: string; version: number } }>().goal;
    expect(archivedGoal).toMatchObject({ status: 'archived' });
    const archivedSummary = await app.inject({
      method: 'GET',
      url: `/api/v1/goals/${goalId}/plan/summary`,
      headers: { cookie: alex.cookie },
    });
    expect(archivedSummary.statusCode, archivedSummary.body).toBe(200);
    const archivedPlanVersion = archivedSummary.json<{ planVersion: number }>().planVersion;
    for (const endpoint of ['plan/health', 'recovery'] as const) {
      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/goals/${goalId}/${endpoint}`,
        headers: { cookie: alex.cookie },
      });
      expect(response.statusCode, response.body).toBe(200);
    }
    const archivedPreview = await app.inject({
      method: 'POST',
      url: `/api/v1/goals/${goalId}/what-if/preview`,
      headers: {
        origin: configuration.WEB_ORIGIN,
        cookie: alex.cookie,
        'x-csrf-token': alex.csrf,
      },
      payload: {
        expectedGoalVersion: archivedGoal.version,
        expectedPlanVersion: archivedPlanVersion,
        change: { changedDimension: 'CONTRIBUTION', recurringContributionCents: 25_000 },
      },
    });
    expect(archivedPreview.statusCode, archivedPreview.body).toBe(409);
  });

  it('rejects mutations without a CSRF token', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/goals/${goalId}/pause`,
      headers: { origin: configuration.WEB_ORIGIN, cookie: alex.cookie },
    });
    expect(response.statusCode).toBe(403);
  });

  it('keeps ordinary authenticated API p95 under one second at local test traffic', async () => {
    const durations: number[] = [];
    for (let iteration = 0; iteration < 20; iteration += 1) {
      const startedAt = performance.now();
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/goals',
        headers: { cookie: alex.cookie },
      });
      expect(response.statusCode).toBe(200);
      durations.push(performance.now() - startedAt);
    }
    durations.sort((left, right) => left - right);
    const p95DurationMs =
      durations[Math.ceil(durations.length * 0.95) - 1] ?? Number.POSITIVE_INFINITY;
    process.stdout.write(
      `[performance] authenticated-goals-get-p95=${p95DurationMs.toFixed(1)}ms samples=${String(durations.length)} ceiling=1000ms\n`,
    );
    expect(p95DurationMs).toBeLessThan(1_000);
  });

  it('uses the injected clock while retaining the activated assumption snapshot', async () => {
    const registration = await app.inject({
      method: 'POST',
      url: '/auth/register',
      headers: { origin: configuration.WEB_ORIGIN },
      payload: {
        email: `clock-${runKey.toLowerCase()}@example.test`,
        password: 'GoalPilot-Clock-2026!',
        displayName: 'Clock Boundary Test',
      },
    });
    expect(registration.statusCode, registration.body).toBe(201);
    const session = {
      cookie: cookiesFrom(registration),
      csrf: registration.json<{ csrfToken: string }>().csrfToken,
    };
    const clockUserId = registration.json<{ user: { id: string } }>().user.id;

    try {
      const created = await app.inject({
        method: 'POST',
        url: '/api/v1/goals',
        headers: {
          origin: configuration.WEB_ORIGIN,
          cookie: session.cookie,
          'x-csrf-token': session.csrf,
          'idempotency-key': `clock-goal-${runKey}`,
        },
        payload: {
          name: 'Injected clock boundary',
          targetAmountCents: 600_000,
          currentSavedCents: 100_000,
          targetDate: '2028-08-23',
          recurringContributionCents: 45_000,
          contributionCadence: 'monthly',
          liquidityNeed: 'anytime',
          preservationPreference: 'required',
          confidence: 'expected',
        },
      });
      expect(created.statusCode, created.body).toBe(201);
      const clockGoalId = created.json<{ id: string }>().id;
      const activated = await app.inject({
        method: 'POST',
        url: `/api/v1/goals/${clockGoalId}/activate`,
        headers: {
          origin: configuration.WEB_ORIGIN,
          cookie: session.cookie,
          'x-csrf-token': session.csrf,
          'idempotency-key': `clock-activation-${runKey}`,
        },
        payload: { vehicleCode: 'hysa', expectedGoalVersion: 1 },
      });
      expect(activated.statusCode, activated.body).toBe(201);
      const activatedAccount = activated.json<{
        account: { projectedCompletionDate: string | null };
      }>().account;

      rateCatalog = illustrativeAssumptions.map((assumption) => ({
        ...assumption,
        assumptionVersion: 'unpersisted-test-v2',
        apyBasisPoints: assumption.vehicleCode === 'hysa' ? 10_000 : assumption.apyBasisPoints,
      }));
      await clock.advanceTo('2027-08-24');
      await database`
        UPDATE user_application_clocks SET application_date = '2027-08-24', version = version + 1
        WHERE user_id = ${clockUserId}
      `;
      const detail = await app.inject({
        method: 'GET',
        url: `/api/v1/goals/${clockGoalId}`,
        headers: { cookie: session.cookie },
      });
      expect(detail.statusCode, detail.body).toBe(200);
      expect(detail.json()).toMatchObject({
        applicationDate: '2027-08-24',
        account: {
          assumptionVersion: 'demo-2026-08-v1',
          assumptionIsStale: true,
          projectedCompletionDate: activatedAccount.projectedCompletionDate,
        },
      });

      const paused = await app.inject({
        method: 'POST',
        url: `/api/v1/goals/${clockGoalId}/pause`,
        headers: {
          origin: configuration.WEB_ORIGIN,
          cookie: session.cookie,
          'x-csrf-token': session.csrf,
          'idempotency-key': `clock-pause-${runKey}`,
        },
        payload: { expectedGoalVersion: 2 },
      });
      expect(paused.statusCode, paused.body).toBe(200);
      const activity = await app.inject({
        method: 'GET',
        url: `/api/v1/goals/${clockGoalId}/ledger`,
        headers: { cookie: session.cookie },
      });
      expect(
        activity
          .json<{ activity: readonly { type: string; effectiveDate: string }[] }>()
          .activity.find((entry) => entry.type === 'paused'),
      ).toMatchObject({ effectiveDate: '2027-08-24' });
    } finally {
      rateCatalog = illustrativeAssumptions;
      const deletion = await app.inject({
        method: 'POST',
        url: '/api/v1/account-deletion',
        headers: {
          origin: configuration.WEB_ORIGIN,
          cookie: session.cookie,
          'x-csrf-token': session.csrf,
        },
        payload: {},
      });
      expect(deletion.statusCode, deletion.body).toBe(200);
    }
  });

  it('serves readiness, catalog, session refresh, and logout flows', async () => {
    const ready = await app.inject({ method: 'GET', url: '/health/ready' });
    expect(ready.statusCode, ready.body).toBe(200);
    expect(ready.json()).toEqual({ status: 'ready', database: 'ready' });

    const catalog = await app.inject({ method: 'GET', url: '/api/v1/vehicle-catalog' });
    expect(catalog.statusCode).toBe(200);
    expect(catalog.json<{ vehicles: readonly unknown[] }>().vehicles).toHaveLength(4);

    const me = await app.inject({
      method: 'GET',
      url: '/api/v1/me',
      headers: { cookie: alex.cookie },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({ user: { email: 'alex@example.test' } });

    const invalidLogin = await app.inject({
      method: 'POST',
      url: '/auth/login',
      headers: { origin: configuration.WEB_ORIGIN },
      payload: { email: 'alex@example.test', password: 'Incorrect-Password-2026!' },
    });
    expect(invalidLogin.statusCode).toBe(401);
    expect(invalidLogin.json()).toMatchObject({
      error: { code: 'AUTHENTICATION_REQUIRED' },
    });

    const refreshedLogin = await app.inject({
      method: 'POST',
      url: '/auth/login',
      headers: { origin: configuration.WEB_ORIGIN, cookie: alex.cookie },
      payload: { email: 'alex@example.test', password: 'GoalPilot-Alex-2026!' },
    });
    expect(refreshedLogin.statusCode).toBe(200);
    alex = {
      cookie: cookiesFrom(refreshedLogin),
      csrf: refreshedLogin.json<{ csrfToken: string }>().csrfToken,
    };

    const logout = await app.inject({
      method: 'POST',
      url: '/auth/logout',
      headers: {
        origin: configuration.WEB_ORIGIN,
        cookie: sam.cookie,
        'x-csrf-token': sam.csrf,
      },
      payload: {},
    });
    expect(logout.statusCode).toBe(204);
    const samStatus = await app.inject({
      method: 'GET',
      url: '/api/v1/session-status',
      headers: { cookie: sam.cookie },
    });
    expect(samStatus.json()).toEqual({ authenticated: false });
  });

  it('exports owned data and deletes a local account without retaining credentials', async () => {
    const registration = await app.inject({
      method: 'POST',
      url: '/auth/register',
      headers: { origin: configuration.WEB_ORIGIN },
      payload: {
        email: `privacy-${runKey.toLowerCase()}@example.test`,
        password: 'GoalPilot-Privacy-2026!',
        displayName: 'Privacy Test',
      },
    });
    expect(registration.statusCode, registration.body).toBe(201);
    const session = {
      cookie: cookiesFrom(registration),
      csrf: registration.json<{ csrfToken: string }>().csrfToken,
    };
    const userId = registration.json<{ user: { id: string } }>().user.id;
    const duplicateRegistration = await app.inject({
      method: 'POST',
      url: '/auth/register',
      headers: { origin: configuration.WEB_ORIGIN },
      payload: {
        email: `privacy-${runKey.toLowerCase()}@example.test`,
        password: 'GoalPilot-Privacy-2026!',
        displayName: 'Privacy Test',
      },
    });
    expect(duplicateRegistration.statusCode).toBe(409);

    const exportResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/data-exports',
      headers: {
        origin: configuration.WEB_ORIGIN,
        cookie: session.cookie,
        'x-csrf-token': session.csrf,
        'idempotency-key': `privacy-export-${runKey}`,
      },
      payload: {},
    });
    expect(exportResponse.statusCode, exportResponse.body).toBe(201);
    expect(exportResponse.json()).toMatchObject({
      status: 'completed',
      data: { user: { id: userId, displayName: 'Privacy Test' }, goals: [] },
    });
    expect(exportResponse.body).not.toContain('password_hash');
    const exportReplay = await app.inject({
      method: 'POST',
      url: '/api/v1/data-exports',
      headers: {
        origin: configuration.WEB_ORIGIN,
        cookie: session.cookie,
        'x-csrf-token': session.csrf,
        'idempotency-key': `privacy-export-${runKey}`,
      },
      payload: {},
    });
    expect(exportReplay.statusCode, exportReplay.body).toBe(201);
    expect(exportReplay.headers['idempotency-replayed']).toBe('true');
    expect(exportReplay.json()).toEqual(exportResponse.json());
    const legacyExport = await app.inject({
      method: 'GET',
      url: '/api/v1/data-export',
      headers: { cookie: session.cookie },
    });
    expect(legacyExport.statusCode).toBe(404);
    const requests = await database<{ status: string }[]>`
      SELECT status FROM data_requests WHERE user_id = ${userId} AND request_type = 'export'
    `;
    expect(requests).toEqual([{ status: 'completed' }]);

    const deletion = await app.inject({
      method: 'POST',
      url: '/api/v1/account-deletion',
      headers: {
        origin: configuration.WEB_ORIGIN,
        cookie: session.cookie,
        'x-csrf-token': session.csrf,
      },
      payload: {},
    });
    expect(deletion.statusCode, deletion.body).toBe(200);
    expect(deletion.json()).toEqual({ status: 'completed' });
    await expect(database`SELECT id FROM users WHERE id = ${userId}`).resolves.toHaveLength(0);
    const deletionAudits = await database<
      { user_id: string | null; pseudonymous_subject_hash: string | null }[]
    >`
      SELECT user_id, pseudonymous_subject_hash FROM audit_events
      WHERE event_name = 'privacy.deletion_completed' AND user_id IS NULL
      ORDER BY created_at DESC LIMIT 1
    `;
    expect(deletionAudits[0]).toMatchObject({ user_id: null });
    expect(deletionAudits[0]?.pseudonymous_subject_hash).toHaveLength(64);

    const sessionStatus = await app.inject({
      method: 'GET',
      url: '/api/v1/session-status',
      headers: { cookie: session.cookie },
    });
    expect(sessionStatus.json()).toEqual({ authenticated: false });
  });

  it('rate-limits repeated local login attempts with a safe envelope', async () => {
    let response = await app.inject({
      method: 'POST',
      url: '/auth/login',
      headers: { origin: configuration.WEB_ORIGIN },
      payload: { email: 'unknown@example.test', password: 'Incorrect-Password-2026!' },
    });
    for (let attempt = 0; attempt < 8; attempt += 1) {
      response = await app.inject({
        method: 'POST',
        url: '/auth/login',
        headers: { origin: configuration.WEB_ORIGIN },
        payload: { email: 'unknown@example.test', password: 'Incorrect-Password-2026!' },
      });
    }
    expect(response.statusCode).toBe(429);
    expect(response.json()).toMatchObject({ error: { code: 'RATE_LIMITED' } });
  });
});
