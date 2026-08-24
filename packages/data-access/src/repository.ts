import type {
  AccountSummaryDto,
  ActivityDto,
  GoalArchiveInput,
  GoalDto,
  GoalInput,
  PlanCalculationContext,
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

type ExportUserRow = postgres.Row & {
  readonly id: string;
  readonly email: string;
  readonly display_name: string;
  readonly created_at: Date;
  readonly updated_at: Date;
};

type ExportRecord = Readonly<Record<string, unknown>>;
type ExportRecordRow = postgres.Row & { readonly record: ExportRecord };

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
  readonly archived_at?: Date | null;
  readonly archive_reason?: GoalDto['archiveReason'];
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

function addCalendarDaysUtc(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function initialPlanCalculationContext(
  goal: Pick<GoalDto, 'currentSavedCents' | 'targetDate'>,
  assumption: PreviewOutput['vehicles'][number]['assumption'],
  applicationDate: string,
): PlanCalculationContext {
  const fixedTerm =
    assumption.vehicleCode === 'cd_ladder' || assumption.vehicleCode === 'treasury_ladder';
  const firstMaturityDate = addCalendarDaysUtc(applicationDate, assumption.lockDays);
  return {
    contextVersion: 'plan-calculation-context-v1',
    personalPrincipalCents: goal.currentSavedCents,
    totalLedgerValueCents: goal.currentSavedCents,
    currentAvailableFundsCents: fixedTerm ? 0 : goal.currentSavedCents,
    currentAccruedInterestMicros: 0,
    applicationDate,
    scheduleAnchorDate: applicationDate,
    omittedContributionDates: [],
    fixedTermLots:
      fixedTerm && goal.currentSavedCents > 0
        ? [
            {
              personalPrincipalCents: goal.currentSavedCents,
              currentBalanceCents: goal.currentSavedCents,
              firstMaturityDate,
              nextMaturityDate: firstMaturityDate,
              nextMaturityInterestEligible: firstMaturityDate <= goal.targetDate,
            },
          ]
        : [],
  };
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
    archivedAt:
      row.status === 'archived' ? (row.archived_at ?? row.updated_at).toISOString() : null,
    archiveReason: row.status === 'archived' ? (row.archive_reason ?? 'GOAL_COMPLETED') : null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export function calculatePrincipalCompositionBasisPoints(
  personalPrincipalCents: number,
  modeledInterestCents: number,
): number {
  if (!Number.isSafeInteger(personalPrincipalCents) || personalPrincipalCents < 0) {
    throw new RangeError('Personal principal must be a non-negative safe integer.');
  }
  if (!Number.isSafeInteger(modeledInterestCents) || modeledInterestCents < 0) {
    throw new RangeError('Modeled interest must be a non-negative safe integer.');
  }
  const lifetimeFundingCents = personalPrincipalCents + modeledInterestCents;
  if (!Number.isSafeInteger(lifetimeFundingCents)) {
    throw new RangeError('Lifetime funding must be a safe integer.');
  }
  if (lifetimeFundingCents === 0) return 0;
  return Math.min(
    10_000,
    Math.max(0, Math.round((personalPrincipalCents / lifetimeFundingCents) * 10_000)),
  );
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
  readonly omittedContributionDates: readonly string[];
  readonly omitContribution: boolean;
  readonly apyBasisPoints: number;
  readonly vehicleCode: VehicleCode;
  readonly lastProcessedDate: string;
}

export interface ActiveAccount {
  readonly accountId: string;
  readonly userId: string;
  readonly goalId: string;
  readonly goalVersion: number;
  readonly planVersionId: string;
  readonly apyBasisPoints: number;
  readonly vehicleCode: VehicleCode;
  readonly lockDays: number;
  readonly targetAmountCents: number;
  readonly targetDate: string;
  readonly balanceCents: number;
  readonly ledgerEntryCount: number;
  readonly accruedInterestMicros: number;
  readonly lastAccrualDate: string;
}

export interface MaturityLot {
  readonly sourceEntryId: string;
  readonly principalCents: number;
  readonly currentBalanceCents: number;
  readonly cycle: number;
  readonly maturityDate: string;
}

export const userDataExportSchemaVersion = 'goalpilot-user-data-export-v2' as const;

export interface UserDataExport {
  readonly schemaVersion: typeof userDataExportSchemaVersion;
  readonly exportedAt: string;
  readonly user: UserDto & { readonly createdAt: string; readonly updatedAt: string };
  readonly goalDrafts: readonly ExportRecord[];
  readonly userApplicationClock: ExportRecord | null;
  readonly demoFixtureCapability: ExportRecord | null;
  readonly goals: readonly GoalDto[];
  readonly planVersions: readonly ExportRecord[];
  readonly simulatedAccounts: readonly ExportRecord[];
  readonly ledgerEntries: readonly ExportRecord[];
  readonly scheduleOccurrences: readonly ExportRecord[];
  readonly interestPostingPeriods: readonly ExportRecord[];
  readonly purchaseTiming: Readonly<{
    items: readonly ExportRecord[];
    watchPolicies: readonly ExportRecord[];
    checkRuns: readonly ExportRecord[];
    observations: readonly ExportRecord[];
    assessments: readonly ExportRecord[];
  }>;
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

export async function lockOwnerFinancialMutation(
  transaction: postgres.TransactionSql,
  userId: string,
  expectedApplicationDate?: string,
): Promise<string> {
  const clocks = await transaction<
    { readonly application_date: string | Date; readonly financial_run_active: boolean }[]
  >`
    SELECT application_date, (
      financial_run_token IS NOT NULL AND financial_run_expires_at > now()
    ) AS financial_run_active
    FROM user_application_clocks
    WHERE user_id = ${userId}
    FOR UPDATE
  `;
  const clock = clocks[0];
  if (clock === undefined) {
    throw new StateConflictError('The controlled application clock is unavailable.');
  }
  if (clock.financial_run_active) {
    throw new StateConflictError('A Story Mode financial run is already in progress.');
  }
  const applicationDate = calendarDate(clock.application_date);
  if (expectedApplicationDate !== undefined && applicationDate !== expectedApplicationDate) {
    throw new StateConflictError('The application date changed. Refresh and try again.');
  }
  return applicationDate;
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
      await lockOwnerFinancialMutation(transaction, userId);
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
      await lockOwnerFinancialMutation(transaction, userId);
      const rows = await transaction<{ id: string }[]>`
        UPDATE goals SET status = 'archived', version = version + 1,
          archived_at = now(), archive_reason = 'GOAL_COMPLETED', updated_at = now()
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

  public async archiveGoalPlan(input: {
    readonly userId: string;
    readonly goalId: string;
    readonly expectedGoalVersion: number;
    readonly reasonCode: GoalArchiveInput['reasonCode'];
    readonly idempotencyKey: string;
    readonly requestHash: string;
    readonly requestId?: string;
  }): Promise<
    | { readonly result: 'archived'; readonly goal: GoalDto; readonly replayed: boolean }
    | {
        readonly result: 'not_found' | 'version_conflict' | 'invalid_state';
        readonly replayed: false;
      }
  > {
    return this.database.begin(async (transaction) => {
      const operation = 'goal-plan.archive';
      await transaction`SELECT pg_advisory_xact_lock(hashtextextended(${`${input.userId}:${operation}:${input.idempotencyKey}`}, 0))`;
      const prior = await transaction<
        { readonly request_hash: string; readonly response_body: GoalDto }[]
      >`
        SELECT request_hash, response_body
        FROM idempotency_records
        WHERE user_id = ${input.userId} AND operation = ${operation}
          AND key = ${input.idempotencyKey}
      `;
      const previous = prior[0];
      if (previous !== undefined) {
        if (previous.request_hash !== input.requestHash) throw new IdempotencyConflictError();
        return {
          result: 'archived',
          goal: {
            ...previous.response_body,
            archivedAt: previous.response_body.archivedAt ?? previous.response_body.updatedAt,
            archiveReason: previous.response_body.archiveReason ?? input.reasonCode,
          },
          replayed: true,
        };
      }

      await lockOwnerFinancialMutation(transaction, input.userId);

      const currentRows = await transaction<
        { readonly version: number; readonly status: string }[]
      >`
        SELECT version, status FROM goals
        WHERE id = ${input.goalId} AND user_id = ${input.userId}
        FOR UPDATE
      `;
      const current = currentRows[0];
      if (current === undefined) return { result: 'not_found', replayed: false };
      if (current.version !== input.expectedGoalVersion) {
        return { result: 'version_conflict', replayed: false };
      }
      const allowedStates = ['active', 'paused', 'purchase_ready', 'completed'];
      if (
        !allowedStates.includes(current.status) ||
        (input.reasonCode === 'GOAL_COMPLETED' && current.status !== 'completed')
      ) {
        return { result: 'invalid_state', replayed: false };
      }

      const archivedRows = await transaction<GoalRow[]>`
        UPDATE goals SET status = 'archived', version = version + 1,
          archived_at = now(), archive_reason = ${input.reasonCode}, updated_at = now()
        WHERE id = ${input.goalId} AND user_id = ${input.userId}
          AND version = ${input.expectedGoalVersion}
        RETURNING id, name, category, target_amount_cents, current_saved_cents,
          target_date, recurring_contribution_cents, contribution_cadence,
          liquidity_need, preservation_preference, confidence, notes, status,
          version, archived_at, archive_reason, created_at, updated_at
      `;
      const archivedRow = archivedRows[0];
      if (archivedRow === undefined) return { result: 'version_conflict', replayed: false };
      await transaction`
        UPDATE simulated_accounts SET
          status = 'completed', next_contribution_date = NULL, updated_at = now()
        WHERE goal_id = ${input.goalId} AND user_id = ${input.userId}
      `;
      const goal = mapGoal(archivedRow);
      await transaction`
        INSERT INTO idempotency_records (
          user_id, operation, key, request_hash, response_status, response_body
        ) VALUES (
          ${input.userId}, ${operation}, ${input.idempotencyKey}, ${input.requestHash}, 200,
          ${transaction.json(jsonValue(goal))}
        )
      `;
      await transaction`
        INSERT INTO audit_events (
          id, user_id, event_name, resource_id, request_id, metadata
        ) VALUES (
          ${ulid()}, ${input.userId}, 'goal.archived', ${input.goalId},
          ${input.requestId ?? null},
          ${transaction.json({ reasonCode: input.reasonCode })}
        )
      `;
      return { result: 'archived', goal, replayed: false };
    });
  }

  public async setGoalState(
    userId: string,
    goalId: string,
    fromStates: readonly GoalDto['status'][],
    toState: GoalDto['status'],
    eventType: ActivityDto['type'],
    effectiveDate: string,
  ): Promise<boolean> {
    return this.database.begin(async (transaction) => {
      await lockOwnerFinancialMutation(transaction, userId);
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
            ${effectiveDate},
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
                ${effectiveDate},
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

  public async transitionGoalStateIdempotent(input: {
    readonly userId: string;
    readonly goalId: string;
    readonly expectedGoalVersion: number;
    readonly fromStates: readonly GoalDto['status'][];
    readonly toState: GoalDto['status'];
    readonly eventType: ActivityDto['type'];
    readonly effectiveDate: string;
    readonly idempotencyKey: string;
    readonly requestHash: string;
    readonly requestId?: string;
  }): Promise<
    | { readonly result: 'transitioned'; readonly goal: GoalDto; readonly replayed: boolean }
    | {
        readonly result: 'not_found' | 'version_conflict' | 'invalid_state';
        readonly replayed: false;
      }
  > {
    return this.database.begin(async (transaction) => {
      const operation = `goal.${input.toState}`;
      await transaction`SELECT pg_advisory_xact_lock(hashtextextended(${`${input.userId}:${operation}:${input.idempotencyKey}`}, 0))`;
      const prior = await transaction<
        { readonly request_hash: string; readonly response_body: GoalDto }[]
      >`
        SELECT request_hash, response_body FROM idempotency_records
        WHERE user_id = ${input.userId} AND operation = ${operation}
          AND key = ${input.idempotencyKey}
      `;
      const previous = prior[0];
      if (previous !== undefined) {
        if (previous.request_hash !== input.requestHash) throw new IdempotencyConflictError();
        return { result: 'transitioned', goal: previous.response_body, replayed: true };
      }

      await lockOwnerFinancialMutation(transaction, input.userId, input.effectiveDate);

      const currentRows = await transaction<
        {
          readonly version: number;
          readonly status: GoalDto['status'];
          readonly target_amount_cents: string;
        }[]
      >`
        SELECT version, status, target_amount_cents FROM goals
        WHERE id = ${input.goalId} AND user_id = ${input.userId}
        FOR UPDATE
      `;
      const current = currentRows[0];
      if (current === undefined) return { result: 'not_found', replayed: false };
      if (current.version !== input.expectedGoalVersion)
        return { result: 'version_conflict', replayed: false };
      if (!input.fromStates.includes(current.status))
        return { result: 'invalid_state', replayed: false };
      const accounts = await transaction<{ readonly id: string }[]>`
        SELECT id FROM simulated_accounts
        WHERE goal_id = ${input.goalId} AND user_id = ${input.userId}
        FOR UPDATE
      `;
      const account = accounts[0];
      if (account === undefined) return { result: 'invalid_state', replayed: false };
      let resolvedToState = input.toState;
      if (input.eventType === 'goal_completed' || input.eventType === 'resumed') {
        const available = await transaction<{ readonly available_balance_cents: string }[]>`
          SELECT simulated_account_available_balance(
            ${account.id}, ${input.userId}, ${input.effectiveDate}::date
          ) AS available_balance_cents
        `;
        const purchaseReady =
          Number(available[0]?.available_balance_cents ?? 0) >= Number(current.target_amount_cents);
        if (input.eventType === 'goal_completed' && !purchaseReady) {
          return { result: 'invalid_state', replayed: false };
        }
        if (input.eventType === 'resumed' && purchaseReady) resolvedToState = 'purchase_ready';
      }

      const rows = await transaction<GoalRow[]>`
        UPDATE goals SET status = ${resolvedToState}, version = version + 1, updated_at = now()
        WHERE id = ${input.goalId} AND user_id = ${input.userId}
          AND version = ${input.expectedGoalVersion} AND status IN ${transaction(input.fromStates)}
        RETURNING *
      `;
      const row = rows[0];
      if (row === undefined) return { result: 'version_conflict', replayed: false };
      await transaction`
        UPDATE simulated_accounts SET status = ${resolvedToState}, updated_at = now()
        WHERE goal_id = ${input.goalId} AND user_id = ${input.userId}
      `;
      await transaction`
        INSERT INTO ledger_entries
          (id, account_id, user_id, entry_type, effective_date, description)
        VALUES (
          ${ulid()}, ${account.id}, ${input.userId}, ${input.eventType},
          ${input.effectiveDate}, ${input.eventType.replaceAll('_', ' ')}
        )
      `;
      if (input.eventType === 'goal_completed') {
        const balances = await transaction<
          { readonly principal_cents: string; readonly interest_cents: string }[]
        >`
            SELECT COALESCE(SUM(principal_cents), 0) AS principal_cents,
                   COALESCE(SUM(interest_cents), 0) AS interest_cents
            FROM ledger_entries
            WHERE account_id = ${account.id} AND user_id = ${input.userId}
          `;
        const principalCents = Number(balances[0]?.principal_cents ?? 0);
        const interestCents = Number(balances[0]?.interest_cents ?? 0);
        if (principalCents + interestCents > 0) {
          await transaction`
              INSERT INTO ledger_entries (
                id, account_id, user_id, entry_type, principal_cents, interest_cents,
                effective_date, description
              ) VALUES (
                ${ulid()}, ${account.id}, ${input.userId}, 'simulated_withdrawal',
                ${-principalCents}, ${-interestCents}, ${input.effectiveDate},
                'Simulated purchase withdrawal'
              )
            `;
        }
      }
      const goal = mapGoal(row);
      await transaction`
        INSERT INTO idempotency_records (
          user_id, operation, key, request_hash, response_status, response_body
        ) VALUES (
          ${input.userId}, ${operation}, ${input.idempotencyKey}, ${input.requestHash}, 200,
          ${transaction.json(jsonValue(goal))}
        )
      `;
      await transaction`
        INSERT INTO audit_events (id, user_id, event_name, resource_id, request_id)
        VALUES (
          ${ulid()}, ${input.userId}, ${`goal.${input.toState}`}, ${input.goalId},
          ${input.requestId ?? null}
        )
      `;
      return { result: 'transitioned', goal, replayed: false };
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
      await lockOwnerFinancialMutation(transaction, input.userId, input.asOfDate);
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
      const calculationContext = initialPlanCalculationContext(
        input.goal,
        selected.assumption,
        input.asOfDate,
      );
      await transaction`
        INSERT INTO plan_versions (
          id, goal_id, user_id, version, vehicle_code, assumption_version,
          normalized_input, calculation_output, calculation_context
        ) VALUES (
          ${planId}, ${input.goal.id}, ${input.userId}, 1, ${input.vehicleCode},
          ${selected.assumption.assumptionVersion}, ${transaction.json(jsonValue(input.goal))},
          ${transaction.json(jsonValue(input.projection))},
          ${transaction.json(jsonValue(calculationContext))}
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

  public async activateGoalIdempotent(input: {
    readonly userId: string;
    readonly goal: GoalDto;
    readonly expectedGoalVersion: number;
    readonly vehicleCode: VehicleCode;
    readonly projection: PreviewOutput;
    readonly asOfDate: string;
    readonly nextContributionDate: string | null;
    readonly idempotencyKey: string;
    readonly requestHash: string;
    readonly requestId?: string;
  }): Promise<{ readonly account: AccountSummaryDto; readonly replayed: boolean }> {
    return this.database.begin(async (transaction) => {
      const operation = 'goal.activate';
      await transaction`SELECT pg_advisory_xact_lock(hashtextextended(${`${input.userId}:${operation}:${input.idempotencyKey}`}, 0))`;
      const prior = await transaction<
        { readonly request_hash: string; readonly response_body: AccountSummaryDto }[]
      >`
        SELECT request_hash, response_body FROM idempotency_records
        WHERE user_id = ${input.userId} AND operation = ${operation}
          AND key = ${input.idempotencyKey}
      `;
      const previous = prior[0];
      if (previous !== undefined) {
        if (previous.request_hash !== input.requestHash) throw new IdempotencyConflictError();
        return { account: previous.response_body, replayed: true };
      }

      await lockOwnerFinancialMutation(transaction, input.userId, input.asOfDate);

      const selected = input.projection.vehicles.find(
        (vehicle) => vehicle.vehicleCode === input.vehicleCode,
      );
      if (!selected?.eligible) throw new Error('Selected vehicle is ineligible.');
      const funded = input.goal.currentSavedCents >= input.goal.targetAmountCents;
      const fixedTerm =
        input.vehicleCode === 'cd_ladder' || input.vehicleCode === 'treasury_ladder';
      const purchaseReady = funded && !fixedTerm;
      const updated = await transaction<{ readonly id: string }[]>`
        UPDATE goals SET status = ${purchaseReady ? 'purchase_ready' : 'active'},
          version = version + 1, updated_at = now()
        WHERE id = ${input.goal.id} AND user_id = ${input.userId} AND status = 'draft'
          AND version = ${input.expectedGoalVersion}
        RETURNING id
      `;
      if (updated[0] === undefined)
        throw new StateConflictError('The goal changed or cannot be activated.');
      const planId = ulid();
      const calculationContext = initialPlanCalculationContext(
        input.goal,
        selected.assumption,
        input.asOfDate,
      );
      await transaction`
        INSERT INTO plan_versions (
          id, goal_id, user_id, version, vehicle_code, assumption_version,
          normalized_input, calculation_output, calculation_context
        ) VALUES (
          ${planId}, ${input.goal.id}, ${input.userId}, 1, ${input.vehicleCode},
          ${selected.assumption.assumptionVersion}, ${transaction.json(jsonValue(input.goal))},
          ${transaction.json(jsonValue(input.projection))},
          ${transaction.json(jsonValue(calculationContext))}
        )
      `;
      const accountId = ulid();
      await transaction`
        INSERT INTO simulated_accounts (
          id, goal_id, user_id, plan_version_id, status, next_contribution_date,
          last_processed_date, last_accrual_date
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
      const account: AccountSummaryDto = {
        id: accountId,
        goalId: input.goal.id,
        status: purchaseReady ? 'purchase_ready' : 'active',
        vehicleCode: input.vehicleCode,
        principalContributedCents: input.goal.currentSavedCents,
        interestEarnedCents: 0,
        currentLedgerBalanceCents: input.goal.currentSavedCents,
        principalCompositionBasisPoints: input.goal.currentSavedCents === 0 ? 0 : 10_000,
        availableBalanceCents:
          fixedTerm && input.asOfDate < input.goal.targetDate ? 0 : input.goal.currentSavedCents,
        pendingContributionCents: 0,
        nextContributionDate: funded ? null : input.nextContributionDate,
        currentIllustrativeApyBasisPoints: selected.assumption.apyBasisPoints,
        progressPercent: Math.min(
          100,
          Math.round((input.goal.currentSavedCents / input.goal.targetAmountCents) * 10_000) / 100,
        ),
        projectedCompletionDate: selected.projectedCompletionDate,
        assumptionVersion: selected.assumption.assumptionVersion,
        assumptionReviewedDate: selected.assumption.reviewedDate,
        assumptionIsStale: false,
      };
      await transaction`
        INSERT INTO idempotency_records (
          user_id, operation, key, request_hash, response_status, response_body
        ) VALUES (
          ${input.userId}, ${operation}, ${input.idempotencyKey}, ${input.requestHash}, 201,
          ${transaction.json(jsonValue(account))}
        )
      `;
      await transaction`
        INSERT INTO audit_events (id, user_id, event_name, resource_id, request_id)
        VALUES (
          ${ulid()}, ${input.userId}, 'goal.plan_activated', ${input.goal.id},
          ${input.requestId ?? null}
        )
      `;
      return { account, replayed: false };
    });
  }

  public async getAccountSummary(
    userId: string,
    goalId: string,
    asOfDate?: string,
  ): Promise<AccountSummaryDto | null> {
    const ownerClock =
      asOfDate === undefined
        ? await this.database<{ readonly application_date: string | Date }[]>`
            SELECT application_date FROM user_application_clocks WHERE user_id = ${userId}
          `
        : [];
    const applicationDate =
      asOfDate ??
      (ownerClock[0] === undefined
        ? (() => {
            throw new Error('The user application clock is unavailable.');
          })()
        : calendarDate(ownerClock[0].application_date));
    const rows = await this.database<
      (postgres.Row & {
        readonly id: string;
        readonly goal_id: string;
        readonly goal_version: number;
        readonly goal_status: GoalDto['status'];
        readonly archive_reason: GoalDto['archiveReason'];
        readonly plan_version_id: string;
        readonly status: AccountSummaryDto['status'];
        readonly vehicle_code: VehicleCode;
        readonly assumption_version: string;
        readonly apy_basis_points: number;
        readonly next_contribution_date: string | Date | null;
        readonly target_amount_cents: string;
        readonly target_date: string | Date;
        readonly principal_cents: string;
        readonly interest_cents: string;
        readonly balance_cents: string;
        readonly ledger_entry_count: string;
        readonly available_balance_cents: string;
        readonly projected_completion_date: string | null;
        readonly reviewed_date: string | Date;
        readonly assumption_is_stale: boolean;
      })[]
    >`
      SELECT a.id, a.goal_id, a.status, g.status AS goal_status, g.archive_reason,
             p.vehicle_code, p.assumption_version,
             va.apy_basis_points, vav.reviewed_date,
             (p.vehicle_code <> 'cash' AND ${applicationDate}::date >
               vav.reviewed_date + 365) AS assumption_is_stale,
             a.next_contribution_date, g.target_amount_cents, g.target_date,
             COALESCE(SUM(l.principal_cents) FILTER (
               WHERE l.entry_type IN ('account_opened', 'contribution_posted')
                  OR (l.entry_type = 'reversal'
                      AND reversed_source.entry_type IN (
                        'account_opened', 'contribution_posted'
                      ))
             ), 0) AS principal_cents,
             COALESCE(SUM(l.interest_cents) FILTER (
               WHERE l.entry_type = 'interest_posted'
                  OR (l.entry_type = 'reversal'
                      AND reversed_source.entry_type = 'interest_posted')
             ), 0) AS interest_cents,
             COALESCE(SUM(l.principal_cents + l.interest_cents), 0) AS balance_cents,
             simulated_account_available_balance(
               a.id, ${userId}, ${applicationDate}::date
             ) AS available_balance_cents,
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
        AND l.effective_date <= ${applicationDate}::date
      LEFT JOIN ledger_entries reversed_source
        ON reversed_source.id = l.reverses_entry_id
        AND reversed_source.account_id = l.account_id
        AND reversed_source.user_id = l.user_id
      WHERE a.goal_id = ${goalId} AND a.user_id = ${userId}
      GROUP BY a.id, p.vehicle_code, p.assumption_version, va.apy_basis_points,
               vav.reviewed_date, g.target_amount_cents, g.target_date, g.status,
               g.archive_reason, p.calculation_output
    `;
    const row = rows[0];
    if (row === undefined) return null;
    const principal = Number(row.principal_cents);
    const interest = Number(row.interest_cents);
    const balance = Number(row.balance_cents);
    const target = Number(row.target_amount_cents);
    return {
      id: row.id,
      goalId: row.goal_id,
      status:
        row.goal_status === 'archived' && row.archive_reason !== 'GOAL_COMPLETED'
          ? 'archived'
          : row.status,
      vehicleCode: row.vehicle_code,
      principalContributedCents: principal,
      interestEarnedCents: interest,
      currentLedgerBalanceCents: balance,
      principalCompositionBasisPoints: calculatePrincipalCompositionBasisPoints(
        principal,
        interest,
      ),
      availableBalanceCents: Number(row.available_balance_cents),
      pendingContributionCents: 0,
      nextContributionDate:
        row.next_contribution_date === null ? null : calendarDate(row.next_contribution_date),
      currentIllustrativeApyBasisPoints: row.apy_basis_points,
      progressPercent:
        row.goal_status === 'completed' ||
        (row.goal_status === 'archived' && row.archive_reason === 'GOAL_COMPLETED') ||
        target === 0
          ? 100
          : Math.min(100, Math.max(0, Math.round((balance / target) * 10_000) / 100)),
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
      JOIN user_application_clocks clock ON clock.user_id = l.user_id
      WHERE a.goal_id = ${goalId} AND l.user_id = ${userId} AND a.user_id = ${userId}
        AND l.effective_date <= clock.application_date
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
      const clocks = await transaction<
        {
          readonly application_date: string | Date;
          readonly financial_run_token: string | null;
          readonly financial_run_expires_at: Date | null;
          readonly financial_run_active: boolean;
        }[]
      >`
        SELECT application_date, financial_run_token, financial_run_expires_at,
               (
                 financial_run_token IS NOT NULL AND financial_run_expires_at > now()
               ) AS financial_run_active
        FROM user_application_clocks
        WHERE user_id = ${input.userId}
        FOR UPDATE
      `;
      const ownerClock = clocks[0];
      if (
        ownerClock === undefined ||
        calendarDate(ownerClock.application_date) !== input.effectiveDate
      ) {
        throw new StateConflictError(
          'The application date changed. Refresh before posting this contribution.',
        );
      }
      if (ownerClock.financial_run_active) {
        throw new StateConflictError(
          'A Story Mode financial run is in progress. Retry after it finishes.',
        );
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
        const balances = await transaction<
          { readonly balance_cents: string; readonly available_balance_cents: string }[]
        >`
          SELECT COALESCE(SUM(principal_cents + interest_cents), 0) AS balance_cents,
                 simulated_account_available_balance(
                   ${account.id}, ${input.userId}, ${input.effectiveDate}::date
                 ) AS available_balance_cents
          FROM ledger_entries WHERE account_id = ${account.id}
        `;
        const funded =
          Number(balances[0]?.balance_cents ?? 0) >= Number(account.target_amount_cents);
        const purchaseReady =
          Number(balances[0]?.available_balance_cents ?? 0) >= Number(account.target_amount_cents);
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

  public async listDueAccounts(
    processingDate: string,
    userId?: string,
  ): Promise<readonly DueAccount[]> {
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
        readonly schedule_anchor_date: string | Date;
        readonly omitted_contribution_dates: readonly (string | Date)[];
        readonly omit_contribution: boolean;
        readonly apy_basis_points: number;
        readonly vehicle_code: VehicleCode;
        readonly last_processed_date: string | Date;
      })[]
    >`
      SELECT a.id AS account_id, a.user_id, a.goal_id, a.next_contribution_date,
             g.recurring_contribution_cents, g.contribution_cadence, g.target_amount_cents,
             g.target_date, p.schedule_anchor_date AS schedule_anchor_date,
             p.omitted_contribution_dates,
             a.next_contribution_date = ANY(p.omitted_contribution_dates) AS omit_contribution,
             va.apy_basis_points, p.vehicle_code, a.last_processed_date
      FROM simulated_accounts a
      JOIN goals g ON g.id = a.goal_id AND g.user_id = a.user_id
      JOIN plan_versions p ON p.id = a.plan_version_id AND p.user_id = a.user_id
      JOIN vehicle_assumptions va ON va.version = p.assumption_version AND va.vehicle_code = p.vehicle_code
      WHERE a.status = 'active' AND a.next_contribution_date <= ${processingDate}
        AND a.next_contribution_date <= g.target_date
        AND (${userId ?? null}::text IS NULL OR a.user_id = ${userId ?? null})
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
      scheduleAnchorDate: calendarDate(row.schedule_anchor_date),
      omittedContributionDates: row.omitted_contribution_dates.map(calendarDate),
      omitContribution: row.omit_contribution,
      apyBasisPoints: row.apy_basis_points,
      vehicleCode: row.vehicle_code,
      lastProcessedDate: calendarDate(row.last_processed_date),
    }));
  }

  public async processScheduledContribution(input: {
    readonly account: DueAccount;
    readonly processingDate: string;
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
          ${input.account.recurringContributionCents > 0 && !input.account.omitContribution ? 'posted' : 'skipped'}
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
      if (input.account.recurringContributionCents === 0 || input.account.omitContribution) {
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
          ${input.account.recurringContributionCents}, ${input.processingDate},
          ${occurrenceId}, 'Scheduled simulated contribution posted'
        )
      `;
      const balances = await transaction<
        { readonly balance_cents: string; readonly available_balance_cents: string }[]
      >`
        SELECT COALESCE(SUM(principal_cents + interest_cents), 0) AS balance_cents,
               simulated_account_available_balance(
                 ${input.account.accountId}, ${input.account.userId},
                 ${input.processingDate}::date
               ) AS available_balance_cents
        FROM ledger_entries WHERE account_id = ${input.account.accountId}
      `;
      const funded = Number(balances[0]?.balance_cents ?? 0) >= input.account.targetAmountCents;
      const purchaseReady =
        Number(balances[0]?.available_balance_cents ?? 0) >= input.account.targetAmountCents;
      await transaction`
        UPDATE simulated_accounts SET
          status = ${purchaseReady ? 'purchase_ready' : 'active'},
          next_contribution_date = ${funded ? null : input.nextContributionDate},
          last_processed_date = ${input.processingDate},
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

  public async listActiveAccounts(
    userId?: string,
    processingDate?: string,
  ): Promise<readonly ActiveAccount[]> {
    const rows = await this.database<
      (postgres.Row & {
        readonly account_id: string;
        readonly user_id: string;
        readonly goal_id: string;
        readonly goal_version: number;
        readonly plan_version_id: string;
        readonly apy_basis_points: number;
        readonly vehicle_code: VehicleCode;
        readonly lock_days: number;
        readonly target_amount_cents: string;
        readonly target_date: string | Date;
        readonly balance_cents: string;
        readonly ledger_entry_count: string;
        readonly accrued_interest_micros: string;
        readonly last_accrual_date: string | Date;
      })[]
    >`
      SELECT a.id AS account_id, a.user_id, a.goal_id, g.version AS goal_version,
             p.id AS plan_version_id, va.apy_basis_points,
             p.vehicle_code, va.lock_days, g.target_amount_cents, g.target_date,
             a.accrued_interest_micros, a.last_accrual_date,
             COALESCE(SUM(l.principal_cents + l.interest_cents), 0) AS balance_cents,
             COUNT(l.id) AS ledger_entry_count
      FROM simulated_accounts a
      JOIN goals g ON g.id = a.goal_id AND g.user_id = a.user_id
      JOIN plan_versions p ON p.id = a.plan_version_id AND p.user_id = a.user_id
      JOIN vehicle_assumptions va ON va.version = p.assumption_version AND va.vehicle_code = p.vehicle_code
      LEFT JOIN ledger_entries l ON l.account_id = a.id AND l.user_id = a.user_id
        AND (${processingDate ?? null}::date IS NULL OR l.effective_date <= ${processingDate ?? null}::date)
      WHERE a.status IN ('active', 'paused', 'purchase_ready')
        AND (${userId ?? null}::text IS NULL OR a.user_id = ${userId ?? null})
      GROUP BY a.id, va.apy_basis_points, p.vehicle_code, va.lock_days,
               g.id, p.id, g.target_amount_cents, g.target_date
    `;
    return rows.map((row) => ({
      accountId: row.account_id,
      userId: row.user_id,
      goalId: row.goal_id,
      goalVersion: row.goal_version,
      planVersionId: row.plan_version_id,
      apyBasisPoints: row.apy_basis_points,
      vehicleCode: row.vehicle_code,
      lockDays: row.lock_days,
      targetAmountCents: Number(row.target_amount_cents),
      targetDate: calendarDate(row.target_date),
      balanceCents: Number(row.balance_cents),
      ledgerEntryCount: Number(row.ledger_entry_count),
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
        readonly current_balance_cents: string;
        readonly cycle: number;
        readonly maturity_date: string | Date;
      })[]
    >`
      SELECT l.id AS source_entry_id, l.principal_cents,
             l.principal_cents + COALESCE((
               SELECT SUM(lot_entry.interest_cents)
               FROM ledger_entries lot_entry
               LEFT JOIN ledger_entries reversed_interest
                 ON reversed_interest.id = lot_entry.reverses_entry_id
                AND reversed_interest.account_id = lot_entry.account_id
                AND reversed_interest.user_id = lot_entry.user_id
               WHERE lot_entry.account_id = l.account_id
                 AND lot_entry.user_id = l.user_id
                 AND lot_entry.effective_date <= ${processingDate}::date
                 AND (
                   (
                     lot_entry.entry_type = 'interest_posted'
                     AND lot_entry.occurrence_id LIKE 'maturity:' || l.id || ':%'
                   ) OR (
                     lot_entry.entry_type = 'reversal'
                     AND reversed_interest.entry_type = 'interest_posted'
                     AND reversed_interest.occurrence_id LIKE 'maturity:' || l.id || ':%'
                   )
                 )
             ), 0) AS current_balance_cents,
             cycles.cycle,
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
        AND NOT EXISTS (
          SELECT 1 FROM ledger_entries source_reversal
          WHERE source_reversal.reverses_entry_id = l.id
            AND source_reversal.account_id = l.account_id
            AND source_reversal.user_id = l.user_id
            AND source_reversal.effective_date <= ${processingDate}::date
        )
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
      currentBalanceCents: Number(row.current_balance_cents),
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
      const sourceRows = await transaction<
        { readonly id: string; readonly current_balance_cents: string }[]
      >`
        SELECT source.id,
               source.principal_cents + COALESCE((
                 SELECT SUM(lot_entry.interest_cents)
                 FROM ledger_entries lot_entry
                 LEFT JOIN ledger_entries reversed_interest
                   ON reversed_interest.id = lot_entry.reverses_entry_id
                  AND reversed_interest.account_id = lot_entry.account_id
                  AND reversed_interest.user_id = lot_entry.user_id
                 WHERE lot_entry.account_id = source.account_id
                   AND lot_entry.user_id = source.user_id
                   AND lot_entry.effective_date <= ${input.lot.maturityDate}::date
                   AND (
                     (
                       lot_entry.entry_type = 'interest_posted'
                       AND lot_entry.occurrence_id LIKE 'maturity:' || source.id || ':%'
                     ) OR (
                       lot_entry.entry_type = 'reversal'
                       AND reversed_interest.entry_type = 'interest_posted'
                       AND reversed_interest.occurrence_id LIKE 'maturity:' || source.id || ':%'
                     )
                   )
               ), 0) AS current_balance_cents
        FROM ledger_entries source
        WHERE source.id = ${input.lot.sourceEntryId}
          AND source.account_id = ${input.account.accountId}
          AND source.user_id = ${input.account.userId}
          AND source.entry_type IN ('account_opened', 'contribution_posted')
          AND source.principal_cents = ${input.lot.principalCents}
          AND NOT EXISTS (
            SELECT 1 FROM ledger_entries source_reversal
            WHERE source_reversal.reverses_entry_id = source.id
              AND source_reversal.account_id = source.account_id
              AND source_reversal.user_id = source.user_id
              AND source_reversal.effective_date <= ${input.lot.maturityDate}::date
          )
      `;
      if (
        sourceRows[0] === undefined ||
        Number(sourceRows[0].current_balance_cents) !== input.lot.currentBalanceCents
      ) {
        return { posted: false, purchaseReady: false };
      }
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
      if (Number(balances[0]?.balance_cents ?? 0) >= input.account.targetAmountCents) {
        await transaction`
          UPDATE simulated_accounts SET next_contribution_date = NULL, updated_at = now()
          WHERE id = ${input.account.accountId} AND user_id = ${input.account.userId}
        `;
      }
      return {
        posted: input.interestCents > 0,
        purchaseReady: false,
      };
    });
  }

  public async markPurchaseReadyIfFunded(
    account: ActiveAccount,
    processingDate: string,
  ): Promise<boolean> {
    return this.database.begin(async (transaction) => {
      const locked = await transaction<
        {
          readonly status: string;
          readonly goal_id: string;
          readonly target_amount_cents: string;
        }[]
      >`
        SELECT simulated.status, goal.id AS goal_id, goal.target_amount_cents
        FROM simulated_accounts simulated
        JOIN goals goal ON goal.id = simulated.goal_id AND goal.user_id = simulated.user_id
        WHERE simulated.id = ${account.accountId} AND simulated.user_id = ${account.userId}
        FOR UPDATE OF simulated, goal
      `;
      const current = locked[0];
      if (current?.status !== 'active') return false;
      const balances = await transaction<{ available_balance_cents: string }[]>`
        SELECT simulated_account_available_balance(
          ${account.accountId}, ${account.userId}, ${processingDate}::date
        ) AS available_balance_cents
      `;
      if (Number(balances[0]?.available_balance_cents ?? 0) < Number(current.target_amount_cents))
        return false;
      await transaction`
        UPDATE simulated_accounts SET status = 'purchase_ready', next_contribution_date = NULL,
          updated_at = now()
        WHERE id = ${account.accountId} AND user_id = ${account.userId} AND status = 'active'
      `;
      await transaction`
        UPDATE goals SET status = 'purchase_ready', version = version + 1, updated_at = now()
        WHERE id = ${current.goal_id} AND user_id = ${account.userId} AND status = 'active'
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
    readonly expectedLastAccrualDate: string;
    readonly expectedAccruedInterestMicros: number;
    readonly expectedBalanceCents: number;
    readonly expectedLedgerEntryCount: number;
  }): Promise<{
    readonly status: 'accrued' | 'already_processed' | 'revision_conflict' | 'inactive';
    readonly purchaseReady: boolean;
  }> {
    return this.database.begin(async (transaction) => {
      const locked = await transaction<
        {
          last_accrual_date: string | Date;
          accrued_interest_micros: string;
          status: string;
          goal_id: string;
          goal_version: number;
          target_amount_cents: string;
          target_date: string | Date;
          plan_version_id: string;
        }[]
      >`
        SELECT simulated.last_accrual_date, simulated.accrued_interest_micros,
               simulated.status, simulated.plan_version_id,
               goal.id AS goal_id, goal.version AS goal_version,
               goal.target_amount_cents, goal.target_date
        FROM simulated_accounts simulated
        JOIN goals goal ON goal.id = simulated.goal_id AND goal.user_id = simulated.user_id
        WHERE simulated.id = ${input.account.accountId}
          AND simulated.user_id = ${input.account.userId}
        FOR UPDATE OF simulated, goal
      `;
      const lockedAccount = locked[0];
      if (
        lockedAccount === undefined ||
        !['active', 'paused', 'purchase_ready'].includes(lockedAccount.status)
      ) {
        return { status: 'inactive', purchaseReady: false };
      }
      if (calendarDate(lockedAccount.last_accrual_date) >= input.accrualDate) {
        return { status: 'already_processed', purchaseReady: false };
      }
      const financialRevision = await transaction<
        { readonly balance_cents: string; readonly ledger_entry_count: string }[]
      >`
        SELECT COALESCE(SUM(principal_cents + interest_cents), 0) AS balance_cents,
               COUNT(*) AS ledger_entry_count
        FROM ledger_entries
        WHERE account_id = ${input.account.accountId} AND user_id = ${input.account.userId}
          AND effective_date <= ${input.accrualDate}::date
      `;
      const revision = financialRevision[0];
      if (
        calendarDate(lockedAccount.last_accrual_date) !== input.expectedLastAccrualDate ||
        Number(lockedAccount.accrued_interest_micros) !== input.expectedAccruedInterestMicros ||
        Number(revision?.balance_cents ?? 0) !== input.expectedBalanceCents ||
        Number(revision?.ledger_entry_count ?? 0) !== input.expectedLedgerEntryCount ||
        lockedAccount.goal_version !== input.account.goalVersion ||
        lockedAccount.plan_version_id !== input.account.planVersionId ||
        Number(lockedAccount.target_amount_cents) !== input.account.targetAmountCents ||
        calendarDate(lockedAccount.target_date) !== input.account.targetDate
      ) {
        return { status: 'revision_conflict', purchaseReady: false };
      }
      const totalMicros = Number(lockedAccount.accrued_interest_micros) + input.accrualMicros;
      const accrualEntries = await transaction<{ readonly id: string }[]>`
        INSERT INTO ledger_entries (
          id, account_id, user_id, entry_type, effective_date, occurrence_id, description
        ) VALUES (
          ${ulid()}, ${input.account.accountId}, ${input.account.userId}, 'interest_accrued',
          ${input.accrualDate}, ${`accrual:${input.account.accountId}:${input.accrualDate}`},
          'Modeled daily interest accrued'
        ) ON CONFLICT (account_id, occurrence_id) WHERE occurrence_id IS NOT NULL DO NOTHING
        RETURNING id
      `;
      if (accrualEntries[0] === undefined) {
        return { status: 'already_processed', purchaseReady: false };
      }
      if (input.postInterestCents > 0) {
        const occurrenceId = `interest:${input.account.accountId}:${input.accrualDate}`;
        const postingEntries = await transaction<{ readonly id: string }[]>`
          INSERT INTO ledger_entries (
            id, account_id, user_id, entry_type, interest_cents, effective_date,
            occurrence_id, description
          ) VALUES (
            ${ulid()}, ${input.account.accountId}, ${input.account.userId}, 'interest_posted',
            ${input.postInterestCents}, ${input.accrualDate}, ${occurrenceId},
            'Modeled interest posted'
          ) ON CONFLICT (account_id, occurrence_id) WHERE occurrence_id IS NOT NULL DO NOTHING
          RETURNING id
        `;
        if (postingEntries[0] === undefined) {
          throw new StateConflictError('The interest posting was already recorded.');
        }
      }
      await transaction`
        UPDATE simulated_accounts SET last_accrual_date = ${input.accrualDate},
          accrued_interest_micros = ${input.postingBoundary ? 0 : totalMicros},
          updated_at = now()
        WHERE id = ${input.account.accountId} AND user_id = ${input.account.userId}
      `;
      const balances = await transaction<{ available_balance_cents: string }[]>`
        SELECT simulated_account_available_balance(
          ${input.account.accountId}, ${input.account.userId}, ${input.accrualDate}::date
        ) AS available_balance_cents
      `;
      const purchaseReady =
        Number(balances[0]?.available_balance_cents ?? 0) >=
        Number(lockedAccount.target_amount_cents);
      const transitioned = purchaseReady && lockedAccount.status === 'active';
      if (transitioned) {
        await transaction`
          UPDATE simulated_accounts SET status = 'purchase_ready', next_contribution_date = NULL
          WHERE id = ${input.account.accountId} AND user_id = ${input.account.userId}
        `;
        await transaction`
          UPDATE goals SET status = 'purchase_ready', version = version + 1, updated_at = now()
          WHERE id = ${lockedAccount.goal_id} AND user_id = ${input.account.userId}
            AND status = 'active'
        `;
      }
      return { status: 'accrued', purchaseReady: transitioned };
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

  public async exportUserData(userId: string): Promise<UserDataExport | null> {
    return this.database.begin(async (transaction) => {
      const userRows = await transaction<ExportUserRow[]>`
        SELECT id, email, display_name, created_at, updated_at
        FROM users WHERE id = ${userId} AND deleted_at IS NULL
      `;
      const userRow = userRows[0];
      if (userRow === undefined) return null;

      const goalRows = await transaction<GoalRow[]>`
        SELECT * FROM goals WHERE user_id = ${userId} ORDER BY created_at, id
      `;
      const draftRows = await transaction<ExportRecordRow[]>`
        SELECT jsonb_build_object(
          'id', id,
          'schemaVersion', schema_version,
          'draftData', draft_data,
          'lastCompletedStep', last_completed_step,
          'version', version,
          'createdAt', created_at,
          'updatedAt', updated_at
        ) AS record
        FROM goal_drafts WHERE user_id = ${userId} ORDER BY updated_at, id
      `;
      const clockRows = await transaction<ExportRecordRow[]>`
        SELECT jsonb_build_object(
          'initialApplicationDate', initial_application_date,
          'applicationDate', application_date,
          'version', version,
          'createdAt', created_at,
          'updatedAt', updated_at
        ) AS record
        FROM user_application_clocks WHERE user_id = ${userId}
      `;
      const capabilityRows = await transaction<ExportRecordRow[]>`
        SELECT jsonb_build_object(
          'fixtureKey', fixture_key,
          'fixtureVersion', fixture_version,
          'resetGeneration', reset_generation,
          'createdAt', created_at,
          'updatedAt', updated_at
        ) AS record
        FROM demo_fixture_users WHERE user_id = ${userId}
      `;
      const planRows = await transaction<ExportRecordRow[]>`
        SELECT jsonb_build_object(
          'id', id,
          'goalId', goal_id,
          'version', version,
          'vehicleCode', vehicle_code,
          'assumptionVersion', assumption_version,
          'normalizedInput', normalized_input,
          'calculationOutput', calculation_output,
          'calculationContext', calculation_context,
          'applicationDate', application_date,
          'scheduleAnchorDate', schedule_anchor_date,
          'calculationPolicyVersion', calculation_policy_version,
          'rankingPolicyVersion', ranking_policy_version,
          'healthPolicyVersion', health_policy_version,
          'changeKind', change_kind,
          'changedField', changed_field,
          'changeReasonCode', change_reason_code,
          'changePayload', change_payload,
          'omittedContributionDates', omitted_contribution_dates,
          'basePlanVersionId', base_plan_version_id,
          'createdAt', created_at
        ) AS record
        FROM plan_versions WHERE user_id = ${userId} ORDER BY goal_id, version, id
      `;
      const accountRows = await transaction<ExportRecordRow[]>`
        SELECT jsonb_build_object(
          'id', a.id,
          'goalId', a.goal_id,
          'planVersionId', a.plan_version_id,
          'status', CASE
            WHEN g.status = 'archived' AND g.archive_reason <> 'GOAL_COMPLETED'
              THEN 'archived'
            ELSE a.status
          END,
          'nextContributionDate', a.next_contribution_date,
          'lastProcessedDate', a.last_processed_date,
          'lastAccrualDate', a.last_accrual_date,
          'accruedInterestMicros', a.accrued_interest_micros,
          'createdAt', a.created_at,
          'updatedAt', a.updated_at
        ) AS record
        FROM simulated_accounts a
        JOIN goals g ON g.id = a.goal_id AND g.user_id = a.user_id
        WHERE a.user_id = ${userId} ORDER BY a.created_at, a.id
      `;
      const ledgerRows = await transaction<ExportRecordRow[]>`
        SELECT jsonb_build_object(
          'id', id,
          'accountId', account_id,
          'entryType', entry_type,
          'principalCents', principal_cents,
          'interestCents', interest_cents,
          'effectiveDate', effective_date,
          'occurrenceId', occurrence_id,
          'description', description,
          'reversesEntryId', reverses_entry_id,
          'createdAt', created_at
        ) AS record
        FROM ledger_entries
        WHERE user_id = ${userId} ORDER BY effective_date, created_at, id
      `;
      const scheduleRows = await transaction<ExportRecordRow[]>`
        SELECT jsonb_build_object(
          'id', id,
          'accountId', account_id,
          'dueDate', due_date,
          'status', status,
          'createdAt', created_at
        ) AS record
        FROM schedule_occurrences WHERE user_id = ${userId} ORDER BY due_date, id
      `;
      const interestPeriodRows = await transaction<ExportRecordRow[]>`
        SELECT jsonb_build_object(
          'accountId', account_id,
          'periodEnd', period_end,
          'ledgerEntryId', ledger_entry_id
        ) AS record
        FROM interest_posting_periods WHERE user_id = ${userId} ORDER BY period_end, account_id
      `;
      const purchaseItemRows = await transaction<ExportRecordRow[]>`
        SELECT jsonb_build_object(
          'id', id,
          'goalId', goal_id,
          'fixtureCode', fixture_code,
          'displayName', display_name,
          'currency', currency,
          'targetPriceCents', target_price_cents,
          'version', version,
          'lifecycle', lifecycle,
          'createdAt', created_at,
          'updatedAt', updated_at
        ) AS record
        FROM purchase_items WHERE user_id = ${userId} ORDER BY created_at, id
      `;
      const watchPolicyRows = await transaction<ExportRecordRow[]>`
        SELECT jsonb_build_object(
          'id', id,
          'purchaseItemId', purchase_item_id,
          'version', version,
          'cadence', cadence,
          'nextDueDate', next_due_date,
          'freshnessLimitDays', freshness_limit_days,
          'analysisPolicyVersion', analysis_policy_version,
          'enabled', enabled,
          'createdAt', created_at
        ) AS record
        FROM price_watch_policies
        WHERE user_id = ${userId} ORDER BY purchase_item_id, version, id
      `;
      const checkRunRows = await transaction<ExportRecordRow[]>`
        SELECT jsonb_build_object(
          'id', id,
          'priceWatchPolicyId', price_watch_policy_id,
          'purchaseItemId', purchase_item_id,
          'applicationDate', application_date,
          'fixtureSourceVersion', fixture_source_version,
          'fixtureSourceChecksum', fixture_source_checksum,
          'status', status,
          'errorCode', error_code,
          'attemptCount', attempt_count,
          'claimedAt', claimed_at,
          'completedAt', completed_at
        ) AS record
        FROM price_check_runs WHERE user_id = ${userId} ORDER BY application_date, id
      `;
      const observationRows = await transaction<ExportRecordRow[]>`
        SELECT jsonb_build_object(
          'id', id,
          'priceCheckRunId', price_check_run_id,
          'purchaseItemId', purchase_item_id,
          'fixtureSourceVersion', fixture_source_version,
          'observationKey', observation_key,
          'observedOn', observed_on,
          'priceCents', price_cents,
          'currency', currency,
          'createdAt', created_at
        ) AS record
        FROM price_observations
        WHERE user_id = ${userId} ORDER BY observed_on, observation_key, id
      `;
      const assessmentRows = await transaction<ExportRecordRow[]>`
        SELECT jsonb_build_object(
          'id', id,
          'priceCheckRunId', price_check_run_id,
          'purchaseItemId', purchase_item_id,
          'goalId', goal_id,
          'priceWatchPolicyVersion', price_watch_policy_version,
          'planVersionId', plan_version_id,
          'planVersionNumber', plan_version_number,
          'planLifecycle', plan_lifecycle,
          'planHealth', plan_health,
          'planHealthPolicyVersion', plan_health_policy_version,
          'analysisPolicyVersion', analysis_policy_version,
          'fixtureSourceVersion', fixture_source_version,
          'fixtureSourceChecksum', fixture_source_checksum,
          'asOfDate', as_of_date,
          'currency', currency,
          'assessmentState', assessment_state,
          'rationaleCodes', rationale_codes,
          'seasonalSummary', seasonal_summary,
          'observationCount', observation_count,
          'earliestObservationDate', earliest_observation_date,
          'latestObservationDate', latest_observation_date,
          'dataSpanDays', data_span_days,
          'freshnessDays', freshness_days,
          'currentPriceCents', current_price_cents,
          'targetPriceCents', target_price_cents,
          'minimumPriceCents', minimum_price_cents,
          'medianPriceCents', median_price_cents,
          'maximumPriceCents', maximum_price_cents,
          'currentPercentileBasisPoints', current_percentile_basis_points,
          'differenceFromMedianCents', difference_from_median_cents,
          'differenceFromTargetCents', difference_from_target_cents,
          'createdAt', created_at
        ) AS record
        FROM purchase_timing_assessments
        WHERE user_id = ${userId} ORDER BY as_of_date, id
      `;

      return {
        schemaVersion: userDataExportSchemaVersion,
        exportedAt: new Date().toISOString(),
        user: {
          id: userRow.id,
          email: userRow.email,
          displayName: userRow.display_name,
          createdAt: userRow.created_at.toISOString(),
          updatedAt: userRow.updated_at.toISOString(),
        },
        goalDrafts: draftRows.map((row) => row.record),
        userApplicationClock: clockRows[0]?.record ?? null,
        demoFixtureCapability: capabilityRows[0]?.record ?? null,
        goals: goalRows.map(mapGoal),
        planVersions: planRows.map((row) => row.record),
        simulatedAccounts: accountRows.map((row) => row.record),
        ledgerEntries: ledgerRows.map((row) => row.record),
        scheduleOccurrences: scheduleRows.map((row) => row.record),
        interestPostingPeriods: interestPeriodRows.map((row) => row.record),
        purchaseTiming: {
          items: purchaseItemRows.map((row) => row.record),
          watchPolicies: watchPolicyRows.map((row) => row.record),
          checkRuns: checkRunRows.map((row) => row.record),
          observations: observationRows.map((row) => row.record),
          assessments: assessmentRows.map((row) => row.record),
        },
      };
    });
  }

  public async createCompletedExport(userId: string): Promise<{
    readonly requestId: string;
    readonly data: UserDataExport;
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
