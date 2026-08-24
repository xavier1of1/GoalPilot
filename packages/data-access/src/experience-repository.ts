import type {
  BuilderStep,
  GoalDraft,
  GoalDraftData,
  GoalInput,
  ProductEventInput,
} from '@goalpilot/contracts';
import { goalInputSchema } from '@goalpilot/contracts';
import type postgres from 'postgres';
import { ulid } from 'ulid';

import type { DatabaseClient } from './database.js';
import { IdempotencyConflictError, StateConflictError } from './repository.js';

export class IndeterminateApplicationCommandError extends StateConflictError {
  public constructor() {
    super('A request with this idempotency key has an indeterminate result and cannot be retried.');
    this.name = 'IndeterminateApplicationCommandError';
  }
}

type GoalDraftRow = postgres.Row & {
  readonly id: string;
  readonly draft_data: GoalDraftData;
  readonly last_completed_step: BuilderStep | null;
  readonly version: number;
  readonly created_at: Date;
  readonly updated_at: Date;
};

type DemoResetSnapshotRow = postgres.Row & {
  readonly reset_generation: number;
  readonly fixture_version: string;
  readonly goal_version: number;
  readonly goal_created_at: Date;
  readonly plan_id: string;
  readonly vehicle_code: 'cash' | 'hysa' | 'cd_ladder' | 'treasury_ladder';
  readonly assumption_version: string;
  readonly normalized_input: unknown;
  readonly calculation_output: postgres.JSONValue;
  readonly calculation_context: postgres.JSONValue;
  readonly application_date: string | Date;
  readonly schedule_anchor_date: string | Date;
  readonly calculation_policy_version: string;
  readonly ranking_policy_version: string;
  readonly health_policy_version: string;
  readonly plan_created_at: Date;
  readonly account_id: string;
  readonly account_created_at: Date;
  readonly initial_next_contribution_date: string | Date | null;
  readonly opening_entry_id: string;
  readonly opening_entry_created_at: Date;
  readonly purchase_item_id: string;
  readonly purchase_item_created_at: Date;
  readonly watch_policy_id: string;
  readonly watch_policy_cadence: 'weekly' | 'monthly';
  readonly watch_policy_next_due_date: string | Date;
  readonly watch_policy_created_at: Date;
  readonly initial_application_date: string | Date;
  readonly financial_run_token: string | null;
  readonly financial_run_expires_at: Date | null;
  readonly financial_run_active: boolean;
};

function jsonValue(value: unknown): postgres.JSONValue {
  return JSON.parse(JSON.stringify(value)) as postgres.JSONValue;
}

function calendarDate(value: string | Date): string {
  return typeof value === 'string' ? value : value.toISOString().slice(0, 10);
}

function mapDraft(row: GoalDraftRow): GoalDraft {
  return {
    id: row.id,
    data: row.draft_data,
    lastCompletedStep: row.last_completed_step,
    version: row.version,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function databaseChangedDimension(
  value: ProductEventInput,
): 'recurring_contribution' | 'target_date' | 'target_amount' | 'missed_contribution' | null {
  if (!('changedDimension' in value)) return null;
  const dimensions = {
    CONTRIBUTION: 'recurring_contribution',
    DEADLINE: 'target_date',
    TARGET: 'target_amount',
    MISSED_CONTRIBUTION: 'missed_contribution',
  } as const;
  return dimensions[value.changedDimension];
}

export interface UserApplicationDate {
  readonly applicationDate: string;
  readonly initialApplicationDate: string;
  readonly version: number;
}

export interface DemoMilestoneContext {
  readonly goalId: string;
  readonly goalVersion: number;
  readonly targetDate: string;
  readonly accountStatus: 'active' | 'paused' | 'purchase_ready' | 'completed';
  readonly nextContributionDate: string | null;
  readonly nextMaturityDate: string | null;
  readonly pendingFinancialDate: string | null;
}

export type IdempotentRequestClaim<T> =
  | {
      readonly kind: 'replay';
      readonly value: T;
      readonly responseStatus: number;
    }
  | {
      readonly kind: 'claimed';
      readonly claimToken: string;
    };

export class ProductExperienceRepository {
  public constructor(private readonly database: DatabaseClient) {}

  // The caller owns the schema for the response stored under its operation name.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
  public async getIdempotentResponse<T>(input: {
    readonly userId: string;
    readonly operation: string;
    readonly idempotencyKey: string;
    readonly requestHash: string;
  }): Promise<{ readonly value: T; readonly responseStatus: number } | null> {
    const rows = await this.database<
      {
        readonly request_hash: string;
        readonly response_status: number;
        readonly response_body: T;
      }[]
    >`
      SELECT request_hash, response_status, response_body
      FROM idempotency_records
      WHERE user_id = ${input.userId} AND operation = ${input.operation}
        AND key = ${input.idempotencyKey}
    `;
    const previous = rows[0];
    if (previous === undefined) return null;
    if (previous.request_hash !== input.requestHash) throw new IdempotencyConflictError();
    return { value: previous.response_body, responseStatus: previous.response_status };
  }

  /**
   * Claims a replayable application command without retaining a database
   * connection while the command executes. Completed responses continue to
   * live in idempotency_records; this table only coordinates in-flight work.
   */
  public async claimIdempotentRequest<T>(input: {
    readonly userId: string;
    readonly operation: string;
    readonly idempotencyKey: string;
    readonly requestHash: string;
    readonly leaseSeconds?: number;
  }): Promise<IdempotentRequestClaim<T>> {
    const leaseSeconds = input.leaseSeconds ?? 900;
    if (!Number.isInteger(leaseSeconds) || leaseSeconds < 5 || leaseSeconds > 3600) {
      throw new RangeError('Idempotency claim lease must be between 5 and 3600 seconds.');
    }
    return this.database.begin(async (transaction) => {
      await transaction`SELECT pg_advisory_xact_lock(hashtextextended(${`${input.userId}:${input.operation}:${input.idempotencyKey}`}, 0))`;
      const prior = await transaction<
        {
          readonly request_hash: string;
          readonly response_status: number;
          readonly response_body: T;
        }[]
      >`
        SELECT request_hash, response_status, response_body FROM idempotency_records
        WHERE user_id = ${input.userId} AND operation = ${input.operation}
          AND key = ${input.idempotencyKey}
      `;
      const previous = prior[0];
      if (previous !== undefined) {
        if (previous.request_hash !== input.requestHash) throw new IdempotencyConflictError();
        return {
          kind: 'replay',
          value: previous.response_body,
          responseStatus: previous.response_status,
        };
      }

      const activeClaims = await transaction<
        {
          readonly request_hash: string;
          readonly state: 'claimed' | 'retryable';
          readonly lease_active: boolean;
        }[]
      >`
        SELECT request_hash, state,
          (state = 'claimed' AND lease_expires_at > now()) AS lease_active
        FROM application_command_claims
        WHERE user_id = ${input.userId} AND operation = ${input.operation}
          AND key = ${input.idempotencyKey}
        FOR UPDATE
      `;
      const activeClaim = activeClaims[0];
      if (activeClaim !== undefined) {
        if (activeClaim.request_hash !== input.requestHash) throw new IdempotencyConflictError();
        if (activeClaim.state === 'claimed') {
          if (!activeClaim.lease_active) throw new IndeterminateApplicationCommandError();
          throw new StateConflictError('A request with this idempotency key is still processing.');
        }
      }

      const claimToken = ulid();
      await transaction`
        INSERT INTO application_command_claims (
          user_id, operation, key, request_hash, state, claim_token, lease_expires_at
        ) VALUES (
          ${input.userId}, ${input.operation}, ${input.idempotencyKey}, ${input.requestHash},
          'claimed', ${claimToken}, now() + ${leaseSeconds} * INTERVAL '1 second'
        )
        ON CONFLICT (user_id, operation, key) DO UPDATE SET
          state = 'claimed',
          claim_token = EXCLUDED.claim_token,
          lease_expires_at = EXCLUDED.lease_expires_at,
          updated_at = now()
      `;
      return { kind: 'claimed', claimToken };
    });
  }

  public async completeIdempotentRequest(input: {
    readonly userId: string;
    readonly operation: string;
    readonly idempotencyKey: string;
    readonly requestHash: string;
    readonly claimToken: string;
    readonly responseStatus: number;
    readonly value: unknown;
  }): Promise<void> {
    await this.database.begin(async (transaction) => {
      await transaction`SELECT pg_advisory_xact_lock(hashtextextended(${`${input.userId}:${input.operation}:${input.idempotencyKey}`}, 0))`;
      const completed = await transaction<{ readonly request_hash: string }[]>`
        SELECT request_hash FROM idempotency_records
        WHERE user_id = ${input.userId} AND operation = ${input.operation}
          AND key = ${input.idempotencyKey}
      `;
      if (completed[0] !== undefined) {
        if (completed[0].request_hash !== input.requestHash) throw new IdempotencyConflictError();
        return;
      }

      const claims = await transaction<
        { readonly request_hash: string; readonly claim_token: string | null }[]
      >`
        SELECT request_hash, claim_token
        FROM application_command_claims
        WHERE user_id = ${input.userId} AND operation = ${input.operation}
          AND key = ${input.idempotencyKey} AND state = 'claimed'
        FOR UPDATE
      `;
      const claim = claims[0];
      if (claim?.request_hash !== input.requestHash || claim.claim_token !== input.claimToken) {
        throw new StateConflictError('The idempotency claim is no longer current.');
      }
      await transaction`
        INSERT INTO idempotency_records (
          user_id, operation, key, request_hash, response_status, response_body
        ) VALUES (
          ${input.userId}, ${input.operation}, ${input.idempotencyKey}, ${input.requestHash},
          ${input.responseStatus}, ${transaction.json(jsonValue(input.value))}
        )
      `;
      await transaction`
        DELETE FROM application_command_claims
        WHERE user_id = ${input.userId} AND operation = ${input.operation}
          AND key = ${input.idempotencyKey} AND claim_token = ${input.claimToken}
      `;
    });
  }

  public async abandonIdempotentRequest(input: {
    readonly userId: string;
    readonly operation: string;
    readonly idempotencyKey: string;
    readonly requestHash: string;
    readonly claimToken: string;
  }): Promise<void> {
    await this.database`
      UPDATE application_command_claims SET
        state = 'retryable', claim_token = NULL, lease_expires_at = NULL, updated_at = now()
      WHERE user_id = ${input.userId} AND operation = ${input.operation}
        AND key = ${input.idempotencyKey} AND request_hash = ${input.requestHash}
        AND state = 'claimed' AND claim_token = ${input.claimToken}
    `;
  }

  public async listGoalDrafts(userId: string): Promise<readonly GoalDraft[]> {
    const rows = await this.database<GoalDraftRow[]>`
      SELECT id, draft_data, last_completed_step, version, created_at, updated_at
      FROM goal_drafts
      WHERE user_id = ${userId}
      ORDER BY updated_at DESC, id
      LIMIT 100
    `;
    return rows.map(mapDraft);
  }

  public async getGoalDraft(userId: string, draftId: string): Promise<GoalDraft | null> {
    const rows = await this.database<GoalDraftRow[]>`
      SELECT id, draft_data, last_completed_step, version, created_at, updated_at
      FROM goal_drafts
      WHERE id = ${draftId} AND user_id = ${userId}
    `;
    return rows[0] === undefined ? null : mapDraft(rows[0]);
  }

  public async createGoalDraft(input: {
    readonly userId: string;
    readonly data: GoalDraftData;
    readonly lastCompletedStep: BuilderStep | null;
    readonly idempotencyKey: string;
    readonly requestHash: string;
    readonly requestId?: string;
  }): Promise<{ readonly draft: GoalDraft; readonly replayed: boolean }> {
    return this.database.begin(async (transaction) => {
      const operation = 'goal-draft.create';
      await transaction`SELECT pg_advisory_xact_lock(hashtextextended(${`${input.userId}:${operation}:${input.idempotencyKey}`}, 0))`;
      const prior = await transaction<
        { readonly request_hash: string; readonly response_body: GoalDraft }[]
      >`
        SELECT request_hash, response_body
        FROM idempotency_records
        WHERE user_id = ${input.userId} AND operation = ${operation}
          AND key = ${input.idempotencyKey}
      `;
      const previous = prior[0];
      if (previous !== undefined) {
        if (previous.request_hash !== input.requestHash) throw new IdempotencyConflictError();
        return { draft: previous.response_body, replayed: true };
      }
      const rows = await transaction<GoalDraftRow[]>`
        INSERT INTO goal_drafts (id, user_id, draft_data, last_completed_step)
        VALUES (
          ${ulid()}, ${input.userId}, ${transaction.json(jsonValue(input.data))},
          ${input.lastCompletedStep}
        )
        RETURNING id, draft_data, last_completed_step, version, created_at, updated_at
      `;
      const row = rows[0];
      if (row === undefined) throw new Error('Draft insert did not return a row.');
      const draft = mapDraft(row);
      await transaction`
        INSERT INTO idempotency_records (
          user_id, operation, key, request_hash, response_status, response_body
        ) VALUES (
          ${input.userId}, ${operation}, ${input.idempotencyKey}, ${input.requestHash}, 201,
          ${transaction.json(jsonValue(draft))}
        )
      `;
      await transaction`
        INSERT INTO audit_events (id, user_id, event_name, resource_id, request_id)
        VALUES (${ulid()}, ${input.userId}, 'goal_draft.created', ${row.id}, ${input.requestId ?? null})
      `;
      return { draft, replayed: false };
    });
  }

  public async updateGoalDraft(input: {
    readonly userId: string;
    readonly draftId: string;
    readonly expectedVersion: number;
    readonly data: GoalDraftData;
    readonly lastCompletedStep: BuilderStep | null;
    readonly idempotencyKey: string;
    readonly requestHash: string;
    readonly requestId?: string;
  }): Promise<{ readonly draft: GoalDraft | null; readonly replayed: boolean }> {
    return this.database.begin(async (transaction) => {
      const operation = 'goal-draft.update';
      await transaction`SELECT pg_advisory_xact_lock(hashtextextended(${`${input.userId}:${operation}:${input.idempotencyKey}`}, 0))`;
      const prior = await transaction<
        { readonly request_hash: string; readonly response_body: GoalDraft }[]
      >`
        SELECT request_hash, response_body
        FROM idempotency_records
        WHERE user_id = ${input.userId} AND operation = ${operation}
          AND key = ${input.idempotencyKey}
      `;
      const previous = prior[0];
      if (previous !== undefined) {
        if (previous.request_hash !== input.requestHash) throw new IdempotencyConflictError();
        return { draft: previous.response_body, replayed: true };
      }
      const rows = await transaction<GoalDraftRow[]>`
        UPDATE goal_drafts SET
          draft_data = ${transaction.json(jsonValue(input.data))},
          last_completed_step = ${input.lastCompletedStep},
          version = version + 1,
          updated_at = now()
        WHERE id = ${input.draftId} AND user_id = ${input.userId}
          AND version = ${input.expectedVersion}
        RETURNING id, draft_data, last_completed_step, version, created_at, updated_at
      `;
      const row = rows[0];
      if (row === undefined) return { draft: null, replayed: false };
      const draft = mapDraft(row);
      await transaction`
        INSERT INTO idempotency_records (
          user_id, operation, key, request_hash, response_status, response_body
        ) VALUES (
          ${input.userId}, ${operation}, ${input.idempotencyKey}, ${input.requestHash}, 200,
          ${transaction.json(jsonValue(draft))}
        )
      `;
      await transaction`
        INSERT INTO audit_events (id, user_id, event_name, resource_id, request_id)
        VALUES (${ulid()}, ${input.userId}, 'goal_draft.updated', ${row.id}, ${input.requestId ?? null})
      `;
      return { draft, replayed: false };
    });
  }

  public async deleteGoalDraft(input: {
    readonly userId: string;
    readonly draftId: string;
    readonly expectedVersion: number;
    readonly idempotencyKey: string;
    readonly requestHash: string;
    readonly requestId?: string;
  }): Promise<{
    readonly result: 'deleted' | 'not_found' | 'version_conflict';
    readonly replayed: boolean;
  }> {
    return this.database.begin(async (transaction) => {
      const operation = 'goal-draft.delete';
      await transaction`SELECT pg_advisory_xact_lock(hashtextextended(${`${input.userId}:${operation}:${input.idempotencyKey}`}, 0))`;
      const prior = await transaction<
        {
          readonly request_hash: string;
          readonly response_body: { readonly result: 'deleted' };
        }[]
      >`
        SELECT request_hash, response_body
        FROM idempotency_records
        WHERE user_id = ${input.userId} AND operation = ${operation}
          AND key = ${input.idempotencyKey}
      `;
      const previous = prior[0];
      if (previous !== undefined) {
        if (previous.request_hash !== input.requestHash) throw new IdempotencyConflictError();
        return { result: previous.response_body.result, replayed: true };
      }
      const rows = await transaction<{ readonly id: string }[]>`
        DELETE FROM goal_drafts
        WHERE id = ${input.draftId} AND user_id = ${input.userId}
          AND version = ${input.expectedVersion}
        RETURNING id
      `;
      if (rows[0] === undefined) {
        const existing = await transaction<{ readonly present: boolean }[]>`
          SELECT EXISTS(
            SELECT 1 FROM goal_drafts
            WHERE id = ${input.draftId} AND user_id = ${input.userId}
          ) AS present
        `;
        return {
          result: existing[0]?.present === true ? 'version_conflict' : 'not_found',
          replayed: false,
        };
      }
      await transaction`
        INSERT INTO idempotency_records (
          user_id, operation, key, request_hash, response_status, response_body
        ) VALUES (
          ${input.userId}, ${operation}, ${input.idempotencyKey}, ${input.requestHash}, 204,
          ${transaction.json({ result: 'deleted' })}
        )
      `;
      await transaction`
        INSERT INTO audit_events (id, user_id, event_name, resource_id, request_id)
        VALUES (
          ${ulid()}, ${input.userId}, 'goal_draft.discarded', ${input.draftId},
          ${input.requestId ?? null}
        )
      `;
      return { result: 'deleted', replayed: false };
    });
  }

  public async getUserApplicationDate(userId: string): Promise<UserApplicationDate | null> {
    const rows = await this.database<
      {
        readonly application_date: string | Date;
        readonly initial_application_date: string | Date;
        readonly version: number;
      }[]
    >`
      SELECT application_date, initial_application_date, version
      FROM user_application_clocks
      WHERE user_id = ${userId}
    `;
    const row = rows[0];
    if (row === undefined) return null;
    return {
      applicationDate:
        typeof row.application_date === 'string'
          ? row.application_date
          : row.application_date.toISOString().slice(0, 10),
      initialApplicationDate:
        typeof row.initial_application_date === 'string'
          ? row.initial_application_date
          : row.initial_application_date.toISOString().slice(0, 10),
      version: row.version,
    };
  }

  public async advanceUserApplicationDate(input: {
    readonly userId: string;
    readonly nextDate: string;
    readonly expectedVersion: number;
  }): Promise<UserApplicationDate | null> {
    const rows = await this.database<
      {
        readonly application_date: string | Date;
        readonly initial_application_date: string | Date;
        readonly version: number;
      }[]
    >`
      UPDATE user_application_clocks SET
        application_date = ${input.nextDate}, version = version + 1, updated_at = now()
      WHERE user_id = ${input.userId} AND version = ${input.expectedVersion}
        AND application_date <= ${input.nextDate}
      RETURNING application_date, initial_application_date, version
    `;
    const row = rows[0];
    if (row === undefined) return null;
    return {
      applicationDate:
        typeof row.application_date === 'string'
          ? row.application_date
          : row.application_date.toISOString().slice(0, 10),
      initialApplicationDate:
        typeof row.initial_application_date === 'string'
          ? row.initial_application_date
          : row.initial_application_date.toISOString().slice(0, 10),
      version: row.version,
    };
  }

  public async claimOwnerFinancialRun(input: {
    readonly userId: string;
    readonly runToken: string;
  }): Promise<boolean> {
    const rows = await this.database<{ readonly user_id: string }[]>`
      UPDATE user_application_clocks SET
        financial_run_token = ${input.runToken},
        financial_run_expires_at = now() + interval '10 minutes',
        version = version + 1, updated_at = now()
      WHERE user_id = ${input.userId}
        AND (financial_run_token IS NULL OR financial_run_expires_at <= now())
      RETURNING user_id
    `;
    return rows[0] !== undefined;
  }

  public async releaseOwnerFinancialRun(input: {
    readonly userId: string;
    readonly runToken: string;
  }): Promise<boolean> {
    const rows = await this.database<{ readonly user_id: string }[]>`
      UPDATE user_application_clocks SET
        financial_run_token = NULL, financial_run_expires_at = NULL,
        version = version + 1, updated_at = now()
      WHERE user_id = ${input.userId} AND financial_run_token = ${input.runToken}
      RETURNING user_id
    `;
    return rows[0] !== undefined;
  }

  public async isDemoFixtureUser(userId: string): Promise<boolean> {
    const rows = await this.database<{ readonly allowed: boolean }[]>`
      SELECT EXISTS(
        SELECT 1 FROM demo_fixture_users WHERE user_id = ${userId}
      ) AS allowed
    `;
    return rows[0]?.allowed ?? false;
  }

  /** Restores only the marked Japan-trip fixture from its immutable v1 plan snapshot. */
  public async resetSeededDemo(input: {
    readonly userId: string;
    readonly goalId: string;
    readonly expectedGoalVersion: number;
    readonly requestId?: string;
  }): Promise<
    | { readonly result: 'reset'; readonly resetGeneration: number }
    | { readonly result: 'not_found' | 'version_conflict' }
  > {
    return this.database.begin(async (transaction) => {
      await transaction`SELECT pg_advisory_xact_lock(hashtextextended(${`goalpilot:demo-reset:${input.userId}`}, 0))`;
      const rows = await transaction<DemoResetSnapshotRow[]>`
        SELECT
          fixture.reset_generation, fixture.fixture_version,
          goal.version AS goal_version, goal.created_at AS goal_created_at,
          plan.id AS plan_id, plan.vehicle_code, plan.assumption_version,
          plan.normalized_input, plan.calculation_output, plan.calculation_context,
          plan.application_date,
          plan.schedule_anchor_date, plan.calculation_policy_version,
          plan.ranking_policy_version, plan.health_policy_version,
          plan.created_at AS plan_created_at,
          account.id AS account_id, account.created_at AS account_created_at,
          COALESCE(
            (SELECT MIN(occurrence.due_date) FROM schedule_occurrences occurrence
             WHERE occurrence.account_id = account.id),
            account.next_contribution_date
          ) AS initial_next_contribution_date,
          opening.id AS opening_entry_id, opening.created_at AS opening_entry_created_at,
          item.id AS purchase_item_id, item.created_at AS purchase_item_created_at,
          policy.id AS watch_policy_id, policy.cadence AS watch_policy_cadence,
          policy.next_due_date AS watch_policy_next_due_date,
          policy.created_at AS watch_policy_created_at,
          clock.initial_application_date, clock.financial_run_token,
          clock.financial_run_expires_at,
          (
            clock.financial_run_token IS NOT NULL
            AND clock.financial_run_expires_at > now()
          ) AS financial_run_active
        FROM demo_fixture_users fixture
        JOIN goals goal ON goal.user_id = fixture.user_id AND goal.id = ${input.goalId}
        JOIN plan_versions plan ON plan.goal_id = goal.id AND plan.user_id = goal.user_id
          AND plan.version = 1 AND plan.change_kind = 'initial_activation'
        JOIN simulated_accounts account ON account.goal_id = goal.id
          AND account.user_id = goal.user_id
        JOIN ledger_entries opening ON opening.account_id = account.id
          AND opening.user_id = account.user_id AND opening.entry_type = 'account_opened'
        JOIN purchase_items item ON item.goal_id = goal.id AND item.user_id = goal.user_id
          AND item.fixture_code = 'synthetic_oled_65_v1'
        JOIN price_watch_policies policy ON policy.purchase_item_id = item.id
          AND policy.user_id = item.user_id AND policy.version = 1
        JOIN user_application_clocks clock ON clock.user_id = fixture.user_id
        WHERE fixture.user_id = ${input.userId} AND fixture.fixture_key = 'japan-trip'
        FOR UPDATE OF fixture, goal, clock
      `;
      const snapshot = rows[0];
      if (snapshot?.fixture_version !== 'product-experience-v1') {
        return { result: 'not_found' };
      }
      if (snapshot.financial_run_active) {
        throw new StateConflictError('A Story Mode financial run is already in progress.');
      }
      if (snapshot.goal_version !== input.expectedGoalVersion) {
        return { result: 'version_conflict' };
      }
      const otherRunningGoals = await transaction<{ readonly present: boolean }[]>`
        SELECT EXISTS(
          SELECT 1 FROM goals
          WHERE user_id = ${input.userId} AND id <> ${input.goalId}
            AND status IN ('active', 'paused', 'purchase_ready')
        ) AS present
      `;
      if (otherRunningGoals[0]?.present === true) {
        throw new StateConflictError(
          'Archive the other running goal before restoring the seeded demonstration.',
        );
      }
      const goal: GoalInput = goalInputSchema.parse(snapshot.normalized_input);
      const initialApplicationDate = calendarDate(snapshot.initial_application_date);
      const initialNextContributionDate =
        snapshot.initial_next_contribution_date === null
          ? null
          : calendarDate(snapshot.initial_next_contribution_date);

      await transaction`
        DELETE FROM goals WHERE id = ${input.goalId} AND user_id = ${input.userId}
      `;
      await transaction`
        INSERT INTO goals (
          id, user_id, name, category, target_amount_cents, current_saved_cents,
          target_date, recurring_contribution_cents, contribution_cadence,
          liquidity_need, preservation_preference, confidence, notes, status,
          version, created_at, updated_at
        ) VALUES (
          ${input.goalId}, ${input.userId}, ${goal.name}, ${goal.category ?? null},
          ${goal.targetAmountCents}, ${goal.currentSavedCents}, ${goal.targetDate},
          ${goal.recurringContributionCents}, ${goal.contributionCadence},
          ${goal.liquidityNeed}, ${goal.preservationPreference}, ${goal.confidence},
          ${goal.notes ?? null}, 'active', 1, ${snapshot.goal_created_at}, now()
        )
      `;
      await transaction`
        INSERT INTO plan_versions (
          id, goal_id, user_id, version, vehicle_code, assumption_version,
          normalized_input, calculation_output, calculation_context,
          application_date, schedule_anchor_date,
          calculation_policy_version, ranking_policy_version, health_policy_version,
          change_kind, changed_field, change_reason_code, change_payload,
          omitted_contribution_dates, base_plan_version_id, created_at
        ) VALUES (
          ${snapshot.plan_id}, ${input.goalId}, ${input.userId}, 1,
          ${snapshot.vehicle_code}, ${snapshot.assumption_version},
          ${transaction.json(jsonValue(goal))},
          ${transaction.json(snapshot.calculation_output)},
          ${transaction.json(snapshot.calculation_context)}, ${snapshot.application_date},
          ${snapshot.schedule_anchor_date}, ${snapshot.calculation_policy_version},
          ${snapshot.ranking_policy_version}, ${snapshot.health_policy_version},
          'initial_activation', NULL, 'INITIAL_ACTIVATION', NULL, '{}'::date[], NULL,
          ${snapshot.plan_created_at}
        )
      `;
      await transaction`
        INSERT INTO simulated_accounts (
          id, goal_id, user_id, plan_version_id, status, next_contribution_date,
          last_processed_date, last_accrual_date, accrued_interest_micros,
          created_at, updated_at
        ) VALUES (
          ${snapshot.account_id}, ${input.goalId}, ${input.userId}, ${snapshot.plan_id},
          'active', ${initialNextContributionDate}, ${initialApplicationDate},
          ${initialApplicationDate}, 0, ${snapshot.account_created_at}, now()
        )
      `;
      await transaction`
        INSERT INTO ledger_entries (
          id, account_id, user_id, entry_type, principal_cents, interest_cents,
          effective_date, occurrence_id, description, reverses_entry_id, created_at
        ) VALUES (
          ${snapshot.opening_entry_id}, ${snapshot.account_id}, ${input.userId},
          'account_opened', ${goal.currentSavedCents}, 0, ${initialApplicationDate}, NULL,
          'Opening simulated savings', NULL, ${snapshot.opening_entry_created_at}
        )
      `;
      await transaction`
        INSERT INTO purchase_items (
          id, user_id, goal_id, fixture_code, display_name, currency,
          target_price_cents, version, lifecycle, created_at, updated_at
        ) VALUES (
          ${snapshot.purchase_item_id}, ${input.userId}, ${input.goalId},
          'synthetic_oled_65_v1', '65-inch OLED television', 'USD', 150000,
          1, 'active', ${snapshot.purchase_item_created_at}, now()
        )
      `;
      await transaction`
        INSERT INTO price_watch_policies (
          id, purchase_item_id, user_id, version, cadence, next_due_date,
          freshness_limit_days, analysis_policy_version, enabled, created_at
        ) VALUES (
          ${snapshot.watch_policy_id}, ${snapshot.purchase_item_id}, ${input.userId},
          1, ${snapshot.watch_policy_cadence}, ${snapshot.watch_policy_next_due_date},
          14, 'purchase-timing-v1', true, ${snapshot.watch_policy_created_at}
        )
      `;
      await transaction`
        UPDATE user_application_clocks SET
          application_date = initial_application_date,
          financial_run_token = NULL,
          financial_run_expires_at = NULL,
          version = version + 1,
          updated_at = now()
        WHERE user_id = ${input.userId}
      `;
      const resetRows = await transaction<{ readonly reset_generation: number }[]>`
        UPDATE demo_fixture_users SET
          reset_generation = reset_generation + 1,
          updated_at = now()
        WHERE user_id = ${input.userId} AND fixture_key = 'japan-trip'
        RETURNING reset_generation
      `;
      const resetGeneration = resetRows[0]?.reset_generation;
      if (resetGeneration === undefined) {
        throw new StateConflictError('The seeded demonstration could not be restored.');
      }
      await transaction`
        INSERT INTO audit_events (id, user_id, event_name, resource_id, request_id)
        VALUES (
          ${ulid()}, ${input.userId}, 'demo_fixture.reset', ${input.goalId},
          ${input.requestId ?? null}
        )
      `;
      return { result: 'reset', resetGeneration };
    });
  }

  public async getDemoMilestoneContext(
    userId: string,
    goalId: string,
    applicationDate: string,
  ): Promise<DemoMilestoneContext | null> {
    const rows = await this.database<
      {
        readonly goal_id: string;
        readonly goal_version: number;
        readonly target_date: string | Date;
        readonly account_status: DemoMilestoneContext['accountStatus'];
        readonly next_contribution_date: string | Date | null;
        readonly next_maturity_date: string | Date | null;
        readonly pending_financial_date: string | Date | null;
      }[]
    >`
      WITH owner_financial_state AS (
        SELECT GREATEST(
          owner_account.last_processed_date,
          owner_account.last_accrual_date,
          COALESCE((
            SELECT MAX(owner_entry.effective_date)
            FROM ledger_entries owner_entry
            WHERE owner_entry.account_id = owner_account.id
              AND owner_entry.user_id = owner_account.user_id
          ), ${applicationDate}::date)
        ) AS financial_date
        FROM simulated_accounts owner_account
        WHERE owner_account.user_id = ${userId}
      )
      SELECT g.id AS goal_id, g.version AS goal_version, g.target_date,
             a.status AS account_status, a.next_contribution_date,
             (
               SELECT MAX(financial_date)
               FROM owner_financial_state
               WHERE financial_date > ${applicationDate}::date
             ) AS pending_financial_date,
             CASE WHEN p.vehicle_code IN ('cd_ladder', 'treasury_ladder') THEN (
               SELECT MIN(lot.next_event_date)
               FROM (
                 SELECT CASE
                   WHEN source.effective_date + va.lock_days <= g.target_date THEN
                     CASE
                       WHEN source.effective_date + (
                         ((SELECT COUNT(*) FROM ledger_entries posted
                           WHERE posted.account_id = source.account_id
                             AND posted.user_id = source.user_id
                             AND posted.occurrence_id LIKE
                               ${'maturity:'} || source.id || ':%')::integer + 1) * va.lock_days
                       ) <= g.target_date
                         THEN source.effective_date + (
                           ((SELECT COUNT(*) FROM ledger_entries posted
                             WHERE posted.account_id = source.account_id
                               AND posted.user_id = source.user_id
                               AND posted.occurrence_id LIKE
                                 ${'maturity:'} || source.id || ':%')::integer + 1) * va.lock_days
                         )
                       ELSE g.target_date
                     END
                   ELSE source.effective_date + va.lock_days
                 END AS next_event_date
                 FROM ledger_entries source
                 WHERE source.account_id = a.id AND source.user_id = a.user_id
                   AND source.entry_type IN ('account_opened', 'contribution_posted')
                   AND source.principal_cents > 0
                   AND source.effective_date <= ${applicationDate}::date
                   AND NOT EXISTS (
                     SELECT 1 FROM ledger_entries source_reversal
                     WHERE source_reversal.reverses_entry_id = source.id
                       AND source_reversal.account_id = source.account_id
                       AND source_reversal.user_id = source.user_id
                       AND source_reversal.effective_date <= ${applicationDate}::date
                   )
               ) lot
               WHERE lot.next_event_date > ${applicationDate}::date
             ) ELSE NULL END AS next_maturity_date
      FROM goals g
      JOIN simulated_accounts a ON a.goal_id = g.id AND a.user_id = g.user_id
      JOIN plan_versions p ON p.id = a.plan_version_id
        AND p.goal_id = g.id AND p.user_id = g.user_id
      JOIN vehicle_assumptions va ON va.version = p.assumption_version
        AND va.vehicle_code = p.vehicle_code
      WHERE g.id = ${goalId} AND g.user_id = ${userId}
        AND g.status IN ('active', 'paused', 'purchase_ready')
        AND a.status IN ('active', 'paused', 'purchase_ready')
    `;
    const row = rows[0];
    if (row === undefined) return null;
    const asDate = (value: string | Date): string =>
      typeof value === 'string' ? value : value.toISOString().slice(0, 10);
    return {
      goalId: row.goal_id,
      goalVersion: row.goal_version,
      targetDate: asDate(row.target_date),
      accountStatus: row.account_status,
      nextContributionDate:
        row.next_contribution_date === null ? null : asDate(row.next_contribution_date),
      nextMaturityDate: row.next_maturity_date === null ? null : asDate(row.next_maturity_date),
      pendingFinancialDate:
        row.pending_financial_date === null ? null : asDate(row.pending_financial_date),
    };
  }

  public async recordProductEvent(input: {
    readonly userId: string;
    readonly subjectHash: string;
    readonly event: ProductEventInput;
    readonly idempotencyKey: string;
    readonly requestHash: string;
  }): Promise<{ readonly accepted: true; readonly replayed: boolean }> {
    return this.database.begin(async (transaction) => {
      const operation = `product-event:${input.event.eventName}`;
      await transaction`SELECT pg_advisory_xact_lock(hashtextextended(${`${input.userId}:${operation}:${input.idempotencyKey}`}, 0))`;
      const prior = await transaction<
        { readonly request_hash: string; readonly response_body: { readonly accepted: true } }[]
      >`
        SELECT request_hash, response_body
        FROM idempotency_records
        WHERE user_id = ${input.userId} AND operation = ${operation}
          AND key = ${input.idempotencyKey}
      `;
      const previous = prior[0];
      if (previous !== undefined) {
        if (previous.request_hash !== input.requestHash) throw new IdempotencyConflictError();
        return { ...previous.response_body, replayed: true };
      }

      const eventId = ulid();
      await transaction`
        INSERT INTO product_events (
          id, event_name, occurred_at, subject_kind, subject_hash, builder_step,
          vehicle_code, rejection_code, changed_dimension, is_demo, application_version
        ) VALUES (
          ${eventId}, ${input.event.eventName}, now(), 'user', ${input.subjectHash},
          ${'builderStep' in input.event ? input.event.builderStep : null},
          ${'vehicleCode' in input.event ? input.event.vehicleCode : null},
          ${'rejectionCode' in input.event ? input.event.rejectionCode : null},
          ${databaseChangedDimension(input.event)}, ${input.event.demo},
          ${input.event.applicationVersion}
        )
      `;
      const response = { accepted: true as const };
      await transaction`
        INSERT INTO idempotency_records (
          user_id, operation, key, request_hash, response_status, response_body
        ) VALUES (
          ${input.userId}, ${operation}, ${input.idempotencyKey}, ${input.requestHash}, 202,
          ${transaction.json(jsonValue(response))}
        )
      `;
      return { ...response, replayed: false };
    });
  }
}
