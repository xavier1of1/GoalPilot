import type {
  GoalDto,
  GoalInput,
  HistoricalPriceObservation,
  HistoricalPriceSeries,
  PriceCheckRunSummary,
  PriceWatchPolicy,
  PurchaseItem,
  PurchaseTimingAssessment,
  PurchaseTimingLatestOutput,
  VehicleCode,
} from '@goalpilot/contracts';
import type postgres from 'postgres';
import { ulid } from 'ulid';

import type { DatabaseClient } from './database.js';
import { IdempotencyConflictError, StateConflictError } from './repository.js';

type PurchaseItemRow = postgres.Row & {
  readonly id: string;
  readonly goal_id: string;
  readonly fixture_code: PurchaseItem['fixtureCode'];
  readonly display_name: PurchaseItem['displayName'];
  readonly currency: PurchaseItem['currency'];
  readonly target_price_cents: string;
  readonly lifecycle: PurchaseItem['lifecycle'];
  readonly version: number;
  readonly created_at: Date;
  readonly updated_at: Date;
};

type WatchPolicyRow = postgres.Row & {
  readonly id: string;
  readonly purchase_item_id: string;
  readonly version: number;
  readonly cadence: PriceWatchPolicy['cadence'];
  readonly next_due_date: string | Date;
  readonly freshness_limit_days: 14;
  readonly analysis_policy_version: 'purchase-timing-v1';
  readonly enabled: boolean;
  readonly created_at: Date;
};

type AssessmentRow = postgres.Row & {
  readonly id: string;
  readonly price_check_run_id: string;
  readonly purchase_item_id: string;
  readonly plan_version_number: number | null;
  readonly plan_lifecycle: StoredTimingAssessmentInput['planLifecycle'];
  readonly plan_health: PurchaseTimingAssessment['planHealth'];
  readonly target_price_cents: string;
  readonly assessment_state: PurchaseTimingAssessment['state'];
  readonly analysis_policy_version: 'purchase-timing-v1';
  readonly fixture_source_version: string;
  readonly fixture_source_checksum: string;
  readonly as_of_date: string | Date;
  readonly rationale_codes: PurchaseTimingAssessment['rationaleCodes'];
  readonly observation_count: number;
  readonly data_span_days: number;
  readonly freshness_days: number;
  readonly current_price_cents: string;
  readonly minimum_price_cents: string;
  readonly median_price_cents: string;
  readonly maximum_price_cents: string;
  readonly current_percentile_basis_points: number;
  readonly difference_from_median_cents: string;
  readonly difference_from_target_cents: string;
  readonly seasonal_summary: PurchaseTimingAssessment['seasonal'];
  readonly created_at: Date;
};

export interface PurchaseTimingPlanContext {
  readonly goalId: string;
  readonly goalVersion: number;
  readonly goalStatus: GoalDto['status'];
  readonly targetAmountCents: number;
  readonly targetDate: string;
  readonly contributionCadence: GoalInput['contributionCadence'];
  readonly planVersionId: string | null;
  readonly planVersion: number | null;
  readonly vehicleCode: VehicleCode | null;
  readonly normalizedInput: GoalInput | null;
  readonly calculationOutput: unknown;
  readonly accountStatus: 'active' | 'paused' | 'purchase_ready' | 'completed' | null;
  readonly nextContributionDate: string | null;
  readonly lastProcessedDate: string | null;
  readonly lastAccrualDate: string | null;
  readonly accruedInterestMicros: number;
  readonly ledgerBalanceCents: number;
  readonly ledgerEntryCount: number;
  readonly availableBalanceCents: number;
}

export interface DuePriceWatch {
  readonly policy: PriceWatchPolicy;
  readonly item: PurchaseItem;
  readonly plan: PurchaseTimingPlanContext;
}

export interface PriceCheckClaim {
  readonly runId: string;
  readonly status: 'claimed' | 'in_progress' | 'completed' | 'failed';
  readonly claimToken: string | null;
  readonly replayed: boolean;
  readonly sourceVersion: string | null;
  readonly sourceChecksum: string | null;
  readonly errorCode: PriceCheckRunSummary['errorCodes'][number] | null;
}

export interface StoredTimingAssessmentInput {
  readonly currentPlanVersionId: string | null;
  readonly currentPlanVersion: number | null;
  readonly planLifecycle: 'draft' | 'active' | 'completed' | 'archived';
  readonly planHealth: PurchaseTimingAssessment['planHealth'];
  readonly state: PurchaseTimingAssessment['state'];
  readonly rationaleCodes: readonly PurchaseTimingAssessment['rationaleCodes'][number][];
  readonly statistics: PurchaseTimingAssessment['statistics'];
  readonly seasonal: PurchaseTimingAssessment['seasonal'];
}

function calendarDate(value: string | Date): string {
  return typeof value === 'string' ? value : value.toISOString().slice(0, 10);
}

function jsonValue(value: unknown): postgres.JSONValue {
  return JSON.parse(JSON.stringify(value)) as postgres.JSONValue;
}

function mapItem(row: PurchaseItemRow): PurchaseItem {
  return {
    id: row.id,
    goalId: row.goal_id,
    fixtureCode: row.fixture_code,
    displayName: row.display_name,
    currency: row.currency,
    targetPriceCents: Number(row.target_price_cents),
    lifecycle: row.lifecycle,
    version: row.version,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function mapPolicy(row: WatchPolicyRow): PriceWatchPolicy {
  return {
    id: row.id,
    purchaseItemId: row.purchase_item_id,
    version: row.version,
    cadence: row.cadence,
    nextDueDate: calendarDate(row.next_due_date),
    freshnessLimitDays: row.freshness_limit_days,
    analysisPolicyVersion: row.analysis_policy_version,
    enabled: row.enabled,
    createdAt: row.created_at.toISOString(),
  };
}

function mapAssessment(row: AssessmentRow): PurchaseTimingAssessment {
  return {
    id: row.id,
    purchaseItemId: row.purchase_item_id,
    priceCheckRunId: row.price_check_run_id,
    asOfDate: calendarDate(row.as_of_date),
    assessedTargetPriceCents: Number(row.target_price_cents),
    currentPlanVersion: row.plan_version_number,
    planLifecycle: row.plan_lifecycle,
    planHealth: row.plan_health,
    state: row.assessment_state,
    statistics: {
      minimumPriceCents: Number(row.minimum_price_cents),
      medianPriceCents: Number(row.median_price_cents),
      maximumPriceCents: Number(row.maximum_price_cents),
      currentPriceCents: Number(row.current_price_cents),
      empiricalPercentileBasisPoints: row.current_percentile_basis_points,
      differenceFromMedianCents: Number(row.difference_from_median_cents),
      differenceFromTargetCents: Number(row.difference_from_target_cents),
      observationCount: row.observation_count,
      observationSpanDays: row.data_span_days,
      freshnessDays: row.freshness_days,
    },
    seasonal: row.seasonal_summary,
    rationaleCodes: row.rationale_codes,
    analysisPolicyVersion: row.analysis_policy_version,
    sourceVersion: row.fixture_source_version,
    sourceChecksum: row.fixture_source_checksum,
    createdAt: row.created_at.toISOString(),
  };
}

export class PurchaseTimingRepository {
  public constructor(private readonly database: DatabaseClient) {}

  public async listPurchaseItems(userId: string): Promise<readonly PurchaseItem[]> {
    const rows = await this.database<PurchaseItemRow[]>`
      SELECT id, goal_id, fixture_code, display_name, currency, target_price_cents,
             lifecycle, version, created_at, updated_at
      FROM purchase_items
      WHERE user_id = ${userId}
      ORDER BY updated_at DESC, id
      LIMIT 100
    `;
    return rows.map(mapItem);
  }

  public async getPurchaseItem(userId: string, itemId: string): Promise<PurchaseItem | null> {
    const rows = await this.database<PurchaseItemRow[]>`
      SELECT id, goal_id, fixture_code, display_name, currency, target_price_cents,
             lifecycle, version, created_at, updated_at
      FROM purchase_items
      WHERE id = ${itemId} AND user_id = ${userId}
    `;
    return rows[0] === undefined ? null : mapItem(rows[0]);
  }

  public async createPurchaseItem(input: {
    readonly userId: string;
    readonly goalId: string;
    readonly fixtureCode: PurchaseItem['fixtureCode'];
    readonly currency: PurchaseItem['currency'];
    readonly targetPriceCents: number;
    readonly idempotencyKey: string;
    readonly requestHash: string;
  }): Promise<{ readonly item: PurchaseItem; readonly replayed: boolean }> {
    return this.database.begin(async (transaction) => {
      const operation = 'purchase-item.create';
      await transaction`SELECT pg_advisory_xact_lock(hashtextextended(${`${input.userId}:${operation}:${input.idempotencyKey}`}, 0))`;
      const prior = await transaction<
        { readonly request_hash: string; readonly response_body: PurchaseItem }[]
      >`
        SELECT request_hash, response_body FROM idempotency_records
        WHERE user_id = ${input.userId} AND operation = ${operation}
          AND key = ${input.idempotencyKey}
      `;
      const previous = prior[0];
      if (previous !== undefined) {
        if (previous.request_hash !== input.requestHash) throw new IdempotencyConflictError();
        return { item: previous.response_body, replayed: true };
      }
      const rows = await transaction<PurchaseItemRow[]>`
        INSERT INTO purchase_items (
          id, user_id, goal_id, fixture_code, display_name, currency, target_price_cents
        ) SELECT
          ${ulid()}, ${input.userId}, g.id, ${input.fixtureCode}, '65-inch OLED television',
          ${input.currency}, ${input.targetPriceCents}
        FROM goals g
        WHERE g.id = ${input.goalId} AND g.user_id = ${input.userId}
          AND g.status NOT IN ('completed', 'archived')
        RETURNING id, goal_id, fixture_code, display_name, currency, target_price_cents,
                  lifecycle, version, created_at, updated_at
      `;
      const row = rows[0];
      if (row === undefined) throw new StateConflictError('The owned goal is not available.');
      const item = mapItem(row);
      await transaction`
        INSERT INTO idempotency_records (
          user_id, operation, key, request_hash, response_status, response_body
        ) VALUES (
          ${input.userId}, ${operation}, ${input.idempotencyKey}, ${input.requestHash}, 201,
          ${transaction.json(jsonValue(item))}
        )
      `;
      return { item, replayed: false };
    });
  }

  public async updatePurchaseItem(input: {
    readonly userId: string;
    readonly itemId: string;
    readonly expectedVersion: number;
    readonly targetPriceCents: number;
    readonly idempotencyKey: string;
    readonly requestHash: string;
  }): Promise<{ readonly item: PurchaseItem | null; readonly replayed: boolean }> {
    return this.database.begin(async (transaction) => {
      const operation = 'purchase-item.update';
      await transaction`SELECT pg_advisory_xact_lock(hashtextextended(${`${input.userId}:${input.itemId}:${operation}:${input.idempotencyKey}`}, 0))`;
      const prior = await transaction<
        { readonly request_hash: string; readonly response_body: PurchaseItem }[]
      >`
        SELECT request_hash, response_body FROM idempotency_records
        WHERE user_id = ${input.userId} AND operation = ${operation}
          AND key = ${input.idempotencyKey}
      `;
      const previous = prior[0];
      if (previous !== undefined) {
        if (previous.request_hash !== input.requestHash) throw new IdempotencyConflictError();
        return { item: previous.response_body, replayed: true };
      }
      const rows = await transaction<PurchaseItemRow[]>`
        UPDATE purchase_items SET
          target_price_cents = ${input.targetPriceCents}, version = version + 1,
          updated_at = now()
        WHERE id = ${input.itemId} AND user_id = ${input.userId}
          AND version = ${input.expectedVersion} AND lifecycle = 'active'
          AND EXISTS (
            SELECT 1 FROM goals g
            WHERE g.id = purchase_items.goal_id AND g.user_id = purchase_items.user_id
              AND g.status NOT IN ('completed', 'archived')
          )
        RETURNING id, goal_id, fixture_code, display_name, currency, target_price_cents,
                  lifecycle, version, created_at, updated_at
      `;
      const row = rows[0];
      if (row === undefined) return { item: null, replayed: false };
      const item = mapItem(row);
      await transaction`
        INSERT INTO idempotency_records (
          user_id, operation, key, request_hash, response_status, response_body
        ) VALUES (
          ${input.userId}, ${operation}, ${input.idempotencyKey}, ${input.requestHash}, 200,
          ${transaction.json(jsonValue(item))}
        )
      `;
      return { item, replayed: false };
    });
  }

  public async archivePurchaseItem(input: {
    readonly userId: string;
    readonly itemId: string;
    readonly expectedVersion: number;
    readonly idempotencyKey: string;
    readonly requestHash: string;
  }): Promise<{ readonly item: PurchaseItem | null; readonly replayed: boolean }> {
    return this.database.begin(async (transaction) => {
      const operation = 'purchase-item.archive';
      await transaction`SELECT pg_advisory_xact_lock(hashtextextended(${`${input.userId}:${input.itemId}:${operation}:${input.idempotencyKey}`}, 0))`;
      const prior = await transaction<
        { readonly request_hash: string; readonly response_body: PurchaseItem }[]
      >`
        SELECT request_hash, response_body FROM idempotency_records
        WHERE user_id = ${input.userId} AND operation = ${operation}
          AND key = ${input.idempotencyKey}
      `;
      const previous = prior[0];
      if (previous !== undefined) {
        if (previous.request_hash !== input.requestHash) throw new IdempotencyConflictError();
        return { item: previous.response_body, replayed: true };
      }
      const rows = await transaction<PurchaseItemRow[]>`
        UPDATE purchase_items SET
          lifecycle = 'archived', version = version + 1, updated_at = now()
        WHERE id = ${input.itemId} AND user_id = ${input.userId}
          AND version = ${input.expectedVersion} AND lifecycle = 'active'
          AND EXISTS (
            SELECT 1 FROM goals g
            WHERE g.id = purchase_items.goal_id AND g.user_id = purchase_items.user_id
              AND g.status NOT IN ('completed', 'archived')
          )
        RETURNING id, goal_id, fixture_code, display_name, currency, target_price_cents,
                  lifecycle, version, created_at, updated_at
      `;
      const row = rows[0];
      if (row === undefined) return { item: null, replayed: false };
      const item = mapItem(row);
      await transaction`
        INSERT INTO idempotency_records (
          user_id, operation, key, request_hash, response_status, response_body
        ) VALUES (
          ${input.userId}, ${operation}, ${input.idempotencyKey}, ${input.requestHash}, 200,
          ${transaction.json(jsonValue(item))}
        )
      `;
      return { item, replayed: false };
    });
  }

  public async createWatchPolicy(input: {
    readonly userId: string;
    readonly itemId: string;
    readonly cadence: PriceWatchPolicy['cadence'];
    readonly nextDueDate: string;
    readonly enabled: boolean;
    readonly idempotencyKey: string;
    readonly requestHash: string;
  }): Promise<{ readonly policy: PriceWatchPolicy; readonly replayed: boolean }> {
    return this.database.begin(async (transaction) => {
      const operation = 'price-watch-policy.create';
      await transaction`SELECT pg_advisory_xact_lock(hashtextextended(${`${input.userId}:${input.itemId}:${operation}:${input.idempotencyKey}`}, 0))`;
      const prior = await transaction<
        { readonly request_hash: string; readonly response_body: PriceWatchPolicy }[]
      >`
        SELECT request_hash, response_body FROM idempotency_records
        WHERE user_id = ${input.userId} AND operation = ${operation}
          AND key = ${input.idempotencyKey}
      `;
      const previous = prior[0];
      if (previous !== undefined) {
        if (previous.request_hash !== input.requestHash) throw new IdempotencyConflictError();
        return { policy: previous.response_body, replayed: true };
      }
      const items = await transaction<{ readonly id: string }[]>`
        SELECT item.id FROM purchase_items item
        JOIN goals goal ON goal.id = item.goal_id AND goal.user_id = item.user_id
        WHERE item.id = ${input.itemId} AND item.user_id = ${input.userId}
          AND item.lifecycle = 'active'
          AND goal.status NOT IN ('completed', 'archived')
        FOR UPDATE
      `;
      if (items[0] === undefined) {
        throw new StateConflictError('The purchase item is not available.');
      }
      const rows = await transaction<WatchPolicyRow[]>`
        INSERT INTO price_watch_policies (
          id, purchase_item_id, user_id, version, cadence, next_due_date, enabled
        ) VALUES (
          ${ulid()}, ${input.itemId}, ${input.userId},
          COALESCE((SELECT MAX(version) + 1 FROM price_watch_policies
                    WHERE purchase_item_id = ${input.itemId}), 1),
          ${input.cadence}, ${input.nextDueDate}, ${input.enabled}
        )
        RETURNING id, purchase_item_id, version, cadence, next_due_date,
                  freshness_limit_days, analysis_policy_version, enabled, created_at
      `;
      const row = rows[0];
      if (row === undefined) throw new Error('Price watch policy insert did not return a row.');
      const policy = mapPolicy(row);
      await transaction`
        INSERT INTO idempotency_records (
          user_id, operation, key, request_hash, response_status, response_body
        ) VALUES (
          ${input.userId}, ${operation}, ${input.idempotencyKey}, ${input.requestHash}, 201,
          ${transaction.json(jsonValue(policy))}
        )
      `;
      return { policy, replayed: false };
    });
  }

  public async getLatest(
    userId: string,
    itemId: string,
  ): Promise<PurchaseTimingLatestOutput | null> {
    const item = await this.getPurchaseItem(userId, itemId);
    if (item === null) return null;
    const policies = await this.database<WatchPolicyRow[]>`
      SELECT id, purchase_item_id, version, cadence, next_due_date,
             freshness_limit_days, analysis_policy_version, enabled, created_at
      FROM price_watch_policies
      WHERE purchase_item_id = ${itemId} AND user_id = ${userId}
      ORDER BY version DESC LIMIT 1
    `;
    const assessments = await this.database<AssessmentRow[]>`
      SELECT id, price_check_run_id, purchase_item_id, plan_version_number, plan_lifecycle,
             plan_health,
             assessment_state, analysis_policy_version, fixture_source_version,
             fixture_source_checksum, as_of_date, target_price_cents, rationale_codes,
             observation_count, data_span_days, freshness_days, current_price_cents, minimum_price_cents,
             median_price_cents, maximum_price_cents, current_percentile_basis_points,
             difference_from_median_cents, difference_from_target_cents,
             seasonal_summary, created_at
      FROM purchase_timing_assessments
      WHERE purchase_item_id = ${itemId} AND user_id = ${userId}
      ORDER BY as_of_date DESC, created_at DESC, id DESC LIMIT 1
    `;
    const assessmentRow = assessments[0];
    let series: HistoricalPriceSeries | null = null;
    if (assessmentRow !== undefined) {
      const observations = await this.database<
        {
          readonly observation_key: string;
          readonly observed_on: string | Date;
          readonly price_cents: string;
          readonly currency: 'USD';
        }[]
      >`
        SELECT observation_key, observed_on, price_cents, currency
        FROM price_observations
        WHERE price_check_run_id = ${assessmentRow.price_check_run_id}
          AND purchase_item_id = ${itemId} AND user_id = ${userId}
        ORDER BY observed_on, observation_key
      `;
      if (observations.length === 0) {
        throw new StateConflictError('The latest price assessment has no source observations.');
      }
      series = {
        fixtureCode: item.fixtureCode,
        displayDescriptor: item.displayName,
        currency: item.currency,
        asOfDate: calendarDate(assessmentRow.as_of_date),
        sourceVersion: assessmentRow.fixture_source_version,
        sourceChecksum: assessmentRow.fixture_source_checksum,
        sourceType: 'deterministic_fixture',
        isDemoData: true,
        observations: observations.map((observation) => ({
          observationKey: observation.observation_key,
          observedDate: calendarDate(observation.observed_on),
          priceCents: Number(observation.price_cents),
          currency: observation.currency,
        })),
      };
    }
    return {
      item,
      policy: policies[0] === undefined ? null : mapPolicy(policies[0]),
      assessment: assessmentRow === undefined ? null : mapAssessment(assessmentRow),
      series,
    };
  }

  public async listDuePriceWatches(
    userId: string,
    asOfDate: string,
  ): Promise<readonly DuePriceWatch[]> {
    const rows = await this.database<
      (WatchPolicyRow &
        PurchaseItemRow & {
          readonly policy_id: string;
          readonly policy_version: number;
          readonly item_id: string;
          readonly item_version: number;
          readonly goal_status: GoalDto['status'];
          readonly goal_version: number;
          readonly goal_target_amount_cents: string;
          readonly goal_target_date: string | Date;
          readonly contribution_cadence: GoalInput['contributionCadence'];
          readonly plan_version_id: string | null;
          readonly plan_version: number | null;
          readonly vehicle_code: VehicleCode | null;
          readonly normalized_input: GoalInput | null;
          readonly calculation_output: unknown;
          readonly account_status: PurchaseTimingPlanContext['accountStatus'];
          readonly next_contribution_date: string | Date | null;
          readonly last_processed_date: string | Date | null;
          readonly last_accrual_date: string | Date | null;
          readonly accrued_interest_micros: string;
          readonly ledger_balance_cents: string;
          readonly ledger_entry_count: string;
          readonly available_balance_cents: string;
        })[]
    >`
      SELECT policy.id AS policy_id, policy.version AS policy_version,
             policy.purchase_item_id, policy.cadence, policy.next_due_date,
             policy.freshness_limit_days, policy.analysis_policy_version,
             policy.enabled, policy.created_at,
             item.id AS item_id, item.goal_id, item.fixture_code, item.display_name,
             item.currency, item.target_price_cents, item.lifecycle,
             item.version AS item_version, item.updated_at,
             goal.status AS goal_status, goal.version AS goal_version,
             goal.target_amount_cents AS goal_target_amount_cents,
             goal.target_date AS goal_target_date, goal.contribution_cadence,
             plan.id AS plan_version_id, plan.version AS plan_version,
             plan.vehicle_code,
             plan.normalized_input, plan.calculation_output, account.status AS account_status,
             account.next_contribution_date, account.last_processed_date,
             account.last_accrual_date, COALESCE(account.accrued_interest_micros, 0)
               AS accrued_interest_micros, COUNT(ledger.id) AS ledger_entry_count,
             COALESCE(SUM(ledger.principal_cents + ledger.interest_cents), 0)
               AS ledger_balance_cents,
             COALESCE(
               simulated_account_available_balance(account.id, ${userId}, ${asOfDate}::date),
               0
             ) AS available_balance_cents
      FROM price_watch_policies policy
      JOIN purchase_items item ON item.id = policy.purchase_item_id
        AND item.user_id = policy.user_id
      JOIN goals goal ON goal.id = item.goal_id AND goal.user_id = item.user_id
      LEFT JOIN simulated_accounts account ON account.goal_id = goal.id
        AND account.user_id = goal.user_id
      LEFT JOIN plan_versions plan ON plan.id = account.plan_version_id
        AND plan.goal_id = goal.id AND plan.user_id = goal.user_id
      LEFT JOIN ledger_entries ledger ON ledger.account_id = account.id
        AND ledger.user_id = goal.user_id
      WHERE policy.user_id = ${userId} AND policy.enabled = true
        AND policy.next_due_date <= ${asOfDate}
        AND item.lifecycle = 'active'
        AND goal.status NOT IN ('completed', 'archived')
        AND policy.version = (
          SELECT MAX(latest.version) FROM price_watch_policies latest
          WHERE latest.purchase_item_id = policy.purchase_item_id
        )
      GROUP BY policy.id, item.id, goal.id, account.id, plan.id
      ORDER BY policy.next_due_date, policy.purchase_item_id
      LIMIT 100
    `;
    return rows.map((row) => ({
      policy: mapPolicy({ ...row, id: row.policy_id, version: row.policy_version }),
      item: mapItem({ ...row, id: row.item_id, version: row.item_version }),
      plan: {
        goalId: row.goal_id,
        goalVersion: row.goal_version,
        goalStatus: row.goal_status,
        targetAmountCents: Number(row.goal_target_amount_cents),
        targetDate: calendarDate(row.goal_target_date),
        contributionCadence: row.contribution_cadence,
        planVersionId: row.plan_version_id,
        planVersion: row.plan_version,
        vehicleCode: row.vehicle_code,
        normalizedInput: row.normalized_input,
        calculationOutput: row.calculation_output,
        accountStatus: row.account_status,
        nextContributionDate:
          row.next_contribution_date === null ? null : calendarDate(row.next_contribution_date),
        lastProcessedDate:
          row.last_processed_date === null ? null : calendarDate(row.last_processed_date),
        lastAccrualDate:
          row.last_accrual_date === null ? null : calendarDate(row.last_accrual_date),
        accruedInterestMicros: Number(row.accrued_interest_micros),
        ledgerBalanceCents: Number(row.ledger_balance_cents),
        ledgerEntryCount: Number(row.ledger_entry_count),
        availableBalanceCents: Number(row.available_balance_cents),
      },
    }));
  }

  public async claimPriceCheck(input: {
    readonly userId: string;
    readonly itemId: string;
    readonly policyId: string;
    readonly applicationDate: string;
  }): Promise<PriceCheckClaim> {
    return this.database.begin(async (transaction) => {
      await transaction`SELECT pg_advisory_xact_lock(hashtextextended(${`${input.userId}:${input.policyId}:${input.applicationDate}`}, 0))`;
      const existing = await transaction<
        {
          readonly id: string;
          readonly status: PriceCheckClaim['status'];
          readonly fixture_source_version: string | null;
          readonly fixture_source_checksum: string | null;
          readonly attempt_count: number;
          readonly worker_claim_token: string | null;
          readonly worker_lease_active: boolean;
          readonly error_code: PriceCheckClaim['errorCode'];
          readonly goal_status: GoalDto['status'];
        }[]
      >`
        SELECT run.id, run.status, run.fixture_source_version, run.fixture_source_checksum,
               run.attempt_count, run.worker_claim_token, run.error_code,
               goal.status AS goal_status,
               (run.worker_lease_expires_at IS NOT NULL AND run.worker_lease_expires_at > now())
                 AS worker_lease_active
        FROM price_check_runs run
        JOIN purchase_items item ON item.id = run.purchase_item_id
          AND item.user_id = run.user_id
        JOIN goals goal ON goal.id = item.goal_id AND goal.user_id = item.user_id
        WHERE run.price_watch_policy_id = ${input.policyId}
          AND run.purchase_item_id = ${input.itemId} AND run.user_id = ${input.userId}
          AND run.application_date = ${input.applicationDate}
        FOR UPDATE OF run
        FOR SHARE OF goal
      `;
      const previous = existing[0];
      if (previous !== undefined) {
        const goalIsTerminal =
          previous.goal_status === 'completed' || previous.goal_status === 'archived';
        if (previous.status === 'failed' && !goalIsTerminal) {
          const retryToken = ulid();
          const retried = await transaction<
            {
              readonly id: string;
              readonly status: PriceCheckClaim['status'];
              readonly fixture_source_version: string | null;
              readonly fixture_source_checksum: string | null;
            }[]
          >`
            UPDATE price_check_runs SET
              status = 'claimed', error_code = NULL, completed_at = NULL,
              attempt_count = attempt_count + 1,
              worker_claim_token = ${retryToken},
              worker_lease_expires_at = now() + interval '10 minutes'
            WHERE id = ${previous.id} AND status = 'failed' AND attempt_count < 3
            RETURNING id, status, fixture_source_version, fixture_source_checksum
          `;
          const retry = retried[0];
          if (retry !== undefined) {
            return {
              runId: retry.id,
              status: retry.status,
              claimToken: retryToken,
              replayed: false,
              sourceVersion: retry.fixture_source_version,
              sourceChecksum: retry.fixture_source_checksum,
              errorCode: null,
            };
          }
        }
        if (previous.status === 'claimed') {
          if (!previous.worker_lease_active) {
            const failed = await transaction<{ readonly id: string }[]>`
              UPDATE price_check_runs SET
                status = 'failed', error_code = 'PROVIDER_FAILURE', completed_at = now(),
                worker_claim_token = NULL, worker_lease_expires_at = NULL
              WHERE id = ${previous.id} AND status = 'claimed'
                AND worker_claim_token = ${previous.worker_claim_token}
                AND worker_lease_expires_at <= now()
              RETURNING id
            `;
            if (failed[0] !== undefined && previous.attempt_count < 3 && !goalIsTerminal) {
              const retryToken = ulid();
              const reclaimed = await transaction<{ readonly id: string }[]>`
                UPDATE price_check_runs SET
                  status = 'claimed', error_code = NULL, completed_at = NULL,
                  attempt_count = attempt_count + 1,
                  worker_claim_token = ${retryToken},
                  worker_lease_expires_at = now() + interval '10 minutes'
                WHERE id = ${previous.id} AND status = 'failed' AND attempt_count < 3
                RETURNING id
              `;
              if (reclaimed[0] !== undefined) {
                return {
                  runId: previous.id,
                  status: 'claimed',
                  claimToken: retryToken,
                  replayed: false,
                  sourceVersion: previous.fixture_source_version,
                  sourceChecksum: previous.fixture_source_checksum,
                  errorCode: null,
                };
              }
            }
            return {
              runId: previous.id,
              status: 'failed',
              claimToken: null,
              replayed: false,
              sourceVersion: previous.fixture_source_version,
              sourceChecksum: previous.fixture_source_checksum,
              errorCode: 'PROVIDER_FAILURE',
            };
          }
          return {
            runId: previous.id,
            status: 'in_progress',
            claimToken: null,
            replayed: true,
            sourceVersion: previous.fixture_source_version,
            sourceChecksum: previous.fixture_source_checksum,
            errorCode: null,
          };
        }
        return {
          runId: previous.id,
          status: previous.status,
          claimToken: null,
          replayed: previous.status === 'completed',
          sourceVersion: previous.fixture_source_version,
          sourceChecksum: previous.fixture_source_checksum,
          errorCode: previous.status === 'failed' ? previous.error_code : null,
        };
      }
      const runId = ulid();
      const claimToken = ulid();
      const inserted = await transaction<{ readonly id: string }[]>`
        INSERT INTO price_check_runs (
          id, price_watch_policy_id, purchase_item_id, user_id, application_date,
          worker_claim_token, worker_lease_expires_at
        ) SELECT ${runId}, p.id, p.purchase_item_id, p.user_id, ${input.applicationDate},
                 ${claimToken}, now() + interval '10 minutes'
        FROM price_watch_policies p
        JOIN purchase_items item ON item.id = p.purchase_item_id AND item.user_id = p.user_id
        JOIN goals goal ON goal.id = item.goal_id AND goal.user_id = item.user_id
        WHERE p.id = ${input.policyId} AND p.purchase_item_id = ${input.itemId}
          AND p.user_id = ${input.userId} AND p.enabled = true
          AND item.lifecycle = 'active'
          AND goal.status NOT IN ('completed', 'archived')
        FOR SHARE OF item, goal
        RETURNING id
      `;
      if (inserted[0] === undefined) throw new StateConflictError('The price watch is not due.');
      return {
        runId,
        status: 'claimed',
        claimToken,
        replayed: false,
        sourceVersion: null,
        sourceChecksum: null,
        errorCode: null,
      };
    });
  }

  public async completePriceCheck(input: {
    readonly userId: string;
    readonly item: PurchaseItem;
    readonly policy: PriceWatchPolicy;
    readonly runId: string;
    readonly claimToken: string;
    readonly applicationDate: string;
    readonly sourceVersion: string;
    readonly sourceChecksum: string;
    readonly observations: readonly HistoricalPriceObservation[];
    readonly expectedPlan: PurchaseTimingPlanContext;
    readonly assessment: StoredTimingAssessmentInput;
    readonly nextDueDate: string;
  }): Promise<{
    readonly assessment: PurchaseTimingAssessment;
    readonly observationsInserted: number;
  }> {
    return this.database.begin(async (transaction) => {
      const runs = await transaction<
        {
          readonly status: 'claimed' | 'completed' | 'failed';
          readonly fixture_source_version: string | null;
          readonly fixture_source_checksum: string | null;
          readonly worker_claim_token: string | null;
        }[]
      >`
        SELECT status, fixture_source_version, fixture_source_checksum, worker_claim_token
        FROM price_check_runs
        WHERE id = ${input.runId} AND purchase_item_id = ${input.item.id}
          AND user_id = ${input.userId} AND application_date = ${input.applicationDate}
        FOR UPDATE
      `;
      const run = runs[0];
      if (run?.status !== 'claimed' || run.worker_claim_token !== input.claimToken) {
        throw new StateConflictError('The price check is not claimable.');
      }
      if (run.fixture_source_version === null) {
        await transaction`
          UPDATE price_check_runs SET
            fixture_source_version = ${input.sourceVersion},
            fixture_source_checksum = ${input.sourceChecksum}
          WHERE id = ${input.runId} AND user_id = ${input.userId}
        `;
      } else if (
        run.fixture_source_version !== input.sourceVersion ||
        run.fixture_source_checksum !== input.sourceChecksum
      ) {
        throw new StateConflictError('The claimed run has different fixture provenance.');
      }

      const clocks = await transaction<{ readonly application_date: string | Date }[]>`
        SELECT application_date FROM user_application_clocks
        WHERE user_id = ${input.userId}
        FOR UPDATE
      `;
      if (
        clocks[0] === undefined ||
        calendarDate(clocks[0].application_date) !== input.applicationDate
      ) {
        throw new StateConflictError(
          'The application clock changed after this timing assessment was calculated.',
        );
      }
      const currentItems = await transaction<
        { readonly version: number; readonly lifecycle: PurchaseItem['lifecycle'] }[]
      >`
        SELECT version, lifecycle FROM purchase_items
        WHERE id = ${input.item.id} AND goal_id = ${input.item.goalId}
          AND user_id = ${input.userId}
        FOR UPDATE
      `;
      if (
        currentItems[0]?.version !== input.item.version ||
        currentItems[0].lifecycle !== input.item.lifecycle ||
        currentItems[0].lifecycle !== 'active'
      ) {
        throw new StateConflictError(
          'The purchase item changed after this timing assessment was calculated.',
        );
      }
      const currentPolicies = await transaction<
        {
          readonly id: string;
          readonly version: number;
          readonly next_due_date: string | Date;
          readonly enabled: boolean;
        }[]
      >`
        SELECT id, version, next_due_date, enabled
        FROM price_watch_policies
        WHERE purchase_item_id = ${input.item.id} AND user_id = ${input.userId}
        ORDER BY version DESC
        LIMIT 1
        FOR UPDATE
      `;
      const currentPolicy = currentPolicies[0];
      if (
        currentPolicy?.id !== input.policy.id ||
        currentPolicy.version !== input.policy.version ||
        calendarDate(currentPolicy.next_due_date) !== input.policy.nextDueDate ||
        !currentPolicy.enabled
      ) {
        throw new StateConflictError(
          'The price watch changed after this timing assessment was calculated.',
        );
      }
      const currentGoals = await transaction<
        { readonly version: number; readonly status: GoalDto['status'] }[]
      >`
        SELECT version, status FROM goals
        WHERE id = ${input.item.goalId} AND user_id = ${input.userId}
        FOR UPDATE
      `;
      const currentGoal = currentGoals[0];
      const currentAccounts = await transaction<
        {
          readonly id: string;
          readonly status: PurchaseTimingPlanContext['accountStatus'];
          readonly plan_version_id: string | null;
          readonly next_contribution_date: string | Date | null;
          readonly last_processed_date: string | Date;
          readonly last_accrual_date: string | Date;
          readonly accrued_interest_micros: string;
        }[]
      >`
        SELECT id, status, plan_version_id, next_contribution_date,
               last_processed_date, last_accrual_date, accrued_interest_micros
        FROM simulated_accounts
        WHERE goal_id = ${input.item.goalId} AND user_id = ${input.userId}
        FOR UPDATE
      `;
      const currentAccount = currentAccounts[0];
      const currentBalances =
        currentAccount === undefined
          ? { ledgerBalanceCents: 0, availableBalanceCents: 0, ledgerEntryCount: 0 }
          : await (async () => {
              const balances = await transaction<
                {
                  readonly ledger_balance_cents: string;
                  readonly available_balance_cents: string;
                  readonly ledger_entry_count: string;
                }[]
              >`
                SELECT COALESCE(SUM(principal_cents + interest_cents), 0)
                         AS ledger_balance_cents,
                       simulated_account_available_balance(
                         ${currentAccount.id}, ${input.userId}, ${input.applicationDate}::date
                       ) AS available_balance_cents,
                       COUNT(*) AS ledger_entry_count
                FROM ledger_entries
                WHERE account_id = ${currentAccount.id} AND user_id = ${input.userId}
              `;
              return {
                ledgerBalanceCents: Number(balances[0]?.ledger_balance_cents ?? 0),
                availableBalanceCents: Number(balances[0]?.available_balance_cents ?? 0),
                ledgerEntryCount: Number(balances[0]?.ledger_entry_count ?? 0),
              };
            })();
      const currentNextContributionValue = currentAccount?.next_contribution_date;
      const currentNextContributionDate =
        currentNextContributionValue === null || currentNextContributionValue === undefined
          ? null
          : calendarDate(currentNextContributionValue);
      const expected = input.expectedPlan;
      if (
        currentGoal?.version !== expected.goalVersion ||
        currentGoal.status !== expected.goalStatus ||
        (currentAccount?.plan_version_id ?? null) !== expected.planVersionId ||
        (currentAccount?.status ?? null) !== expected.accountStatus ||
        currentNextContributionDate !== expected.nextContributionDate ||
        (currentAccount === undefined ? null : calendarDate(currentAccount.last_processed_date)) !==
          expected.lastProcessedDate ||
        (currentAccount === undefined ? null : calendarDate(currentAccount.last_accrual_date)) !==
          expected.lastAccrualDate ||
        Number(currentAccount?.accrued_interest_micros ?? 0) !== expected.accruedInterestMicros ||
        currentBalances.ledgerBalanceCents !== expected.ledgerBalanceCents ||
        currentBalances.ledgerEntryCount !== expected.ledgerEntryCount ||
        currentBalances.availableBalanceCents !== expected.availableBalanceCents ||
        input.assessment.currentPlanVersionId !== expected.planVersionId ||
        input.assessment.currentPlanVersion !== expected.planVersion
      ) {
        throw new StateConflictError(
          'The plan changed after this timing assessment was calculated.',
        );
      }

      const earliestObservation = input.observations[0];
      const latestObservation = input.observations.at(-1);
      if (earliestObservation === undefined || latestObservation === undefined) {
        throw new StateConflictError('A price assessment requires at least one observation.');
      }
      const observationRows = input.observations.map((observation) => ({
        id: ulid(),
        price_check_run_id: input.runId,
        purchase_item_id: input.item.id,
        user_id: input.userId,
        fixture_source_version: input.sourceVersion,
        observation_key: observation.observationKey,
        observed_on: observation.observedDate,
        price_cents: observation.priceCents,
        currency: observation.currency,
      }));
      const priorObservations = await transaction<
        {
          readonly observation_key: string;
          readonly observed_on: string | Date;
          readonly price_cents: string;
          readonly currency: string;
        }[]
      >`
        SELECT observation_key, observed_on, price_cents, currency
        FROM price_observations
        WHERE purchase_item_id = ${input.item.id}
          AND user_id = ${input.userId}
          AND fixture_source_version = ${input.sourceVersion}
          AND observation_key IN ${transaction(
            input.observations.map((observation) => observation.observationKey),
          )}
      `;
      const expectedByKey = new Map(
        input.observations.map((observation) => [observation.observationKey, observation]),
      );
      if (
        priorObservations.some((stored) => {
          const expected = expectedByKey.get(stored.observation_key);
          return (
            calendarDate(stored.observed_on) !== expected?.observedDate ||
            Number(stored.price_cents) !== expected.priceCents ||
            stored.currency !== expected.currency
          );
        })
      ) {
        throw new StateConflictError('A historical observation conflicts with stored data.');
      }
      const insertedObservations = await transaction<{ readonly id: string }[]>`
        INSERT INTO price_observations ${transaction(
          observationRows,
          'id',
          'price_check_run_id',
          'purchase_item_id',
          'user_id',
          'fixture_source_version',
          'observation_key',
          'observed_on',
          'price_cents',
          'currency',
        )}
        ON CONFLICT (price_check_run_id, observation_key) DO NOTHING
        RETURNING id
      `;
      const storedObservations = await transaction<
        {
          readonly observation_key: string;
          readonly observed_on: string | Date;
          readonly price_cents: string;
          readonly currency: string;
        }[]
      >`
        SELECT observation_key, observed_on, price_cents, currency
        FROM price_observations
        WHERE price_check_run_id = ${input.runId}
          AND purchase_item_id = ${input.item.id}
          AND user_id = ${input.userId}
      `;
      const storedByKey = new Map(
        storedObservations.map((observation) => [observation.observation_key, observation]),
      );
      for (const observation of input.observations) {
        const stored = storedByKey.get(observation.observationKey);
        if (
          stored === undefined ||
          calendarDate(stored.observed_on) !== observation.observedDate ||
          Number(stored.price_cents) !== observation.priceCents ||
          stored.currency !== observation.currency
        ) {
          throw new StateConflictError('A historical observation conflicts with stored data.');
        }
      }
      const observationsInserted = insertedObservations.length;

      const assessmentId = ulid();
      const statistics = input.assessment.statistics;
      const rationaleCodes = [...input.assessment.rationaleCodes];
      const created = await transaction<{ readonly created_at: Date }[]>`
        INSERT INTO purchase_timing_assessments (
          id, price_check_run_id, purchase_item_id, goal_id, user_id,
          price_watch_policy_version, plan_version_id, plan_version_number,
          plan_lifecycle, plan_health, fixture_source_version, fixture_source_checksum,
          as_of_date, currency, assessment_state, rationale_codes,
          observation_count, earliest_observation_date, latest_observation_date,
          data_span_days, freshness_days, current_price_cents, target_price_cents,
          minimum_price_cents, median_price_cents, maximum_price_cents,
          current_percentile_basis_points, difference_from_median_cents,
          difference_from_target_cents, seasonal_summary
        ) VALUES (
          ${assessmentId}, ${input.runId}, ${input.item.id}, ${input.item.goalId},
          ${input.userId}, ${input.policy.version}, ${input.assessment.currentPlanVersionId},
          ${input.assessment.currentPlanVersion}, ${input.assessment.planLifecycle},
          ${input.assessment.planHealth}, ${input.sourceVersion}, ${input.sourceChecksum},
          ${input.applicationDate}, ${input.item.currency}, ${input.assessment.state},
          ${rationaleCodes}, ${statistics.observationCount},
          ${earliestObservation.observedDate},
          ${latestObservation.observedDate}, ${statistics.observationSpanDays},
          ${statistics.freshnessDays}, ${statistics.currentPriceCents},
          ${input.item.targetPriceCents}, ${statistics.minimumPriceCents},
          ${statistics.medianPriceCents}, ${statistics.maximumPriceCents},
          ${statistics.empiricalPercentileBasisPoints}, ${statistics.differenceFromMedianCents},
          ${statistics.differenceFromTargetCents},
          CASE WHEN ${input.assessment.seasonal === null} THEN NULL
            ELSE ${transaction.json(jsonValue(input.assessment.seasonal ?? { months: [] }))} END
        ) RETURNING created_at
      `;
      const createdAt = created[0]?.created_at;
      if (createdAt === undefined) throw new Error('Assessment insert did not return a row.');
      await transaction`
        UPDATE price_check_runs SET status = 'completed', completed_at = now(),
          worker_claim_token = NULL, worker_lease_expires_at = NULL
        WHERE id = ${input.runId} AND user_id = ${input.userId}
          AND worker_claim_token = ${input.claimToken}
      `;
      await transaction`
        INSERT INTO price_watch_policies (
          id, purchase_item_id, user_id, version, cadence, next_due_date,
          freshness_limit_days, analysis_policy_version, enabled
        ) VALUES (
          ${ulid()}, ${input.item.id}, ${input.userId}, ${input.policy.version + 1},
          ${input.policy.cadence}, ${input.nextDueDate}, ${input.policy.freshnessLimitDays},
          ${input.policy.analysisPolicyVersion}, ${input.policy.enabled}
        )
      `;
      return {
        assessment: {
          id: assessmentId,
          purchaseItemId: input.item.id,
          priceCheckRunId: input.runId,
          asOfDate: input.applicationDate,
          assessedTargetPriceCents: input.item.targetPriceCents,
          currentPlanVersion: input.assessment.currentPlanVersion,
          planLifecycle: input.assessment.planLifecycle,
          planHealth: input.assessment.planHealth,
          state: input.assessment.state,
          statistics,
          seasonal: input.assessment.seasonal,
          rationaleCodes,
          analysisPolicyVersion: 'purchase-timing-v1',
          sourceVersion: input.sourceVersion,
          sourceChecksum: input.sourceChecksum,
          createdAt: createdAt.toISOString(),
        },
        observationsInserted,
      };
    });
  }

  public async failPriceCheck(input: {
    readonly userId: string;
    readonly runId: string;
    readonly claimToken: string;
    readonly errorCode:
      | 'PROVIDER_FAILURE'
      | 'INVALID_PRICE_BATCH'
      | 'CURRENCY_MISMATCH'
      | 'FUTURE_OBSERVATION'
      | 'CONFLICTING_OBSERVATION'
      | 'ASSESSMENT_FAILURE';
  }): Promise<boolean> {
    const failed = await this.database<{ readonly id: string }[]>`
      UPDATE price_check_runs SET
        status = 'failed', error_code = ${input.errorCode}, completed_at = now(),
        worker_claim_token = NULL, worker_lease_expires_at = NULL
      WHERE id = ${input.runId} AND user_id = ${input.userId} AND status = 'claimed'
        AND worker_claim_token = ${input.claimToken}
      RETURNING id
    `;
    return failed[0] !== undefined;
  }
}
