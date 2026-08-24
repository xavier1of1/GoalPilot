import { createDatabaseClient } from '@goalpilot/data-access';

import { assertDemoResetTarget, japanTripFixture, resetJapanTripFixture } from './demo-fixture.js';
import { getDatabaseUrl, loadLocalEnvironment } from './runtime-config.js';

loadLocalEnvironment();
const databaseUrl = getDatabaseUrl();
assertDemoResetTarget(process.env['ENVIRONMENT'], databaseUrl);

const database = createDatabaseClient(databaseUrl, 1);
try {
  const result = await resetJapanTripFixture(database);
  process.stdout.write(
    `Restored seeded fixture "${japanTripFixture.fixtureKey}" at ${japanTripFixture.applicationDate} ` +
      `(generation ${String(result.resetGeneration)}).\n`,
  );
} finally {
  await database.end();
}
