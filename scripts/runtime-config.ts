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

function isDirectLoopbackHost(hostname: string): boolean {
  return ['localhost', '127.0.0.1', '::1'].includes(normalizedHost(hostname));
}

function isLocalRuntimeHost(hostname: string): boolean {
  return isDirectLoopbackHost(hostname) || normalizedHost(hostname) === 'host.docker.internal';
}

export function resolveDatabaseUrlForRuntime(
  configuredUrl: string,
  inDevContainer = process.env['GOALPILOT_DEVCONTAINER'] === 'true',
): string {
  const parsed = new URL(configuredUrl);
  if (inDevContainer && isDirectLoopbackHost(parsed.hostname)) {
    parsed.hostname = 'host.docker.internal';
  }
  return parsed.toString();
}

export function getDatabaseUrl(): string {
  loadLocalEnvironment();
  const configuredUrl =
    process.env['ENVIRONMENT'] === 'test'
      ? process.env['TEST_DATABASE_URL']
      : process.env['DATABASE_URL'];
  const databaseUrl = databaseEnvironmentSchema.parse({ DATABASE_URL: configuredUrl }).DATABASE_URL;
  return resolveDatabaseUrlForRuntime(databaseUrl);
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
    host: isLocalRuntimeHost(parsed.hostname) ? 'loopback' : normalizedHost(parsed.hostname),
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
  allowDevContainerHostBridge = process.env['GOALPILOT_DEVCONTAINER'] === 'true',
): URL {
  const parsed = new URL(databaseUrl);
  const { database: databaseName } = databaseIdentity(databaseUrl);
  const hostname = normalizedHost(parsed.hostname);
  const localHost =
    isDirectLoopbackHost(hostname) ||
    (allowDevContainerHostBridge && hostname === 'host.docker.internal');
  if (
    !['postgres:', 'postgresql:'].includes(parsed.protocol) ||
    !localHost ||
    databaseName !== expectedDatabase
  ) {
    throw new Error(
      `Refusing destructive database action for host "${parsed.hostname}" and database "${databaseName}".`,
    );
  }
  return parsed;
}
