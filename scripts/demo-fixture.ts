import { hashPassword } from '@goalpilot/auth';
import type {
  GoalInput,
  PlanDecisionSummary,
  PlanRationaleCode,
  PreviewOutput,
} from '@goalpilot/contracts';
import type { DatabaseClient } from '@goalpilot/data-access';
import {
  catalogVersion,
  compareVehicles,
  derivePlanHealth,
  generateContributionDates,
  illustrativeAssumptions,
} from '@goalpilot/domain';

import { assertLocalDatabaseUrl } from './runtime-config.js';

type DatabaseTransaction = Parameters<Parameters<DatabaseClient['begin']>[1]>[0];
type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export const japanTripFixture = {
  fixtureKey: 'japan-trip',
  fixtureVersion: 'product-experience-v1',
  applicationDate: '2026-08-23',
  user: {
    id: '01K3C8DEMX0000000000000000',
    email: 'demo.japan@example.test',
    displayName: 'Demo Traveler',
    password: 'GoalPilot-Demo-2026!',
  },
  goalId: '01K3C8DGMX0000000000000000',
  planVersionId: '01K3C8DPMX0000000000000000',
  accountId: '01K3C8DAMX0000000000000000',
  openingLedgerEntryId: '01K3C8DENX0000000000000000',
  purchaseItemId: '01K3C8DTMX0000000000000000',
  priceWatchPolicyId: '01K3C8DWMX0000000000000000',
  purchaseItemTargetPriceCents: 150_000,
} as const;

export const japanTripGoal: GoalInput = {
  name: 'Japan trip',
  category: 'Travel',
  targetAmountCents: 900_000,
  currentSavedCents: 150_000,
  targetDate: '2028-02-23',
  recurringContributionCents: 40_050,
  contributionCadence: 'monthly',
  liquidityNeed: 'within_30_days',
  preservationPreference: 'required',
  confidence: 'expected',
  notes: 'Synthetic seeded demonstration; no real account or money movement.',
};

interface FixtureCalculation {
  readonly projection: PreviewOutput;
  readonly summary: PlanDecisionSummary;
  readonly nextContributionDate: string;
}

function jsonValue(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}

export function calculateJapanTripFixture(): FixtureCalculation {
  const projection = compareVehicles(
    japanTripGoal,
    japanTripFixture.applicationDate,
    illustrativeAssumptions,
  );
  if (projection.zeroInterestBaseline.requiredContributionCents !== 41_667) {
    throw new Error('The reviewed Japan-trip safe contribution has drifted from $416.67.');
  }
  if (projection.recommendedVehicleCode !== 'hysa') {
    throw new Error(
      'The production vehicle-fit engine no longer recommends the seeded HYSA model.',
    );
  }
  const selected = projection.vehicles.find((vehicle) => vehicle.vehicleCode === 'hysa');
  if (selected === undefined || !selected.eligible || !selected.accessRequirementSatisfied) {
    throw new Error('The seeded HYSA model must remain eligible and satisfy the access need.');
  }
  if (selected.assumption.assumptionVersion !== catalogVersion) {
    throw new Error('The seeded HYSA model must use the reviewed illustrative catalog version.');
  }
  if (
    !projection.vehicles.some(
      (vehicle) =>
        (vehicle.vehicleCode === 'cd_ladder' || vehicle.vehicleCode === 'treasury_ladder') &&
        vehicle.rejectionCode === 'LIQUIDITY_CONFLICT',
    )
  ) {
    throw new Error('The seeded comparison must explain a fixed-term access conflict.');
  }

  const currentTotalValueCents = japanTripGoal.currentSavedCents;
  const futurePersonalContributionsCents =
    selected.principalContributedCents - currentTotalValueCents;
  const rationaleCodes: PlanRationaleCode[] = [
    'SAFE_CONTRIBUTION_DOES_NOT_DEPEND_ON_INTEREST',
    'CHOSEN_CONTRIBUTION_BELOW_SAFE_AMOUNT',
    'SELECTED_VEHICLE_SATISFIES_ACCESS_NEED',
    'MODELED_INTEREST_DOES_NOT_REDUCE_COMMITMENT',
  ];
  if (selected.modeledInterestCents > 0 && selected.surplusCents > 0) {
    rationaleCodes.push('MODELED_INTEREST_ADDS_CUSHION');
  }
  rationaleCodes.push(
    selected.projectedCompletionDate === null
      ? 'READINESS_CANNOT_BE_REACHED'
      : selected.projectedCompletionDate < japanTripGoal.targetDate
        ? 'READINESS_IS_BEFORE_TARGET'
        : selected.projectedCompletionDate === japanTripGoal.targetDate
          ? 'READINESS_IS_ON_TARGET'
          : 'READINESS_IS_AFTER_TARGET',
  );
  const health = derivePlanHealth({
    paused: false,
    currentAvailableFundsCents: japanTripGoal.currentSavedCents,
    currentTotalValueCents,
    targetAmountCents: japanTripGoal.targetAmountCents,
    accessConditionsSatisfied: selected.accessRequirementSatisfied,
    projectedPurchaseReadyDate: selected.projectedCompletionDate,
    targetDate: japanTripGoal.targetDate,
    contributionCadence: japanTripGoal.contributionCadence,
  });
  const summary: PlanDecisionSummary = {
    safeContributionCents: projection.zeroInterestBaseline.requiredContributionCents,
    chosenContributionCents: japanTripGoal.recurringContributionCents,
    contributionCadence: japanTripGoal.contributionCadence,
    currentSavingsCents: japanTripGoal.currentSavedCents,
    postedPersonalContributionsCents: 0,
    postedModeledInterestCents: 0,
    currentTotalValueCents,
    currentAvailableFundsCents: japanTripGoal.currentSavedCents,
    futurePersonalContributionsCents,
    futureModeledInterestCents: selected.modeledInterestCents,
    projectedTargetDateBalanceCents: selected.endingBalanceCents,
    cushionCents: selected.surplusCents,
    shortfallCents: selected.shortfallCents,
    projectedReadinessDate: selected.projectedCompletionDate,
    vehicleCode: 'hysa',
    assumptionVersion: selected.assumption.assumptionVersion,
    calculationPolicyVersion: 'product-experience-v1',
    rankingPolicyVersion: projection.rankingPolicyVersion,
    rationaleVersion: 'product-experience-v1',
    rationaleCodes,
    health: health.code,
  };
  const nextContributionDate = generateContributionDates(
    japanTripFixture.applicationDate,
    japanTripGoal.targetDate,
    japanTripGoal.contributionCadence,
  )[0];
  if (nextContributionDate === undefined) {
    throw new Error('The seeded Japan-trip plan requires a future contribution date.');
  }
  return { projection, summary, nextContributionDate };
}

export function assertDemoResetTarget(environment: string | undefined, databaseUrl: string): void {
  if (environment !== 'local' && environment !== 'test') {
    throw new Error('Demo reset is enabled only with ENVIRONMENT=local or ENVIRONMENT=test.');
  }
  assertLocalDatabaseUrl(
    databaseUrl,
    environment === 'test' ? 'goalpilot_test' : 'goalpilot_local',
  );
}

async function restoreFixtureRows(
  transaction: DatabaseTransaction,
  passwordHash: string,
  calculation: FixtureCalculation,
): Promise<void> {
  const fixture = japanTripFixture;
  await transaction`DELETE FROM sessions WHERE user_id = ${fixture.user.id}`;
  await transaction`DELETE FROM goal_drafts WHERE user_id = ${fixture.user.id}`;
  await transaction`DELETE FROM goals WHERE user_id = ${fixture.user.id}`;
  await transaction`DELETE FROM idempotency_records WHERE user_id = ${fixture.user.id}`;
  await transaction`DELETE FROM application_command_claims WHERE user_id = ${fixture.user.id}`;
  await transaction`DELETE FROM audit_events WHERE user_id = ${fixture.user.id}`;
  await transaction`DELETE FROM data_requests WHERE user_id = ${fixture.user.id}`;
  await transaction`DELETE FROM user_application_clocks WHERE user_id = ${fixture.user.id}`;

  await transaction`
    UPDATE users SET
      email = ${fixture.user.email}, display_name = ${fixture.user.displayName},
      password_hash = ${passwordHash}, updated_at = now(), deleted_at = NULL
    WHERE id = ${fixture.user.id}
  `;
  await transaction`
    INSERT INTO user_application_clocks (
      user_id, initial_application_date, application_date, version
    ) VALUES (
      ${fixture.user.id}, ${fixture.applicationDate}, ${fixture.applicationDate}, 1
    )
  `;
  await transaction`
    INSERT INTO goals (
      id, user_id, name, category, target_amount_cents, current_saved_cents, target_date,
      recurring_contribution_cents, contribution_cadence, liquidity_need,
      preservation_preference, confidence, notes, status, version
    ) VALUES (
      ${fixture.goalId}, ${fixture.user.id}, ${japanTripGoal.name},
      ${japanTripGoal.category ?? null}, ${japanTripGoal.targetAmountCents},
      ${japanTripGoal.currentSavedCents}, ${japanTripGoal.targetDate},
      ${japanTripGoal.recurringContributionCents}, ${japanTripGoal.contributionCadence},
      ${japanTripGoal.liquidityNeed}, ${japanTripGoal.preservationPreference},
      ${japanTripGoal.confidence}, ${japanTripGoal.notes ?? null}, 'active', 1
    )
  `;
  const selected = calculation.projection.vehicles.find(
    (vehicle) => vehicle.vehicleCode === 'hysa',
  );
  if (selected === undefined) throw new Error('The seeded HYSA projection is unavailable.');
  await transaction`
    INSERT INTO plan_versions (
      id, goal_id, user_id, version, vehicle_code, assumption_version,
      normalized_input, calculation_output, calculation_context,
      application_date, schedule_anchor_date,
      calculation_policy_version, ranking_policy_version, health_policy_version,
      change_kind, change_reason_code
    ) VALUES (
      ${fixture.planVersionId}, ${fixture.goalId}, ${fixture.user.id}, 1, 'hysa',
      ${selected.assumption.assumptionVersion}, ${transaction.json(jsonValue(japanTripGoal))},
      ${transaction.json(
        jsonValue({ ...calculation.projection, decisionSummary: calculation.summary }),
      )},
      ${transaction.json(
        jsonValue({
          contextVersion: 'plan-calculation-context-v1',
          personalPrincipalCents: japanTripGoal.currentSavedCents,
          totalLedgerValueCents: japanTripGoal.currentSavedCents,
          currentAvailableFundsCents: japanTripGoal.currentSavedCents,
          currentAccruedInterestMicros: 0,
          applicationDate: fixture.applicationDate,
          scheduleAnchorDate: fixture.applicationDate,
          omittedContributionDates: [],
          fixedTermLots: [],
        }),
      )},
      ${fixture.applicationDate}, ${fixture.applicationDate}, 'product-experience-v1',
      ${calculation.projection.rankingPolicyVersion}, 'plan-health-v1',
      'initial_activation', 'INITIAL_ACTIVATION'
    )
  `;
  await transaction`
    INSERT INTO simulated_accounts (
      id, goal_id, user_id, plan_version_id, status, next_contribution_date,
      last_processed_date, last_accrual_date
    ) VALUES (
      ${fixture.accountId}, ${fixture.goalId}, ${fixture.user.id}, ${fixture.planVersionId},
      'active', ${calculation.nextContributionDate}, ${fixture.applicationDate},
      ${fixture.applicationDate}
    )
  `;
  await transaction`
    INSERT INTO ledger_entries (
      id, account_id, user_id, entry_type, principal_cents, effective_date, description
    ) VALUES (
      ${fixture.openingLedgerEntryId}, ${fixture.accountId}, ${fixture.user.id},
      'account_opened', ${japanTripGoal.currentSavedCents}, ${fixture.applicationDate},
      'Opening simulated savings'
    )
  `;
  await transaction`
    INSERT INTO purchase_items (
      id, user_id, goal_id, fixture_code, display_name, currency,
      target_price_cents, version, lifecycle
    ) VALUES (
      ${fixture.purchaseItemId}, ${fixture.user.id}, ${fixture.goalId},
      'synthetic_oled_65_v1', '65-inch OLED television', 'USD',
      ${fixture.purchaseItemTargetPriceCents}, 1, 'active'
    )
  `;
  await transaction`
    INSERT INTO price_watch_policies (
      id, purchase_item_id, user_id, version, cadence, next_due_date,
      freshness_limit_days, analysis_policy_version, enabled
    ) VALUES (
      ${fixture.priceWatchPolicyId}, ${fixture.purchaseItemId}, ${fixture.user.id},
      1, 'weekly', ${fixture.applicationDate}, 14, 'purchase-timing-v1', true
    )
  `;
}

async function fixturePasswordHash(): Promise<string> {
  return hashPassword(
    japanTripFixture.user.password,
    Buffer.from(japanTripFixture.user.id.slice(0, 16)),
  );
}

export async function seedJapanTripFixture(database: DatabaseClient): Promise<void> {
  const calculation = calculateJapanTripFixture();
  const passwordHash = await fixturePasswordHash();
  await database.begin(async (transaction) => {
    await transaction`SELECT pg_advisory_xact_lock(hashtextextended('goalpilot:japan-trip-fixture', 0))`;
    const capabilities = await transaction<
      { readonly user_id: string; readonly fixture_version: string }[]
    >`
      SELECT user_id, fixture_version FROM demo_fixture_users
      WHERE fixture_key = ${japanTripFixture.fixtureKey}
      FOR UPDATE
    `;
    const capability = capabilities[0];
    if (capability !== undefined && capability.user_id !== japanTripFixture.user.id) {
      throw new Error('The Japan-trip fixture capability belongs to an unexpected user.');
    }
    if (
      capability !== undefined &&
      capability.fixture_version !== japanTripFixture.fixtureVersion
    ) {
      throw new Error('The Japan-trip fixture capability version is unsupported.');
    }
    const existingUsers = await transaction<{ readonly id: string; readonly email: string }[]>`
      SELECT id, email FROM users
      WHERE id = ${japanTripFixture.user.id} OR email = ${japanTripFixture.user.email}
      FOR UPDATE
    `;
    if (capability === undefined && existingUsers.length > 0) {
      throw new Error(
        'Fixture seeding refused to grant reset capability to an existing unmarked user.',
      );
    }
    await transaction`
      INSERT INTO users (id, email, display_name, password_hash)
      VALUES (
        ${japanTripFixture.user.id}, ${japanTripFixture.user.email},
        ${japanTripFixture.user.displayName}, ${passwordHash}
      )
      ON CONFLICT (id) DO NOTHING
    `;
    if (capability === undefined) {
      await transaction`
        INSERT INTO demo_fixture_users (user_id, fixture_key, fixture_version, reset_generation)
        VALUES (
          ${japanTripFixture.user.id}, ${japanTripFixture.fixtureKey},
          ${japanTripFixture.fixtureVersion}, 0
        )
      `;
    }
    await restoreFixtureRows(transaction, passwordHash, calculation);
  });
}

export async function resetJapanTripFixture(
  database: DatabaseClient,
): Promise<{ readonly resetGeneration: number }> {
  const calculation = calculateJapanTripFixture();
  const passwordHash = await fixturePasswordHash();
  return database.begin(async (transaction) => {
    await transaction`SELECT pg_advisory_xact_lock(hashtextextended('goalpilot:japan-trip-fixture', 0))`;
    const capabilities = await transaction<
      { readonly fixture_version: string; readonly reset_generation: number }[]
    >`
      SELECT fixture_version, reset_generation FROM demo_fixture_users
      WHERE user_id = ${japanTripFixture.user.id}
        AND fixture_key = ${japanTripFixture.fixtureKey}
      FOR UPDATE
    `;
    const capability = capabilities[0];
    if (capability === undefined) {
      throw new Error('Demo reset refused: the seeded fixture capability is missing.');
    }
    if (capability.fixture_version !== japanTripFixture.fixtureVersion) {
      throw new Error('Demo reset refused: the seeded fixture version is unsupported.');
    }
    await restoreFixtureRows(transaction, passwordHash, calculation);
    const updated = await transaction<{ readonly reset_generation: number }[]>`
      UPDATE demo_fixture_users SET
        reset_generation = reset_generation + 1,
        updated_at = now()
      WHERE user_id = ${japanTripFixture.user.id}
        AND fixture_key = ${japanTripFixture.fixtureKey}
      RETURNING reset_generation
    `;
    const resetGeneration = updated[0]?.reset_generation;
    if (resetGeneration === undefined) {
      throw new Error('Demo reset failed to advance its fixture generation.');
    }
    return { resetGeneration };
  });
}
