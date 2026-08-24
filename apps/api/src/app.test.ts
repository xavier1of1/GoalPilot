import { afterEach, describe, expect, it } from 'vitest';

import { previewOutputSchema } from '@goalpilot/contracts';
import { createDatabaseClient } from '@goalpilot/data-access';
import { illustrativeAssumptions } from '@goalpilot/domain';

import { buildApp } from './app.js';
import type { AppConfiguration } from './config.js';

const configuration: AppConfiguration = Object.freeze({
  ENVIRONMENT: 'test',
  NODE_ENV: 'test',
  WEB_ORIGIN: 'http://localhost:5173',
  API_ORIGIN: 'http://localhost:3000',
  API_PORT: 3000,
  DATABASE_URL: 'postgres://goalpilot:goalpilot@127.0.0.1:1/goalpilot_test',
  AUTH_MODE: 'local',
  SESSION_SECRET: 'a-test-secret-that-is-at-least-32-characters',
  FINANCIAL_PROVIDER_MODE: 'simulated',
  APPLICATION_DATE: '2026-08-23',
  LOG_LEVEL: 'silent',
});

const resources: { close: () => Promise<void> }[] = [];
afterEach(async () => {
  await Promise.all(resources.splice(0).map((resource) => resource.close()));
});

async function testApp() {
  const database = createDatabaseClient(configuration.DATABASE_URL, 1);
  const app = await buildApp({ configuration, database });
  resources.push({
    close: async () => {
      await app.close();
      await database.end();
    },
  });
  return app;
}

describe('Fastify public API', () => {
  it('serves liveness with security headers and a request id', async () => {
    const app = await testApp();
    const response = await app.inject({ method: 'GET', url: '/health/live' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'live' });
    expect(response.headers['x-content-type-options']).toBe('nosniff');
  });

  it('returns all four deterministic illustrative preview routes', async () => {
    const app = await testApp();
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
    expect(durations[Math.ceil(durations.length * 0.95) - 1]).toBeLessThan(1_000);
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
