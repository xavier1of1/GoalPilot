import { createDatabaseClient } from '@goalpilot/data-access';

import { assertLocalDatabaseUrl, getDatabaseUrl } from './runtime-config.js';

const databaseUrl = getDatabaseUrl();
const parsed = assertLocalDatabaseUrl(databaseUrl);
if (!process.argv.includes('--yes')) {
  process.stderr.write(
    `This destroys and recreates every schema object in local database "${parsed.pathname.slice(1)}".\n` +
      'Re-run with: pnpm db:reset --yes\n',
  );
  process.exitCode = 2;
} else {
  const database = createDatabaseClient(databaseUrl, 1);
  try {
    await database`DROP SCHEMA public CASCADE`;
    await database`CREATE SCHEMA public`;
    process.stdout.write(
      `Reset local database "${parsed.pathname.slice(1)}". Run db:migrate and db:seed.\n`,
    );
  } finally {
    await database.end();
  }
}
