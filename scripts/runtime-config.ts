import { existsSync } from 'node:fs';

import { z } from 'zod';

export function loadLocalEnvironment(): void {
  if (existsSync('.env.local')) process.loadEnvFile('.env.local');
}

const databaseEnvironmentSchema = z.object({
  DATABASE_URL: z.url().startsWith('postgres'),
});

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
    if (['localhost', '127.0.0.1', '::1'].includes(parsed.hostname))
      parsed.hostname = 'host.docker.internal';
    return parsed.toString();
  })();
  return databaseEnvironmentSchema.parse({ DATABASE_URL: databaseUrl }).DATABASE_URL;
}

export function assertLocalDatabaseUrl(databaseUrl: string): URL {
  const parsed = new URL(databaseUrl);
  const databaseName = parsed.pathname.slice(1);
  const localHost = ['localhost', '127.0.0.1', '::1', 'host.docker.internal'].includes(
    parsed.hostname,
  );
  const knownDatabase =
    databaseName.includes('goalpilot_local') || databaseName.includes('goalpilot_test');
  if (!localHost || !knownDatabase) {
    throw new Error(
      `Refusing destructive database action for host "${parsed.hostname}" and database "${databaseName}".`,
    );
  }
  return parsed;
}
