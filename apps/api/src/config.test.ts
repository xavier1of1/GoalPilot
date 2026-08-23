import { describe, expect, it } from 'vitest';

import { loadConfiguration } from './config.js';

const validEnvironment = {
  ENVIRONMENT: 'test',
  NODE_ENV: 'test',
  WEB_ORIGIN: 'http://localhost:5173',
  API_ORIGIN: 'http://localhost:3000',
  API_PORT: '3000',
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
    });
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
});
