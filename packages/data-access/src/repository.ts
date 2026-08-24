import type {
  AccountSummaryDto,
  ActivityDto,
  GoalDto,
  GoalInput,
  PreviewOutput,
  UserDto,
  VehicleCode,
} from '@goalpilot/contracts';
import type postgres from 'postgres';
import { ulid } from 'ulid';

import type { DatabaseClient } from './database.js';

type UserRow = postgres.Row & {
  readonly id: string;
  readonly email: string;
  readonly display_name: string;
  readonly password_hash: string;
};

type GoalRow = postgres.Row & {
  readonly id: string;
  readonly name: string;
  readonly category: string | null;
  readonly target_amount_cents: string;
  readonly current_saved_cents: string;
  readonly target_date: string | Date;
  readonly recurring_contribution_cents: string;
  readonly contribution_cadence: GoalInput['contributionCadence'];
  readonly liquidity_need: GoalInput['liquidityNeed'];
  readonly preservation_preference: GoalInput['preservationPreference'];
  readonly confidence: 'expected';
  readonly notes: string | null;
  readonly status: GoalDto['status'];
  readonly version: number;
  readonly created_at: Date;
  readonly updated_at: Date;
};

function mapUser(row: UserRow): UserDto {
  return { id: row.id, email: row.email, displayName: row.display_name };
}

function calendarDate(value: string | Date): string {
  return typeof value === 'string' ? value : value.toISOString().slice(0, 10);
}

function jsonValue(value: unknown): postgres.JSONValue {
  return JSON.parse(JSON.stringify(value)) as postgres.JSONValue;
}

function mapGoal(row: GoalRow): GoalDto {
  return {
    id: row.id,
    name: row.name,
    ...(row.category === null ? {} : { category: row.category }),
    targetAmountCents: Number(row.target_amount_cents),
    currentSavedCents: Number(row.current_saved_cents),
    targetDate: calendarDate(row.target_date),
    recurringContributionCents: Number(row.recurring_contribution_cents),
    contributionCadence: row.contribution_cadence,
    liquidityNeed: row.liquidity_need,
    preservationPreference: row.preservation_preference,
    confidence: row.confidence,
    ...(row.notes === null ? {} : { notes: row.notes }),
    status: row.status,
    version: row.version,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export interface SessionRecord {
  readonly user: UserDto;
  readonly csrfHash: string;
  readonly expiresAt: Date;
  readonly absoluteExpiresAt: Date;
}

export interface DueAccount {
  readonly accountId: string;
  readonly userId: string;
  readonly goalId: string;
  readonly nextContributionDate: string;
  readonly recurringContributionCents: number;
  readonly cadence: GoalInput['contributionCadence'];
  readonly targetAmountCents: number;
  readonly targetDate: string;
  readonly scheduleAnchorDate: string;
  readonly apyBasisPoints: number;
  readonly vehicleCode: VehicleCode;
  readonly lastProcessedDate: string;
}

export interface ActiveAccount {
  readonly accountId: string;
  readonly userId: string;
  readonly goalId: string;
  readonly apyBasisPoints: number;
  readonly vehicleCode: VehicleCode;
  readonly lockDays: number;
  readonly targetAmountCents: number;
  readonly targetDate: string;
  readonly balanceCents: number;
  readonly accruedInterestMicros: number;
  readonly lastAccrualDate: string;
}

export interface MaturityLot {
  readonly sourceEntryId: string;
  readonly principalCents: number;
  readonly cycle: number;
  readonly maturityDate: string;
}

export class IdempotencyConflictError extends Error {
  public constructor() {
    super('The idempotency key was already used for a different request.');
    this.name = 'IdempotencyConflictError';
  }
}

export class StateConflictError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'StateConflictError';
  }
}

export class GoalPilotRepository {
  public constructor(private readonly database: DatabaseClient) {}

  public async createUser(input: {
    readonly email: string;
    readonly passwordHash: string;
    readonly displayName: string;
  }): Promise<UserDto> {
    const rows = await this.database<UserRow[]>`
      INSERT INTO users (id, email, display_name, password_hash)
      VALUES (${ulid()}, ${input.email}, ${input.displayName}, ${input.passwordHash})
      RETURNING id, email, display_name, password_hash
    `;
    const row = rows[0];
    if (row === undefined) throw new Error('User insert did not return a row.');
    return mapUser(row);
  }

  public async findCredentialByEmail(
    email: string,
  ): Promise<{ readonly user: UserDto; readonly passwordHash: string } | null> {
    const rows = await this.database<UserRow[]>`
      SELECT id, email, display_name, password_hash
      FROM users WHERE email = ${email} AND deleted_at IS NULL
    `;
    const row = rows[0];
    return row === undefined ? null : { user: mapUser(row), passwordHash: row.password_hash };
  }

  public async getUser(userId: string): Promise<UserDto | null> {
    const rows = await this.database<UserRow[]>`
      SELECT id, email, display_name, password_hash
      FROM users WHERE id = ${userId} AND deleted_at IS NULL
    `;
    return rows[0] === undefined ? null : mapUser(rows[0]);
  }

  public async createSession(input: {
    readonly idHash: string;
    readonly userId: string;
    readonly csrfHash: string;
    readonly expiresAt: Date;
    readonly absoluteExpiresAt: Date;
  }): Promise<void> {
    await this.database`
      INSERT INTO sessions (id_hash, user_id, csrf_hash, expires_at, absolute_expires_at)
      VALUES (
        ${input.idHash}, ${input.userId}, ${input.csrfHash},
        ${input.expiresAt}, ${input.absoluteExpiresAt}
      )
    `;
  }

  public async getSession(idHash: string, now: Date): Promise<SessionRecord | null> {
    const rows = await this.database<
      (UserRow & {
        readonly csrf_hash: string;
        readonly expires_at: Date;
        readonly absolute_expires_at: Date;
      })[]
    >`
      SELECT u.id, u.email, u.display_name, u.password_hash,
             s.csrf_hash, s.expires_at, s.absolute_expires_at
      FROM sessions s
      JOIN users u ON u.id = s.user_id
      WHERE s.id_hash = ${idHash}
        AND s.expires_at > ${now}
        AND s.absolute_expires_at > ${now}
        AND u.deleted_at IS NULL
    `;
    const row = rows[0];
    if (row === undefined) return null;
    const refreshedExpiry = new Date(
      Math.min(now.getTime() + 8 * 60 * 60 * 1000, row.absolute_expires_at.getTime()),
    );
    await this.database`
      UPDATE sessions SET last_seen_at = ${now}, expires_at = ${refreshedExpiry}
      WHERE id_hash = ${idHash} AND expires_at > ${now} AND absolute_expires_at > ${now}
    `;
    return {
      user: mapUser(row),
      csrfHash: row.csrf_hash,
      expiresAt: refreshedExpiry,
      absoluteExpiresAt: row.absolute_expires_at,
    };
  }

  public async deleteSession(idHash: string): Promise<void> {
    await this.database`DELETE FROM sessions WHERE id_hash = ${idHash}`;
  }

  public async deleteUserSessions(userId: string): Promise<void> {
    await this.database`DELETE FROM sessions WHERE user_id = ${userId}`;
  }

  public async listGoals(userId: string): Promise<readonly GoalDto[]> {
    const rows = await this.database<GoalRow[]>`
      SELECT * FROM goals WHERE user_id = ${userId} ORDER BY created_at DESC LIMIT 100
    `;
    return rows.map(mapGoal);
  }

  public async getGoal(userId: string, goalId: string): Promise<GoalDto | null> {
    const rows = await this.database<GoalRow[]>`
      SELECT * FROM goals WHERE id = ${goalId} AND user_id = ${userId}
    `;
    return rows[0] === undefined ? null : mapGoal(rows[0]);
  }

  public async createGoal(userId: string, input: GoalInput): Promise<GoalDto> {
    const rows = await this.database<GoalRow[]>`
      INSERT INTO goals (
        id, user_id, name, category, target_amount_cents, current_saved_cents, target_date,
        recurring_contribution_cents, contribution_cadence, liquidity_need,
        preservation_preference, confidence, notes
      ) VALUES (
        ${ulid()}, ${userId}, ${input.name}, ${input.category ?? null}, ${input.targetAmountCents},
        ${input.currentSavedCents}, ${input.targetDate}, ${input.recurringContributionCents},
        ${input.contributionCadence}, ${input.liquidityNeed}, ${input.preservationPreference},
        ${input.confidence}, ${input.notes ?? null}
      ) RETURNING *
    `;
    const row = rows[0];
    if (row === undefined) throw new Error('Goal insert did not return a row.');
    await this.audit(userId, 'goal.created', row.id);
    return mapGoal(row);
  }

  public async createGoalIdempotent(input: {
    readonly userId: string;
    readonly goal: GoalInput;
    readonly key: string;
    readonly requestHash: string;
  }): Promise<{ readonly goal: GoalDto; readonly replayed: boolean }> {
    return this.database.begin(async (transaction) => {
      const operation = 'goal.create';
      await transaction`SELECT pg_advisory_xact_lock(hashtextextended(${`${input.userId}:${operation}:${input.key}`}, 0))`;
      const existing = await transaction<
        { readonly request_hash: string; readonly response_body: GoalDto }[]
      >`
        SELECT request_hash, response_body
        FROM idempotency_records
        WHERE user_id = ${input.userId} AND operation = ${operation} AND key = ${input.key}
      `;
      const record = existing[0];
      if (record !== undefined) {
        if (record.request_hash !== input.requestHash) throw new IdempotencyConflictError();
        return { goal: record.response_body, replayed: true };
      }

      const rows = await transaction<GoalRow[]>`
        INSERT INTO goals (
          id, user_id, name, category, target_amount_cents, current_saved_cents, target_date,
          recurring_contribution_cents, contribution_cadence, liquidity_need,
          preservation_preference, confidence, notes
        ) VALUES (
          ${ulid()}, ${input.userId}, ${input.goal.name}, ${input.goal.category ?? null},
          ${input.goal.targetAmountCents}, ${input.goal.currentSavedCents}, ${input.goal.targetDate},
          ${input.goal.recurringContributionCents}, ${input.goal.contributionCadence},
          ${input.goal.liquidityNeed}, ${input.goal.preservationPreference},
          ${input.goal.confidence}, ${input.goal.notes ?? null}
        ) RETURNING *
      `;
      const row = rows[0];
      if (row === undefined) throw new Error('Goal insert did not return a row.');
      const goal = mapGoal(row);
      await transaction`
        INSERT INTO idempotency_records (
          user_id, operation, key, request_hash, response_status, response_body
        ) VALUES (
          ${input.userId}, ${operation}, ${input.key}, ${input.requestHash}, 201,
          ${transaction.json(jsonValue(goal))}
        )
      `;
      await transaction`
        INSERT INTO audit_events (id, user_id, event_name, resource_id)
        VALUES (${ulid()}, ${input.userId}, 'goal.created', ${goal.id})
      `;
      return { goal, replayed: false };
    });
  }

  public async updateGoal(
    userId: string,
    goalId: string,
    input: GoalInput,
    expectedVersion: number,
  ): Promise<GoalDto | null> {
    return this.database.begin(async (transaction) => {
      const rows = await transaction<GoalRow[]>`
        UPDATE goals SET
          name = ${input.name}, category = ${input.category ?? null},
          target_amount_cents = ${input.targetAmountCents},
          current_saved_cents = ${input.currentSavedCents}, target_date = ${input.targetDate},
          recurring_contribution_cents = ${input.recurringContributionCents},
          contribution_cadence = ${input.contributionCadence}, liquidity_need = ${input.liquidityNeed},
          preservation_preference = ${input.preservationPreference}, confidence = ${input.confidence},
          notes = ${input.notes ?? null}, version = version + 1, updated_at = now()
        WHERE id = ${goalId} AND user_id = ${userId} AND version = ${expectedVersion}
          AND status IN ('draft', 'active', 'paused')
        RETURNING *
      `;
      const row = rows[0];
      if (row === undefined) return null;
      await transaction`
        INSERT INTO audit_events (id, user_id, event_name, resource_id)
        VALUES (${ulid()}, ${userId}, 'goal.updated', ${goalId})
      `;
      return mapGoal(row);
    });
  }

  public async deleteGoal(userId: string, goalId: string): Promise<boolean> {
    return this.database.begin(async (transaction) => {
      const rows = await transaction<{ id: string }[]>`
        DELETE FROM goals WHERE id = ${goalId} AND user_id = ${userId} RETURNING id
      `;
      if (rows[0] === undefined) return false;
      await transaction`
        INSERT INTO audit_events (id, user_id, event_name, resource_id)
        VALUES (${ulid()}, ${userId}, 'goal.deleted', ${goalId})
      `;
      return true;
    });
  }

  public async archiveGoal(userId: string, goalId: string): Promise<boolean> {
    return this.database.begin(async (transaction) => {
      const rows = await transaction<{ id: string }[]>`
        UPDATE goals SET status = 'archived', version = version + 1, updated_at = now()
        WHERE id = ${goalId} AND user_id = ${userId} AND status = 'completed'
        RETURNING id
      `;
      if (rows[0] === undefined) return false;
      await transaction`
        INSERT INTO audit_events (id, user_id, event_name, resource_id)
        VALUES (${ulid()}, ${userId}, 'goal.archived', ${goalId})
      `;
      return true;
    });
  }

  public async setGoalState(
    userId: string,
    goalId: string,
    fromStates: readonly GoalDto['status'][],
    toState: GoalDto['status'],
    eventType: ActivityDto['type'],
  ): Promise<boolean> {
    return this.database.begin(async (transaction) => {
      const rows = await transaction<{ id: string }[]>`
        UPDATE goals SET status = ${toState}, version = version + 1, updated_at = now()
        WHERE id = ${goalId} AND user_id = ${userId} AND status IN ${transaction(fromStates)}
        RETURNING id
      `;
      if (rows[0] === undefined) return false;
      await transaction`
        UPDATE simulated_accounts SET status = ${
          toState === 'active' ? 'active' : toState
        }, updated_at = now()
        WHERE goal_id = ${goalId} AND user_id = ${userId}
      `;
      const accounts = await transaction<{ id: string }[]>`
        SELECT id FROM simulated_accounts WHERE goal_id = ${goalId} AND user_id = ${userId}
      `;
      if (accounts[0] !== undefined) {
        await transaction`
          INSERT INTO ledger_entries
            (id, account_id, user_id, entry_type, effective_date, description)
          SELECT ${ulid()}, id, ${userId}, ${eventType},
            (SELECT application_date FROM application_clock WHERE singleton = true),
            ${eventType.replaceAll('_', ' ')}
          FROM simulated_accounts WHERE goal_id = ${goalId} AND user_id = ${userId}
        `;
        if (eventType === 'goal_completed') {
          const balances = await transaction<
            { readonly principal_cents: string; readonly interest_cents: string }[]
          >`
            SELECT COALESCE(SUM(principal_cents), 0) AS principal_cents,
                   COALESCE(SUM(interest_cents), 0) AS interest_cents
            FROM ledger_entries
            WHERE account_id = ${accounts[0].id} AND user_id = ${userId}
          `;
          const principalCents = Number(balances[0]?.principal_cents ?? 0);
          const interestCents = Number(balances[0]?.interest_cents ?? 0);
          if (principalCents + interestCents > 0) {
            await transaction`
              INSERT INTO ledger_entries (
                id, account_id, user_id, entry_type, principal_cents, interest_cents,
                effective_date, description
              ) VALUES (
                ${ulid()}, ${accounts[0].id}, ${userId}, 'simulated_withdrawal',
                ${-principalCents}, ${-interestCents},
                (SELECT application_date FROM application_clock WHERE singleton = true),
                'Simulated purchase withdrawal'
              )
            `;
          }
        }
      }
      await transaction`
        INSERT INTO audit_events (id, user_id, event_name, resource_id)
        VALUES (${ulid()}, ${userId}, ${`goal.${toState}`}, ${goalId})
      `;
      return true;
    });
  }

  public async activateGoal(input: {
    readonly userId: string;
    readonly goal: GoalDto;
    readonly vehicleCode: VehicleCode;
    readonly projection: PreviewOutput;
    readonly asOfDate: string;
    readonly nextContributionDate: string | null;
  }): Promise<string> {
    return this.database.begin(async (transaction) => {
      const selected = input.projection.vehicles.find(
        (vehicle) => vehicle.vehicleCode === input.vehicleCode,
      );
      if (!selected?.eligible) throw new Error('Selected vehicle is ineligible.');
      const funded = input.goal.currentSavedCents >= input.goal.targetAmountCents;
      const fixedTerm =
        input.vehicleCode === 'cd_ladder' || input.vehicleCode === 'treasury_ladder';
      const purchaseReady = funded && !fixedTerm;
      const updated = await transaction<{ id: string }[]>`
        UPDATE goals SET status = ${purchaseReady ? 'purchase_ready' : 'active'},
          version = version + 1, updated_at = now()
        WHERE id = ${input.goal.id} AND user_id = ${input.userId} AND status = 'draft'
        RETURNING id
      `;
      if (updated[0] === undefined)
        throw new StateConflictError('This goal cannot be activated from its current state.');
      const planId = ulid();
      await transaction`
        INSERT INTO plan_versions (
          id, goal_id, user_id, version, vehicle_code, assumption_version,
          normalized_input, calculation_output
        ) VALUES (
          ${planId}, ${input.goal.id}, ${input.userId}, 1, ${input.vehicleCode},
          ${selected.assumption.assumptionVersion}, ${transaction.json(jsonValue(input.goal))},
          ${transaction.json(jsonValue(input.projection))}
        )
      `;
      const accountId = ulid();
      await transaction`
        INSERT INTO simulated_accounts (
          id, goal_id, user_id, plan_version_id, status, next_contribution_date, last_processed_date,
          last_accrual_date
        ) VALUES (
          ${accountId}, ${input.goal.id}, ${input.userId}, ${planId},
          ${purchaseReady ? 'purchase_ready' : 'active'},
          ${funded ? null : input.nextContributionDate}, ${input.asOfDate}, ${input.asOfDate}
        )
      `;
      await transaction`
        INSERT INTO ledger_entries (
          id, account_id, user_id, entry_type, principal_cents, effective_date, description
        ) VALUES (
          ${ulid()}, ${accountId}, ${input.userId}, 'account_opened',
          ${input.goal.currentSavedCents}, ${input.asOfDate}, 'Opening simulated savings'
        )
      `;
      await transaction`
        INSERT INTO audit_events (id, user_id, event_name, resource_id)
        VALUES (${ulid()}, ${input.userId}, 'goal.plan_activated', ${input.goal.id})
      `;
      return accountId;
    });
  }

  public async getAccountSummary(
    userId: string,
    goalId: string,
  ): Promise<AccountSummaryDto | null> {
    const rows = await this.database<
      (postgres.Row & {
        readonly id: string;
        readonly goal_id: string;
        readonly status: AccountSummaryDto['status'];
        readonly vehicle_code: VehicleCode;
        readonly assumption_version: string;
        readonly apy_basis_points: number;
        readonly next_contribution_date: string | Date | null;
        readonly target_amount_cents: string;
        readonly target_date: string | Date;
        readonly application_date: string | Date;
        readonly principal_cents: string;
        readonly interest_cents: string;
        readonly balance_cents: string;
        readonly projected_completion_date: string | null;
        readonly reviewed_date: string | Date;
        readonly assumption_is_stale: boolean;
      })[]
    >`
      SELECT a.id, a.goal_id, a.status, p.vehicle_code, p.assumption_version,
             va.apy_basis_points, vav.reviewed_date,
             (p.vehicle_code <> 'cash' AND
               (SELECT application_date FROM application_clock WHERE singleton = true) >
                 vav.reviewed_date + 365) AS assumption_is_stale,
             a.next_contribution_date, g.target_amount_cents, g.target_date,
             (SELECT application_date FROM application_clock WHERE singleton = true) AS application_date,
             COALESCE(SUM(l.principal_cents) FILTER (
               WHERE l.entry_type IN ('account_opened', 'contribution_posted')
             ), 0) AS principal_cents,
             COALESCE(SUM(l.interest_cents) FILTER (
               WHERE l.entry_type = 'interest_posted'
             ), 0) AS interest_cents,
             COALESCE(SUM(l.principal_cents + l.interest_cents), 0) AS balance_cents,
             p.calculation_output #>> ARRAY['vehicles',
               (SELECT (ordinality - 1)::text FROM jsonb_array_elements(p.calculation_output->'vehicles')
                WITH ORDINALITY AS vehicle(value, ordinality)
                WHERE vehicle.value->>'vehicleCode' = p.vehicle_code LIMIT 1),
               'projectedCompletionDate'] AS projected_completion_date
      FROM simulated_accounts a
      JOIN goals g ON g.id = a.goal_id AND g.user_id = ${userId}
      JOIN plan_versions p ON p.id = a.plan_version_id AND p.user_id = ${userId}
      JOIN vehicle_assumptions va ON va.version = p.assumption_version AND va.vehicle_code = p.vehicle_code
      JOIN vehicle_assumption_versions vav ON vav.version = p.assumption_version
      LEFT JOIN ledger_entries l ON l.account_id = a.id AND l.user_id = ${userId}
      WHERE a.goal_id = ${goalId} AND a.user_id = ${userId}
      GROUP BY a.id, p.vehicle_code, p.assumption_version, va.apy_basis_points,
               vav.reviewed_date, g.target_amount_cents, g.target_date, p.calculation_output
    `;
    const row = rows[0];
    if (row === undefined) return null;
    const principal = Number(row.principal_cents);
    const interest = Number(row.interest_cents);
    const balance = Number(row.balance_cents);
    const target = Number(row.target_amount_cents);
    const fixedTerm = row.vehicle_code === 'cd_ladder' || row.vehicle_code === 'treasury_ladder';
    return {
      id: row.id,
      goalId: row.goal_id,
      status: row.status,
      vehicleCode: row.vehicle_code,
      principalContributedCents: principal,
      interestEarnedCents: interest,
      currentLedgerBalanceCents: balance,
      availableBalanceCents:
        fixedTerm && calendarDate(row.application_date) < calendarDate(row.target_date)
          ? 0
          : balance,
      pendingContributionCents: 0,
      nextContributionDate:
        row.next_contribution_date === null ? null : calendarDate(row.next_contribution_date),
      currentIllustrativeApyBasisPoints: row.apy_basis_points,
      progressPercent:
        row.status === 'completed' || target === 0
          ? 100
          : Math.min(100, Math.round((balance / target) * 10_000) / 100),
      projectedCompletionDate: row.projected_completion_date,
      assumptionVersion: row.assumption_version,
      assumptionReviewedDate: calendarDate(row.reviewed_date),
      assumptionIsStale: row.assumption_is_stale,
    };
  }

  public async getActivity(userId: string, goalId: string): Promise<readonly ActivityDto[]> {
    const rows = await this.database<
      (postgres.Row & {
        readonly id: string;
        readonly entry_type: ActivityDto['type'];
        readonly effective_date: string | Date;
        readonly principal_cents: string;
        readonly interest_cents: string;
        readonly description: string;
        readonly created_at: Date;
      })[]
    >`
      SELECT l.id, l.entry_type, l.effective_date, l.principal_cents, l.interest_cents,
             l.description, l.created_at
      FROM ledger_entries l
      JOIN simulated_accounts a ON a.id = l.account_id
      WHERE a.goal_id = ${goalId} AND l.user_id = ${userId} AND a.user_id = ${userId}
      ORDER BY l.effective_date DESC, l.created_at DESC
    `;
    return rows.map((row) => ({
      id: row.id,
      type: row.entry_type,
      effectiveDate: calendarDate(row.effective_date),
      principalCents: Number(row.principal_cents),
      interestCents: Number(row.interest_cents),
      description: row.description,
      createdAt: row.created_at.toISOString(),
    }));
  }

  public async postContribution(input: {
    readonly userId: string;
    readonly goalId: string;
    readonly amountCents: number;
    readonly effectiveDate: string;
    readonly occurrenceId: string;
    readonly idempotencyKey: string;
    readonly requestHash: string;
    readonly simulateFailure: boolean;
  }): Promise<{
    readonly activityId: string;
    readonly posted: boolean;
    readonly duplicate: boolean;
  }> {
    return this.database.begin(async (transaction) => {
      const operation = `goal.contribution:${input.goalId}`;
      await transaction`SELECT pg_advisory_xact_lock(hashtextextended(${`${input.userId}:${operation}:${input.idempotencyKey}`}, 0))`;
      const stored = await transaction<
        {
          readonly request_hash: string;
          readonly response_body: {
            readonly activityId: string;
            readonly posted: boolean;
            readonly duplicate: boolean;
          };
        }[]
      >`
        SELECT request_hash, response_body
        FROM idempotency_records
        WHERE user_id = ${input.userId} AND operation = ${operation}
          AND key = ${input.idempotencyKey}
      `;
      const storedRecord = stored[0];
      if (storedRecord !== undefined) {
        if (storedRecord.request_hash !== input.requestHash) throw new IdempotencyConflictError();
        return { ...storedRecord.response_body, duplicate: true };
      }
      const accountRows = await transaction<
        {
          id: string;
          status: string;
          target_amount_cents: string;
          target_date: string | Date;
          vehicle_code: VehicleCode;
        }[]
      >`
        SELECT a.id, a.status, g.target_amount_cents, g.target_date, p.vehicle_code
        FROM simulated_accounts a
        JOIN goals g ON g.id = a.goal_id AND g.user_id = a.user_id
        JOIN plan_versions p ON p.id = a.plan_version_id AND p.user_id = a.user_id
        WHERE a.goal_id = ${input.goalId} AND a.user_id = ${input.userId} FOR UPDATE OF a
      `;
      const account = accountRows[0];
      if (account === undefined)
        throw new StateConflictError('Activate this goal before adding a contribution.');
      const existing = await transaction<{ id: string; entry_type: string }[]>`
        SELECT id, entry_type FROM ledger_entries
        WHERE account_id = ${account.id} AND occurrence_id = ${input.occurrenceId}
      `;
      if (existing[0] !== undefined) {
        const duplicateResult = {
          activityId: existing[0].id,
          posted: existing[0].entry_type === 'contribution_posted',
          duplicate: true,
        };
        await transaction`
          INSERT INTO idempotency_records (
            user_id, operation, key, request_hash, response_status, response_body
          ) VALUES (
            ${input.userId}, ${operation}, ${input.idempotencyKey}, ${input.requestHash}, 200,
            ${transaction.json(duplicateResult)}
          )
        `;
        return duplicateResult;
      }
      if (account.status !== 'active')
        throw new StateConflictError('Contributions are available only while the goal is active.');
      const activityId = ulid();
      await transaction`
        INSERT INTO ledger_entries (
          id, account_id, user_id, entry_type, principal_cents, effective_date,
          occurrence_id, description
        ) VALUES (
          ${activityId}, ${account.id}, ${input.userId},
          ${input.simulateFailure ? 'contribution_failed' : 'contribution_posted'},
          ${input.simulateFailure ? 0 : input.amountCents}, ${input.effectiveDate},
          ${input.occurrenceId},
          ${input.simulateFailure ? 'Simulated contribution failed' : 'Simulated contribution posted'}
        )
      `;
      if (!input.simulateFailure) {
        const balances = await transaction<{ balance_cents: string }[]>`
          SELECT COALESCE(SUM(principal_cents + interest_cents), 0) AS balance_cents
          FROM ledger_entries WHERE account_id = ${account.id}
        `;
        const funded =
          Number(balances[0]?.balance_cents ?? 0) >= Number(account.target_amount_cents);
        const fixedTerm =
          account.vehicle_code === 'cd_ladder' || account.vehicle_code === 'treasury_ladder';
        const purchaseReady =
          funded && (!fixedTerm || input.effectiveDate >= calendarDate(account.target_date));
        if (funded) {
          await transaction`
            UPDATE simulated_accounts SET status = ${purchaseReady ? 'purchase_ready' : 'active'},
              next_contribution_date = NULL,
              updated_at = now()
            WHERE id = ${account.id} AND user_id = ${input.userId}
          `;
        }
        if (purchaseReady) {
          await transaction`
            UPDATE goals SET status = 'purchase_ready', version = version + 1, updated_at = now()
            WHERE id = ${input.goalId} AND user_id = ${input.userId}
          `;
        }
      }
      const result = { activityId, posted: !input.simulateFailure, duplicate: false };
      await transaction`
        INSERT INTO idempotency_records (
          user_id, operation, key, request_hash, response_status, response_body
        ) VALUES (
          ${input.userId}, ${operation}, ${input.idempotencyKey}, ${input.requestHash}, 201,
          ${transaction.json(result)}
        )
      `;
      return result;
    });
  }

  public async listDueAccounts(processingDate: string): Promise<readonly DueAccount[]> {
    const rows = await this.database<
      (postgres.Row & {
        readonly account_id: string;
        readonly user_id: string;
        readonly goal_id: string;
        readonly next_contribution_date: string | Date;
        readonly recurring_contribution_cents: string;
        readonly contribution_cadence: GoalInput['contributionCadence'];
        readonly target_amount_cents: string;
        readonly target_date: string | Date;
        readonly schedule_anchor_date: string;
        readonly apy_basis_points: number;
        readonly vehicle_code: VehicleCode;
        readonly last_processed_date: string | Date;
      })[]
    >`
      SELECT a.id AS account_id, a.user_id, a.goal_id, a.next_contribution_date,
             g.recurring_contribution_cents, g.contribution_cadence, g.target_amount_cents,
             g.target_date, p.calculation_output->>'asOfDate' AS schedule_anchor_date,
             va.apy_basis_points, p.vehicle_code, a.last_processed_date
      FROM simulated_accounts a
      JOIN goals g ON g.id = a.goal_id AND g.user_id = a.user_id
      JOIN plan_versions p ON p.id = a.plan_version_id AND p.user_id = a.user_id
      JOIN vehicle_assumptions va ON va.version = p.assumption_version AND va.vehicle_code = p.vehicle_code
      WHERE a.status = 'active' AND a.next_contribution_date <= ${processingDate}
        AND a.next_contribution_date <= g.target_date
      ORDER BY a.next_contribution_date, a.id
      LIMIT 500
    `;
    return rows.map((row) => ({
      accountId: row.account_id,
      userId: row.user_id,
      goalId: row.goal_id,
      nextContributionDate: calendarDate(row.next_contribution_date),
      recurringContributionCents: Number(row.recurring_contribution_cents),
      cadence: row.contribution_cadence,
      targetAmountCents: Number(row.target_amount_cents),
      targetDate: calendarDate(row.target_date),
      scheduleAnchorDate: row.schedule_anchor_date,
      apyBasisPoints: row.apy_basis_points,
      vehicleCode: row.vehicle_code,
      lastProcessedDate: calendarDate(row.last_processed_date),
    }));
  }

  public async processScheduledContribution(input: {
    readonly account: DueAccount;
    readonly nextContributionDate: string | null;
  }): Promise<{ readonly posted: boolean; readonly purchaseReady: boolean }> {
    return this.database.begin(async (transaction) => {
      const locked = await transaction<
        { status: string; next_contribution_date: string | Date | null }[]
      >`
        SELECT status, next_contribution_date FROM simulated_accounts
        WHERE id = ${input.account.accountId} AND user_id = ${input.account.userId} FOR UPDATE
      `;
      const lockedAccount = locked[0];
      if (
        lockedAccount?.status !== 'active' ||
        (lockedAccount.next_contribution_date === null
          ? null
          : calendarDate(lockedAccount.next_contribution_date)) !==
          input.account.nextContributionDate
      )
        return { posted: false, purchaseReady: false };
      const occurrenceId = `schedule:${input.account.accountId}:${input.account.nextContributionDate}`;
      const occurrences = await transaction<{ id: string }[]>`
        INSERT INTO schedule_occurrences (id, account_id, user_id, due_date, status)
        VALUES (
          ${occurrenceId}, ${input.account.accountId}, ${input.account.userId},
          ${input.account.nextContributionDate},
          ${input.account.recurringContributionCents > 0 ? 'posted' : 'skipped'}
        ) ON CONFLICT (account_id, due_date) DO NOTHING RETURNING id
      `;
      if (occurrences[0] === undefined) return { posted: false, purchaseReady: false };
      await transaction`
        INSERT INTO ledger_entries (
          id, account_id, user_id, entry_type, effective_date, occurrence_id, description
        ) VALUES (
          ${ulid()}, ${input.account.accountId}, ${input.account.userId},
          'contribution_scheduled', ${input.account.nextContributionDate},
          ${`scheduled:${input.account.accountId}:${input.account.nextContributionDate}`},
          'Scheduled simulated contribution due'
        )
      `;
      if (input.account.recurringContributionCents === 0) {
        await transaction`
          UPDATE simulated_accounts SET next_contribution_date = ${input.nextContributionDate},
            last_processed_date = ${input.account.nextContributionDate}, updated_at = now()
          WHERE id = ${input.account.accountId} AND user_id = ${input.account.userId}
        `;
        return { posted: false, purchaseReady: false };
      }
      await transaction`
        INSERT INTO ledger_entries (
          id, account_id, user_id, entry_type, principal_cents, effective_date,
          occurrence_id, description
        ) VALUES (
          ${ulid()}, ${input.account.accountId}, ${input.account.userId}, 'contribution_posted',
          ${input.account.recurringContributionCents}, ${input.account.nextContributionDate},
          ${occurrenceId}, 'Scheduled simulated contribution posted'
        )
      `;
      const balances = await transaction<{ balance_cents: string }[]>`
        SELECT COALESCE(SUM(principal_cents + interest_cents), 0) AS balance_cents
        FROM ledger_entries WHERE account_id = ${input.account.accountId}
      `;
      const funded = Number(balances[0]?.balance_cents ?? 0) >= input.account.targetAmountCents;
      const fixedTerm =
        input.account.vehicleCode === 'cd_ladder' ||
        input.account.vehicleCode === 'treasury_ladder';
      const purchaseReady =
        funded && (!fixedTerm || input.account.nextContributionDate >= input.account.targetDate);
      await transaction`
        UPDATE simulated_accounts SET
          status = ${purchaseReady ? 'purchase_ready' : 'active'},
          next_contribution_date = ${funded ? null : input.nextContributionDate},
          last_processed_date = ${input.account.nextContributionDate},
          updated_at = now()
        WHERE id = ${input.account.accountId} AND user_id = ${input.account.userId}
      `;
      if (purchaseReady) {
        await transaction`
          UPDATE goals SET status = 'purchase_ready', version = version + 1, updated_at = now()
          WHERE id = ${input.account.goalId} AND user_id = ${input.account.userId}
        `;
      }
      return { posted: true, purchaseReady };
    });
  }

  public async listActiveAccounts(): Promise<readonly ActiveAccount[]> {
    const rows = await this.database<
      (postgres.Row & {
        readonly account_id: string;
        readonly user_id: string;
        readonly goal_id: string;
        readonly apy_basis_points: number;
        readonly vehicle_code: VehicleCode;
        readonly lock_days: number;
        readonly target_amount_cents: string;
        readonly target_date: string | Date;
        readonly balance_cents: string;
        readonly accrued_interest_micros: string;
        readonly last_accrual_date: string | Date;
      })[]
    >`
      SELECT a.id AS account_id, a.user_id, a.goal_id, va.apy_basis_points,
             p.vehicle_code, va.lock_days, g.target_amount_cents, g.target_date,
             a.accrued_interest_micros, a.last_accrual_date,
             COALESCE(SUM(l.principal_cents + l.interest_cents), 0) AS balance_cents
      FROM simulated_accounts a
      JOIN goals g ON g.id = a.goal_id AND g.user_id = a.user_id
      JOIN plan_versions p ON p.id = a.plan_version_id AND p.user_id = a.user_id
      JOIN vehicle_assumptions va ON va.version = p.assumption_version AND va.vehicle_code = p.vehicle_code
      LEFT JOIN ledger_entries l ON l.account_id = a.id AND l.user_id = a.user_id
      WHERE a.status IN ('active', 'paused', 'purchase_ready')
      GROUP BY a.id, va.apy_basis_points, p.vehicle_code, va.lock_days,
               g.target_amount_cents, g.target_date
    `;
    return rows.map((row) => ({
      accountId: row.account_id,
      userId: row.user_id,
      goalId: row.goal_id,
      apyBasisPoints: row.apy_basis_points,
      vehicleCode: row.vehicle_code,
      lockDays: row.lock_days,
      targetAmountCents: Number(row.target_amount_cents),
      targetDate: calendarDate(row.target_date),
      balanceCents: Number(row.balance_cents),
      accruedInterestMicros: Number(row.accrued_interest_micros),
      lastAccrualDate: calendarDate(row.last_accrual_date),
    }));
  }

  public async listDueMaturityLots(
    account: ActiveAccount,
    processingDate: string,
  ): Promise<readonly MaturityLot[]> {
    if (account.lockDays <= 0) return [];
    const rows = await this.database<
      (postgres.Row & {
        readonly source_entry_id: string;
        readonly principal_cents: string;
        readonly cycle: number;
        readonly maturity_date: string | Date;
      })[]
    >`
      SELECT l.id AS source_entry_id, l.principal_cents, cycles.cycle,
             l.effective_date + (cycles.cycle * ${account.lockDays}) AS maturity_date
      FROM ledger_entries l
      JOIN simulated_accounts a ON a.id = l.account_id AND a.user_id = l.user_id
      JOIN goals g ON g.id = a.goal_id AND g.user_id = a.user_id
      CROSS JOIN LATERAL generate_series(
        1,
        GREATEST(0, ((${processingDate}::date - l.effective_date) / ${account.lockDays})::integer)
      ) AS cycles(cycle)
      WHERE l.account_id = ${account.accountId} AND l.user_id = ${account.userId}
        AND l.principal_cents > 0
        AND l.entry_type IN ('account_opened', 'contribution_posted')
        AND l.effective_date + (cycles.cycle * ${account.lockDays}) <= g.target_date
        AND NOT EXISTS (
          SELECT 1 FROM ledger_entries posted
          WHERE posted.account_id = l.account_id
            AND posted.occurrence_id = ${`maturity:`} || l.id || ':' || cycles.cycle::text
        )
      ORDER BY maturity_date, source_entry_id, cycles.cycle
    `;
    return rows.map((row) => ({
      sourceEntryId: row.source_entry_id,
      principalCents: Number(row.principal_cents),
      cycle: row.cycle,
      maturityDate: calendarDate(row.maturity_date),
    }));
  }

  public async postMaturityInterest(input: {
    readonly account: ActiveAccount;
    readonly lot: MaturityLot;
    readonly interestCents: number;
  }): Promise<{ readonly posted: boolean; readonly purchaseReady: boolean }> {
    return this.database.begin(async (transaction) => {
      const locked = await transaction<{ status: string }[]>`
        SELECT status FROM simulated_accounts
        WHERE id = ${input.account.accountId} AND user_id = ${input.account.userId} FOR UPDATE
      `;
      if (!['active', 'paused', 'purchase_ready'].includes(locked[0]?.status ?? ''))
        return { posted: false, purchaseReady: false };
      const occurrenceId = `maturity:${input.lot.sourceEntryId}:${String(input.lot.cycle)}`;
      const inserted = await transaction<{ id: string }[]>`
        INSERT INTO ledger_entries (
          id, account_id, user_id, entry_type, interest_cents, effective_date,
          occurrence_id, description
        ) VALUES (
          ${ulid()}, ${input.account.accountId}, ${input.account.userId},
          ${input.interestCents > 0 ? 'interest_posted' : 'interest_accrued'},
          ${input.interestCents}, ${input.lot.maturityDate}, ${occurrenceId},
          ${
            input.interestCents > 0
              ? 'Modeled fixed-term interest posted at maturity'
              : 'Modeled fixed-term maturity produced less than one cent'
          }
        ) ON CONFLICT (account_id, occurrence_id) WHERE occurrence_id IS NOT NULL DO NOTHING
        RETURNING id
      `;
      if (inserted[0] === undefined) return { posted: false, purchaseReady: false };
      const balances = await transaction<{ balance_cents: string }[]>`
        SELECT COALESCE(SUM(principal_cents + interest_cents), 0) AS balance_cents
        FROM ledger_entries WHERE account_id = ${input.account.accountId}
      `;
      const purchaseReady =
        input.lot.maturityDate >= input.account.targetDate &&
        Number(balances[0]?.balance_cents ?? 0) >= input.account.targetAmountCents;
      if (purchaseReady && locked[0]?.status !== 'purchase_ready') {
        await transaction`
          UPDATE simulated_accounts SET status = 'purchase_ready', next_contribution_date = NULL,
            updated_at = now()
          WHERE id = ${input.account.accountId} AND user_id = ${input.account.userId}
        `;
        await transaction`
          UPDATE goals SET status = 'purchase_ready', version = version + 1, updated_at = now()
          WHERE id = ${input.account.goalId} AND user_id = ${input.account.userId}
        `;
      }
      return {
        posted: input.interestCents > 0,
        purchaseReady: purchaseReady && locked[0]?.status !== 'purchase_ready',
      };
    });
  }

  public async markPurchaseReadyIfFunded(
    account: ActiveAccount,
    processingDate: string,
  ): Promise<boolean> {
    return this.database.begin(async (transaction) => {
      const locked = await transaction<{ status: string }[]>`
        SELECT status FROM simulated_accounts
        WHERE id = ${account.accountId} AND user_id = ${account.userId} FOR UPDATE
      `;
      const balances = await transaction<{ balance_cents: string }[]>`
        SELECT COALESCE(SUM(principal_cents + interest_cents), 0) AS balance_cents
        FROM ledger_entries
        WHERE account_id = ${account.accountId} AND user_id = ${account.userId}
      `;
      if (
        !['active', 'paused'].includes(locked[0]?.status ?? '') ||
        ((account.vehicleCode === 'cd_ladder' || account.vehicleCode === 'treasury_ladder') &&
          processingDate < account.targetDate) ||
        Number(balances[0]?.balance_cents ?? 0) < account.targetAmountCents
      )
        return false;
      await transaction`
        UPDATE simulated_accounts SET status = 'purchase_ready', next_contribution_date = NULL,
          updated_at = now()
        WHERE id = ${account.accountId} AND user_id = ${account.userId}
      `;
      await transaction`
        UPDATE goals SET status = 'purchase_ready', version = version + 1, updated_at = now()
        WHERE id = ${account.goalId} AND user_id = ${account.userId}
      `;
      return true;
    });
  }

  public async accrueInterestDay(input: {
    readonly account: ActiveAccount;
    readonly accrualDate: string;
    readonly accrualMicros: number;
    readonly postInterestCents: number;
    readonly postingBoundary: boolean;
  }): Promise<{ readonly accrued: boolean; readonly purchaseReady: boolean }> {
    return this.database.begin(async (transaction) => {
      const locked = await transaction<
        { last_accrual_date: string | Date; accrued_interest_micros: string; status: string }[]
      >`
        SELECT last_accrual_date, accrued_interest_micros, status FROM simulated_accounts
        WHERE id = ${input.account.accountId} AND user_id = ${input.account.userId} FOR UPDATE
      `;
      const lockedAccount = locked[0];
      if (lockedAccount === undefined) return { accrued: false, purchaseReady: false };
      if (
        !['active', 'paused', 'purchase_ready'].includes(lockedAccount.status) ||
        calendarDate(lockedAccount.last_accrual_date) >= input.accrualDate
      )
        return { accrued: false, purchaseReady: false };
      const totalMicros = Number(lockedAccount.accrued_interest_micros) + input.accrualMicros;
      await transaction`
        INSERT INTO ledger_entries (
          id, account_id, user_id, entry_type, effective_date, occurrence_id, description
        ) VALUES (
          ${ulid()}, ${input.account.accountId}, ${input.account.userId}, 'interest_accrued',
          ${input.accrualDate}, ${`accrual:${input.account.accountId}:${input.accrualDate}`},
          'Modeled daily interest accrued'
        ) ON CONFLICT (account_id, occurrence_id) WHERE occurrence_id IS NOT NULL DO NOTHING
      `;
      if (input.postInterestCents > 0) {
        const occurrenceId = `interest:${input.account.accountId}:${input.accrualDate}`;
        await transaction`
          INSERT INTO ledger_entries (
            id, account_id, user_id, entry_type, interest_cents, effective_date,
            occurrence_id, description
          ) VALUES (
            ${ulid()}, ${input.account.accountId}, ${input.account.userId}, 'interest_posted',
            ${input.postInterestCents}, ${input.accrualDate}, ${occurrenceId},
            'Modeled interest posted'
          ) ON CONFLICT (account_id, occurrence_id) WHERE occurrence_id IS NOT NULL DO NOTHING
        `;
      }
      await transaction`
        UPDATE simulated_accounts SET last_accrual_date = ${input.accrualDate},
          accrued_interest_micros = ${input.postingBoundary ? 0 : totalMicros},
          updated_at = now()
        WHERE id = ${input.account.accountId} AND user_id = ${input.account.userId}
      `;
      const balances = await transaction<{ balance_cents: string }[]>`
        SELECT COALESCE(SUM(principal_cents + interest_cents), 0) AS balance_cents
        FROM ledger_entries
        WHERE account_id = ${input.account.accountId} AND user_id = ${input.account.userId}
      `;
      const purchaseReady =
        Number(balances[0]?.balance_cents ?? 0) >= input.account.targetAmountCents;
      const transitioned = purchaseReady && lockedAccount.status !== 'purchase_ready';
      if (transitioned) {
        await transaction`
          UPDATE simulated_accounts SET status = 'purchase_ready', next_contribution_date = NULL
          WHERE id = ${input.account.accountId} AND user_id = ${input.account.userId}
        `;
        await transaction`
          UPDATE goals SET status = 'purchase_ready', version = version + 1, updated_at = now()
          WHERE id = ${input.account.goalId} AND user_id = ${input.account.userId}
        `;
      }
      return { accrued: true, purchaseReady: transitioned };
    });
  }

  public async getApplicationDate(): Promise<string> {
    const rows = await this.database<{ application_date: string | Date }[]>`
      SELECT application_date FROM application_clock WHERE singleton = true
    `;
    const row = rows[0];
    if (row === undefined) throw new Error('Application clock is not seeded.');
    return calendarDate(row.application_date);
  }

  public async setApplicationDate(currentDate: string): Promise<void> {
    await this.database`
      UPDATE application_clock SET application_date = ${currentDate}, updated_at = now()
      WHERE singleton = true AND application_date <= ${currentDate}
    `;
  }

  public async audit(userId: string, eventName: string, resourceId?: string): Promise<void> {
    await this.database`
      INSERT INTO audit_events (id, user_id, event_name, resource_id)
      VALUES (${ulid()}, ${userId}, ${eventName}, ${resourceId ?? null})
    `;
  }

  public async exportUserData(userId: string): Promise<Readonly<Record<string, unknown>> | null> {
    const user = await this.getUser(userId);
    if (user === null) return null;
    const goals = await this.listGoals(userId);
    const plans = await this.database`
      SELECT id, goal_id, version, vehicle_code, assumption_version, normalized_input,
             calculation_output, created_at
      FROM plan_versions WHERE user_id = ${userId} ORDER BY created_at
    `;
    const activity = await this.database`
      SELECT l.id, a.goal_id, l.entry_type, l.principal_cents, l.interest_cents,
             l.effective_date, l.description, l.created_at
      FROM ledger_entries l JOIN simulated_accounts a ON a.id = l.account_id
      WHERE l.user_id = ${userId} AND a.user_id = ${userId} ORDER BY l.created_at
    `;
    return { exportedAt: new Date().toISOString(), user, goals, plans, activity };
  }

  public async createCompletedExport(userId: string): Promise<{
    readonly requestId: string;
    readonly data: Readonly<Record<string, unknown>>;
  }> {
    const data = await this.exportUserData(userId);
    if (data === null) throw new Error('User no longer exists.');
    const requestId = ulid();
    await this.database`
      INSERT INTO data_requests (id, user_id, request_type, status, completed_at)
      VALUES (${requestId}, ${userId}, 'export', 'completed', now())
    `;
    await this.audit(userId, 'privacy.export_completed', requestId);
    return { requestId, data };
  }

  public async deleteAccount(userId: string, subjectHash: string): Promise<boolean> {
    return this.database.begin(async (transaction) => {
      const existing = await transaction<{ id: string }[]>`
        SELECT id FROM users WHERE id = ${userId} AND deleted_at IS NULL FOR UPDATE
      `;
      if (existing[0] === undefined) return false;
      await transaction`
        INSERT INTO audit_events (id, user_id, event_name, resource_id)
        VALUES (${ulid()}, ${userId}, 'privacy.deletion_completed', NULL)
      `;
      await transaction`
        UPDATE audit_events SET pseudonymous_subject_hash = ${subjectHash}, user_id = NULL,
          resource_id = NULL, metadata = '{}'::jsonb
        WHERE user_id = ${userId}
      `;
      await transaction`DELETE FROM users WHERE id = ${userId}`;
      return true;
    });
  }
}
