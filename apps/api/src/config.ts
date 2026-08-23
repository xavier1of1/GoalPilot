import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { z } from 'zod';

const configurationSchema = z.object({
  ENVIRONMENT: z.enum(['local', 'test', 'staging', 'production']),
  NODE_ENV: z.enum(['development', 'test', 'production']),
  WEB_ORIGIN: z.url(),
  API_ORIGIN: z.url(),
  API_PORT: z.coerce.number().int().min(1).max(65_535),
  DATABASE_URL: z.url().startsWith('postgres'),
  AUTH_MODE: z.enum(['local', 'external']),
  SESSION_SECRET: z.string().min(32),
  FINANCIAL_PROVIDER_MODE: z.enum(['simulated', 'provider']),
  APPLICATION_DATE: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']),
});

export type AppConfiguration = Readonly<z.infer<typeof configurationSchema>>;

function containerDatabaseUrl(
  value: string | undefined,
  inDevContainer: boolean,
): string | undefined {
  if (value === undefined || !inDevContainer) return value;
  const parsed = new URL(value);
  if (['localhost', '127.0.0.1', '::1'].includes(parsed.hostname))
    parsed.hostname = 'host.docker.internal';
  return parsed.toString();
}

export function loadConfiguration(environment: NodeJS.ProcessEnv = process.env): AppConfiguration {
  const repositoryEnvironmentFile = fileURLToPath(new URL('../../../.env.local', import.meta.url));
  if (environment === process.env && existsSync(repositoryEnvironmentFile))
    process.loadEnvFile(repositoryEnvironmentFile);
  const loaded = environment === process.env ? process.env : environment;
  const inDevContainer = loaded['GOALPILOT_DEVCONTAINER'] === 'true';
  const selected = {
    ...loaded,
    DATABASE_URL: containerDatabaseUrl(
      loaded['ENVIRONMENT'] === 'test' && loaded['TEST_DATABASE_URL'] !== undefined
        ? loaded['TEST_DATABASE_URL']
        : loaded['DATABASE_URL'],
      inDevContainer,
    ),
  };
  const parsed = configurationSchema.parse(selected);
  if (parsed.ENVIRONMENT === 'staging' || parsed.ENVIRONMENT === 'production')
    throw new Error('Local authentication is forbidden outside local/test.');
  if (parsed.AUTH_MODE !== 'local')
    throw new Error('No external authentication adapter ships in the local MVP.');
  if (parsed.FINANCIAL_PROVIDER_MODE !== 'simulated')
    throw new Error('No live financial provider ships in the local MVP.');
  const loopbackHosts = new Set(['localhost', '127.0.0.1', '::1', 'host.docker.internal']);
  for (const [name, value] of [
    ['WEB_ORIGIN', parsed.WEB_ORIGIN],
    ['API_ORIGIN', parsed.API_ORIGIN],
    ['DATABASE_URL', parsed.DATABASE_URL],
  ] as const) {
    if (!loopbackHosts.has(new URL(value).hostname))
      throw new Error(`${name} must use a loopback host in the local MVP.`);
  }
  return Object.freeze(parsed);
}
