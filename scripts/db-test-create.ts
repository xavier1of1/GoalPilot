import { createDatabaseClient } from '@goalpilot/data-access';

import {
  assertLocalDatabaseUrl,
  loadLocalEnvironment,
  resolveDatabaseUrlForRuntime,
  sameDatabase,
} from './runtime-config.js';

loadLocalEnvironment();
const configuredDevelopmentUrl = process.env['DATABASE_URL'];
const configuredTestUrl = process.env['TEST_DATABASE_URL'];
if (configuredDevelopmentUrl === undefined || configuredTestUrl === undefined)
  throw new Error('DATABASE_URL and TEST_DATABASE_URL are required.');
const developmentUrl = resolveDatabaseUrlForRuntime(configuredDevelopmentUrl);
const testUrl = resolveDatabaseUrlForRuntime(configuredTestUrl);
assertLocalDatabaseUrl(developmentUrl, 'goalpilot_local');
if (sameDatabase(developmentUrl, testUrl))
  throw new Error('The test database must differ from the local database.');
const parsedTest = assertLocalDatabaseUrl(testUrl, 'goalpilot_test');

const admin = createDatabaseClient(developmentUrl, 1);
try {
  const name = parsedTest.pathname.slice(1);
  const existing = await admin<{ exists: boolean }[]>`
    SELECT EXISTS(SELECT 1 FROM pg_database WHERE datname = ${name}) AS exists
  `;
  if (!existing[0]?.exists) {
    await admin.unsafe(`CREATE DATABASE "${name.replaceAll('"', '""')}"`);
    process.stdout.write(`Created isolated test database "${name}".\n`);
  }
} finally {
  await admin.end();
}
