import { describe, expect, it } from 'vitest';

import { loadConfiguration } from './config.js';

const validEnvironment = {
  ENVIRONMENT: 'test',
  NODE_ENV: 'test',
  WEB_ORIGIN: 'http://localhost:5173',
  API_ORIGIN: 'http://localhost:3000',
  API_PORT: '3000',
  API_BIND_HOST: '127.0.0.1',
  DATABASE_URL: 'postgres://goalpilot:goalpilot@localhost:5432/goalpilot_test',
  AUTH_MODE: 'local',
  SESSION_SECRET: 'a-test-secret-that-is-at-least-32-characters',
  FINANCIAL_PROVIDER_MODE: 'simulated',
  APPLICATION_DATE: '2026-08-23',
  LOG_LEVEL: 'silent',
} as const;

describe('runtime configuration', () => {
  it('accepts explicit local test configuration', () => {
    expect(loadConfiguration(validEnvironment)).toMatchObject({
      ENVIRONMENT: 'test',
      API_PORT: 3000,
      DEMO_STORY_ENABLED: false,
      PURCHASE_TIMING_LAB_ENABLED: false,
    });
  });

  it('parses explicit product capabilities without truthy string coercion', () => {
    expect(
      loadConfiguration({
        ...validEnvironment,
        DEMO_STORY_ENABLED: 'true',
        PURCHASE_TIMING_LAB_ENABLED: 'false',
      }),
    ).toMatchObject({ DEMO_STORY_ENABLED: true, PURCHASE_TIMING_LAB_ENABLED: false });
  });

  it('rejects ambiguous feature flag values', () => {
    expect(() => loadConfiguration({ ...validEnvironment, DEMO_STORY_ENABLED: 'yes' })).toThrow();
  });

  it('rejects local authentication in production', () => {
    expect(() => loadConfiguration({ ...validEnvironment, ENVIRONMENT: 'production' })).toThrow(
      'Local authentication is forbidden',
    );
  });

  it('fails fast when a required value is missing', () => {
    expect(() => loadConfiguration({ ...validEnvironment, DATABASE_URL: undefined })).toThrow();
  });

  it('rejects non-loopback URLs in local and test modes', () => {
    expect(() =>
      loadConfiguration({ ...validEnvironment, WEB_ORIGIN: 'http://192.168.1.20:5173' }),
    ).toThrow('loopback host');
  });

  it('routes local database URLs through the host from the Dev Container', () => {
    expect(
      loadConfiguration({ ...validEnvironment, GOALPILOT_DEVCONTAINER: 'true' }).DATABASE_URL,
    ).toContain('@host.docker.internal:5432/goalpilot_test');
  });

  it('rejects an all-interface API listener outside the Dev Container', () => {
    expect(() => loadConfiguration({ ...validEnvironment, API_BIND_HOST: '0.0.0.0' })).toThrow(
      'only inside the Dev Container',
    );
  });

  it('allows a larger request budget only in the isolated test environment', () => {
    expect(loadConfiguration({ ...validEnvironment, TEST_RATE_LIMIT_MAX: '2000' })).toMatchObject({
      ENVIRONMENT: 'test',
      TEST_RATE_LIMIT_MAX: 2000,
    });
    expect(() =>
      loadConfiguration({
        ...validEnvironment,
        ENVIRONMENT: 'local',
        NODE_ENV: 'development',
        TEST_RATE_LIMIT_MAX: '2000',
      }),
    ).toThrow('TEST_RATE_LIMIT_MAX may be changed only for an isolated test process.');
  });
});
