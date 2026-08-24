import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import { createDatabaseClient, schemaTables } from '@goalpilot/data-access';
import { catalogVersion, illustrativeAssumptions } from '@goalpilot/domain';

import { getDatabaseUrl } from './runtime-config.js';

const migrationsDirectory = path.resolve('packages/data-access/migrations');
const database = createDatabaseClient(getDatabaseUrl(), 1);

function calendarDate(value: string | Date): string {
  return typeof value === 'string' ? value : value.toISOString().slice(0, 10);
}
try {
  const migrationFiles = (await readdir(migrationsDirectory))
    .filter((filename) => filename.endsWith('.sql'))
    .sort();
  const expectedMigrations = await Promise.all(
    migrationFiles.map(async (filename) => ({
      filename,
      checksum: createHash('sha256')
        .update(await readFile(path.join(migrationsDirectory, filename), 'utf8'))
        .digest('hex'),
    })),
  );
  const migrations = await database<{ filename: string; checksum: string }[]>`
    SELECT filename, checksum FROM schema_migrations ORDER BY filename
  `;
  if (JSON.stringify(migrations) !== JSON.stringify(expectedMigrations))
    throw new Error('Applied migrations do not exactly match the ordered migration files.');

  const tables = await database<{ table_name: string }[]>`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' ORDER BY table_name
  `;
  const expectedTables = [...schemaTables, 'schema_migrations'].sort();
  if (JSON.stringify(tables.map((row) => row.table_name)) !== JSON.stringify(expectedTables))
    throw new Error('Public database tables do not exactly match the required local schema.');

  const catalog = await database<
    {
      vehicle_code: (typeof illustrativeAssumptions)[number]['vehicleCode'];
      display_name: string;
      assumption_version: string;
      apy_basis_points: number;
      effective_date: string | Date;
      reviewed_date: string | Date;
      source_type: string;
      source_label: string;
      is_live: boolean;
      liquidity_days: number;
      lock_days: number;
      minimum_cents: string;
      enabled: boolean;
    }[]
  >`
    SELECT va.vehicle_code, va.display_name, va.version AS assumption_version,
           va.apy_basis_points, vav.effective_date, vav.reviewed_date, vav.source_type,
           va.source_label, vav.is_live, va.liquidity_days, va.lock_days,
           va.minimum_cents, va.enabled
    FROM vehicle_assumptions va
    JOIN vehicle_assumption_versions vav ON vav.version = va.version
    WHERE va.version = ${catalogVersion}
    ORDER BY CASE va.vehicle_code
      WHEN 'cash' THEN 1 WHEN 'hysa' THEN 2 WHEN 'cd_ladder' THEN 3 ELSE 4 END
  `;
  const storedCatalog = catalog.map((row) => ({
    vehicleCode: row.vehicle_code,
    displayName: row.display_name,
    assumptionVersion: row.assumption_version,
    apyBasisPoints: row.apy_basis_points,
    effectiveDate: calendarDate(row.effective_date),
    reviewedDate: calendarDate(row.reviewed_date),
    sourceType: row.source_type,
    sourceLabel: row.source_label,
    isLive: row.is_live,
    liquidityDays: row.liquidity_days,
    lockDays: row.lock_days,
    minimumCents: Number(row.minimum_cents),
    enabled: row.enabled,
  }));
  if (JSON.stringify(storedCatalog) !== JSON.stringify(illustrativeAssumptions))
    throw new Error('Seeded illustrative assumptions have drifted from the reviewed catalog.');

  process.stdout.write(
    `Verified ${String(migrations.length)} immutable migrations, ${String(tables.length)} public tables, and ${String(catalog.length)} reviewed assumptions.\n`,
  );
} finally {
  await database.end();
}
