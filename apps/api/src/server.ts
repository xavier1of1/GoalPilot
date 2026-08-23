import { createDatabaseClient } from '@goalpilot/data-access';

import { buildApp } from './app.js';
import { loadConfiguration } from './config.js';

const configuration = loadConfiguration();
const database = createDatabaseClient(configuration.DATABASE_URL);
const app = await buildApp({ configuration, database });

const close = async (): Promise<void> => {
  await app.close();
  await database.end();
};
process.on('SIGINT', () => void close());
process.on('SIGTERM', () => void close());

await app.listen({ port: configuration.API_PORT, host: '0.0.0.0' });
app.log.info(
  {
    web: configuration.WEB_ORIGIN,
    api: configuration.API_ORIGIN,
    docs: `${configuration.API_ORIGIN}/docs`,
    database: 'PostgreSQL local',
    environment: configuration.ENVIRONMENT,
    authProvider: 'LocalAuthProvider',
    financialProviderMode: configuration.FINANCIAL_PROVIDER_MODE,
    awsStatus: 'disabled',
  },
  'GoalPilot local services',
);
