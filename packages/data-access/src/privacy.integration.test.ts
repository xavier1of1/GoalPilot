import { createHash } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ulid } from 'ulid';

import {
  createDatabaseClient,
  GoalPilotRepository,
  type DatabaseClient,
  userDataExportSchemaVersion,
} from './index.js';

function testDatabaseUrl(): string {
  const requestedEnvironment = process.env['ENVIRONMENT'];
  const requestedNodeEnvironment = process.env['NODE_ENV'];
  process.loadEnvFile('.env.local');
  if (requestedEnvironment !== 'test' || requestedNodeEnvironment !== 'test') {
    throw new Error('Privacy integration tests require ENVIRONMENT=test and NODE_ENV=test.');
  }
  const value = process.env['TEST_DATABASE_URL'];
  if (value === undefined) throw new Error('TEST_DATABASE_URL is required for integration tests.');
  const parsed = new URL(value);
  if (
    !['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname.toLowerCase()) ||
    decodeURIComponent(parsed.pathname.slice(1)) !== 'goalpilot_test'
  ) {
    throw new Error(
      'Privacy integration tests require the exact loopback goalpilot_test database.',
    );
  }
  return value;
}

describe('versioned privacy export and deletion boundary', () => {
  let database: DatabaseClient;
  let repository: GoalPilotRepository;

  beforeAll(() => {
    database = createDatabaseClient(testDatabaseUrl(), 2);
    repository = new GoalPilotRepository(database);
  });

  afterAll(async () => database.end());

  it('exports all owned product records and cascades them without exporting operational secrets', async () => {
    const runKey = ulid();
    const passwordHashSecret = `private-password-hash-${runKey}`;
    const sessionIdHash = createHash('sha256').update(`session:${runKey}`).digest('hex');
    const csrfHash = createHash('sha256').update(`csrf:${runKey}`).digest('hex');
    const requestHash = createHash('sha256').update(`request:${runKey}`).digest('hex');
    const auditSecret = `private-audit-metadata-${runKey}`;
    const idempotencyResponseSecret = `private-idempotency-response-${runKey}`;
    const operationalKey = `privacy-${runKey}`;
    const deletionSubjectHash = createHash('sha256')
      .update(`deleted-privacy:${runKey}`)
      .digest('hex');
    const ids = {
      draft: ulid(),
      goal: ulid(),
      firstPlan: ulid(),
      secondPlan: ulid(),
      account: ulid(),
      opening: ulid(),
      contribution: ulid(),
      interest: ulid(),
      planChanged: ulid(),
      schedule: ulid(),
      item: ulid(),
      policy: ulid(),
      run: ulid(),
      runWorkerToken: ulid(),
      observation: ulid(),
      assessment: ulid(),
      claimToken: ulid(),
      audit: ulid(),
      dataRequest: ulid(),
    } as const;

    const user = await repository.createUser({
      email: `privacy-export-${runKey.toLowerCase()}@example.test`,
      passwordHash: passwordHashSecret,
      displayName: 'Privacy Export Fixture',
    });
    try {
      const assumptions = await database<{ version: string }[]>`
        SELECT version FROM vehicle_assumptions
        WHERE vehicle_code = 'hysa' AND enabled = true
        ORDER BY version DESC LIMIT 1
      `;
      const assumptionVersion = assumptions[0]?.version;
      if (assumptionVersion === undefined) {
        throw new Error('The deterministic HYSA assumption must be seeded for integration tests.');
      }

      await database.begin(async (transaction) => {
        await transaction`
          UPDATE user_application_clocks SET
            application_date = '2026-09-23', version = version + 1, updated_at = now()
          WHERE user_id = ${user.id}
        `;
        await transaction`
          INSERT INTO goal_drafts (
            id, user_id, draft_data, last_completed_step, version
          ) VALUES (
            ${ids.draft}, ${user.id},
            ${transaction.json({
              name: 'Private purchase draft',
              targetAmountCents: 250_000,
              currentSavedCents: 25_000,
              notes: 'Owned draft content belongs in the export.',
            })},
            'starting_point', 3
          )
        `;
        await transaction`
          INSERT INTO goals (
            id, user_id, name, category, target_amount_cents, current_saved_cents,
            target_date, recurring_contribution_cents, contribution_cadence,
            liquidity_need, preservation_preference, confidence, notes, status, version
          ) VALUES (
            ${ids.goal}, ${user.id}, 'Privacy regression goal', 'purchase', 500000,
            125000, '2028-12-23', 10000, 'monthly', 'anytime', 'required', 'expected',
            'Owned goal notes', 'active', 2
          )
        `;
        await transaction`
          INSERT INTO plan_versions (
            id, goal_id, user_id, version, vehicle_code, assumption_version,
            normalized_input, calculation_output, calculation_context,
            application_date, schedule_anchor_date, calculation_policy_version,
            ranking_policy_version, health_policy_version, change_kind,
            change_reason_code
          ) VALUES (
            ${ids.firstPlan}, ${ids.goal}, ${user.id}, 1, 'hysa', ${assumptionVersion},
            ${transaction.json({
              targetAmountCents: 500_000,
              currentSavedCents: 125_000,
              targetDate: '2028-08-23',
              recurringContributionCents: 10_000,
              contributionCadence: 'monthly',
              liquidityNeed: 'anytime',
              preservationPreference: 'required',
              confidence: 'expected',
            })},
            ${transaction.json({
              asOfDate: '2026-08-23',
              projectedFinalBalanceCents: 510_000,
            })},
            ${transaction.json({
              contextVersion: 'plan-calculation-context-v1',
              personalPrincipalCents: 125_000,
              totalLedgerValueCents: 125_000,
              currentAvailableFundsCents: 125_000,
              currentAccruedInterestMicros: 0,
              applicationDate: '2026-08-23',
              scheduleAnchorDate: '2026-08-23',
              omittedContributionDates: [],
              fixedTermLots: [],
            })},
            '2026-08-23', '2026-08-23', 'product-experience-v1', 'vehicle-fit-v1',
            'plan-health-v1', 'initial_activation', 'INITIAL_ACTIVATION'
          )
        `;
        await transaction`
          INSERT INTO simulated_accounts (
            id, goal_id, user_id, plan_version_id, status, next_contribution_date,
            last_processed_date, last_accrual_date, accrued_interest_micros
          ) VALUES (
            ${ids.account}, ${ids.goal}, ${user.id}, ${ids.firstPlan}, 'active',
            '2026-09-23', '2026-08-23', '2026-08-23', 0
          )
        `;
        await transaction`
          INSERT INTO ledger_entries (
            id, account_id, user_id, entry_type, principal_cents, effective_date,
            occurrence_id, description
          ) VALUES (
            ${ids.opening}, ${ids.account}, ${user.id}, 'account_opened', 125000,
            '2026-08-23', 'privacy-opening', 'Opening simulated balance'
          )
        `;
        await transaction`
          INSERT INTO ledger_entries (
            id, account_id, user_id, entry_type, principal_cents, effective_date,
            occurrence_id, description
          ) VALUES (
            ${ids.contribution}, ${ids.account}, ${user.id}, 'contribution_posted', 10000,
            '2026-09-23', 'privacy-contribution', 'Posted simulated contribution'
          )
        `;
        await transaction`
          INSERT INTO schedule_occurrences (id, account_id, user_id, due_date, status)
          VALUES (${ids.schedule}, ${ids.account}, ${user.id}, '2026-09-23', 'posted')
        `;
        await transaction`
          INSERT INTO ledger_entries (
            id, account_id, user_id, entry_type, interest_cents, effective_date,
            occurrence_id, description
          ) VALUES (
            ${ids.interest}, ${ids.account}, ${user.id}, 'interest_posted', 123,
            '2026-09-23', 'privacy-interest', 'Posted illustrative interest'
          )
        `;
        await transaction`
          INSERT INTO interest_posting_periods (
            account_id, period_end, ledger_entry_id, user_id
          ) VALUES (${ids.account}, '2026-09-23', ${ids.interest}, ${user.id})
        `;
        await transaction`
          INSERT INTO plan_versions (
            id, goal_id, user_id, version, vehicle_code, assumption_version,
            normalized_input, calculation_output, calculation_context,
            application_date, schedule_anchor_date, calculation_policy_version,
            ranking_policy_version, health_policy_version, change_kind, changed_field,
            change_reason_code, change_payload, base_plan_version_id
          ) VALUES (
            ${ids.secondPlan}, ${ids.goal}, ${user.id}, 2, 'hysa', ${assumptionVersion},
            ${transaction.json({
              targetAmountCents: 500_000,
              currentSavedCents: 135_000,
              targetDate: '2028-12-23',
              recurringContributionCents: 10_000,
              contributionCadence: 'monthly',
              liquidityNeed: 'anytime',
              preservationPreference: 'required',
              confidence: 'expected',
            })},
            ${transaction.json({
              asOfDate: '2026-09-23',
              projectedFinalBalanceCents: 525_000,
            })},
            ${transaction.json({
              contextVersion: 'plan-calculation-context-v1',
              personalPrincipalCents: 135_000,
              totalLedgerValueCents: 135_123,
              currentAvailableFundsCents: 135_123,
              currentAccruedInterestMicros: 456_789,
              applicationDate: '2026-09-23',
              scheduleAnchorDate: '2026-08-23',
              omittedContributionDates: [],
              fixedTermLots: [],
            })},
            '2026-09-23', '2026-08-23', 'product-experience-v1', 'vehicle-fit-v1',
            'plan-health-v1', 'scenario_applied', 'target_date', 'USER_DEADLINE_CHANGED',
            ${transaction.json({ targetDate: '2028-12-23' })}, ${ids.firstPlan}
          )
        `;
        await transaction`
          UPDATE simulated_accounts SET
            plan_version_id = ${ids.secondPlan}, next_contribution_date = '2026-10-23',
            last_processed_date = '2026-09-23', last_accrual_date = '2026-09-23',
            accrued_interest_micros = 456789, updated_at = now()
          WHERE id = ${ids.account} AND user_id = ${user.id}
        `;
        await transaction`
          INSERT INTO ledger_entries (
            id, account_id, user_id, entry_type, effective_date, occurrence_id, description
          ) VALUES (
            ${ids.planChanged}, ${ids.account}, ${user.id}, 'plan_changed', '2026-09-23',
            'privacy-plan-change', 'Applied a deadline scenario'
          )
        `;
        await transaction`
          INSERT INTO purchase_items (
            id, user_id, goal_id, fixture_code, display_name, currency,
            target_price_cents, version, lifecycle
          ) VALUES (
            ${ids.item}, ${user.id}, ${ids.goal}, 'synthetic_oled_65_v1',
            '65-inch OLED television', 'USD', 150000, 1, 'active'
          )
        `;
        await transaction`
          INSERT INTO price_watch_policies (
            id, purchase_item_id, user_id, version, cadence, next_due_date
          ) VALUES (${ids.policy}, ${ids.item}, ${user.id}, 1, 'weekly', '2026-09-23')
        `;
        await transaction`
          INSERT INTO price_check_runs (
            id, price_watch_policy_id, purchase_item_id, user_id, application_date,
            fixture_source_version, fixture_source_checksum,
            worker_claim_token, worker_lease_expires_at
          ) VALUES (
            ${ids.run}, ${ids.policy}, ${ids.item}, ${user.id}, '2026-09-23',
            'privacy-prices-v1', ${'a'.repeat(64)}, ${ids.runWorkerToken},
            now() + interval '10 minutes'
          )
        `;
        await transaction`
          INSERT INTO price_observations (
            id, price_check_run_id, purchase_item_id, user_id, fixture_source_version,
            observation_key, observed_on, price_cents, currency
          ) VALUES (
            ${ids.observation}, ${ids.run}, ${ids.item}, ${user.id}, 'privacy-prices-v1',
            'privacy-observation-1', '2026-09-23', 140000, 'USD'
          )
        `;
        await transaction`
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
            ${ids.assessment}, ${ids.run}, ${ids.item}, ${ids.goal}, ${user.id}, 1,
            ${ids.secondPlan}, 2, 'active', 'ON_TRACK', 'privacy-prices-v1', ${'a'.repeat(64)},
            '2026-09-23', 'USD', 'INSUFFICIENT_DATA',
            ARRAY['INSUFFICIENT_OBSERVATION_COUNT'], 1, '2026-09-23', '2026-09-23', 0, 0,
            140000, 150000, 140000, 140000, 140000, 5000, 0, -10000
          )
        `;
        await transaction`
          UPDATE price_check_runs SET status = 'completed', completed_at = now(),
            worker_claim_token = NULL, worker_lease_expires_at = NULL
          WHERE id = ${ids.run}
        `;

        await transaction`
          INSERT INTO sessions (
            id_hash, user_id, csrf_hash, expires_at, absolute_expires_at
          ) VALUES (
            ${sessionIdHash}, ${user.id}, ${csrfHash}, now() + interval '1 day',
            now() + interval '2 days'
          )
        `;
        await transaction`
          INSERT INTO idempotency_records (
            user_id, operation, key, request_hash, response_status, response_body
          ) VALUES (
            ${user.id}, 'privacy.fixture', ${operationalKey}, ${requestHash}, 201,
            ${transaction.json({ privateValue: idempotencyResponseSecret })}
          )
        `;
        await transaction`
          INSERT INTO application_command_claims (
            user_id, operation, key, request_hash, state, claim_token, lease_expires_at
          ) VALUES (
            ${user.id}, 'privacy.fixture', ${operationalKey}, ${requestHash}, 'claimed',
            ${ids.claimToken}, now() + interval '5 minutes'
          )
        `;
        await transaction`
          INSERT INTO audit_events (id, user_id, event_name, resource_id, metadata)
          VALUES (
            ${ids.audit}, ${user.id}, 'privacy.fixture', ${ids.goal},
            ${transaction.json({ privateValue: auditSecret })}
          )
        `;
        await transaction`
          INSERT INTO data_requests (id, user_id, request_type, status)
          VALUES (${ids.dataRequest}, ${user.id}, 'export', 'pending')
        `;
      });

      const demoCapabilities = await database<{ user_id: string }[]>`
        SELECT user_id FROM demo_fixture_users WHERE fixture_key = 'japan-trip'
      `;
      const demoUserId = demoCapabilities[0]?.user_id;
      if (demoUserId === undefined) throw new Error('The seeded demo capability is missing.');
      const demoExport = await repository.exportUserData(demoUserId);
      expect(demoExport?.demoFixtureCapability).toMatchObject({
        fixtureKey: 'japan-trip',
        fixtureVersion: 'product-experience-v1',
      });

      const exported = await repository.exportUserData(user.id);
      if (exported === null) throw new Error('The owned privacy fixture must be exportable.');
      expect(exported.schemaVersion).toBe(userDataExportSchemaVersion);
      expect(Number.isNaN(Date.parse(exported.exportedAt))).toBe(false);
      expect(exported.user).toMatchObject({
        id: user.id,
        email: user.email,
        displayName: 'Privacy Export Fixture',
      });
      expect(exported.goalDrafts).toHaveLength(1);
      expect(exported.goalDrafts[0]).toMatchObject({
        id: ids.draft,
        schemaVersion: 'goal-draft-v1',
        lastCompletedStep: 'starting_point',
        version: 3,
      });
      expect(exported.goalDrafts[0]?.['draftData']).toMatchObject({
        name: 'Private purchase draft',
      });
      expect(exported.userApplicationClock).toMatchObject({
        initialApplicationDate: '2026-08-23',
        applicationDate: '2026-09-23',
        version: 2,
      });
      expect(exported.demoFixtureCapability).toBeNull();
      expect(exported.goals).toEqual([
        expect.objectContaining({ id: ids.goal, version: 2, status: 'active' }),
      ]);
      expect(exported.planVersions).toHaveLength(2);
      expect(Object.keys(exported.planVersions[1] ?? {}).sort()).toEqual(
        [
          'applicationDate',
          'assumptionVersion',
          'basePlanVersionId',
          'calculationContext',
          'calculationOutput',
          'calculationPolicyVersion',
          'changeKind',
          'changePayload',
          'changeReasonCode',
          'changedField',
          'createdAt',
          'goalId',
          'healthPolicyVersion',
          'id',
          'normalizedInput',
          'omittedContributionDates',
          'rankingPolicyVersion',
          'scheduleAnchorDate',
          'vehicleCode',
          'version',
        ].sort(),
      );
      expect(exported.planVersions[1]).toMatchObject({
        id: ids.secondPlan,
        goalId: ids.goal,
        version: 2,
        changeKind: 'scenario_applied',
        changedField: 'target_date',
        changeReasonCode: 'USER_DEADLINE_CHANGED',
        changePayload: { targetDate: '2028-12-23' },
        basePlanVersionId: ids.firstPlan,
      });
      expect(exported.planVersions[1]?.['calculationContext']).toMatchObject({
        contextVersion: 'plan-calculation-context-v1',
        personalPrincipalCents: 135_000,
        totalLedgerValueCents: 135_123,
        currentAccruedInterestMicros: 456_789,
      });
      expect(exported.simulatedAccounts).toEqual([
        expect.objectContaining({ id: ids.account, planVersionId: ids.secondPlan }),
      ]);
      expect(exported.ledgerEntries).toHaveLength(4);
      expect(exported.ledgerEntries).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: ids.opening, principalCents: 125_000 }),
          expect.objectContaining({ id: ids.contribution, principalCents: 10_000 }),
          expect.objectContaining({ id: ids.interest, interestCents: 123 }),
          expect.objectContaining({ id: ids.planChanged, entryType: 'plan_changed' }),
        ]),
      );
      expect(exported.scheduleOccurrences).toEqual([
        expect.objectContaining({ id: ids.schedule, accountId: ids.account, status: 'posted' }),
      ]);
      expect(exported.interestPostingPeriods).toEqual([
        { accountId: ids.account, ledgerEntryId: ids.interest, periodEnd: '2026-09-23' },
      ]);
      expect(exported.purchaseTiming.items).toEqual([
        expect.objectContaining({ id: ids.item, goalId: ids.goal, targetPriceCents: 150_000 }),
      ]);
      expect(exported.purchaseTiming.watchPolicies).toEqual([
        expect.objectContaining({ id: ids.policy, analysisPolicyVersion: 'purchase-timing-v1' }),
      ]);
      expect(exported.purchaseTiming.checkRuns).toEqual([
        expect.objectContaining({ id: ids.run, status: 'completed' }),
      ]);
      expect(Object.keys(exported.purchaseTiming.checkRuns[0] ?? {}).sort()).toEqual(
        [
          'applicationDate',
          'attemptCount',
          'claimedAt',
          'completedAt',
          'errorCode',
          'fixtureSourceChecksum',
          'fixtureSourceVersion',
          'id',
          'priceWatchPolicyId',
          'purchaseItemId',
          'status',
        ].sort(),
      );
      expect(exported.purchaseTiming.observations).toEqual([
        expect.objectContaining({
          id: ids.observation,
          observationKey: 'privacy-observation-1',
          priceCents: 140_000,
        }),
      ]);
      expect(exported.purchaseTiming.assessments).toEqual([
        expect.objectContaining({
          id: ids.assessment,
          planVersionId: ids.secondPlan,
          assessmentState: 'INSUFFICIENT_DATA',
          observationCount: 1,
        }),
      ]);

      expect(exported).not.toHaveProperty('sessions');
      expect(exported).not.toHaveProperty('idempotencyRecords');
      expect(exported).not.toHaveProperty('applicationCommandClaims');
      expect(exported).not.toHaveProperty('auditEvents');
      expect(exported).not.toHaveProperty('productEvents');
      expect(exported).not.toHaveProperty('dataRequests');
      const serializedExport = JSON.stringify(exported);
      for (const excludedValue of [
        passwordHashSecret,
        sessionIdHash,
        csrfHash,
        requestHash,
        auditSecret,
        idempotencyResponseSecret,
        operationalKey,
        ids.runWorkerToken,
      ]) {
        expect(serializedExport).not.toContain(excludedValue);
      }
      expect(serializedExport).not.toContain('01K3C8ALEX0000000000000000');

      await database.begin(async (transaction) => {
        await transaction`
          UPDATE goals SET status = 'archived', archive_reason = 'USER_REQUESTED',
            archived_at = now(), updated_at = now()
          WHERE id = ${ids.goal} AND user_id = ${user.id}
        `;
        await transaction`
          UPDATE simulated_accounts SET status = 'completed'
          WHERE id = ${ids.account} AND user_id = ${user.id}
        `;
      });
      const userRequestedArchive = await repository.exportUserData(user.id);
      expect(userRequestedArchive?.simulatedAccounts).toEqual([
        expect.objectContaining({ id: ids.account, status: 'archived' }),
      ]);

      await database`
        UPDATE goals SET archive_reason = 'NO_LONGER_PURSUED', updated_at = now()
        WHERE id = ${ids.goal} AND user_id = ${user.id}
      `;
      const noLongerPursuedArchive = await repository.exportUserData(user.id);
      expect(noLongerPursuedArchive?.simulatedAccounts).toEqual([
        expect.objectContaining({ id: ids.account, status: 'archived' }),
      ]);

      await database`
        UPDATE goals SET archive_reason = 'GOAL_COMPLETED', updated_at = now()
        WHERE id = ${ids.goal} AND user_id = ${user.id}
      `;
      const completedArchive = await repository.exportUserData(user.id);
      expect(completedArchive?.simulatedAccounts).toEqual([
        expect.objectContaining({ id: ids.account, status: 'completed' }),
      ]);

      await expect(repository.deleteAccount(user.id, deletionSubjectHash)).resolves.toBe(true);
      await expect(repository.exportUserData(user.id)).resolves.toBeNull();
      const deletedOwnedRows = await database<
        {
          users: string;
          sessions: string;
          drafts: string;
          clocks: string;
          capabilities: string;
          goals: string;
          plans: string;
          accounts: string;
          ledger: string;
          schedules: string;
          interest_periods: string;
          idempotency_records: string;
          command_claims: string;
          data_requests: string;
          items: string;
          policies: string;
          runs: string;
          observations: string;
          assessments: string;
        }[]
      >`
        SELECT
          (SELECT count(*) FROM users WHERE id = ${user.id}) AS users,
          (SELECT count(*) FROM sessions WHERE user_id = ${user.id}) AS sessions,
          (SELECT count(*) FROM goal_drafts WHERE user_id = ${user.id}) AS drafts,
          (SELECT count(*) FROM user_application_clocks WHERE user_id = ${user.id}) AS clocks,
          (SELECT count(*) FROM demo_fixture_users WHERE user_id = ${user.id}) AS capabilities,
          (SELECT count(*) FROM goals WHERE user_id = ${user.id}) AS goals,
          (SELECT count(*) FROM plan_versions WHERE user_id = ${user.id}) AS plans,
          (SELECT count(*) FROM simulated_accounts WHERE user_id = ${user.id}) AS accounts,
          (SELECT count(*) FROM ledger_entries WHERE user_id = ${user.id}) AS ledger,
          (SELECT count(*) FROM schedule_occurrences WHERE user_id = ${user.id}) AS schedules,
          (SELECT count(*) FROM interest_posting_periods
            WHERE user_id = ${user.id}) AS interest_periods,
          (SELECT count(*) FROM idempotency_records
            WHERE user_id = ${user.id}) AS idempotency_records,
          (SELECT count(*) FROM application_command_claims
            WHERE user_id = ${user.id}) AS command_claims,
          (SELECT count(*) FROM data_requests WHERE user_id = ${user.id}) AS data_requests,
          (SELECT count(*) FROM purchase_items WHERE user_id = ${user.id}) AS items,
          (SELECT count(*) FROM price_watch_policies WHERE user_id = ${user.id}) AS policies,
          (SELECT count(*) FROM price_check_runs WHERE user_id = ${user.id}) AS runs,
          (SELECT count(*) FROM price_observations WHERE user_id = ${user.id}) AS observations,
          (SELECT count(*) FROM purchase_timing_assessments
            WHERE user_id = ${user.id}) AS assessments
      `;
      expect(Object.values(deletedOwnedRows[0] ?? {})).toEqual(Array(19).fill('0'));

      const retainedAudits = await database<
        {
          user_id: string | null;
          pseudonymous_subject_hash: string;
          resource_id: string | null;
          metadata: Readonly<Record<string, unknown>>;
        }[]
      >`
        SELECT user_id, pseudonymous_subject_hash, resource_id, metadata
        FROM audit_events WHERE pseudonymous_subject_hash = ${deletionSubjectHash}
      `;
      expect(retainedAudits).toHaveLength(2);
      expect(
        retainedAudits.every(
          (event) =>
            event.user_id === null &&
            event.resource_id === null &&
            Object.keys(event.metadata).length === 0,
        ),
      ).toBe(true);
    } finally {
      await repository.deleteAccount(user.id, deletionSubjectHash);
      await database`
        DELETE FROM audit_events
        WHERE pseudonymous_subject_hash = ${deletionSubjectHash} OR user_id = ${user.id}
      `;
    }
  }, 60_000);
});
