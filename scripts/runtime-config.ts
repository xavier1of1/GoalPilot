import { existsSync } from 'node:fs';

import { z } from 'zod';

export function loadLocalEnvironment(): void {
  if (existsSync('.env.local')) process.loadEnvFile('.env.local');
}

const databaseEnvironmentSchema = z.object({
  DATABASE_URL: z.url().startsWith('postgres'),
});

function normalizedHost(hostname: string): string {
  return hostname.replace(/^\[|\]$/g, '').toLowerCase();
}

function isLoopbackHost(hostname: string): boolean {
  return ['localhost', '127.0.0.1', '::1', 'host.docker.internal'].includes(
    normalizedHost(hostname),
  );
}

export function getDatabaseUrl(): string {
  loadLocalEnvironment();
  const configuredUrl =
    process.env['ENVIRONMENT'] === 'test'
      ? process.env['TEST_DATABASE_URL']
      : process.env['DATABASE_URL'];
  const databaseUrl = (() => {
    if (configuredUrl === undefined || process.env['GOALPILOT_DEVCONTAINER'] !== 'true')
      return configuredUrl;
    const parsed = new URL(configuredUrl);
    if (
      isLoopbackHost(parsed.hostname) &&
      normalizedHost(parsed.hostname) !== 'host.docker.internal'
    )
      parsed.hostname = 'host.docker.internal';
    return parsed.toString();
  })();
  return databaseEnvironmentSchema.parse({ DATABASE_URL: databaseUrl }).DATABASE_URL;
}

export interface DatabaseIdentity {
  readonly host: string;
  readonly port: string;
  readonly user: string;
  readonly database: string;
}

export function databaseIdentity(databaseUrl: string): DatabaseIdentity {
  const parsed = new URL(databaseUrl);
  return {
    host: isLoopbackHost(parsed.hostname) ? 'loopback' : normalizedHost(parsed.hostname),
    port: parsed.port || '5432',
    user: decodeURIComponent(parsed.username),
    database: decodeURIComponent(parsed.pathname.slice(1)),
  };
}

export function sameDatabase(leftUrl: string, rightUrl: string): boolean {
  const left = databaseIdentity(leftUrl);
  const right = databaseIdentity(rightUrl);
  return (
    left.host === right.host &&
    left.port === right.port &&
    left.user === right.user &&
    left.database === right.database
  );
}

export function assertLocalDatabaseUrl(
  databaseUrl: string,
  expectedDatabase: 'goalpilot_local' | 'goalpilot_test',
): URL {
  const parsed = new URL(databaseUrl);
  const { database: databaseName } = databaseIdentity(databaseUrl);
  const localHost = isLoopbackHost(parsed.hostname);
  if (!localHost || databaseName !== expectedDatabase) {
    throw new Error(
      `Refusing destructive database action for host "${parsed.hostname}" and database "${databaseName}".`,
    );
  }
  return parsed;
}
