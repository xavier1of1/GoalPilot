import { createDatabaseClient } from '@goalpilot/data-access';

import { getDatabaseUrl } from './runtime-config.js';

const database = createDatabaseClient(getDatabaseUrl(), 1);
try {
  const migrations = await database<{ filename: string }[]>`
    SELECT filename FROM schema_migrations ORDER BY filename
  `;
  const tables = await database<{ table_name: string }[]>`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' ORDER BY table_name
  `;
  if (migrations.length === 0) throw new Error('No migrations have been applied.');
  if (!tables.some((row) => row.table_name === 'ledger_entries')) {
    throw new Error('Required ledger_entries table is missing.');
  }
  process.stdout.write(
    `Verified ${String(migrations.length)} migrations and ${String(tables.length)} public tables.\n`,
  );
} finally {
  await database.end();
}
