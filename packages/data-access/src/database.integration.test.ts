import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ulid } from 'ulid';

import { createDatabaseClient, GoalPilotRepository, type DatabaseClient } from './index.js';

function databaseUrl(): string {
  process.loadEnvFile('.env.local');
  const value = process.env['TEST_DATABASE_URL'];
  if (value === undefined) throw new Error('TEST_DATABASE_URL is required for integration tests.');
  return value;
}

describe('PostgreSQL migration and ownership constraints', () => {
  let database: DatabaseClient;
  let repository: GoalPilotRepository;

  beforeAll(() => {
    database = createDatabaseClient(databaseUrl(), 2);
    repository = new GoalPilotRepository(database);
  });

  afterAll(async () => database.end());

  it('records ordered migrations and all required local tables', async () => {
    const migrations = await database<{ filename: string }[]>`
      SELECT filename FROM schema_migrations ORDER BY filename
    `;
    const tables = await database<{ table_name: string }[]>`
      SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'
    `;
    expect(migrations.map((row) => row.filename)).toEqual([
      '202608230001_local_mvp.sql',
      '202608230002_allow_ledger_cascade_purge.sql',
      '202608230003_financial_integrity.sql',
    ]);
    expect(tables.map((row) => row.table_name)).toEqual(
      expect.arrayContaining([
        'users',
        'goals',
        'simulated_accounts',
        'ledger_entries',
        'schedule_occurrences',
        'application_clock',
      ]),
    );
  });

  it('stores every monetary column as bigint', async () => {
    const columns = await database<
      { table_name: string; column_name: string; data_type: string }[]
    >`
      SELECT table_name, column_name, data_type
      FROM information_schema.columns
      WHERE table_schema = 'public' AND column_name LIKE '%_cents'
    `;
    expect(columns.length).toBeGreaterThan(5);
    expect(columns.every((column) => column.data_type === 'bigint')).toBe(true);
  });

  it('hides an owned goal from a different deterministic user', async () => {
    const goal = await repository.createGoal('01K3C8ALEX0000000000000000', {
      name: 'Ownership integration fixture',
      targetAmountCents: 100_000,
      currentSavedCents: 10_000,
      targetDate: '2027-08-23',
      recurringContributionCents: 10_000,
      contributionCadence: 'monthly',
      liquidityNeed: 'anytime',
      preservationPreference: 'required',
      confidence: 'expected',
    });
    await expect(repository.getGoal('01K3C8SAM00000000000000000', goal.id)).resolves.toBeNull();
    await expect(repository.getGoal('01K3C8ALEX0000000000000000', goal.id)).resolves.toMatchObject({
      id: goal.id,
    });
    await repository.deleteGoal('01K3C8ALEX0000000000000000', goal.id);
  });

  it('rejects cross-owner child rows at the database boundary', async () => {
    const goal = await repository.createGoal('01K3C8ALEX0000000000000000', {
      name: 'Composite ownership fixture',
      targetAmountCents: 100_000,
      currentSavedCents: 10_000,
      targetDate: '2027-08-23',
      recurringContributionCents: 10_000,
      contributionCadence: 'monthly',
      liquidityNeed: 'anytime',
      preservationPreference: 'required',
      confidence: 'expected',
    });
    await expect(
      database`
        INSERT INTO plan_versions (
          id, goal_id, user_id, version, vehicle_code, assumption_version,
          normalized_input, calculation_output
        ) VALUES (
          '01M0CROSSOWNERPLAN00000000', ${goal.id}, '01K3C8SAM00000000000000000', 1,
          'cash', 'demo-2026-08-v1', '{}'::jsonb, '{}'::jsonb
        )
      `,
    ).rejects.toMatchObject({ code: '23503' });
    await repository.deleteGoal('01K3C8ALEX0000000000000000', goal.id);
  });

  it('keeps illustrative assumptions immutable', async () => {
    await expect(
      database`
        UPDATE vehicle_assumptions SET apy_basis_points = 9999
        WHERE version = 'demo-2026-08-v1' AND vehicle_code = 'hysa'
      `,
    ).rejects.toThrow('illustrative assumption versions are immutable');
  });

  it('keeps account activity append-only', async () => {
    const userId = '01K3C8ALEX0000000000000000';
    const goal = await repository.createGoal(userId, {
      name: 'Append-only ledger fixture',
      targetAmountCents: 100_000,
      currentSavedCents: 10_000,
      targetDate: '2027-08-23',
      recurringContributionCents: 10_000,
      contributionCadence: 'monthly',
      liquidityNeed: 'anytime',
      preservationPreference: 'required',
      confidence: 'expected',
    });
    const planId = ulid();
    const accountId = ulid();
    const ledgerId = ulid();
    await database`
      INSERT INTO plan_versions (
        id, goal_id, user_id, version, vehicle_code, assumption_version,
        normalized_input, calculation_output
      ) VALUES (
        ${planId}, ${goal.id}, ${userId}, 1, 'cash', 'demo-2026-08-v1',
        '{}'::jsonb, '{}'::jsonb
      )
    `;
    await database`
      INSERT INTO simulated_accounts (
        id, goal_id, user_id, plan_version_id, status, last_processed_date, last_accrual_date
      ) VALUES (
        ${accountId}, ${goal.id}, ${userId}, ${planId}, 'active', '2026-08-23', '2026-08-23'
      )
    `;
    await database`
      INSERT INTO ledger_entries (
        id, account_id, user_id, entry_type, principal_cents, effective_date, description
      ) VALUES (
        ${ledgerId}, ${accountId}, ${userId}, 'account_opened', 10000,
        '2026-08-23', 'Append-only test opening'
      )
    `;

    await expect(
      database`UPDATE ledger_entries SET description = 'Changed' WHERE id = ${ledgerId}`,
    ).rejects.toThrow('ledger entries are append-only');
    await expect(database`DELETE FROM ledger_entries WHERE id = ${ledgerId}`).rejects.toThrow(
      'ledger entries are append-only',
    );
    await repository.deleteGoal(userId, goal.id);
  });
});
