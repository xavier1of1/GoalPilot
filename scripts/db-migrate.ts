import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import { createDatabaseClient } from '@goalpilot/data-access';

import { getDatabaseUrl } from './runtime-config.js';

const migrationsDirectory = path.resolve('packages/data-access/migrations');
const database = createDatabaseClient(getDatabaseUrl(), 1);

try {
  await database`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename text PRIMARY KEY,
      checksum char(64) NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `;
  const filenames = (await readdir(migrationsDirectory))
    .filter((filename) => filename.endsWith('.sql'))
    .sort();
  for (const filename of filenames) {
    const sqlText = await readFile(path.join(migrationsDirectory, filename), 'utf8');
    const checksum = createHash('sha256').update(sqlText).digest('hex');
    const existing = await database<{ checksum: string }[]>`
      SELECT checksum FROM schema_migrations WHERE filename = ${filename}
    `;
    if (existing[0] !== undefined) {
      if (existing[0].checksum !== checksum)
        throw new Error(`Applied migration changed: ${filename}`);
      continue;
    }
    await database.begin(async (transaction) => {
      await transaction.unsafe(sqlText);
      await transaction`
        INSERT INTO schema_migrations (filename, checksum) VALUES (${filename}, ${checksum})
      `;
    });
    process.stdout.write(`Applied ${filename}\n`);
  }
  process.stdout.write(`Database is current (${String(filenames.length)} migration files).\n`);
} finally {
  await database.end();
}
