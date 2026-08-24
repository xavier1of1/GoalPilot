import { createDatabaseClient } from '@goalpilot/data-access';

import { assertLocalDatabaseUrl, loadLocalEnvironment, sameDatabase } from './runtime-config.js';

loadLocalEnvironment();
const developmentUrl = process.env['DATABASE_URL'];
const testUrl = process.env['TEST_DATABASE_URL'];
if (developmentUrl === undefined || testUrl === undefined)
  throw new Error('DATABASE_URL and TEST_DATABASE_URL are required.');
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
