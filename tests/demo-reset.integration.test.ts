import { verifyPassword } from '@goalpilot/auth';
import {
  createDatabaseClient,
  ProductExperienceRepository,
  type DatabaseClient,
} from '@goalpilot/data-access';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  assertDemoResetTarget,
  calculateJapanTripFixture,
  japanTripFixture,
  japanTripGoal,
  resetJapanTripFixture,
  seedJapanTripFixture,
} from '../scripts/demo-fixture.js';

function testDatabaseUrl(): string {
  process.loadEnvFile('.env.local');
  const value = process.env['TEST_DATABASE_URL'];
  if (value === undefined) throw new Error('TEST_DATABASE_URL is required for integration tests.');
  return value;
}

describe('seeded Japan-trip demo reset', () => {
  let database: DatabaseClient;

  beforeAll(async () => {
    database = createDatabaseClient(testDatabaseUrl(), 2);
    await resetJapanTripFixture(database);
  });

  afterAll(async () => database.end());

  it('accepts only explicit loopback local and test database targets', () => {
    expect(() =>
      assertDemoResetTarget('test', 'postgres://goalpilot:password@localhost:55432/goalpilot_test'),
    ).not.toThrow();
    expect(() =>
      assertDemoResetTarget(
        'local',
        'postgres://goalpilot:password@127.0.0.1:55432/goalpilot_local',
      ),
    ).not.toThrow();
    expect(() =>
      assertDemoResetTarget(
        'production',
        'postgres://goalpilot:password@localhost:55432/goalpilot_local',
      ),
    ).toThrow('ENVIRONMENT=local or ENVIRONMENT=test');
    expect(() =>
      assertDemoResetTarget('test', 'postgres://goalpilot:password@db.internal/goalpilot_test'),
    ).toThrow('Refusing destructive database action');
    expect(() =>
      assertDemoResetTarget(
        'test',
        'postgres://goalpilot:password@localhost:55432/goalpilot_local',
      ),
    ).toThrow('database "goalpilot_local"');
  });

  it('persists the reviewed story from production calculations and deterministic fixture data', async () => {
    const calculation = calculateJapanTripFixture();
    const rows = await database<
      {
        readonly email: string;
        readonly display_name: string;
        readonly password_hash: string;
        readonly fixture_key: string;
        readonly fixture_version: string;
        readonly initial_application_date: string;
        readonly application_date: string;
        readonly clock_version: number;
        readonly goal_name: string;
        readonly target_amount_cents: string;
        readonly current_saved_cents: string;
        readonly target_date: string;
        readonly recurring_contribution_cents: string;
        readonly liquidity_need: string;
        readonly goal_version: number;
        readonly plan_number: number;
        readonly vehicle_code: string;
        readonly assumption_version: string;
        readonly normalized_input: unknown;
        readonly calculation_output: unknown;
        readonly plan_application_date: string;
        readonly schedule_anchor_date: string;
        readonly change_kind: string;
        readonly account_status: string;
        readonly next_contribution_date: string;
        readonly last_processed_date: string;
      }[]
    >`
      SELECT
        users.email, users.display_name, users.password_hash,
        fixture.fixture_key, fixture.fixture_version,
        clock.initial_application_date::text, clock.application_date::text,
        clock.version AS clock_version,
        goal.name AS goal_name, goal.target_amount_cents::text,
        goal.current_saved_cents::text, goal.target_date::text,
        goal.recurring_contribution_cents::text, goal.liquidity_need,
        goal.version AS goal_version,
        plan.version AS plan_number, plan.vehicle_code, plan.assumption_version,
        plan.normalized_input, plan.calculation_output,
        plan.application_date::text AS plan_application_date,
        plan.schedule_anchor_date::text, plan.change_kind,
        account.status AS account_status,
        account.next_contribution_date::text, account.last_processed_date::text
      FROM users
      JOIN demo_fixture_users fixture ON fixture.user_id = users.id
      JOIN user_application_clocks clock ON clock.user_id = users.id
      JOIN goals goal ON goal.user_id = users.id
      JOIN plan_versions plan ON plan.goal_id = goal.id AND plan.user_id = users.id
      JOIN simulated_accounts account
        ON account.plan_version_id = plan.id AND account.user_id = users.id
      WHERE users.id = ${japanTripFixture.user.id}
    `;
    expect(rows).toHaveLength(1);
    const row = rows[0];
    if (row === undefined) throw new Error('The seeded Japan-trip fixture is missing.');
    expect(row).toMatchObject({
      email: japanTripFixture.user.email,
      display_name: japanTripFixture.user.displayName,
      fixture_key: japanTripFixture.fixtureKey,
      fixture_version: japanTripFixture.fixtureVersion,
      initial_application_date: japanTripFixture.applicationDate,
      application_date: japanTripFixture.applicationDate,
      clock_version: 1,
      goal_name: japanTripGoal.name,
      target_amount_cents: String(japanTripGoal.targetAmountCents),
      current_saved_cents: String(japanTripGoal.currentSavedCents),
      target_date: japanTripGoal.targetDate,
      recurring_contribution_cents: String(japanTripGoal.recurringContributionCents),
      liquidity_need: 'within_30_days',
      goal_version: 1,
      plan_number: 1,
      vehicle_code: 'hysa',
      assumption_version: 'demo-2026-08-v1',
      normalized_input: japanTripGoal,
      calculation_output: { ...calculation.projection, decisionSummary: calculation.summary },
      plan_application_date: japanTripFixture.applicationDate,
      schedule_anchor_date: japanTripFixture.applicationDate,
      change_kind: 'initial_activation',
      account_status: 'active',
      next_contribution_date: calculation.nextContributionDate,
      last_processed_date: japanTripFixture.applicationDate,
    });
    await expect(verifyPassword(japanTripFixture.user.password, row.password_hash)).resolves.toBe(
      true,
    );

    const ledger = await database<
      {
        readonly entry_type: string;
        readonly principal_cents: string;
        readonly effective_date: string;
        readonly entry_count: string;
      }[]
    >`
      SELECT min(entry_type) AS entry_type, min(principal_cents)::text AS principal_cents,
        min(effective_date)::text AS effective_date, count(*)::text AS entry_count
      FROM ledger_entries
      WHERE account_id = ${japanTripFixture.accountId}
    `;
    expect(ledger[0]).toEqual({
      entry_type: 'account_opened',
      principal_cents: String(japanTripGoal.currentSavedCents),
      effective_date: japanTripFixture.applicationDate,
      entry_count: '1',
    });

    const timing = await database<
      {
        readonly fixture_code: string;
        readonly display_name: string;
        readonly currency: string;
        readonly target_price_cents: string;
        readonly item_version: number;
        readonly lifecycle: string;
        readonly cadence: string;
        readonly next_due_date: string;
        readonly policy_version: number;
        readonly analysis_policy_version: string;
        readonly enabled: boolean;
      }[]
    >`
      SELECT item.fixture_code, item.display_name, item.currency,
        item.target_price_cents::text, item.version AS item_version, item.lifecycle,
        policy.cadence, policy.next_due_date::text, policy.version AS policy_version,
        policy.analysis_policy_version, policy.enabled
      FROM purchase_items item
      JOIN price_watch_policies policy
        ON policy.purchase_item_id = item.id AND policy.user_id = item.user_id
      WHERE item.id = ${japanTripFixture.purchaseItemId}
    `;
    expect(timing).toEqual([
      {
        fixture_code: 'synthetic_oled_65_v1',
        display_name: '65-inch OLED television',
        currency: 'USD',
        target_price_cents: String(japanTripFixture.purchaseItemTargetPriceCents),
        item_version: 1,
        lifecycle: 'active',
        cadence: 'weekly',
        next_due_date: japanTripFixture.applicationDate,
        policy_version: 1,
        analysis_policy_version: 'purchase-timing-v1',
        enabled: true,
      },
    ]);
  });

  it('restores only the marked owner and advances the reset generation', async () => {
    const otherUserId = '01K3C8SAM00000000000000000';
    const otherDraftId = '01K3C8RSMX0000000000000000';
    const fixtureDraftId = '01K3C8RDMX0000000000000000';
    await database`DELETE FROM goal_drafts WHERE id = ${otherDraftId}`;
    await database`
      DELETE FROM application_command_claims
      WHERE operation = 'integration.demo-reset' AND key = 'reset-isolation-marker'
    `;
    try {
      await database`
        INSERT INTO goal_drafts (id, user_id, draft_data, last_completed_step, version)
        VALUES (
          ${otherDraftId}, ${otherUserId},
          '{"name":"Reset isolation marker"}'::jsonb, 'starting_point', 1
        )
      `;
      await database`
        INSERT INTO application_command_claims (
          user_id, operation, key, request_hash, state, claim_token, lease_expires_at
        ) VALUES
          (
            ${otherUserId}, 'integration.demo-reset', 'reset-isolation-marker',
            ${'a'.repeat(64)}, 'claimed', ${otherDraftId}, now() + interval '5 minutes'
          ),
          (
            ${japanTripFixture.user.id}, 'integration.demo-reset', 'reset-isolation-marker',
            ${'b'.repeat(64)}, 'claimed', ${fixtureDraftId}, now() + interval '5 minutes'
          )
      `;
      await database`
        INSERT INTO goal_drafts (id, user_id, draft_data, last_completed_step, version)
        VALUES (
          ${fixtureDraftId}, ${japanTripFixture.user.id},
          '{"name":"Discard this fixture draft"}'::jsonb, 'starting_point', 1
        )
      `;
      await database`
        UPDATE user_application_clocks SET
          application_date = '2027-02-23', version = version + 1, updated_at = now()
        WHERE user_id = ${japanTripFixture.user.id}
      `;
      await database`
        UPDATE goals SET name = 'Mutated demo goal', version = version + 1, updated_at = now()
        WHERE id = ${japanTripFixture.goalId}
      `;
      await database`
        UPDATE purchase_items SET
          target_price_cents = 149999, version = version + 1, updated_at = now()
        WHERE id = ${japanTripFixture.purchaseItemId}
      `;
      const before = await database<{ readonly reset_generation: number }[]>`
        SELECT reset_generation FROM demo_fixture_users
        WHERE user_id = ${japanTripFixture.user.id}
      `;
      const previousGeneration = before[0]?.reset_generation;
      if (previousGeneration === undefined) {
        throw new Error('The fixture reset capability is missing before reset.');
      }

      const reset = await resetJapanTripFixture(database);

      expect(reset.resetGeneration).toBe(previousGeneration + 1);
      const restored = await database<
        {
          readonly application_date: string;
          readonly clock_version: number;
          readonly goal_name: string;
          readonly goal_version: number;
          readonly target_price_cents: string;
          readonly item_version: number;
          readonly fixture_drafts: string;
          readonly other_drafts: string;
          readonly fixture_claims: string;
          readonly other_claims: string;
        }[]
      >`
        SELECT
          clock.application_date::text, clock.version AS clock_version,
          goal.name AS goal_name, goal.version AS goal_version,
          item.target_price_cents::text, item.version AS item_version,
          (SELECT count(*)::text FROM goal_drafts
            WHERE user_id = ${japanTripFixture.user.id}) AS fixture_drafts,
          (SELECT count(*)::text FROM goal_drafts WHERE id = ${otherDraftId}
            AND user_id = ${otherUserId}) AS other_drafts,
          (SELECT count(*)::text FROM application_command_claims
            WHERE user_id = ${japanTripFixture.user.id}
              AND operation = 'integration.demo-reset') AS fixture_claims,
          (SELECT count(*)::text FROM application_command_claims
            WHERE user_id = ${otherUserId} AND operation = 'integration.demo-reset'
              AND key = 'reset-isolation-marker') AS other_claims
        FROM user_application_clocks clock
        JOIN goals goal ON goal.user_id = clock.user_id
        JOIN purchase_items item ON item.goal_id = goal.id AND item.user_id = clock.user_id
        WHERE clock.user_id = ${japanTripFixture.user.id}
      `;
      expect(restored).toEqual([
        {
          application_date: japanTripFixture.applicationDate,
          clock_version: 1,
          goal_name: japanTripGoal.name,
          goal_version: 1,
          target_price_cents: String(japanTripFixture.purchaseItemTargetPriceCents),
          item_version: 1,
          fixture_drafts: '0',
          other_drafts: '1',
          fixture_claims: '0',
          other_claims: '1',
        },
      ]);
    } finally {
      await database`DELETE FROM goal_drafts WHERE id = ${otherDraftId}`;
      await database`
        DELETE FROM application_command_claims
        WHERE user_id = ${otherUserId} AND operation = 'integration.demo-reset'
          AND key = 'reset-isolation-marker'
      `;
    }
  });

  it('restores the marked fixture transactionally without invalidating the active API session', async () => {
    await resetJapanTripFixture(database);
    const sessionIdHash = 'd'.repeat(64);
    await database`
      INSERT INTO sessions (
        id_hash, user_id, csrf_hash, expires_at, absolute_expires_at
      ) VALUES (
        ${sessionIdHash}, ${japanTripFixture.user.id}, ${'e'.repeat(64)},
        now() + interval '1 hour', now() + interval '8 hours'
      )
    `;
    try {
      await database`
        UPDATE user_application_clocks SET
          application_date = '2027-02-23', version = version + 1, updated_at = now()
        WHERE user_id = ${japanTripFixture.user.id}
      `;
      await database`
        UPDATE goals SET name = 'Changed through demo use', version = version + 1, updated_at = now()
        WHERE id = ${japanTripFixture.goalId}
      `;
      await database`
        UPDATE purchase_items SET
          target_price_cents = 149999, version = version + 1, updated_at = now()
        WHERE id = ${japanTripFixture.purchaseItemId}
      `;
      const repository = new ProductExperienceRepository(database);
      const result = await repository.resetSeededDemo({
        userId: japanTripFixture.user.id,
        goalId: japanTripFixture.goalId,
        expectedGoalVersion: 2,
        requestId: 'integration-demo-reset',
      });
      expect(result.result).toBe('reset');

      const restored = await database<
        {
          readonly application_date: string;
          readonly goal_name: string;
          readonly goal_version: number;
          readonly item_target: string;
          readonly item_version: number;
          readonly session_present: boolean;
          readonly plan_count: string;
          readonly ledger_count: string;
        }[]
      >`
        SELECT clock.application_date::text, goal.name AS goal_name,
          goal.version AS goal_version, item.target_price_cents::text AS item_target,
          item.version AS item_version,
          EXISTS(SELECT 1 FROM sessions WHERE id_hash = ${sessionIdHash}
            AND user_id = ${japanTripFixture.user.id}) AS session_present,
          (SELECT count(*)::text FROM plan_versions WHERE goal_id = goal.id) AS plan_count,
          (SELECT count(*)::text FROM ledger_entries ledger
            JOIN simulated_accounts account ON account.id = ledger.account_id
            WHERE account.goal_id = goal.id) AS ledger_count
        FROM user_application_clocks clock
        JOIN goals goal ON goal.user_id = clock.user_id AND goal.id = ${japanTripFixture.goalId}
        JOIN purchase_items item ON item.goal_id = goal.id AND item.user_id = goal.user_id
        WHERE clock.user_id = ${japanTripFixture.user.id}
      `;
      expect(restored).toEqual([
        {
          application_date: japanTripFixture.applicationDate,
          goal_name: japanTripGoal.name,
          goal_version: 1,
          item_target: String(japanTripFixture.purchaseItemTargetPriceCents),
          item_version: 1,
          session_present: true,
          plan_count: '1',
          ledger_count: '1',
        },
      ]);
    } finally {
      await database`DELETE FROM sessions WHERE id_hash = ${sessionIdHash}`;
      await resetJapanTripFixture(database);
    }
  });

  it('refuses an absent reset capability and seeding cannot adopt an existing user', async () => {
    await database`DELETE FROM users WHERE id = ${japanTripFixture.user.id}`;
    try {
      await expect(resetJapanTripFixture(database)).rejects.toThrow('capability is missing');

      const preservedUsers = await database<{ readonly id: string }[]>`
        SELECT id FROM users WHERE id IN (
          '01K3C8ALEX0000000000000000', '01K3C8SAM00000000000000000'
        ) ORDER BY id
      `;
      expect(preservedUsers).toHaveLength(2);

      await database`
        INSERT INTO users (id, email, display_name, password_hash)
        VALUES (
          ${japanTripFixture.user.id}, ${japanTripFixture.user.email},
          'Unmarked collision', 'not-a-fixture-password-hash'
        )
      `;
      await expect(seedJapanTripFixture(database)).rejects.toThrow('existing unmarked user');
    } finally {
      await database`DELETE FROM users WHERE id = ${japanTripFixture.user.id}`;
      await seedJapanTripFixture(database);
    }
  });
});
