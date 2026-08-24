import { createHash, randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import { createDatabaseClient, type DatabaseClient } from '@goalpilot/data-access';
import { describe, expect, it } from 'vitest';

import { resolveDatabaseUrlForRuntime } from '../scripts/runtime-config.js';

const migrationsDirectory = path.resolve('packages/data-access/migrations');
const expectedMigrationFilenames = [
  '202608230001_local_mvp.sql',
  '202608230002_allow_ledger_cascade_purge.sql',
  '202608230003_financial_integrity.sql',
  '202608230004_relational_integrity.sql',
  '202608230005_ledger_semantic_integrity.sql',
  '202608230006_goal_drafts_and_plan_evolution.sql',
  '202608230007_controlled_clocks_fixtures_and_product_events.sql',
  '202608230008_purchase_timing_lab.sql',
  '202608230009_application_command_claims.sql',
  '202608230010_plan_calculation_context.sql',
  '202608230011_response_provenance.sql',
  '202608230012_purchase_timing_routine_events.sql',
  '202608230013_terminal_timing_provenance.sql',
  '202608230014_exact_timing_series.sql',
  '202608230015_reversal_aware_balances.sql',
  '202608230016_owner_financial_run_guard.sql',
  '202608230017_price_check_worker_lease.sql',
] as const;
const generatedDatabaseNamePattern = /^goalpilot_upgrade_[0-9]{13}_[0-9a-f]{12}$/;

interface MigrationFile {
  readonly filename: string;
  readonly source: string;
  readonly checksum: string;
}

interface ConfiguredDatabases {
  readonly adminUrl: string;
  readonly testUrl: string;
  readonly adminDatabase: string;
}

function normalizedLoopbackHost(hostname: string): string {
  return hostname.replace(/^\[|\]$/g, '').toLowerCase();
}

function databaseName(databaseUrl: URL): string {
  return decodeURIComponent(databaseUrl.pathname.slice(1));
}

function effectivePort(databaseUrl: URL): string {
  return databaseUrl.port || '5432';
}

function assertPostgresUrl(
  databaseUrl: URL,
  label: string,
  allowDevContainerHostBridge: boolean,
): void {
  if (!['postgres:', 'postgresql:'].includes(databaseUrl.protocol)) {
    throw new Error(`${label} must use the postgres or postgresql protocol.`);
  }
  const allowedHosts = ['localhost', '127.0.0.1', '::1'];
  if (allowDevContainerHostBridge) allowedHosts.push('host.docker.internal');
  if (!allowedHosts.includes(normalizedLoopbackHost(databaseUrl.hostname))) {
    throw new Error(`${label} must identify a loopback PostgreSQL server.`);
  }
  if (decodeURIComponent(databaseUrl.username).length === 0) {
    throw new Error(`${label} must include the configured local admin identity.`);
  }
}

function configuredDatabases(): ConfiguredDatabases {
  const requestedEnvironment = process.env['ENVIRONMENT'];
  const requestedNodeEnvironment = process.env['NODE_ENV'];
  if (existsSync('.env.local')) process.loadEnvFile('.env.local');

  if (requestedEnvironment !== 'test' || requestedNodeEnvironment !== 'test') {
    throw new Error(
      'The migration upgrade regression requires ENVIRONMENT=test and NODE_ENV=test.',
    );
  }

  const adminUrlValue = process.env['DATABASE_URL'];
  const testUrlValue = process.env['TEST_DATABASE_URL'];
  if (adminUrlValue === undefined || testUrlValue === undefined) {
    throw new Error('DATABASE_URL and TEST_DATABASE_URL are required for the upgrade regression.');
  }

  const allowDevContainerHostBridge = process.env['GOALPILOT_DEVCONTAINER'] === 'true';
  const adminUrl = new URL(
    resolveDatabaseUrlForRuntime(adminUrlValue, allowDevContainerHostBridge),
  );
  const testUrl = new URL(resolveDatabaseUrlForRuntime(testUrlValue, allowDevContainerHostBridge));
  assertPostgresUrl(adminUrl, 'DATABASE_URL', allowDevContainerHostBridge);
  assertPostgresUrl(testUrl, 'TEST_DATABASE_URL', allowDevContainerHostBridge);

  const adminDatabase = databaseName(adminUrl);
  const testDatabase = databaseName(testUrl);
  if (adminDatabase !== 'goalpilot_local' || testDatabase !== 'goalpilot_test') {
    throw new Error(
      `Refusing upgrade test for base databases "${adminDatabase}" and "${testDatabase}".`,
    );
  }
  if (
    normalizedLoopbackHost(adminUrl.hostname) !== normalizedLoopbackHost(testUrl.hostname) ||
    effectivePort(adminUrl) !== effectivePort(testUrl) ||
    decodeURIComponent(adminUrl.username) !== decodeURIComponent(testUrl.username) ||
    decodeURIComponent(adminUrl.password) !== decodeURIComponent(testUrl.password)
  ) {
    throw new Error('DATABASE_URL and TEST_DATABASE_URL must use the same local admin identity.');
  }
  if (adminUrl.toString() === testUrl.toString()) {
    throw new Error('The configured local and test databases must be distinct.');
  }

  return { adminUrl: adminUrl.toString(), testUrl: testUrl.toString(), adminDatabase };
}

function generatedDatabaseName(): string {
  const name = `goalpilot_upgrade_${String(Date.now())}_${randomBytes(6).toString('hex')}`;
  assertGeneratedDatabaseName(name);
  return name;
}

function assertGeneratedDatabaseName(name: string): void {
  if (!generatedDatabaseNamePattern.test(name)) {
    throw new Error(`Refusing destructive statement for invalid upgrade database name "${name}".`);
  }
}

function generatedDatabaseUrl(adminUrlValue: string, name: string): string {
  assertGeneratedDatabaseName(name);
  const databaseUrl = new URL(adminUrlValue);
  databaseUrl.pathname = `/${name}`;
  return databaseUrl.toString();
}

async function loadMigrations(): Promise<readonly MigrationFile[]> {
  const filenames = (await readdir(migrationsDirectory))
    .filter((filename) => filename.endsWith('.sql'))
    .sort();
  expect(filenames).toEqual(expectedMigrationFilenames);
  return Promise.all(
    filenames.map(async (filename) => {
      const source = await readFile(path.join(migrationsDirectory, filename), 'utf8');
      return {
        filename,
        source,
        checksum: createHash('sha256').update(source).digest('hex'),
      };
    }),
  );
}

async function initializeMigrationLedger(database: DatabaseClient): Promise<void> {
  await database`
    CREATE TABLE schema_migrations (
      filename text PRIMARY KEY,
      checksum char(64) NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `;
}

async function applyMigrations(
  database: DatabaseClient,
  migrations: readonly MigrationFile[],
): Promise<void> {
  for (const migration of migrations) {
    await database.begin(async (transaction) => {
      await transaction.unsafe(migration.source);
      await transaction`
        INSERT INTO schema_migrations (filename, checksum)
        VALUES (${migration.filename}, ${migration.checksum})
      `;
    });
  }
}

function fixtureId(sequence: number): string {
  const id = `01MIGRATIONUPGRADE${String(sequence).padStart(8, '0')}`;
  if (id.length !== 26) throw new Error('Migration fixture IDs must be exactly 26 characters.');
  return id;
}

const fixture = {
  userId: fixtureId(1),
  goalId: fixtureId(2),
  planId: fixtureId(3),
  accountId: fixtureId(4),
  ledgerId: fixtureId(5),
  draftId: fixtureId(6),
  eventId: fixtureId(7),
  purchaseItemId: fixtureId(8),
  policyId: fixtureId(9),
  priceRunId: fixtureId(10),
  observationId: fixtureId(11),
  assessmentId: fixtureId(12),
  claimToken: fixtureId(13),
  archiveAuditId: fixtureId(14),
  secondPolicyId: fixtureId(15),
  secondPriceRunId: fixtureId(16),
  secondObservationId: fixtureId(17),
  secondAssessmentId: fixtureId(18),
  agedObservationId: fixtureId(19),
  claimedPolicyId: fixtureId(20),
  claimedPriceRunId: fixtureId(21),
} as const;

async function seedPriorSchema(database: DatabaseClient): Promise<void> {
  await database.begin(async (transaction) => {
    await transaction`
      INSERT INTO application_clock (singleton, application_date)
      VALUES (true, '2026-08-23')
    `;
    await transaction`
      INSERT INTO users (id, email, display_name, password_hash)
      VALUES (${fixture.userId}, 'upgrade@example.test', 'Upgrade fixture', 'not-a-real-hash')
    `;
    await transaction`
      INSERT INTO vehicle_assumption_versions (
        version, effective_date, reviewed_date, source_type, is_live
      ) VALUES (
        'upgrade-catalog-v1', '2026-08-23', '2026-08-23',
        'reviewed_demo_assumption', false
      )
    `;
    await transaction`
      INSERT INTO vehicle_assumptions (
        version, vehicle_code, display_name, apy_basis_points, liquidity_days,
        lock_days, minimum_cents, source_label, enabled
      ) VALUES (
        'upgrade-catalog-v1', 'hysa', 'Upgrade fixture savings', 400, 0,
        0, 0, 'Deterministic upgrade fixture', true
      )
    `;
    await transaction`
      INSERT INTO goals (
        id, user_id, name, category, target_amount_cents, current_saved_cents,
        target_date, recurring_contribution_cents, contribution_cadence,
        liquidity_need, preservation_preference, confidence, status
      ) VALUES (
        ${fixture.goalId}, ${fixture.userId}, 'Prior schema goal', 'purchase', 100000,
        25000, '2027-08-23', 10000, 'monthly', 'anytime', 'required', 'expected', 'active'
      )
    `;
    await transaction`
      INSERT INTO plan_versions (
        id, goal_id, user_id, version, vehicle_code, assumption_version,
        normalized_input, calculation_output
      ) VALUES (
        ${fixture.planId}, ${fixture.goalId}, ${fixture.userId}, 1, 'hysa',
        'upgrade-catalog-v1',
        ${transaction.json({
          targetAmountCents: 100_000,
          currentSavedCents: 25_000,
          targetDate: '2027-08-23',
          recurringContributionCents: 10_000,
          contributionCadence: 'monthly',
          liquidityNeed: 'anytime',
          preservationPreference: 'required',
          confidence: 'expected',
        })},
        ${transaction.json({
          asOfDate: '2026-08-23',
          projectedFinalBalanceCents: 147_000,
        })}
      )
    `;
    await transaction`
      INSERT INTO simulated_accounts (
        id, goal_id, user_id, plan_version_id, status, next_contribution_date,
        last_processed_date, last_accrual_date, accrued_interest_micros
      ) VALUES (
        ${fixture.accountId}, ${fixture.goalId}, ${fixture.userId}, ${fixture.planId},
        'active', '2026-09-23', '2026-08-23', '2026-08-23', 750000
      )
    `;
    await transaction`
      INSERT INTO ledger_entries (
        id, account_id, user_id, entry_type, principal_cents, interest_cents,
        effective_date, occurrence_id, description
      ) VALUES (
        ${fixture.ledgerId}, ${fixture.accountId}, ${fixture.userId}, 'account_opened',
        25000, 0, '2026-08-23', 'opening:upgrade-fixture', 'Prior-schema opening balance'
      )
    `;
  });
}

async function exerciseNewTables(database: DatabaseClient): Promise<void> {
  const sourceChecksum = 'a'.repeat(64);
  await database`
    INSERT INTO goal_drafts (id, user_id, draft_data, last_completed_step)
    VALUES (
      ${fixture.draftId}, ${fixture.userId},
      ${database.json({ name: 'Upgrade draft' })}, 'goal'
    )
  `;
  await database`
    INSERT INTO demo_fixture_users (user_id, fixture_key, fixture_version)
    VALUES (${fixture.userId}, 'japan-trip', 'upgrade-fixture-v1')
  `;
  await database`
    INSERT INTO product_events (
      id, event_name, occurred_at, subject_kind, subject_hash, is_demo, application_version
    ) VALUES (
      ${fixture.eventId}, 'sample_goal_opened', '2026-08-23T12:00:00Z', 'user',
      ${'b'.repeat(64)}, true, 'product-experience-v1'
    )
  `;
  await database`
    INSERT INTO purchase_items (
      id, user_id, goal_id, fixture_code, display_name, currency, target_price_cents
    ) VALUES (
      ${fixture.purchaseItemId}, ${fixture.userId}, ${fixture.goalId},
      'synthetic_oled_65_v1', '65-inch OLED television', 'USD', 150000
    )
  `;
  await database`
    INSERT INTO price_watch_policies (
      id, purchase_item_id, user_id, version, cadence, next_due_date
    ) VALUES (
      ${fixture.policyId}, ${fixture.purchaseItemId}, ${fixture.userId}, 1,
      'weekly', '2026-08-23'
    )
  `;
  await database`
    INSERT INTO price_check_runs (
      id, price_watch_policy_id, purchase_item_id, user_id, application_date
    ) VALUES (
      ${fixture.priceRunId}, ${fixture.policyId}, ${fixture.purchaseItemId},
      ${fixture.userId}, '2026-08-23'
    )
  `;
  await database`
    UPDATE price_check_runs SET
      fixture_source_version = 'upgrade-prices-v1',
      fixture_source_checksum = ${sourceChecksum}
    WHERE id = ${fixture.priceRunId}
  `;
  await database`
    INSERT INTO price_observations (
      id, price_check_run_id, purchase_item_id, user_id, fixture_source_version,
      observed_on, price_cents, currency
    ) VALUES
      (
        ${fixture.agedObservationId}, ${fixture.priceRunId}, ${fixture.purchaseItemId},
        ${fixture.userId}, 'upgrade-prices-v1', '2024-08-23', 150000, 'USD'
      ),
      (
        ${fixture.observationId}, ${fixture.priceRunId}, ${fixture.purchaseItemId},
        ${fixture.userId}, 'upgrade-prices-v1', '2026-08-23', 140000, 'USD'
      )
  `;
  await database`
    INSERT INTO purchase_timing_assessments (
      id, price_check_run_id, purchase_item_id, goal_id, user_id,
      price_watch_policy_version, plan_version_id, plan_version_number,
      plan_lifecycle, plan_health, fixture_source_version, fixture_source_checksum,
      as_of_date, currency, assessment_state, rationale_codes,
      observation_count, earliest_observation_date, latest_observation_date,
      data_span_days, freshness_days, current_price_cents, target_price_cents,
      minimum_price_cents, median_price_cents, maximum_price_cents,
      current_percentile_basis_points, difference_from_median_cents,
      difference_from_target_cents
    ) VALUES (
      ${fixture.assessmentId}, ${fixture.priceRunId}, ${fixture.purchaseItemId},
      ${fixture.goalId}, ${fixture.userId}, 1, ${fixture.planId}, 1, 'active', 'ON_TRACK',
      'upgrade-prices-v1', ${sourceChecksum}, '2026-08-23', 'USD', 'INSUFFICIENT_DATA',
      ARRAY['INSUFFICIENT_OBSERVATION_COUNT'], 2, '2024-08-23', '2026-08-23', 730, 0,
      140000, 150000, 140000, 145000, 150000, 5000, -5000, -10000
    )
  `;
  await database`
    UPDATE price_check_runs SET status = 'completed', completed_at = now()
    WHERE id = ${fixture.priceRunId}
  `;
  await database`
    INSERT INTO price_watch_policies (
      id, purchase_item_id, user_id, version, cadence, next_due_date
    ) VALUES (
      ${fixture.secondPolicyId}, ${fixture.purchaseItemId}, ${fixture.userId}, 2,
      'weekly', '2026-08-24'
    )
  `;
  await database`
    INSERT INTO price_check_runs (
      id, price_watch_policy_id, purchase_item_id, user_id, application_date
    ) VALUES (
      ${fixture.secondPriceRunId}, ${fixture.secondPolicyId}, ${fixture.purchaseItemId},
      ${fixture.userId}, '2026-08-24'
    )
  `;
  await database`
    UPDATE price_check_runs SET
      fixture_source_version = 'upgrade-prices-v1',
      fixture_source_checksum = ${sourceChecksum}
    WHERE id = ${fixture.secondPriceRunId}
  `;
  await database`
    INSERT INTO price_observations (
      id, price_check_run_id, purchase_item_id, user_id, fixture_source_version,
      observed_on, price_cents, currency
    ) VALUES (
      ${fixture.secondObservationId}, ${fixture.secondPriceRunId}, ${fixture.purchaseItemId},
      ${fixture.userId}, 'upgrade-prices-v1', '2026-08-24', 139000, 'USD'
    )
  `;
  await database`
    INSERT INTO purchase_timing_assessments (
      id, price_check_run_id, purchase_item_id, goal_id, user_id,
      price_watch_policy_version, plan_version_id, plan_version_number,
      plan_lifecycle, plan_health, fixture_source_version, fixture_source_checksum,
      as_of_date, currency, assessment_state, rationale_codes,
      observation_count, earliest_observation_date, latest_observation_date,
      data_span_days, freshness_days, current_price_cents, target_price_cents,
      minimum_price_cents, median_price_cents, maximum_price_cents,
      current_percentile_basis_points, difference_from_median_cents,
      difference_from_target_cents
    ) VALUES (
      ${fixture.secondAssessmentId}, ${fixture.secondPriceRunId}, ${fixture.purchaseItemId},
      ${fixture.goalId}, ${fixture.userId}, 2, ${fixture.planId}, 1, 'active', 'ON_TRACK',
      'upgrade-prices-v1', ${sourceChecksum}, '2026-08-24', 'USD', 'INSUFFICIENT_DATA',
      ARRAY['INSUFFICIENT_OBSERVATION_COUNT'], 2, '2026-08-23', '2026-08-24', 1, 0,
      139000, 150000, 139000, 139500, 140000, 5000, -500, -11000
    )
  `;
  await database`
    UPDATE price_check_runs SET status = 'completed', completed_at = now()
    WHERE id = ${fixture.secondPriceRunId}
  `;
  await database`
    INSERT INTO price_watch_policies (
      id, purchase_item_id, user_id, version, cadence, next_due_date, enabled
    ) VALUES (
      ${fixture.claimedPolicyId}, ${fixture.purchaseItemId}, ${fixture.userId}, 3,
      'weekly', '2026-08-31', false
    )
  `;
  await database`
    INSERT INTO price_check_runs (
      id, price_watch_policy_id, purchase_item_id, user_id, application_date
    ) VALUES (
      ${fixture.claimedPriceRunId}, ${fixture.claimedPolicyId}, ${fixture.purchaseItemId},
      ${fixture.userId}, '2026-08-31'
    )
  `;
  await database`
    INSERT INTO application_command_claims (
      user_id, operation, key, request_hash, state, claim_token, lease_expires_at
    ) VALUES (
      ${fixture.userId}, 'upgrade.regression', 'upgrade-regression-key', ${'c'.repeat(64)},
      'claimed', ${fixture.claimToken}, now() + interval '5 minutes'
    )
  `;
}

async function prepareResponseProvenanceBackfill(database: DatabaseClient): Promise<void> {
  await database`
    INSERT INTO audit_events (
      id, user_id, event_name, resource_id, metadata, created_at
    ) VALUES (
      ${fixture.archiveAuditId}, ${fixture.userId}, 'goal.archived', ${fixture.goalId},
      ${database.json({ reasonCode: 'USER_REQUESTED' })}, '2026-08-24T12:00:00Z'
    )
  `;
  await database`
    UPDATE goals SET status = 'archived', updated_at = '2026-08-24T12:00:00Z'
    WHERE id = ${fixture.goalId} AND user_id = ${fixture.userId}
  `;
}

async function closeAndDropGeneratedDatabase(input: {
  readonly admin: DatabaseClient;
  readonly database: DatabaseClient | undefined;
  readonly created: boolean;
  readonly name: string;
  readonly expectedAdminDatabase: string;
}): Promise<void> {
  const cleanupFailures: unknown[] = [];
  if (input.database !== undefined) {
    try {
      await input.database.end();
    } catch (error) {
      cleanupFailures.push(error);
    }
  }

  if (input.created) {
    try {
      assertGeneratedDatabaseName(input.name);
      const identity = await input.admin<{ database_name: string }[]>`
        SELECT current_database() AS database_name
      `;
      if (identity[0]?.database_name !== input.expectedAdminDatabase) {
        throw new Error('Refusing DROP DATABASE after the admin base database changed.');
      }
      await input.admin.unsafe(`DROP DATABASE "${input.name}"`);
    } catch (error) {
      cleanupFailures.push(error);
    }
  }

  try {
    await input.admin.end();
  } catch (error) {
    cleanupFailures.push(error);
  }
  if (cleanupFailures.length > 0) {
    throw new AggregateError(cleanupFailures, 'Failed to fully clean up the upgrade database.');
  }
}

describe('prior-schema PostgreSQL upgrade', () => {
  it('upgrades a coherent 005 database through 017 without losing history', async () => {
    const configured = configuredDatabases();
    const migrations = await loadMigrations();
    const name = generatedDatabaseName();
    const admin = createDatabaseClient(configured.adminUrl, 1);
    let database: DatabaseClient | undefined;
    let created = false;

    try {
      const adminIdentity = await admin<{ database_name: string; user_name: string }[]>`
        SELECT current_database() AS database_name, current_user AS user_name
      `;
      const configuredAdmin = new URL(configured.adminUrl);
      expect(adminIdentity[0]).toEqual({
        database_name: configured.adminDatabase,
        user_name: decodeURIComponent(configuredAdmin.username),
      });

      assertGeneratedDatabaseName(name);
      const existing = await admin<{ exists: boolean }[]>`
        SELECT EXISTS(SELECT 1 FROM pg_database WHERE datname = ${name}) AS exists
      `;
      if (existing[0]?.exists !== false) {
        throw new Error(`Refusing to reuse existing generated database "${name}".`);
      }
      await admin.unsafe(`CREATE DATABASE "${name}" TEMPLATE template0`);
      created = true;

      database = createDatabaseClient(generatedDatabaseUrl(configured.adminUrl, name), 1);
      const targetIdentity = await database<{ database_name: string }[]>`
        SELECT current_database() AS database_name
      `;
      expect(targetIdentity[0]?.database_name).toBe(name);

      await initializeMigrationLedger(database);
      await applyMigrations(database, migrations.slice(0, 5));
      await seedPriorSchema(database);

      const priorState = await database<
        { ledger_count: string; newer_table_count: string; migration_count: string }[]
      >`
        SELECT
          (SELECT count(*) FROM ledger_entries WHERE id = ${fixture.ledgerId}) AS ledger_count,
          (SELECT count(*) FROM information_schema.tables
            WHERE table_schema = 'public' AND table_name IN (
              'goal_drafts', 'user_application_clocks', 'purchase_items'
            )) AS newer_table_count,
          (SELECT count(*) FROM schema_migrations) AS migration_count
      `;
      expect(priorState[0]).toEqual({
        ledger_count: '1',
        newer_table_count: '0',
        migration_count: '5',
      });

      await applyMigrations(database, migrations.slice(5, 10));
      await exerciseNewTables(database);
      await prepareResponseProvenanceBackfill(database);
      await applyMigrations(database, migrations.slice(10));

      const preservedIdentity = await database<
        {
          user_id: string;
          goal_id: string;
          plan_id: string;
          account_id: string;
          ledger_id: string;
          entry_type: string;
          principal_cents: string;
          interest_cents: string;
          effective_date: string;
          occurrence_id: string;
        }[]
      >`
        SELECT
          users.id AS user_id,
          goals.id AS goal_id,
          plan_versions.id AS plan_id,
          simulated_accounts.id AS account_id,
          ledger_entries.id AS ledger_id,
          ledger_entries.entry_type,
          ledger_entries.principal_cents::text,
          ledger_entries.interest_cents::text,
          ledger_entries.effective_date::text,
          ledger_entries.occurrence_id
        FROM users
        JOIN goals ON goals.user_id = users.id
        JOIN plan_versions ON plan_versions.goal_id = goals.id
          AND plan_versions.user_id = users.id
        JOIN simulated_accounts ON simulated_accounts.plan_version_id = plan_versions.id
          AND simulated_accounts.goal_id = goals.id
          AND simulated_accounts.user_id = users.id
        JOIN ledger_entries ON ledger_entries.account_id = simulated_accounts.id
          AND ledger_entries.user_id = users.id
        WHERE users.id = ${fixture.userId}
      `;
      expect(preservedIdentity).toEqual([
        {
          user_id: fixture.userId,
          goal_id: fixture.goalId,
          plan_id: fixture.planId,
          account_id: fixture.accountId,
          ledger_id: fixture.ledgerId,
          entry_type: 'account_opened',
          principal_cents: '25000',
          interest_cents: '0',
          effective_date: '2026-08-23',
          occurrence_id: 'opening:upgrade-fixture',
        },
      ]);

      const backfills = await database<
        {
          initial_application_date: string;
          owner_application_date: string;
          clock_version: number;
          plan_application_date: string;
          schedule_anchor_date: string;
          calculation_policy_version: string;
          ranking_policy_version: string;
          health_policy_version: string;
          change_kind: string;
          changed_field: string | null;
          change_reason_code: string;
          change_payload: unknown;
          omitted_date_count: number;
          base_plan_version_id: string | null;
          context_version: string;
          personal_principal_cents: string;
          total_ledger_value_cents: string;
          available_funds_cents: string;
          accrued_interest_micros: string;
          context_application_date: string;
          context_schedule_anchor_date: string;
          context_omitted_dates: unknown;
          context_fixed_term_lots: unknown;
        }[]
      >`
        SELECT
          clock.initial_application_date::text,
          clock.application_date::text AS owner_application_date,
          clock.version AS clock_version,
          plan.application_date::text AS plan_application_date,
          plan.schedule_anchor_date::text,
          plan.calculation_policy_version,
          plan.ranking_policy_version,
          plan.health_policy_version,
          plan.change_kind,
          plan.changed_field,
          plan.change_reason_code,
          plan.change_payload,
          cardinality(plan.omitted_contribution_dates) AS omitted_date_count,
          plan.base_plan_version_id,
          plan.calculation_context->>'contextVersion' AS context_version,
          plan.calculation_context->>'personalPrincipalCents' AS personal_principal_cents,
          plan.calculation_context->>'totalLedgerValueCents' AS total_ledger_value_cents,
          plan.calculation_context->>'currentAvailableFundsCents' AS available_funds_cents,
          plan.calculation_context->>'currentAccruedInterestMicros' AS accrued_interest_micros,
          plan.calculation_context->>'applicationDate' AS context_application_date,
          plan.calculation_context->>'scheduleAnchorDate' AS context_schedule_anchor_date,
          plan.calculation_context->'omittedContributionDates' AS context_omitted_dates,
          plan.calculation_context->'fixedTermLots' AS context_fixed_term_lots
        FROM plan_versions plan
        JOIN user_application_clocks clock ON clock.user_id = plan.user_id
        WHERE plan.id = ${fixture.planId}
      `;
      expect(backfills).toEqual([
        {
          initial_application_date: '2026-08-23',
          owner_application_date: '2026-08-23',
          clock_version: 1,
          plan_application_date: '2026-08-23',
          schedule_anchor_date: '2026-08-23',
          calculation_policy_version: 'legacy-calculation-v1',
          ranking_policy_version: 'vehicle-fit-v1',
          health_policy_version: 'legacy-account-status-v1',
          change_kind: 'initial_activation',
          changed_field: null,
          change_reason_code: 'INITIAL_ACTIVATION',
          change_payload: null,
          omitted_date_count: 0,
          base_plan_version_id: null,
          context_version: 'plan-calculation-context-v1',
          personal_principal_cents: '25000',
          total_ledger_value_cents: '25000',
          available_funds_cents: '25000',
          accrued_interest_micros: '750000',
          context_application_date: '2026-08-23',
          context_schedule_anchor_date: '2026-08-23',
          context_omitted_dates: [],
          context_fixed_term_lots: [],
        },
      ]);

      const workerLeaseBackfill = await database<
        {
          run_id: string;
          status: string;
          worker_claim_token: string | null;
          exact_ten_minute_lease: boolean;
          terminal_worker_token: string | null;
          terminal_worker_lease: string | null;
        }[]
      >`
        SELECT claimed.id AS run_id,
               claimed.status,
               claimed.worker_claim_token,
               claimed.worker_lease_expires_at = claimed.claimed_at + interval '10 minutes'
                 AS exact_ten_minute_lease,
               terminal.worker_claim_token AS terminal_worker_token,
               terminal.worker_lease_expires_at::text AS terminal_worker_lease
        FROM price_check_runs claimed
        JOIN price_check_runs terminal ON terminal.id = ${fixture.priceRunId}
        WHERE claimed.id = ${fixture.claimedPriceRunId}
      `;
      expect(workerLeaseBackfill).toHaveLength(1);
      expect(workerLeaseBackfill[0]).toMatchObject({
        run_id: fixture.claimedPriceRunId,
        status: 'claimed',
        exact_ten_minute_lease: true,
        terminal_worker_token: null,
        terminal_worker_lease: null,
      });
      expect(workerLeaseBackfill[0]?.worker_claim_token).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);

      const appliedMigrations = await database<{ filename: string; checksum: string }[]>`
        SELECT filename, checksum FROM schema_migrations ORDER BY filename
      `;
      expect(appliedMigrations).toEqual(
        migrations.map(({ filename, checksum }) => ({ filename, checksum })),
      );
      const migrationsAfterUpgrade = await loadMigrations();
      expect(
        migrationsAfterUpgrade.map(({ filename, checksum }) => ({ filename, checksum })),
      ).toEqual(migrations.map(({ filename, checksum }) => ({ filename, checksum })));

      const responseProvenance = await database<
        {
          status: string;
          archive_reason: string;
          archived_at: string;
          observation_key: string;
        }[]
      >`
        SELECT
          goal.status,
          goal.archive_reason,
          to_char(
            goal.archived_at AT TIME ZONE 'UTC',
            'YYYY-MM-DD"T"HH24:MI:SS"Z"'
          ) AS archived_at,
          observation.observation_key
        FROM goals goal
        JOIN purchase_items item ON item.goal_id = goal.id AND item.user_id = goal.user_id
        JOIN price_observations observation
          ON observation.purchase_item_id = item.id AND observation.user_id = item.user_id
        WHERE goal.id = ${fixture.goalId} AND observation.id = ${fixture.observationId}
      `;
      expect(responseProvenance).toEqual([
        {
          status: 'archived',
          archive_reason: 'USER_REQUESTED',
          archived_at: '2026-08-24T12:00:00Z',
          observation_key: 'stored-2026-08-23',
        },
      ]);

      const restoredSeriesMembership = await database<
        { readonly run_id: string; readonly observation_count: string }[]
      >`
        SELECT price_check_run_id AS run_id, COUNT(*)::text AS observation_count
        FROM price_observations
        WHERE price_check_run_id IN (${fixture.priceRunId}, ${fixture.secondPriceRunId})
        GROUP BY price_check_run_id
        ORDER BY price_check_run_id
      `;
      expect(restoredSeriesMembership).toEqual(
        [
          { run_id: fixture.priceRunId, observation_count: '2' },
          { run_id: fixture.secondPriceRunId, observation_count: '2' },
        ].sort((left, right) => left.run_id.localeCompare(right.run_id)),
      );

      const usableTables = await database<
        {
          draft: boolean;
          owner_clock: boolean;
          fixture_capability: boolean;
          product_event: boolean;
          purchase_item: boolean;
          watch_policy: boolean;
          completed_run: boolean;
          observation: boolean;
          assessment: boolean;
          command_claim: boolean;
        }[]
      >`
        SELECT
          EXISTS(SELECT 1 FROM goal_drafts WHERE id = ${fixture.draftId}) AS draft,
          EXISTS(SELECT 1 FROM user_application_clocks
            WHERE user_id = ${fixture.userId}) AS owner_clock,
          EXISTS(SELECT 1 FROM demo_fixture_users
            WHERE user_id = ${fixture.userId}) AS fixture_capability,
          EXISTS(SELECT 1 FROM product_events WHERE id = ${fixture.eventId}) AS product_event,
          EXISTS(SELECT 1 FROM purchase_items
            WHERE id = ${fixture.purchaseItemId}) AS purchase_item,
          EXISTS(SELECT 1 FROM price_watch_policies
            WHERE id = ${fixture.policyId}) AS watch_policy,
          EXISTS(SELECT 1 FROM price_check_runs
            WHERE id = ${fixture.priceRunId} AND status = 'completed') AS completed_run,
          EXISTS(SELECT 1 FROM price_observations
            WHERE id = ${fixture.observationId}) AS observation,
          EXISTS(SELECT 1 FROM purchase_timing_assessments
            WHERE id = ${fixture.assessmentId}) AS assessment,
          EXISTS(SELECT 1 FROM application_command_claims
            WHERE user_id = ${fixture.userId}
              AND operation = 'upgrade.regression') AS command_claim
      `;
      expect(usableTables).toEqual([
        {
          draft: true,
          owner_clock: true,
          fixture_capability: true,
          product_event: true,
          purchase_item: true,
          watch_policy: true,
          completed_run: true,
          observation: true,
          assessment: true,
          command_claim: true,
        },
      ]);
    } finally {
      await closeAndDropGeneratedDatabase({
        admin,
        database,
        created,
        name,
        expectedAdminDatabase: configured.adminDatabase,
      });
    }
  }, 60_000);
});
