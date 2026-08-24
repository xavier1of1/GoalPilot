import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ulid } from 'ulid';

import {
  createDatabaseClient,
  GoalPilotRepository,
  PlanExperienceRepository,
  ProductExperienceRepository,
  PurchaseTimingRepository,
  type DatabaseClient,
} from './index.js';

function databaseUrl(): string {
  process.loadEnvFile('.env.local');
  const value = process.env['TEST_DATABASE_URL'];
  if (value === undefined) throw new Error('TEST_DATABASE_URL is required for integration tests.');
  return value;
}

describe('PostgreSQL migration and ownership constraints', () => {
  let database: DatabaseClient;
  let repository: GoalPilotRepository;
  let planRepository: PlanExperienceRepository;
  let timingRepository: PurchaseTimingRepository;
  let experienceRepository: ProductExperienceRepository;

  beforeAll(() => {
    database = createDatabaseClient(databaseUrl(), 2);
    repository = new GoalPilotRepository(database);
    planRepository = new PlanExperienceRepository(database);
    timingRepository = new PurchaseTimingRepository(database);
    experienceRepository = new ProductExperienceRepository(database);
  });

  afterAll(async () => database.end());

  const createTimingFixture = async (options: { readonly expiredWorkerLease?: boolean } = {}) => {
    const userId = '01K3C8ALEX0000000000000000';
    const goal = await repository.createGoal(userId, {
      name: 'Purchase timing database fixture',
      targetAmountCents: 200_000,
      currentSavedCents: 50_000,
      targetDate: '2027-08-23',
      recurringContributionCents: 15_000,
      contributionCadence: 'monthly',
      liquidityNeed: 'goal_date',
      preservationPreference: 'required',
      confidence: 'expected',
    });
    const planId = ulid();
    const itemId = ulid();
    const policyId = ulid();
    const runId = ulid();
    const workerClaimToken = ulid();
    const sourceVersion = 'synthetic-prices-v1';
    const sourceChecksum = 'a'.repeat(64);
    await database`
      INSERT INTO plan_versions (
        id, goal_id, user_id, version, vehicle_code, assumption_version,
        normalized_input, calculation_output
      ) VALUES (
        ${planId}, ${goal.id}, ${userId}, 1, 'cash', 'demo-2026-08-v1',
        '{}'::jsonb, '{"asOfDate":"2026-08-23"}'::jsonb
      )
    `;
    await database`
      INSERT INTO purchase_items (
        id, user_id, goal_id, fixture_code, display_name, currency, target_price_cents
      ) VALUES (
        ${itemId}, ${userId}, ${goal.id}, 'synthetic_oled_65_v1',
        '65-inch OLED television', 'USD', 150000
      )
    `;
    await database`
      INSERT INTO price_watch_policies (
        id, purchase_item_id, user_id, version, cadence, next_due_date
      ) VALUES (${policyId}, ${itemId}, ${userId}, 1, 'weekly', '2026-08-23')
    `;
    await database`
      INSERT INTO price_check_runs (
        id, price_watch_policy_id, purchase_item_id, user_id, application_date,
        fixture_source_version, fixture_source_checksum,
        worker_claim_token, worker_lease_expires_at
      ) VALUES (
        ${runId}, ${policyId}, ${itemId}, ${userId}, '2026-08-23',
        ${sourceVersion}, ${sourceChecksum}, ${workerClaimToken},
        CASE WHEN ${options.expiredWorkerLease ?? false}
          THEN now() - interval '1 minute'
          ELSE now() + interval '10 minutes' END
      )
    `;
    return {
      goal,
      userId,
      planId,
      itemId,
      policyId,
      runId,
      workerClaimToken,
      sourceVersion,
      sourceChecksum,
    };
  };

  it('reclaims an expired price-check worker and fences the superseded token', async () => {
    const fixture = await createTimingFixture({ expiredWorkerLease: true });

    const reclaimed = await timingRepository.claimPriceCheck({
      userId: fixture.userId,
      itemId: fixture.itemId,
      policyId: fixture.policyId,
      applicationDate: '2026-08-23',
    });
    expect(reclaimed).toMatchObject({ status: 'claimed', replayed: false });
    expect(reclaimed.claimToken).not.toBe(fixture.workerClaimToken);
    if (reclaimed.claimToken === null) throw new Error('Expected a replacement worker token.');

    await expect(
      timingRepository.failPriceCheck({
        userId: fixture.userId,
        runId: fixture.runId,
        claimToken: fixture.workerClaimToken,
        errorCode: 'PROVIDER_FAILURE',
      }),
    ).resolves.toBe(false);
    await expect(
      timingRepository.failPriceCheck({
        userId: fixture.userId,
        runId: fixture.runId,
        claimToken: reclaimed.claimToken,
        errorCode: 'PROVIDER_FAILURE',
      }),
    ).resolves.toBe(true);

    const run = await database<
      {
        status: string;
        attempt_count: number;
        worker_claim_token: string | null;
        worker_lease_expires_at: Date | null;
      }[]
    >`
      SELECT status, attempt_count, worker_claim_token, worker_lease_expires_at
      FROM price_check_runs WHERE id = ${fixture.runId}
    `;
    expect(run).toEqual([
      {
        status: 'failed',
        attempt_count: 2,
        worker_claim_token: null,
        worker_lease_expires_at: null,
      },
    ]);
    await repository.deleteGoal(fixture.userId, fixture.goal.id);
  });

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
    ]);
    expect(tables.map((row) => row.table_name)).toEqual(
      expect.arrayContaining([
        'users',
        'goals',
        'simulated_accounts',
        'ledger_entries',
        'schedule_occurrences',
        'application_clock',
        'goal_drafts',
        'user_application_clocks',
        'demo_fixture_users',
        'product_events',
        'purchase_items',
        'price_watch_policies',
        'price_check_runs',
        'price_observations',
        'purchase_timing_assessments',
        'application_command_claims',
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

  it('coordinates long-running idempotent commands without retaining the only pool connection', async () => {
    const singleConnection = createDatabaseClient(databaseUrl(), 1);
    const experienceRepository = new ProductExperienceRepository(singleConnection);
    const userId = '01K3C8ALEX0000000000000000';
    const idempotencyKey = `claim-${ulid()}`;
    const expiredKey = `expired-${ulid()}`;
    const retryableKey = `retryable-${ulid()}`;
    const requestHash = 'b'.repeat(64);
    try {
      const first = await experienceRepository.claimIdempotentRequest<{ accepted: boolean }>({
        userId,
        operation: 'integration.long-command',
        idempotencyKey,
        requestHash,
      });
      expect(first.kind).toBe('claimed');
      if (first.kind !== 'claimed') throw new Error('Expected a new command claim.');

      const work = await singleConnection<{ alive: boolean }[]>`SELECT true AS alive`;
      expect(work[0]?.alive).toBe(true);
      await expect(
        experienceRepository.claimIdempotentRequest({
          userId,
          operation: 'integration.long-command',
          idempotencyKey,
          requestHash,
        }),
      ).rejects.toThrow('still processing');

      await experienceRepository.completeIdempotentRequest({
        userId,
        operation: 'integration.long-command',
        idempotencyKey,
        requestHash,
        claimToken: first.claimToken,
        responseStatus: 202,
        value: { accepted: true },
      });
      const replay = await experienceRepository.claimIdempotentRequest<{ accepted: boolean }>({
        userId,
        operation: 'integration.long-command',
        idempotencyKey,
        requestHash,
      });
      expect(replay).toEqual({
        kind: 'replay',
        responseStatus: 202,
        value: { accepted: true },
      });
      await expect(
        experienceRepository.getIdempotentResponse({
          userId,
          operation: 'integration.long-command',
          idempotencyKey,
          requestHash: 'c'.repeat(64),
        }),
      ).rejects.toThrow(/idempotency key/i);

      const expired = await experienceRepository.claimIdempotentRequest({
        userId,
        operation: 'integration.long-command',
        idempotencyKey: expiredKey,
        requestHash,
        leaseSeconds: 5,
      });
      expect(expired.kind).toBe('claimed');
      await singleConnection`
        UPDATE application_command_claims SET lease_expires_at = now() - INTERVAL '1 second'
        WHERE user_id = ${userId} AND operation = 'integration.long-command'
          AND key = ${expiredKey}
      `;
      await expect(
        experienceRepository.claimIdempotentRequest({
          userId,
          operation: 'integration.long-command',
          idempotencyKey: expiredKey,
          requestHash,
        }),
      ).rejects.toThrow('indeterminate result');
      await expect(
        experienceRepository.claimIdempotentRequest({
          userId,
          operation: 'integration.long-command',
          idempotencyKey: expiredKey,
          requestHash: 'd'.repeat(64),
        }),
      ).rejects.toThrow(/idempotency key/i);

      const safeToRetry = await experienceRepository.claimIdempotentRequest({
        userId,
        operation: 'integration.long-command',
        idempotencyKey: retryableKey,
        requestHash,
      });
      expect(safeToRetry.kind).toBe('claimed');
      if (safeToRetry.kind !== 'claimed') throw new Error('Expected a retryable command claim.');
      await experienceRepository.abandonIdempotentRequest({
        userId,
        operation: 'integration.long-command',
        idempotencyKey: retryableKey,
        requestHash,
        claimToken: safeToRetry.claimToken,
      });
      const reclaimed = await experienceRepository.claimIdempotentRequest({
        userId,
        operation: 'integration.long-command',
        idempotencyKey: retryableKey,
        requestHash,
      });
      expect(reclaimed).toMatchObject({ kind: 'claimed' });
      if (reclaimed.kind !== 'claimed') throw new Error('Expected the explicit retryable claim.');
      expect(reclaimed.claimToken).not.toBe(safeToRetry.claimToken);
    } finally {
      await singleConnection`
        DELETE FROM idempotency_records
        WHERE user_id = ${userId} AND operation = 'integration.long-command'
          AND key IN (${idempotencyKey}, ${expiredKey}, ${retryableKey})
      `;
      await singleConnection`
        DELETE FROM application_command_claims
        WHERE user_id = ${userId} AND operation = 'integration.long-command'
          AND key IN (${idempotencyKey}, ${expiredKey}, ${retryableKey})
      `;
      await singleConnection.end();
    }
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

  it('binds accounts to a plan for the same goal', async () => {
    const userId = '01K3C8ALEX0000000000000000';
    const first = await repository.createGoal(userId, {
      name: 'Plan relationship fixture one',
      targetAmountCents: 100_000,
      currentSavedCents: 10_000,
      targetDate: '2027-08-23',
      recurringContributionCents: 10_000,
      contributionCadence: 'monthly',
      liquidityNeed: 'anytime',
      preservationPreference: 'required',
      confidence: 'expected',
    });
    const second = await repository.createGoal(userId, {
      name: 'Plan relationship fixture two',
      targetAmountCents: 120_000,
      currentSavedCents: 10_000,
      targetDate: '2027-08-23',
      recurringContributionCents: 10_000,
      contributionCadence: 'monthly',
      liquidityNeed: 'anytime',
      preservationPreference: 'required',
      confidence: 'expected',
    });
    const planId = ulid();
    await database`
      INSERT INTO plan_versions (
        id, goal_id, user_id, version, vehicle_code, assumption_version,
        normalized_input, calculation_output
      ) VALUES (
        ${planId}, ${first.id}, ${userId}, 1, 'cash', 'demo-2026-08-v1',
        '{}'::jsonb, '{}'::jsonb
      )
    `;
    await expect(
      database`
        INSERT INTO simulated_accounts (
          id, goal_id, user_id, plan_version_id, status, last_processed_date, last_accrual_date
        ) VALUES (
          ${ulid()}, ${second.id}, ${userId}, ${planId}, 'active', '2026-08-23', '2026-08-23'
        )
      `,
    ).rejects.toMatchObject({ code: '23503' });
    await repository.deleteGoal(userId, first.id);
    await repository.deleteGoal(userId, second.id);
  });

  it('binds a plan assumption version to the selected vehicle', async () => {
    const userId = '01K3C8ALEX0000000000000000';
    const goal = await repository.createGoal(userId, {
      name: 'Assumption relationship fixture',
      targetAmountCents: 100_000,
      currentSavedCents: 10_000,
      targetDate: '2027-08-23',
      recurringContributionCents: 10_000,
      contributionCadence: 'monthly',
      liquidityNeed: 'anytime',
      preservationPreference: 'required',
      confidence: 'expected',
    });
    await database`
      INSERT INTO vehicle_assumption_versions (
        version, effective_date, reviewed_date, source_type, is_live
      ) VALUES (
        'test-cash-only-v1', '2026-08-01', '2026-08-23',
        'reviewed_demo_assumption', false
      ) ON CONFLICT DO NOTHING
    `;
    await database`
      INSERT INTO vehicle_assumptions (
        version, vehicle_code, display_name, apy_basis_points, liquidity_days,
        lock_days, minimum_cents, source_label, enabled
      ) VALUES (
        'test-cash-only-v1', 'cash', 'Test cash only', 0, 0, 0, 0, 'Test fixture', true
      ) ON CONFLICT DO NOTHING
    `;
    await expect(
      database`
        INSERT INTO plan_versions (
          id, goal_id, user_id, version, vehicle_code, assumption_version,
          normalized_input, calculation_output
        ) VALUES (
          ${ulid()}, ${goal.id}, ${userId}, 1, 'hysa', 'test-cash-only-v1',
          '{}'::jsonb, '{}'::jsonb
        )
      `,
    ).rejects.toMatchObject({ code: '23503' });
    await repository.deleteGoal(userId, goal.id);
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

  it('binds reversals and posting periods to their own account', async () => {
    const userId = '01K3C8ALEX0000000000000000';
    const createAccount = async (
      name: string,
      version: number,
      vehicleCode: 'cash' | 'hysa' | 'cd_ladder' = 'cash',
    ) => {
      const goal = await repository.createGoal(userId, {
        name,
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
          ${planId}, ${goal.id}, ${userId}, ${version}, ${vehicleCode}, 'demo-2026-08-v1',
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
          '2026-08-23', 'Relational integrity opening'
        )
      `;
      return { goal, accountId, ledgerId };
    };
    const first = await createAccount('Ledger relationship fixture one', 1, 'cd_ladder');
    const second = await createAccount('Ledger relationship fixture two', 1, 'hysa');
    const correctedCompounding = await createAccount(
      'Ledger corrected compounding fixture',
      1,
      'cd_ladder',
    );
    const terminalRecovery = await createAccount('Owner-wide terminal recovery fixture', 1, 'cash');
    await database`
      INSERT INTO ledger_entries (
        id, account_id, user_id, entry_type, effective_date, description
      ) VALUES (
        ${ulid()}, ${terminalRecovery.accountId}, ${userId}, 'interest_accrued',
        '2026-08-26', 'Committed owner day before terminal transition'
      )
    `;
    await database`
      UPDATE simulated_accounts SET status = 'completed', updated_at = now()
      WHERE id = ${terminalRecovery.accountId} AND user_id = ${userId}
    `;
    await database`
      UPDATE goals SET status = 'completed', version = version + 1, updated_at = now()
      WHERE id = ${terminalRecovery.goal.id} AND user_id = ${userId}
    `;
    const firstActiveAccount = (await repository.listActiveAccounts(userId)).find(
      (account) => account.accountId === first.accountId,
    );
    if (firstActiveAccount === undefined) throw new Error('Reversal fixture account is missing.');
    const staleHysaAccount = (await repository.listActiveAccounts(userId)).find(
      (account) => account.accountId === second.accountId,
    );
    if (staleHysaAccount === undefined) throw new Error('The HYSA CAS fixture is missing.');
    await database`
      INSERT INTO ledger_entries (
        id, account_id, user_id, entry_type, principal_cents, effective_date,
        occurrence_id, description
      ) VALUES (
        ${ulid()}, ${second.accountId}, ${userId}, 'contribution_posted', 5000,
        '2026-08-25', ${`future-state:${ulid()}`}, 'Crash-recovery future entry fixture'
      )
    `;
    await database`
      INSERT INTO ledger_entries (
        id, account_id, user_id, entry_type, principal_cents, effective_date,
        occurrence_id, description
      ) VALUES (
        ${ulid()}, ${second.accountId}, ${userId}, 'contribution_posted', 1000,
        '2026-08-24', ${`cas-state:${ulid()}`}, 'Concurrent accrual CAS entry fixture'
      )
    `;
    await expect(
      repository.accrueInterestDay({
        account: staleHysaAccount,
        accrualDate: '2026-08-24',
        accrualMicros: 1,
        postInterestCents: 0,
        postingBoundary: false,
        expectedLastAccrualDate: staleHysaAccount.lastAccrualDate,
        expectedAccruedInterestMicros: staleHysaAccount.accruedInterestMicros,
        expectedBalanceCents: staleHysaAccount.balanceCents,
        expectedLedgerEntryCount: staleHysaAccount.ledgerEntryCount,
      }),
    ).resolves.toEqual({ status: 'revision_conflict', purchaseReady: false });
    const refreshedHysaAccount = (await repository.listActiveAccounts(userId, '2026-08-24')).find(
      (account) => account.accountId === second.accountId,
    );
    if (refreshedHysaAccount === undefined)
      throw new Error('The refreshed HYSA fixture is missing.');
    await expect(
      repository.accrueInterestDay({
        account: refreshedHysaAccount,
        accrualDate: '2026-08-24',
        accrualMicros: 1,
        postInterestCents: 0,
        postingBoundary: false,
        expectedLastAccrualDate: refreshedHysaAccount.lastAccrualDate,
        expectedAccruedInterestMicros: refreshedHysaAccount.accruedInterestMicros,
        expectedBalanceCents: refreshedHysaAccount.balanceCents,
        expectedLedgerEntryCount: refreshedHysaAccount.ledgerEntryCount,
      }),
    ).resolves.toEqual({ status: 'accrued', purchaseReady: false });
    await expect(
      repository.getAccountSummary(userId, second.goal.id, '2026-08-23'),
    ).resolves.toMatchObject({
      principalContributedCents: 10_000,
      currentLedgerBalanceCents: 10_000,
    });
    await expect(
      planRepository.getCurrentPlan(userId, second.goal.id, '2026-08-23'),
    ).resolves.toMatchObject({
      account: { postedContributionsCents: 0, ledgerBalanceCents: 10_000 },
    });
    await expect(repository.getActivity(userId, second.goal.id)).resolves.not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ description: 'Crash-recovery future entry fixture' }),
      ]),
    );
    await database`
      UPDATE goals SET status = 'active', version = version + 1, updated_at = now()
      WHERE id = ${second.goal.id} AND user_id = ${userId}
    `;
    await expect(
      experienceRepository.getDemoMilestoneContext(userId, second.goal.id, '2026-08-23'),
    ).resolves.toMatchObject({ pendingFinancialDate: '2026-08-26' });
    const loadedBeforeCorrection = await repository.listDueMaturityLots(
      firstActiveAccount,
      '2027-02-19',
    );
    expect(loadedBeforeCorrection).toHaveLength(1);

    const correctedActiveAccount = (await repository.listActiveAccounts(userId)).find(
      (account) => account.accountId === correctedCompounding.accountId,
    );
    if (correctedActiveAccount === undefined) {
      throw new Error('The corrected compounding account is missing.');
    }
    const firstMaturity = (
      await repository.listDueMaturityLots(correctedActiveAccount, '2027-02-19')
    )[0];
    if (firstMaturity === undefined) throw new Error('The first corrected maturity is missing.');
    expect(firstMaturity.currentBalanceCents).toBe(10_000);
    await expect(
      repository.postMaturityInterest({
        account: correctedActiveAccount,
        lot: firstMaturity,
        interestCents: 1_000,
      }),
    ).resolves.toEqual({ posted: true, purchaseReady: false });
    const firstMaturityRows = await database<{ readonly id: string }[]>`
      SELECT id FROM ledger_entries
      WHERE account_id = ${correctedCompounding.accountId}
        AND occurrence_id = ${`maturity:${correctedCompounding.ledgerId}:1`}
    `;
    const firstMaturityEntryId = firstMaturityRows[0]?.id;
    if (firstMaturityEntryId === undefined) {
      throw new Error('The first maturity posting was not recorded.');
    }
    await database`
      INSERT INTO ledger_entries (
        id, account_id, user_id, entry_type, interest_cents, effective_date,
        description, reverses_entry_id
      ) VALUES (
        ${ulid()}, ${correctedCompounding.accountId}, ${userId}, 'reversal', -1000,
        '2027-02-20', 'Corrected maturity interest', ${firstMaturityEntryId}
      )
    `;
    const secondMaturity = (
      await repository.listDueMaturityLots(correctedActiveAccount, '2027-08-18')
    )[0];
    expect(secondMaturity).toMatchObject({ cycle: 2, currentBalanceCents: 10_000 });

    await expect(
      database`
        INSERT INTO ledger_entries (
          id, account_id, user_id, entry_type, principal_cents, effective_date,
          description, reverses_entry_id
        ) VALUES (
          ${ulid()}, ${second.accountId}, ${userId}, 'reversal', -100,
          '2026-08-24', 'Invalid cross-account reversal', ${first.ledgerId}
        )
      `,
    ).rejects.toThrow('same account');
    await expect(
      database`
        INSERT INTO interest_posting_periods (
          account_id, user_id, period_end, ledger_entry_id
        ) VALUES (
          ${second.accountId}, ${userId}, '2026-08-31', ${first.ledgerId}
        )
      `,
    ).rejects.toThrow('must reference an interest posting');

    await expect(
      database`
        INSERT INTO ledger_entries (
          id, account_id, user_id, entry_type, principal_cents, effective_date,
          description, reverses_entry_id
        ) VALUES (
          ${ulid()}, ${first.accountId}, ${userId}, 'reversal', -100,
          '2026-08-24', 'Invalid non-negating reversal', ${first.ledgerId}
        )
      `,
    ).rejects.toThrow('a reversal must exactly negate the referenced entry');

    await expect(
      database`
        INSERT INTO ledger_entries (
          id, account_id, user_id, entry_type, principal_cents, effective_date,
          description, reverses_entry_id
        ) VALUES (
          ${ulid()}, ${first.accountId}, ${userId}, 'reversal', -10000,
          '2026-08-22', 'Invalid correction chronology', ${first.ledgerId}
        )
      `,
    ).rejects.toThrow('cannot precede the entry it corrects');

    const reversalId = ulid();
    await database`
      INSERT INTO ledger_entries (
        id, account_id, user_id, entry_type, principal_cents, effective_date,
        description, reverses_entry_id
      ) VALUES (
        ${reversalId}, ${first.accountId}, ${userId}, 'reversal', -10000,
        '2026-08-24', 'Exact reversal', ${first.ledgerId}
      )
    `;
    await expect(
      repository.getAccountSummary(userId, first.goal.id, '2026-08-24'),
    ).resolves.toMatchObject({
      principalContributedCents: 0,
      interestEarnedCents: 0,
      currentLedgerBalanceCents: 0,
      availableBalanceCents: 0,
    });
    await expect(
      planRepository.getFixedTermProjectionLots(userId, first.goal.id, '2026-08-24'),
    ).resolves.toEqual([]);
    await expect(repository.listDueMaturityLots(firstActiveAccount, '2027-02-19')).resolves.toEqual(
      [],
    );
    const staleLoadedLot = loadedBeforeCorrection[0];
    if (staleLoadedLot === undefined) throw new Error('Expected a loaded fixed-term lot.');
    await expect(
      repository.postMaturityInterest({
        account: firstActiveAccount,
        lot: staleLoadedLot,
        interestCents: 100,
      }),
    ).resolves.toEqual({ posted: false, purchaseReady: false });
    await expect(
      database`
        INSERT INTO ledger_entries (
          id, account_id, user_id, entry_type, principal_cents, effective_date,
          description, reverses_entry_id
        ) VALUES (
          ${ulid()}, ${first.accountId}, ${userId}, 'reversal', -1,
          '2026-08-25', 'Invalid reversal of reversal', ${reversalId}
        )
      `,
    ).rejects.toThrow('a reversal cannot reverse another reversal');
    const selfReversalId = ulid();
    await expect(
      database`
        INSERT INTO ledger_entries (
          id, account_id, user_id, entry_type, principal_cents, effective_date,
          description, reverses_entry_id
        ) VALUES (
          ${selfReversalId}, ${first.accountId}, ${userId}, 'reversal', -1,
          '2026-08-25', 'Invalid self reversal', ${selfReversalId}
        )
      `,
    ).rejects.toThrow('a ledger entry cannot reverse itself');

    await expect(
      database`
        INSERT INTO interest_posting_periods (
          account_id, user_id, period_end, ledger_entry_id
        ) VALUES (
          ${first.accountId}, ${userId}, '2026-08-31', ${first.ledgerId}
        )
      `,
    ).rejects.toThrow('must reference an interest posting');
    const interestLedgerId = ulid();
    await database`
      INSERT INTO ledger_entries (
        id, account_id, user_id, entry_type, interest_cents, effective_date, description
      ) VALUES (
        ${interestLedgerId}, ${first.accountId}, ${userId}, 'interest_posted', 10,
        '2026-08-31', 'Relational integrity interest posting'
      )
    `;
    await expect(
      database`
        INSERT INTO interest_posting_periods (
          account_id, user_id, period_end, ledger_entry_id
        ) VALUES (
          ${first.accountId}, ${userId}, '2026-09-30', ${interestLedgerId}
        )
      `,
    ).rejects.toThrow('must match the posting effective date');
    await database`
      INSERT INTO interest_posting_periods (account_id, user_id, period_end, ledger_entry_id)
      VALUES (${first.accountId}, ${userId}, '2026-08-31', ${interestLedgerId})
    `;
    await database`
      INSERT INTO ledger_entries (
        id, account_id, user_id, entry_type, interest_cents, effective_date,
        description, reverses_entry_id
      ) VALUES (
        ${ulid()}, ${first.accountId}, ${userId}, 'reversal', -10,
        '2026-09-01', 'Exact interest correction', ${interestLedgerId}
      )
    `;
    await expect(
      repository.getAccountSummary(userId, first.goal.id, '2026-09-01'),
    ).resolves.toMatchObject({
      principalContributedCents: 0,
      interestEarnedCents: 0,
      currentLedgerBalanceCents: 0,
      availableBalanceCents: 0,
    });
    const reversedSnapshot = await planRepository.getCurrentPlan(userId, first.goal.id);
    expect(reversedSnapshot?.account).toMatchObject({
      openingSavingsCents: 0,
      postedContributionsCents: 0,
      postedInterestCents: 0,
      ledgerBalanceCents: 0,
    });

    await repository.deleteGoal(userId, first.goal.id);
    await repository.deleteGoal(userId, second.goal.id);
    await repository.deleteGoal(userId, correctedCompounding.goal.id);
    await repository.deleteGoal(userId, terminalRecovery.goal.id);
    const remaining = await database<{ count: string }[]>`
      SELECT count(*) AS count FROM interest_posting_periods
      WHERE ledger_entry_id = ${interestLedgerId}
    `;
    expect(Number(remaining[0]?.count ?? -1)).toBe(0);
  });

  it('stores only strict optimistic partial goal drafts', async () => {
    const userId = '01K3C8ALEX0000000000000000';
    const draftId = ulid();
    await database`
      INSERT INTO goal_drafts (
        id, user_id, draft_data, last_completed_step
      ) VALUES (
        ${draftId}, ${userId},
        '{"name":"Draft trip","targetAmountCents":600000,"targetDate":"2027-08-23","firstContributionDate":"2026-09-23","currentSavedCents":100000,"budgetFit":"equal","confidence":"expected"}'::jsonb,
        'starting_point'
      )
    `;
    await expect(
      database`
        INSERT INTO goal_drafts (id, user_id, draft_data)
        VALUES (${ulid()}, ${userId}, '[]'::jsonb)
      `,
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      database`
        INSERT INTO goal_drafts (id, user_id, draft_data)
        VALUES (${ulid()}, ${userId}, '{"email":"private@example.test"}'::jsonb)
      `,
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      database`
        INSERT INTO goal_drafts (id, user_id, draft_data, version)
        VALUES (${ulid()}, ${userId}, '{}'::jsonb, 0)
      `,
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      database`
        UPDATE goal_drafts SET version = 0 WHERE id = ${draftId} AND user_id = ${userId}
      `,
    ).rejects.toThrow('goal draft version must advance exactly once');
    await expect(
      database`
        UPDATE goal_drafts SET draft_data = '{"name":"Unversioned edit"}'::jsonb
        WHERE id = ${draftId} AND user_id = ${userId}
      `,
    ).rejects.toThrow('goal draft version must advance exactly once');
    await database`DELETE FROM goal_drafts WHERE id = ${draftId} AND user_id = ${userId}`;
  });

  it('preserves prior plans and permits only direct current-plan evolution', async () => {
    const userId = '01K3C8ALEX0000000000000000';
    const goal = await repository.createGoal(userId, {
      name: 'Immutable plan evolution fixture',
      targetAmountCents: 100_000,
      currentSavedCents: 10_000,
      targetDate: '2027-08-23',
      recurringContributionCents: 10_000,
      contributionCadence: 'monthly',
      liquidityNeed: 'anytime',
      preservationPreference: 'required',
      confidence: 'expected',
    });
    const firstPlanId = ulid();
    const secondPlanId = ulid();
    const missedPlanId = ulid();
    const fourthPlanId = ulid();
    const accountId = ulid();
    await database`
      INSERT INTO plan_versions (
        id, goal_id, user_id, version, vehicle_code, assumption_version,
        normalized_input, calculation_output
      ) VALUES (
        ${firstPlanId}, ${goal.id}, ${userId}, 1, 'cash', 'demo-2026-08-v1',
        '{}'::jsonb, '{"asOfDate":"2026-08-23"}'::jsonb
      )
    `;
    await database`
      INSERT INTO simulated_accounts (
        id, goal_id, user_id, plan_version_id, status, last_processed_date, last_accrual_date
      ) VALUES (
        ${accountId}, ${goal.id}, ${userId}, ${firstPlanId},
        'active', '2026-08-23', '2026-08-23'
      )
    `;
    await database`
      INSERT INTO plan_versions (
        id, goal_id, user_id, version, vehicle_code, assumption_version,
        normalized_input, calculation_output, application_date,
        calculation_policy_version, ranking_policy_version, health_policy_version,
        change_kind, changed_field, change_reason_code, change_payload, base_plan_version_id
      ) VALUES (
        ${secondPlanId}, ${goal.id}, ${userId}, 2, 'cash', 'demo-2026-08-v1',
        '{}'::jsonb, '{"asOfDate":"2026-08-24"}'::jsonb, '2026-08-24',
        'safe-contribution-v1', 'vehicle-fit-v2', 'plan-health-v1',
        'scenario_applied', 'target_amount', 'USER_TARGET_CHANGED',
        '{"targetAmountCents":120000}'::jsonb, ${firstPlanId}
      )
    `;
    await database`
      UPDATE simulated_accounts SET plan_version_id = ${secondPlanId}
      WHERE id = ${accountId} AND user_id = ${userId}
    `;
    await database`
      INSERT INTO ledger_entries (
        id, account_id, user_id, entry_type, effective_date, occurrence_id, description
      ) VALUES (
        ${ulid()}, ${accountId}, ${userId}, 'plan_changed', '2026-08-24',
        'plan-change-v2', 'Simulated plan version changed'
      )
    `;

    await expect(
      database`UPDATE plan_versions SET change_reason_code = 'USER_DEADLINE_CHANGED' WHERE id = ${firstPlanId}`,
    ).rejects.toThrow('plan versions are immutable');
    await expect(
      database`
        INSERT INTO plan_versions (
          id, goal_id, user_id, version, vehicle_code, assumption_version,
          normalized_input, calculation_output, change_kind, changed_field,
          change_reason_code, change_payload, base_plan_version_id
        ) VALUES (
          ${ulid()}, ${goal.id}, ${userId}, 3, 'cash', 'demo-2026-08-v1',
          '{}'::jsonb, '{}'::jsonb, 'scenario_applied', 'target_date',
          'USER_DEADLINE_CHANGED', '{"targetDate":"2027-09-23"}'::jsonb, ${firstPlanId}
        )
      `,
    ).rejects.toThrow('immediately prior owned goal version');
    await expect(
      database`
        INSERT INTO plan_versions (
          id, goal_id, user_id, version, vehicle_code, assumption_version,
          normalized_input, calculation_output, change_kind, changed_field,
          change_reason_code, change_payload, base_plan_version_id
        ) VALUES (
          ${ulid()}, ${goal.id}, ${userId}, 3, 'cash', 'demo-2026-08-v1',
          '{}'::jsonb, '{}'::jsonb, 'scenario_applied', 'target_date',
          'USER_DEADLINE_CHANGED', '{"targetAmountCents":120000}'::jsonb, ${secondPlanId}
        )
      `,
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      database`
        INSERT INTO plan_versions (
          id, goal_id, user_id, version, vehicle_code, assumption_version,
          normalized_input, calculation_output, schedule_anchor_date,
          change_kind, changed_field, change_reason_code, change_payload, base_plan_version_id
        ) VALUES (
          ${ulid()}, ${goal.id}, ${userId}, 3, 'cash', 'demo-2026-08-v1',
          '{}'::jsonb, '{}'::jsonb, '2026-08-25', 'scenario_applied', 'target_date',
          'USER_DEADLINE_CHANGED', '{"targetDate":"2027-09-23"}'::jsonb, ${secondPlanId}
        )
      `,
    ).rejects.toThrow('preserve the original contribution schedule anchor');
    await expect(
      database`
        UPDATE simulated_accounts SET plan_version_id = ${firstPlanId}
        WHERE id = ${accountId} AND user_id = ${userId}
      `,
    ).rejects.toThrow('direct next immutable plan version');
    await database`
      INSERT INTO plan_versions (
        id, goal_id, user_id, version, vehicle_code, assumption_version,
        normalized_input, calculation_output, change_kind, changed_field,
        change_reason_code, change_payload, base_plan_version_id
      ) VALUES (
        ${missedPlanId}, ${goal.id}, ${userId}, 3, 'cash', 'demo-2026-08-v1',
        '{}'::jsonb, '{}'::jsonb, 'scenario_applied', 'missed_contribution',
        'USER_MISSED_CONTRIBUTION_PLANNED', '{"missedContributionDate":"2026-09-23"}'::jsonb,
        ${secondPlanId}
      )
    `;
    await database`
      UPDATE simulated_accounts SET plan_version_id = ${missedPlanId}
      WHERE id = ${accountId} AND user_id = ${userId}
    `;
    await database`
      INSERT INTO plan_versions (
        id, goal_id, user_id, version, vehicle_code, assumption_version,
        normalized_input, calculation_output, change_kind, changed_field,
        change_reason_code, change_payload, base_plan_version_id
      ) VALUES (
        ${fourthPlanId}, ${goal.id}, ${userId}, 4, 'cash', 'demo-2026-08-v1',
        '{}'::jsonb, '{}'::jsonb, 'scenario_applied', 'target_amount',
        'USER_TARGET_CHANGED', '{"targetAmountCents":130000}'::jsonb, ${missedPlanId}
      )
    `;
    await database`
      UPDATE simulated_accounts SET plan_version_id = ${fourthPlanId}
      WHERE id = ${accountId} AND user_id = ${userId}
    `;
    const omissionSnapshots = await database<
      {
        version: number;
        omitted_contribution_dates: string[];
      }[]
    >`
      SELECT version, omitted_contribution_dates::text[]
      FROM plan_versions WHERE id IN (${missedPlanId}, ${fourthPlanId}) ORDER BY version
    `;
    expect(omissionSnapshots).toEqual([
      { version: 3, omitted_contribution_dates: ['2026-09-23'] },
      { version: 4, omitted_contribution_dates: ['2026-09-23'] },
    ]);
    await expect(
      database`
        INSERT INTO plan_versions (
          id, goal_id, user_id, version, vehicle_code, assumption_version,
          normalized_input, calculation_output, change_kind, changed_field,
          change_reason_code, change_payload, base_plan_version_id
        ) VALUES (
          ${ulid()}, ${goal.id}, ${userId}, 5, 'cash', 'demo-2026-08-v1',
          '{}'::jsonb, '{}'::jsonb, 'scenario_applied', 'missed_contribution',
          'USER_MISSED_CONTRIBUTION_PLANNED',
          '{"missedContributionDate":"2026-09-23"}'::jsonb, ${fourthPlanId}
        )
      `,
    ).rejects.toThrow('can be omitted only once');
    await expect(
      database`
        INSERT INTO plan_versions (
          id, goal_id, user_id, version, vehicle_code, assumption_version,
          normalized_input, calculation_output, change_kind, changed_field,
          change_reason_code, change_payload, omitted_contribution_dates,
          base_plan_version_id
        ) VALUES (
          ${ulid()}, ${goal.id}, ${userId}, 5, 'cash', 'demo-2026-08-v1',
          '{}'::jsonb, '{}'::jsonb, 'scenario_applied', 'target_amount',
          'USER_TARGET_CHANGED', '{"targetAmountCents":140000}'::jsonb,
          ARRAY[DATE '2026-10-23'], ${fourthPlanId}
        )
      `,
    ).rejects.toThrow('preserve and append only approved omitted contribution dates');
    await repository.deleteGoal(userId, goal.id);
  });

  it('keeps controlled clocks monotonic except for an explicit fixture reset', async () => {
    const userId = '01K3C8DEMX0000000000000000';
    const clocks = await database<
      {
        application_date: string;
        initial_application_date: string;
        version: number;
      }[]
    >`
      SELECT application_date::text, initial_application_date::text, version
      FROM user_application_clocks WHERE user_id = ${userId}
    `;
    const initialDate = clocks[0]?.initial_application_date;
    const initialVersion = clocks[0]?.version;
    if (initialDate === undefined || initialVersion === undefined) {
      throw new Error('The deterministic fixture user must have a controlled application clock.');
    }
    await expect(
      database`
        UPDATE user_application_clocks SET application_date = application_date + 1
        WHERE user_id = ${userId}
      `,
    ).rejects.toThrow('version must advance exactly once');
    const fixtureCapability = await database<{ fixture_key: string; fixture_version: string }[]>`
      SELECT fixture_key, fixture_version FROM demo_fixture_users WHERE user_id = ${userId}
    `;
    expect(fixtureCapability[0]).toEqual({
      fixture_key: 'japan-trip',
      fixture_version: 'product-experience-v1',
    });
    const firstRunToken = ulid();
    const recoveredRunToken = ulid();
    await expect(
      experienceRepository.claimOwnerFinancialRun({ userId, runToken: firstRunToken }),
    ).resolves.toBe(true);
    await expect(
      experienceRepository.claimOwnerFinancialRun({ userId, runToken: recoveredRunToken }),
    ).resolves.toBe(false);
    await expect(
      repository.postContribution({
        userId,
        goalId: '01K3C8DGMX0000000000000000',
        amountCents: 100,
        effectiveDate: initialDate,
        occurrenceId: `financial-run-block:${ulid()}`,
        idempotencyKey: `financial-run-block-${ulid()}`,
        requestHash: 'a'.repeat(64),
        simulateFailure: false,
      }),
    ).rejects.toThrow('A Story Mode financial run is in progress. Retry after it finishes.');
    await database`
      UPDATE user_application_clocks SET
        financial_run_expires_at = now() - interval '1 second',
        version = version + 1,
        updated_at = now()
      WHERE user_id = ${userId}
    `;
    await expect(
      experienceRepository.claimOwnerFinancialRun({ userId, runToken: recoveredRunToken }),
    ).resolves.toBe(true);
    await expect(
      experienceRepository.releaseOwnerFinancialRun({ userId, runToken: firstRunToken }),
    ).resolves.toBe(false);
    await expect(
      experienceRepository.releaseOwnerFinancialRun({ userId, runToken: recoveredRunToken }),
    ).resolves.toBe(true);
    await database`
      UPDATE user_application_clocks SET
        application_date = application_date + 1,
        version = version + 1,
        updated_at = now()
      WHERE user_id = ${userId}
    `;
    await database`
      UPDATE user_application_clocks SET
        application_date = initial_application_date,
        version = version + 1,
        updated_at = now()
      WHERE user_id = ${userId}
    `;
    await expect(
      database`UPDATE demo_fixture_users SET fixture_version = 'changed-v1' WHERE user_id = ${userId}`,
    ).rejects.toThrow('identity and version are immutable');
    await expect(
      database`DELETE FROM demo_fixture_users WHERE user_id = ${userId}`,
    ).rejects.toThrow('immutable outside owner deletion');
    const resetClock = await database<{ application_date: string; version: number }[]>`
      SELECT application_date::text, version FROM user_application_clocks WHERE user_id = ${userId}
    `;
    expect(resetClock[0]).toEqual({ application_date: initialDate, version: initialVersion + 6 });
  });

  it('keeps privacy-safe product telemetry fixed-column and append-only', async () => {
    const columns = await database<{ column_name: string; data_type: string }[]>`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'product_events'
      ORDER BY ordinal_position
    `;
    const columnNames = columns.map((column) => column.column_name);
    expect(columnNames).toEqual([
      'id',
      'event_name',
      'occurred_at',
      'subject_kind',
      'subject_hash',
      'builder_step',
      'vehicle_code',
      'rejection_code',
      'changed_dimension',
      'is_demo',
      'application_version',
      'created_at',
    ]);
    expect(columns.some((column) => ['json', 'jsonb'].includes(column.data_type))).toBe(false);
    expect(
      columnNames.some((name) =>
        [
          'amount_cents',
          'goal_id',
          'account_id',
          'resource_id',
          'request_id',
          'session_id',
          'email',
          'name',
          'notes',
          'url',
          'metadata',
        ].includes(name),
      ),
    ).toBe(false);

    const eventId = ulid();
    await database`
      INSERT INTO product_events (
        id, event_name, occurred_at, subject_kind, subject_hash,
        builder_step, is_demo, application_version
      ) VALUES (
        ${eventId}, 'builder_step_completed', '2026-08-23T12:00:00Z', 'user',
        ${'b'.repeat(64)}, 'budget_fit', true, 'product-experience-v1'
      )
    `;
    await database`
      INSERT INTO product_events (
        id, event_name, occurred_at, subject_kind, subject_hash, is_demo, application_version
      ) VALUES (
        ${ulid()}, 'purchase_timing_check_completed', '2026-08-23T12:01:00Z', 'user',
        ${'d'.repeat(64)}, true, 'product-experience-v1'
      )
    `;
    await expect(
      database`
        INSERT INTO product_events (
          id, event_name, occurred_at, subject_kind, subject_hash,
          builder_step, is_demo, application_version
        ) VALUES (
          ${ulid()}, 'plan_archived', '2026-08-23T12:00:00Z', 'user',
          ${'c'.repeat(64)}, 'review', true, 'product-experience-v1'
        )
      `,
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      database`UPDATE product_events SET is_demo = false WHERE id = ${eventId}`,
    ).rejects.toThrow('product events are append-only');
    await expect(database`DELETE FROM product_events WHERE id = ${eventId}`).rejects.toThrow(
      'product events are append-only',
    );
  });

  it('enforces composite ownership throughout Purchase Timing Lab', async () => {
    const ownerId = '01K3C8ALEX0000000000000000';
    const otherUserId = '01K3C8SAM00000000000000000';
    const ownerGoal = await repository.createGoal(ownerId, {
      name: 'Timing ownership fixture',
      targetAmountCents: 200_000,
      currentSavedCents: 50_000,
      targetDate: '2027-08-23',
      recurringContributionCents: 15_000,
      contributionCadence: 'monthly',
      liquidityNeed: 'goal_date',
      preservationPreference: 'required',
      confidence: 'expected',
    });
    await expect(
      database`
        INSERT INTO purchase_items (
          id, user_id, goal_id, fixture_code, display_name, currency, target_price_cents
        ) VALUES (
          ${ulid()}, ${otherUserId}, ${ownerGoal.id}, 'synthetic_oled_65_v1',
          '65-inch OLED television', 'USD', 150000
        )
      `,
    ).rejects.toMatchObject({ code: '23503' });
    await expect(
      database`
        INSERT INTO purchase_items (
          id, user_id, goal_id, fixture_code, display_name, currency, target_price_cents
        ) VALUES (
          ${ulid()}, ${ownerId}, ${ownerGoal.id}, 'synthetic_oled_65_v1',
          'Uncontrolled display copy', 'USD', 150000
        )
      `,
    ).rejects.toMatchObject({ code: '23514' });

    const fixture = await createTimingFixture();
    await expect(
      database`
        INSERT INTO price_watch_policies (
          id, purchase_item_id, user_id, version, cadence, next_due_date
        ) VALUES (${ulid()}, ${fixture.itemId}, ${otherUserId}, 2, 'weekly', '2026-08-23')
      `,
    ).rejects.toMatchObject({ code: '23503' });
    await expect(
      database`
        INSERT INTO price_watch_policies (
          id, purchase_item_id, user_id, version, cadence, next_due_date, freshness_limit_days
        ) VALUES (
          ${ulid()}, ${fixture.itemId}, ${fixture.userId}, 2, 'weekly', '2026-08-23', 15
        )
      `,
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      database`
        INSERT INTO price_check_runs (
          id, price_watch_policy_id, purchase_item_id, user_id, application_date,
          worker_claim_token, worker_lease_expires_at
        ) VALUES (
          ${ulid()}, ${fixture.policyId}, ${fixture.itemId}, ${otherUserId}, '2026-08-24',
          ${ulid()}, now() + interval '10 minutes'
        )
      `,
    ).rejects.toMatchObject({ code: '23503' });
    await repository.deleteGoal(ownerId, ownerGoal.id);
    await repository.deleteGoal(fixture.userId, fixture.goal.id);
  });

  it('records a favorable-but-not-ready assessment without an active plan snapshot', async () => {
    const fixture = await createTimingFixture();
    await database`
      INSERT INTO price_observations (
        id, price_check_run_id, purchase_item_id, user_id, fixture_source_version,
        observation_key, observed_on, price_cents, currency
      )
      SELECT
        substr(md5(${fixture.itemId} || series::text), 1, 26),
        ${fixture.runId}, ${fixture.itemId}, ${fixture.userId}, ${fixture.sourceVersion},
        'fixture-' || series::text,
        DATE '2026-04-29' + (series * 4),
        CASE WHEN series = 29 THEN 140000 ELSE 150000 END,
        'USD'
      FROM generate_series(0, 29) AS series
    `;
    const assessmentId = ulid();
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
        ${assessmentId}, ${fixture.runId}, ${fixture.itemId}, ${fixture.goal.id}, ${fixture.userId},
        1, NULL, NULL, 'draft', NULL, ${fixture.sourceVersion}, ${fixture.sourceChecksum},
        '2026-08-23', 'USD', 'HISTORICALLY_FAVORABLE_PLAN_NOT_READY',
        ARRAY['PRICE_AT_OR_BELOW_FAVORABLE_PERCENTILE', 'PLAN_NOT_PURCHASE_READY'],
        30, '2026-04-29', '2026-08-23', 116, 0, 140000, 150000,
        140000, 150000, 150000, 167, -10000, -10000
      )
    `;
    await database`
      UPDATE price_check_runs SET status = 'completed', completed_at = now(),
        worker_claim_token = NULL, worker_lease_expires_at = NULL
      WHERE id = ${fixture.runId}
    `;
    const rows = await database<
      {
        plan_version_id: string | null;
        plan_health: string | null;
        assessment_state: string;
      }[]
    >`
      SELECT plan_version_id, plan_health, assessment_state
      FROM purchase_timing_assessments WHERE id = ${assessmentId}
    `;
    expect(rows[0]).toEqual({
      plan_version_id: null,
      plan_health: null,
      assessment_state: 'HISTORICALLY_FAVORABLE_PLAN_NOT_READY',
    });
    await repository.deleteGoal(fixture.userId, fixture.goal.id);
  });

  it('preserves keyed same-day observations while rejecting conflicting logical replays', async () => {
    const fixture = await createTimingFixture();
    const observationId = ulid();
    await database`
      INSERT INTO price_observations (
        id, price_check_run_id, purchase_item_id, user_id, fixture_source_version,
        observation_key, observed_on, price_cents, currency
      ) VALUES (
        ${observationId}, ${fixture.runId}, ${fixture.itemId}, ${fixture.userId},
        ${fixture.sourceVersion}, 'point-20260822', '2026-08-22', 145000, 'USD'
      )
    `;
    await expect(
      database`
        INSERT INTO price_observations (
          id, price_check_run_id, purchase_item_id, user_id, fixture_source_version,
          observation_key, observed_on, price_cents, currency
        ) VALUES (
          ${ulid()}, ${fixture.runId}, ${fixture.itemId}, ${fixture.userId},
          ${fixture.sourceVersion}, 'point-20260824', '2026-08-24', 145000, 'USD'
        )
      `,
    ).rejects.toThrow('cannot be after its controlled application date');
    await expect(
      database`
        INSERT INTO price_observations (
          id, price_check_run_id, purchase_item_id, user_id, fixture_source_version,
          observation_key, observed_on, price_cents, currency
        ) VALUES (
          ${ulid()}, ${fixture.runId}, ${fixture.itemId}, ${fixture.userId},
          ${fixture.sourceVersion}, 'point-20260821', '2026-08-21', 145000, 'EUR'
        )
      `,
    ).rejects.toThrow('currency must match its purchase item');
    await database`
      INSERT INTO price_observations (
        id, price_check_run_id, purchase_item_id, user_id, fixture_source_version,
        observation_key, observed_on, price_cents, currency
      ) VALUES (
        ${ulid()}, ${fixture.runId}, ${fixture.itemId}, ${fixture.userId},
        ${fixture.sourceVersion}, 'same-day-second-key', '2026-08-22', 146000, 'USD'
      )
    `;
    const sameDay = await database<{ readonly count: string }[]>`
      SELECT COUNT(*)::text AS count FROM price_observations
      WHERE price_check_run_id = ${fixture.runId} AND observed_on = '2026-08-22'
    `;
    expect(sameDay).toEqual([{ count: '2' }]);

    const secondPolicyId = ulid();
    const secondRunId = ulid();
    const secondWorkerClaimToken = ulid();
    await database`
      INSERT INTO price_watch_policies (
        id, purchase_item_id, user_id, version, cadence, next_due_date
      ) VALUES (
        ${secondPolicyId}, ${fixture.itemId}, ${fixture.userId}, 2, 'weekly', '2026-08-23'
      )
    `;
    await database`
      INSERT INTO price_check_runs (
        id, price_watch_policy_id, purchase_item_id, user_id, application_date,
        fixture_source_version, fixture_source_checksum,
        worker_claim_token, worker_lease_expires_at
      ) VALUES (
        ${secondRunId}, ${secondPolicyId}, ${fixture.itemId}, ${fixture.userId}, '2026-08-23',
        ${fixture.sourceVersion}, ${fixture.sourceChecksum}, ${secondWorkerClaimToken},
        now() + interval '10 minutes'
      )
    `;
    await database`
      INSERT INTO price_observations (
        id, price_check_run_id, purchase_item_id, user_id, fixture_source_version,
        observation_key, observed_on, price_cents, currency
      ) VALUES (
        ${ulid()}, ${secondRunId}, ${fixture.itemId}, ${fixture.userId},
        ${fixture.sourceVersion}, 'point-20260822', '2026-08-22', 145000, 'USD'
      )
    `;
    await expect(
      database`
        INSERT INTO price_observations (
          id, price_check_run_id, purchase_item_id, user_id, fixture_source_version,
          observation_key, observed_on, price_cents, currency
        ) VALUES (
          ${ulid()}, ${secondRunId}, ${fixture.itemId}, ${fixture.userId},
          ${fixture.sourceVersion}, 'point-20260822', '2026-08-22', 145001, 'USD'
        )
      `,
    ).rejects.toThrow('conflicts with stored data');
    await expect(
      database`UPDATE price_observations SET price_cents = 1 WHERE id = ${observationId}`,
    ).rejects.toThrow('price observations are append-only');
    await repository.deleteGoal(fixture.userId, fixture.goal.id);
  });

  it('serializes concurrent watch-policy versions across different idempotency keys', async () => {
    const fixture = await createTimingFixture();
    const [first, second] = await Promise.all([
      timingRepository.createWatchPolicy({
        userId: fixture.userId,
        itemId: fixture.itemId,
        cadence: 'weekly',
        nextDueDate: '2026-08-30',
        enabled: true,
        idempotencyKey: `policy-race-${ulid().toLowerCase()}`,
        requestHash: 'b'.repeat(64),
      }),
      timingRepository.createWatchPolicy({
        userId: fixture.userId,
        itemId: fixture.itemId,
        cadence: 'monthly',
        nextDueDate: '2026-09-23',
        enabled: true,
        idempotencyKey: `policy-race-${ulid().toLowerCase()}`,
        requestHash: 'c'.repeat(64),
      }),
    ]);
    expect(
      [first.policy.version, second.policy.version].sort((left, right) => left - right),
    ).toEqual([2, 3]);
    const versions = await database<{ readonly version: number }[]>`
      SELECT version FROM price_watch_policies
      WHERE purchase_item_id = ${fixture.itemId} AND user_id = ${fixture.userId}
      ORDER BY version
    `;
    expect(versions.map((row) => row.version)).toEqual([1, 2, 3]);
    await repository.deleteGoal(fixture.userId, fixture.goal.id);
  });

  it('keeps Timing Lab policy and assessment history immutable and replay-safe', async () => {
    const fixture = await createTimingFixture();
    const observationId = ulid();
    const assessmentId = ulid();
    const seasonalValidation = await database<{ valid: boolean; invalid: boolean }[]>`
      SELECT
        valid_purchase_timing_seasonal_summary(
          jsonb_build_object(
            'months', (
              SELECT jsonb_agg(jsonb_build_object(
                'month', month,
                'observationCount', 3,
                'medianPriceCents', 145000
              ) ORDER BY month)
              FROM generate_series(1, 12) AS month
            )
          )
        ) AS valid,
        valid_purchase_timing_seasonal_summary(
          jsonb_build_object(
            'months', (
              SELECT jsonb_agg(jsonb_build_object(
                'month', 1,
                'observationCount', 3,
                'medianPriceCents', 145000,
                'extra', true
              ))
              FROM generate_series(1, 12)
            )
          )
        ) AS invalid
    `;
    expect(seasonalValidation[0]).toEqual({ valid: true, invalid: false });
    await database`
      INSERT INTO price_observations (
        id, price_check_run_id, purchase_item_id, user_id, fixture_source_version,
        observation_key, observed_on, price_cents, currency
      ) VALUES (
        ${observationId}, ${fixture.runId}, ${fixture.itemId}, ${fixture.userId},
        ${fixture.sourceVersion}, 'point-20260823', '2026-08-23', 145000, 'USD'
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
        ${assessmentId}, ${fixture.runId}, ${fixture.itemId}, ${fixture.goal.id}, ${fixture.userId},
        1, ${fixture.planId}, 1, 'active', 'ON_TRACK', ${fixture.sourceVersion},
        ${fixture.sourceChecksum}, '2026-08-23', 'USD', 'INSUFFICIENT_DATA',
        ARRAY['INSUFFICIENT_OBSERVATION_COUNT'], 1, '2026-08-23', '2026-08-23', 0, 0,
        145000, 150000, 145000, 145000, 145000, 5000, 0, -5000
      )
    `;
    await database`
      UPDATE price_check_runs SET status = 'completed', completed_at = now(),
        worker_claim_token = NULL, worker_lease_expires_at = NULL
      WHERE id = ${fixture.runId}
    `;
    await expect(
      database`
        INSERT INTO price_observations (
          id, price_check_run_id, purchase_item_id, user_id, fixture_source_version,
          observation_key, observed_on, price_cents, currency
        ) VALUES (
          ${ulid()}, ${fixture.runId}, ${fixture.itemId}, ${fixture.userId},
          ${fixture.sourceVersion}, 'late-after-complete', '2026-08-22', 144000, 'USD'
        )
      `,
    ).rejects.toThrow('only a claimed price check run can append observations');

    await expect(
      database`
        INSERT INTO purchase_timing_assessments (
          id, price_check_run_id, purchase_item_id, goal_id, user_id,
          price_watch_policy_version, plan_version_id, plan_version_number,
          plan_lifecycle, plan_health, fixture_source_version, fixture_source_checksum,
          as_of_date, currency, assessment_state, rationale_codes, observation_count,
          earliest_observation_date, latest_observation_date, data_span_days, freshness_days,
          current_price_cents, target_price_cents, minimum_price_cents, median_price_cents,
          maximum_price_cents, current_percentile_basis_points,
          difference_from_median_cents, difference_from_target_cents
        ) VALUES (
          ${ulid()}, ${fixture.runId}, ${fixture.itemId}, ${fixture.goal.id}, ${fixture.userId},
          1, ${fixture.planId}, 1, 'active', 'ON_TRACK', ${fixture.sourceVersion},
          ${fixture.sourceChecksum}, '2026-08-23', 'USD', 'INSUFFICIENT_DATA',
          ARRAY['INSUFFICIENT_OBSERVATION_COUNT'], 1, '2026-08-23', '2026-08-23', 0, 0,
          145000, 150000, 145000, 145000, 145000, 5000, 0, -5000
        )
      `,
    ).rejects.toMatchObject({ code: '23505' });
    await expect(
      database`
        INSERT INTO price_check_runs (
          id, price_watch_policy_id, purchase_item_id, user_id, application_date,
          worker_claim_token, worker_lease_expires_at
        ) VALUES (
          ${ulid()}, ${fixture.policyId}, ${fixture.itemId}, ${fixture.userId}, '2026-08-23',
          ${ulid()}, now() + interval '10 minutes'
        )
      `,
    ).rejects.toMatchObject({ code: '23505' });
    await expect(
      database`
        UPDATE purchase_timing_assessments
        SET rationale_codes = ARRAY['LATEST_OBSERVATION_STALE']
        WHERE id = ${assessmentId}
      `,
    ).rejects.toThrow('purchase timing assessments are immutable');
    await expect(
      database`DELETE FROM purchase_timing_assessments WHERE id = ${assessmentId}`,
    ).rejects.toThrow('purchase timing assessments are immutable');
    await expect(
      database`UPDATE price_watch_policies SET enabled = false WHERE id = ${fixture.policyId}`,
    ).rejects.toThrow('price watch policies are immutable');
    await repository.deleteGoal(fixture.userId, fixture.goal.id);
    const remaining = await database<{ count: string }[]>`
      SELECT count(*) AS count FROM purchase_timing_assessments WHERE id = ${assessmentId}
    `;
    expect(Number(remaining[0]?.count ?? -1)).toBe(0);
  });
});
