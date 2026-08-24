import { afterEach, describe, expect, it } from 'vitest';

import {
  previewOutputSchema,
  recoveryOptionsOutputSchema,
  safeBaselineResponseSchema,
} from '@goalpilot/contracts';
import { createDatabaseClient } from '@goalpilot/data-access';
import {
  buildRecoveryOptions,
  compareVehicles,
  derivePlanHealth,
  illustrativeAssumptions,
} from '@goalpilot/domain';

import {
  buildApp,
  planDecisionSummary,
  recoveryOptionsFromSelectedVehicleRecalculation,
} from './app.js';
import type { AppConfiguration } from './config.js';

const configuration: AppConfiguration = Object.freeze({
  ENVIRONMENT: 'test',
  NODE_ENV: 'test',
  WEB_ORIGIN: 'http://localhost:5173',
  API_ORIGIN: 'http://localhost:3000',
  API_PORT: 3000,
  API_BIND_HOST: '127.0.0.1',
  DATABASE_URL: 'postgres://goalpilot:goalpilot@127.0.0.1:1/goalpilot_test',
  AUTH_MODE: 'local',
  SESSION_SECRET: 'a-test-secret-that-is-at-least-32-characters',
  FINANCIAL_PROVIDER_MODE: 'simulated',
  APPLICATION_DATE: '2026-08-23',
  LOG_LEVEL: 'silent',
  TEST_RATE_LIMIT_MAX: 120,
  DEMO_STORY_ENABLED: false,
  PURCHASE_TIMING_LAB_ENABLED: false,
});

const resources: { close: () => Promise<void> }[] = [];
afterEach(async () => {
  await Promise.all(resources.splice(0).map((resource) => resource.close()));
});

async function testApp(applicationDate?: string) {
  const database = createDatabaseClient(configuration.DATABASE_URL, 1);
  const app = await buildApp({
    configuration,
    database,
    ...(applicationDate === undefined
      ? {}
      : {
          clock: {
            today: () => Promise.resolve(applicationDate),
            advanceTo: () => Promise.resolve(),
          },
        }),
  });
  resources.push({
    close: async () => {
      await app.close();
      await database.end();
    },
  });
  return app;
}

describe('Fastify public API', () => {
  it('keeps posted interest separate from personal contributions in plan summaries', () => {
    const goal = {
      name: 'Interest reconciliation fixture',
      targetAmountCents: 600_000,
      currentSavedCents: 160_000,
      targetDate: '2027-08-23',
      recurringContributionCents: 45_000,
      contributionCadence: 'monthly' as const,
      liquidityNeed: 'anytime' as const,
      preservationPreference: 'required' as const,
      confidence: 'expected' as const,
    };
    const projection = compareVehicles(goal, '2026-08-23', illustrativeAssumptions, {
      personalPrincipalCents: 150_000,
      totalLedgerValueCents: 160_000,
      currentAvailableFundsCents: 160_000,
    });
    const selected = projection.vehicles.find((vehicle) => vehicle.vehicleCode === 'cash');
    expect(selected).toBeDefined();

    const summary = planDecisionSummary({
      goal,
      projection,
      vehicleCode: 'cash',
      openingSavingsCents: 100_000,
      postedContributionsCents: 50_000,
      postedInterestCents: 10_000,
      currentAvailableFundsCents: 160_000,
      paused: false,
    });

    expect(summary.currentTotalValueCents).toBe(160_000);
    expect(summary.postedModeledInterestCents).toBe(10_000);
    expect(summary.futurePersonalContributionsCents).toBe(
      (selected?.principalContributedCents ?? 0) - 150_000,
    );
    expect(
      summary.currentTotalValueCents +
        summary.futurePersonalContributionsCents +
        summary.futureModeledInterestCents,
    ).toBe(summary.projectedTargetDateBalanceCents);
  });

  it('keeps every ordered recovery option visible after fixed-term recomputation', () => {
    const applicationDate = '2026-08-23';
    const goal = {
      name: 'Fixed-term recovery fixture',
      targetAmountCents: 600_000,
      currentSavedCents: 100_000,
      targetDate: '2027-08-23',
      recurringContributionCents: 10_000,
      contributionCadence: 'monthly' as const,
      liquidityNeed: 'goal_date' as const,
      preservationPreference: 'required' as const,
      confidence: 'expected' as const,
    };
    const projectionContext = {
      scheduleAnchorDate: applicationDate,
      omittedContributionDates: [],
      personalPrincipalCents: 100_000,
      totalLedgerValueCents: 100_000,
      currentAvailableFundsCents: 0,
      currentAccruedInterestMicros: 0,
      fixedTermVehicleCode: 'cd_ladder' as const,
      fixedTermLots: [
        {
          personalPrincipalCents: 100_000,
          currentBalanceCents: 100_000,
          firstMaturityDate: '2027-02-19',
          nextMaturityDate: '2027-02-19',
          nextMaturityInterestEligible: true,
        },
      ],
    };
    const currentProjection = compareVehicles(
      goal,
      applicationDate,
      illustrativeAssumptions,
      projectionContext,
    );
    const currentSelected = currentProjection.vehicles.find(
      (vehicle) => vehicle.vehicleCode === 'cd_ladder',
    );
    if (currentSelected === undefined) throw new Error('Missing fixed-term projection fixture.');
    const candidates = buildRecoveryOptions({
      plan: {
        asOfDate: applicationDate,
        scheduleAnchorDate: applicationDate,
        currentSavedCents: projectionContext.personalPrincipalCents,
        targetAmountCents: goal.targetAmountCents,
        targetDate: goal.targetDate,
        recurringContributionCents: goal.recurringContributionCents,
        contributionCadence: goal.contributionCadence,
        omittedContributionDates: projectionContext.omittedContributionDates,
      },
      planHealth: 'ATTENTION_NEEDED',
    });

    const options = recoveryOptionsFromSelectedVehicleRecalculation(candidates, (change) => {
      let nextGoal = goal;
      switch (change.changedDimension) {
        case 'CONTRIBUTION':
          nextGoal = { ...goal, recurringContributionCents: change.recurringContributionCents };
          break;
        case 'DEADLINE':
          nextGoal = { ...goal, targetDate: change.targetDate };
          break;
        case 'TARGET':
          nextGoal = { ...goal, targetAmountCents: change.targetAmountCents };
          break;
        case 'MISSED_CONTRIBUTION':
          throw new Error('Recovery candidates cannot omit a contribution.');
      }
      const projection = compareVehicles(
        nextGoal,
        applicationDate,
        illustrativeAssumptions,
        projectionContext,
      );
      const selected = projection.vehicles.find((vehicle) => vehicle.vehicleCode === 'cd_ladder');
      if (selected === undefined) throw new Error('Missing fixed-term scenario projection.');
      const health = derivePlanHealth({
        paused: false,
        currentAvailableFundsCents: projectionContext.currentAvailableFundsCents,
        currentTotalValueCents: projectionContext.totalLedgerValueCents,
        targetAmountCents: nextGoal.targetAmountCents,
        accessConditionsSatisfied: selected.accessRequirementSatisfied,
        projectedPurchaseReadyDate: selected.projectedCompletionDate,
        targetDate: nextGoal.targetDate,
        contributionCadence: nextGoal.contributionCadence,
      });
      return {
        projectedReadinessDate: selected.projectedCompletionDate,
        health: health.code,
        personalContributionChangeCents:
          selected.futurePersonalContributionsCents -
          currentSelected.futurePersonalContributionsCents,
        modeledInterestChangeCents:
          selected.modeledInterestCents - currentSelected.modeledInterestCents,
      };
    });
    const output = recoveryOptionsOutputSchema.parse({
      health: 'ATTENTION_NEEDED',
      options,
    });

    expect(output.options.map((option) => option.order)).toEqual([1, 2, 3]);
    expect(output.options).toMatchObject([
      {
        availability: 'unavailable',
        order: 1,
        optionType: 'CONTRIBUTION_INCREASE',
        reasonCode: 'SELECTED_VEHICLE_DOES_NOT_RESTORE_READINESS',
      },
      {
        availability: 'available',
        order: 2,
        optionType: 'DEADLINE_EXTENSION',
        resultingHealth: 'ON_TRACK',
      },
      {
        availability: 'unavailable',
        order: 3,
        optionType: 'TARGET_REDUCTION',
        reasonCode: 'SELECTED_VEHICLE_DOES_NOT_RESTORE_READINESS',
      },
    ]);

    expect(
      recoveryOptionsFromSelectedVehicleRecalculation(candidates.slice(0, 1), () => ({
        projectedReadinessDate: null,
        health: 'ATTENTION_NEEDED',
        personalContributionChangeCents: 0,
        modeledInterestChangeCents: 0,
      })),
    ).toEqual([
      {
        availability: 'unavailable',
        order: 1,
        optionType: 'CONTRIBUTION_INCREASE',
        reasonCode: 'SELECTED_VEHICLE_DOES_NOT_RESTORE_READINESS',
      },
    ]);
  });

  it('serves liveness with security headers and a request id', async () => {
    const app = await testApp('2026-08-23');
    const response = await app.inject({ method: 'GET', url: '/health/live' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'live' });
    expect(response.headers['x-content-type-options']).toBe('nosniff');
  });

  it('publishes a response schema for every data-bearing success response', async () => {
    const database = createDatabaseClient(configuration.DATABASE_URL, 1);
    const app = await buildApp({
      configuration: {
        ...configuration,
        DEMO_STORY_ENABLED: true,
        PURCHASE_TIMING_LAB_ENABLED: true,
      },
      database,
      clock: {
        today: () => Promise.resolve('2026-08-23'),
        advanceTo: () => Promise.resolve(),
      },
    });
    resources.push({
      close: async () => {
        await app.close();
        await database.end();
      },
    });
    await app.ready();

    const document = app.swagger() as {
      paths?: Record<
        string,
        Record<
          string,
          {
            responses?: Record<string, { content?: Record<string, { schema?: unknown }> }>;
          }
        >
      >;
    };
    const missing: string[] = [];
    for (const [path, operations] of Object.entries(document.paths ?? {})) {
      for (const [method, operation] of Object.entries(operations)) {
        for (const [status, response] of Object.entries(operation.responses ?? {})) {
          if (!status.startsWith('2') || status === '204') continue;
          if (response.content?.['application/json']?.schema === undefined) {
            missing.push(`${method.toUpperCase()} ${path} ${status}`);
          }
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it('fails closed when a provider returns data outside the catalog response contract', async () => {
    const database = createDatabaseClient(configuration.DATABASE_URL, 1);
    const firstAssumption = illustrativeAssumptions[0];
    if (firstAssumption === undefined) throw new Error('The test catalog is empty.');
    const app = await buildApp({
      configuration,
      database,
      clock: {
        today: () => Promise.resolve('2026-08-23'),
        advanceTo: () => Promise.resolve(),
      },
      rateProvider: {
        getCatalog: () =>
          Promise.resolve([
            {
              ...firstAssumption,
              leakedProviderCredential: 'must-not-cross-the-boundary',
            },
          ]),
      },
    });
    resources.push({
      close: async () => {
        await app.close();
        await database.end();
      },
    });

    const response = await app.inject({ method: 'GET', url: '/api/v1/vehicle-catalog' });
    expect(response.statusCode).toBe(500);
    expect(response.json()).toMatchObject({ error: { code: 'INTERNAL_ERROR' } });
    expect(response.body).not.toContain('must-not-cross-the-boundary');
  });

  it('returns all four deterministic illustrative preview routes', async () => {
    const app = await testApp('2026-08-23');
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/previews',
      headers: { origin: configuration.WEB_ORIGIN },
      payload: {
        name: 'Synthetic trip',
        targetAmountCents: 600_000,
        currentSavedCents: 100_000,
        targetDate: '2027-08-23',
        recurringContributionCents: 45_000,
        contributionCadence: 'monthly',
        liquidityNeed: 'goal_date',
        preservationPreference: 'required',
        confidence: 'expected',
        asOfDate: '2026-08-23',
      },
    });
    expect(response.statusCode).toBe(200);
    const body = previewOutputSchema.parse(response.json());
    expect(body.vehicles).toHaveLength(4);
    expect(body.vehicles.map((vehicle) => vehicle.assumption.isLive)).toEqual([
      false,
      false,
      false,
      false,
    ]);
  });

  it('derives the zero-interest safe baseline and first schedule date on the server', async () => {
    const app = await testApp('2026-08-23');
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/baselines',
      headers: { origin: configuration.WEB_ORIGIN },
      payload: {
        targetAmountCents: 600_000,
        currentSavedCents: 100_000,
        targetDate: '2027-08-23',
        contributionCadence: 'monthly',
      },
    });
    expect(response.statusCode).toBe(200);
    expect(safeBaselineResponseSchema.parse(response.json())).toEqual({
      baseline: {
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
      },
    });
  });

  it('rejects client schedule fields and target dates before the controlled application date', async () => {
    const app = await testApp('2026-08-23');
    const clientSchedule = await app.inject({
      method: 'POST',
      url: '/api/v1/baselines',
      headers: { origin: configuration.WEB_ORIGIN },
      payload: {
        targetAmountCents: 600_000,
        currentSavedCents: 100_000,
        targetDate: '2027-08-23',
        contributionCadence: 'monthly',
        firstContributionDate: '2026-09-23',
      },
    });
    expect(clientSchedule.statusCode).toBe(400);

    const pastTarget = await app.inject({
      method: 'POST',
      url: '/api/v1/baselines',
      headers: { origin: configuration.WEB_ORIGIN },
      payload: {
        targetAmountCents: 600_000,
        currentSavedCents: 100_000,
        targetDate: '2026-08-22',
        contributionCadence: 'monthly',
      },
    });
    expect(pastTarget.statusCode).toBe(400);
    expect(pastTarget.json()).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
  });

  it('uses injected clock and rate providers for the runtime catalog boundary', async () => {
    const database = createDatabaseClient(configuration.DATABASE_URL, 1);
    let requestedDate = '';
    const app = await buildApp({
      configuration,
      database,
      clock: {
        today: () => Promise.resolve('2026-09-01'),
        advanceTo: () => Promise.resolve(),
      },
      rateProvider: {
        getCatalog: (asOfDate) => {
          requestedDate = asOfDate;
          return Promise.resolve(illustrativeAssumptions.slice(0, 1));
        },
      },
    });
    resources.push({
      close: async () => {
        await app.close();
        await database.end();
      },
    });

    const response = await app.inject({ method: 'GET', url: '/api/v1/vehicle-catalog' });
    expect(response.statusCode).toBe(200);
    expect(response.json<{ vehicles: readonly unknown[] }>().vehicles).toHaveLength(1);
    expect(requestedDate).toBe('2026-09-01');
  });

  it('does not expose an unscoped application date through product capabilities', async () => {
    const database = createDatabaseClient(configuration.DATABASE_URL, 1);
    const app = await buildApp({
      configuration: {
        ...configuration,
        DEMO_STORY_ENABLED: true,
        PURCHASE_TIMING_LAB_ENABLED: false,
      },
      database,
      clock: {
        today: () => Promise.resolve('2026-09-01'),
        advanceTo: () => Promise.resolve(),
      },
    });
    resources.push({
      close: async () => {
        await app.close();
        await database.end();
      },
    });

    const response = await app.inject({ method: 'GET', url: '/api/v1/capabilities' });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ error: { code: 'AUTHENTICATION_REQUIRED' } });
  });

  it('keeps Timing Lab routes indistinguishable from missing routes while the flag is off', async () => {
    const app = await testApp('2026-08-23');
    const read = await app.inject({
      method: 'GET',
      url: '/api/v1/timing-lab/purchase-items',
    });
    expect(read.statusCode).toBe(404);

    const mutation = await app.inject({
      method: 'POST',
      url: '/api/v1/timing-lab/purchase-items',
      headers: { origin: configuration.WEB_ORIGIN },
      payload: {},
    });
    expect(mutation.statusCode).toBe(404);
  });

  it('keeps the local stateless preview p95 under one second', async () => {
    const app = await testApp();
    const durations: number[] = [];
    for (let iteration = 0; iteration < 20; iteration += 1) {
      const startedAt = performance.now();
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/previews',
        headers: { origin: configuration.WEB_ORIGIN },
        payload: {
          name: 'Preview performance fixture',
          targetAmountCents: 600_000,
          currentSavedCents: 100_000,
          targetDate: '2027-08-23',
          recurringContributionCents: 45_000,
          contributionCadence: 'monthly',
          liquidityNeed: 'goal_date',
          preservationPreference: 'required',
          confidence: 'expected',
          asOfDate: '2026-08-23',
        },
      });
      expect(response.statusCode).toBe(200);
      durations.push(performance.now() - startedAt);
    }
    durations.sort((left, right) => left - right);
    const p95DurationMs =
      durations[Math.ceil(durations.length * 0.95) - 1] ?? Number.POSITIVE_INFINITY;
    process.stdout.write(
      `[performance] stateless-plan-preview-p95=${p95DurationMs.toFixed(1)}ms samples=${String(durations.length)} ceiling=1000ms\n`,
    );
    expect(p95DurationMs).toBeLessThan(1_000);
  });

  it('rejects unknown financial input fields with a safe validation response', async () => {
    const app = await testApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/previews',
      headers: { origin: configuration.WEB_ORIGIN },
      payload: { unexpected: 'field' },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: { code: 'VALIDATION_ERROR', fieldErrors: null },
    });
    expect(response.body).not.toContain('stack');
  });

  it('rejects state-changing requests from an unapproved origin', async () => {
    const app = await testApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/previews',
      headers: { origin: 'https://attacker.example' },
      payload: {},
    });
    expect(response.statusCode).toBe(403);
  });

  it('does not exempt routes that merely share a public mutation prefix from CSRF', async () => {
    const app = await testApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/previews-untrusted',
      headers: { origin: configuration.WEB_ORIGIN },
      payload: {},
    });
    expect(response.statusCode).toBe(403);
  });

  it('preserves safe client statuses for malformed and oversized requests', async () => {
    const app = await testApp();
    const malformed = await app.inject({
      method: 'POST',
      url: '/api/v1/previews',
      headers: { origin: configuration.WEB_ORIGIN, 'content-type': 'application/json' },
      payload: '{not-json',
    });
    expect(malformed.statusCode).toBe(400);
    expect(malformed.json()).toMatchObject({ error: { code: 'BAD_REQUEST' } });

    const oversized = await app.inject({
      method: 'POST',
      url: '/api/v1/previews',
      headers: { origin: configuration.WEB_ORIGIN },
      payload: { name: 'x'.repeat(70_000) },
    });
    expect(oversized.statusCode).toBe(413);
    expect(oversized.json()).toMatchObject({ error: { code: 'PAYLOAD_TOO_LARGE' } });
  });

  it('returns a safe 429 envelope when the rate limit is exceeded', async () => {
    const app = await testApp();
    let response = await app.inject({ method: 'GET', url: '/health/live' });
    for (let request = 1; request <= 120; request += 1)
      response = await app.inject({ method: 'GET', url: '/health/live' });
    expect(response.statusCode).toBe(429);
    expect(response.json()).toMatchObject({ error: { code: 'RATE_LIMITED' } });
  });
});
