import type {
  FixedTermProjectionLot,
  GoalDto,
  GoalInput,
  InitialPlanActivationOutput,
  PlanCalculationContext,
  PlanDecisionSummary,
  PreviewOutput,
  ScenarioApplyOutput,
  ScenarioComparison,
  VehicleCode,
} from '@goalpilot/contracts';
import type postgres from 'postgres';
import { ulid } from 'ulid';

import type { DatabaseClient } from './database.js';
import {
  IdempotencyConflictError,
  lockOwnerFinancialMutation,
  StateConflictError,
} from './repository.js';

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

type PlanSnapshotRow = GoalRow & {
  readonly plan_version_id: string;
  readonly plan_version: number;
  readonly vehicle_code: VehicleCode;
  readonly assumption_version: string;
  readonly application_date: string | Date;
  readonly schedule_anchor_date: string | Date;
  readonly omitted_contribution_dates: readonly (string | Date)[];
  readonly calculation_policy_version: string;
  readonly ranking_policy_version: string;
  readonly health_policy_version: string;
  readonly change_kind: 'initial_activation' | 'scenario_applied' | 'recovery_applied';
  readonly changed_field:
    | 'recurring_contribution'
    | 'target_date'
    | 'target_amount'
    | 'missed_contribution'
    | null;
  readonly change_reason_code: string;
  readonly change_payload: postgres.JSONValue | null;
  readonly base_plan_version_id: string | null;
  readonly normalized_input: GoalInput;
  readonly calculation_output: PreviewOutput & {
    readonly decisionSummary?: PlanDecisionSummary;
  };
  readonly calculation_context: PlanCalculationContext;
  readonly plan_created_at: Date;
  readonly account_id: string;
  readonly account_status: 'active' | 'paused' | 'purchase_ready' | 'completed';
  readonly next_contribution_date: string | Date | null;
  readonly last_processed_date: string | Date;
  readonly last_accrual_date: string | Date;
  readonly opening_savings_cents: string;
  readonly posted_contributions_cents: string;
  readonly posted_interest_cents: string;
  readonly ledger_balance_cents: string;
  readonly ledger_entry_count: string;
  readonly accrued_interest_micros: string;
};

export interface PlanExperienceSnapshot {
  readonly goal: GoalDto;
  readonly planVersionId: string;
  readonly planVersion: number;
  readonly vehicleCode: VehicleCode;
  readonly assumptionVersion: string;
  readonly applicationDate: string;
  readonly scheduleAnchorDate: string;
  readonly omittedContributionDates: readonly string[];
  readonly calculationPolicyVersion: string;
  readonly rankingPolicyVersion: string;
  readonly healthPolicyVersion: string;
  readonly changeKind: 'initial_activation' | 'scenario_applied' | 'recovery_applied';
  readonly changedField:
    | 'recurring_contribution'
    | 'target_date'
    | 'target_amount'
    | 'missed_contribution'
    | null;
  readonly changeReasonCode: string;
  readonly changePayload: unknown;
  readonly basePlanVersionId: string | null;
  readonly normalizedInput: GoalInput;
  readonly calculationContext: PlanCalculationContext;
  readonly projection: PreviewOutput;
  readonly storedDecisionSummary: PlanDecisionSummary | null;
  readonly activatedAt: string;
  readonly account: {
    readonly id: string;
    readonly status: 'active' | 'paused' | 'purchase_ready' | 'completed';
    readonly nextContributionDate: string | null;
    readonly lastProcessedDate: string;
    readonly lastAccrualDate: string;
    readonly openingSavingsCents: number;
    readonly postedContributionsCents: number;
    readonly postedInterestCents: number;
    readonly ledgerBalanceCents: number;
    readonly ledgerEntryCount: number;
    readonly accruedInterestMicros: number;
  };
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
    archivedAt:
      row.status === 'archived' ? (row.archived_at ?? row.updated_at).toISOString() : null,
    archiveReason: row.status === 'archived' ? (row.archive_reason ?? 'GOAL_COMPLETED') : null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function mapSnapshot(row: PlanSnapshotRow): PlanExperienceSnapshot {
  const { decisionSummary: storedDecisionSummary, ...projection } = row.calculation_output;
  return {
    goal: mapGoal(row),
    planVersionId: row.plan_version_id,
    planVersion: row.plan_version,
    vehicleCode: row.vehicle_code,
    assumptionVersion: row.assumption_version,
    applicationDate: calendarDate(row.application_date),
    scheduleAnchorDate: calendarDate(row.schedule_anchor_date),
    omittedContributionDates: row.omitted_contribution_dates.map(calendarDate),
    calculationPolicyVersion: row.calculation_policy_version,
    rankingPolicyVersion: row.ranking_policy_version,
    healthPolicyVersion: row.health_policy_version,
    changeKind: row.change_kind,
    changedField: row.changed_field,
    changeReasonCode: row.change_reason_code,
    changePayload: row.change_payload,
    basePlanVersionId: row.base_plan_version_id,
    normalizedInput: row.normalized_input,
    calculationContext: row.calculation_context,
    projection,
    storedDecisionSummary: storedDecisionSummary ?? null,
    activatedAt: row.plan_created_at.toISOString(),
    account: {
      id: row.account_id,
      status: row.account_status,
      nextContributionDate:
        row.next_contribution_date === null ? null : calendarDate(row.next_contribution_date),
      lastProcessedDate: calendarDate(row.last_processed_date),
      lastAccrualDate: calendarDate(row.last_accrual_date),
      openingSavingsCents: Number(row.opening_savings_cents),
      postedContributionsCents: Number(row.posted_contributions_cents),
      postedInterestCents: Number(row.posted_interest_cents),
      ledgerBalanceCents: Number(row.ledger_balance_cents),
      ledgerEntryCount: Number(row.ledger_entry_count),
      accruedInterestMicros: Number(row.accrued_interest_micros),
    },
  };
}

function selectedVehicle(projection: PreviewOutput, vehicleCode: VehicleCode) {
  const selected = projection.vehicles.find((vehicle) => vehicle.vehicleCode === vehicleCode);
  if (!selected?.eligible) {
    throw new StateConflictError('Choose an eligible illustrative vehicle.');
  }
  return selected;
}

function planCalculationOutput(
  projection: PreviewOutput,
  summary: PlanDecisionSummary,
): postgres.JSONValue {
  return jsonValue({ ...projection, decisionSummary: summary });
}

export class PlanExperienceRepository {
  public constructor(private readonly database: DatabaseClient) {}

  public async getCurrentPlan(
    userId: string,
    goalId: string,
    asOfDate?: string,
  ): Promise<PlanExperienceSnapshot | null> {
    const rows = await this.snapshotQuery(userId, goalId, true, asOfDate);
    return rows[0] === undefined ? null : mapSnapshot(rows[0]);
  }

  public async getPlanHistory(
    userId: string,
    goalId: string,
  ): Promise<readonly PlanExperienceSnapshot[]> {
    return (await this.snapshotQuery(userId, goalId, false)).map(mapSnapshot);
  }

  public async getFixedTermProjectionLots(
    userId: string,
    goalId: string,
    applicationDate: string,
  ): Promise<readonly FixedTermProjectionLot[]> {
    const rows = await this.database<
      {
        readonly personal_principal_cents: string;
        readonly current_balance_cents: string;
        readonly first_maturity_date: string | Date;
        readonly next_maturity_date: string | Date;
        readonly target_date: string | Date;
      }[]
    >`
      SELECT source.principal_cents AS personal_principal_cents,
             source.principal_cents + COALESCE(SUM(
               maturity.interest_cents + COALESCE(maturity_reversal.interest_cents, 0)
             ), 0)
               AS current_balance_cents,
             source.effective_date + va.lock_days AS first_maturity_date,
             source.effective_date +
               ((COUNT(maturity.id)::integer + 1) * va.lock_days) AS next_maturity_date,
             goal.target_date
      FROM simulated_accounts account
      JOIN goals goal ON goal.id = account.goal_id AND goal.user_id = account.user_id
      JOIN plan_versions plan ON plan.id = account.plan_version_id
        AND plan.goal_id = goal.id AND plan.user_id = goal.user_id
      JOIN vehicle_assumptions va ON va.version = plan.assumption_version
        AND va.vehicle_code = plan.vehicle_code
      JOIN ledger_entries source ON source.account_id = account.id
        AND source.user_id = account.user_id
        AND source.entry_type IN ('account_opened', 'contribution_posted')
        AND source.principal_cents > 0
        AND source.effective_date <= ${applicationDate}::date
      LEFT JOIN ledger_entries maturity ON maturity.account_id = account.id
        AND maturity.user_id = account.user_id
        AND maturity.entry_type IN ('interest_posted', 'interest_accrued')
        AND maturity.occurrence_id LIKE ${'maturity:'} || source.id || ':%'
        AND maturity.effective_date <= ${applicationDate}::date
      LEFT JOIN ledger_entries maturity_reversal
        ON maturity_reversal.reverses_entry_id = maturity.id
        AND maturity_reversal.account_id = maturity.account_id
        AND maturity_reversal.user_id = maturity.user_id
        AND maturity_reversal.effective_date <= ${applicationDate}::date
      WHERE account.goal_id = ${goalId} AND account.user_id = ${userId}
        AND plan.vehicle_code IN ('cd_ladder', 'treasury_ladder')
        AND NOT EXISTS (
          SELECT 1 FROM ledger_entries source_reversal
          WHERE source_reversal.reverses_entry_id = source.id
            AND source_reversal.account_id = source.account_id
            AND source_reversal.user_id = source.user_id
            AND source_reversal.effective_date <= ${applicationDate}::date
        )
      GROUP BY source.id, va.lock_days, goal.target_date
      ORDER BY source.effective_date, source.id
    `;
    return rows.flatMap((row) => {
      const firstMaturityDate = calendarDate(row.first_maturity_date);
      const nextMaturityDate = calendarDate(row.next_maturity_date);
      const targetDate = calendarDate(row.target_date);
      const availabilityDate = firstMaturityDate <= targetDate ? targetDate : firstMaturityDate;
      if (availabilityDate <= applicationDate) return [];
      return [
        {
          personalPrincipalCents: Number(row.personal_principal_cents),
          currentBalanceCents: Number(row.current_balance_cents),
          firstMaturityDate,
          nextMaturityDate,
          nextMaturityInterestEligible: nextMaturityDate <= targetDate,
        },
      ];
    });
  }

  public async activateDraft(input: {
    readonly userId: string;
    readonly draftId: string;
    readonly expectedDraftVersion: number;
    readonly goal: GoalInput;
    readonly vehicleCode: VehicleCode;
    readonly projection: PreviewOutput;
    readonly summary: PlanDecisionSummary;
    readonly calculationContext: PlanCalculationContext;
    readonly applicationDate: string;
    readonly nextContributionDate: string | null;
    readonly idempotencyKey: string;
    readonly requestHash: string;
    readonly requestId?: string;
  }): Promise<{ readonly output: InitialPlanActivationOutput; readonly replayed: boolean }> {
    return this.database.begin(async (transaction) => {
      const operation = 'goal-draft.activate';
      await transaction`SELECT pg_advisory_xact_lock(hashtextextended(${`${input.userId}:${operation}:${input.idempotencyKey}`}, 0))`;
      const prior = await transaction<
        { readonly request_hash: string; readonly response_body: InitialPlanActivationOutput }[]
      >`
        SELECT request_hash, response_body FROM idempotency_records
        WHERE user_id = ${input.userId} AND operation = ${operation}
          AND key = ${input.idempotencyKey}
      `;
      const previous = prior[0];
      if (previous !== undefined) {
        if (previous.request_hash !== input.requestHash) throw new IdempotencyConflictError();
        return { output: previous.response_body, replayed: true };
      }

      await lockOwnerFinancialMutation(transaction, input.userId, input.applicationDate);

      selectedVehicle(input.projection, input.vehicleCode);
      const drafts = await transaction<{ readonly id: string }[]>`
        SELECT id FROM goal_drafts
        WHERE id = ${input.draftId} AND user_id = ${input.userId}
          AND version = ${input.expectedDraftVersion}
        FOR UPDATE
      `;
      if (drafts[0] === undefined) {
        throw new StateConflictError('The draft changed or is no longer available.');
      }

      const fixedTerm =
        input.vehicleCode === 'cd_ladder' || input.vehicleCode === 'treasury_ladder';
      const funded = input.goal.currentSavedCents >= input.goal.targetAmountCents;
      const initialStatus = funded && !fixedTerm ? 'purchase_ready' : 'active';
      const goalId = ulid();
      await transaction`
        INSERT INTO goals (
          id, user_id, name, category, target_amount_cents, current_saved_cents, target_date,
          recurring_contribution_cents, contribution_cadence, liquidity_need,
          preservation_preference, confidence, notes, status
        ) VALUES (
          ${goalId}, ${input.userId}, ${input.goal.name}, ${input.goal.category ?? null},
          ${input.goal.targetAmountCents}, ${input.goal.currentSavedCents}, ${input.goal.targetDate},
          ${input.goal.recurringContributionCents}, ${input.goal.contributionCadence},
          ${input.goal.liquidityNeed}, ${input.goal.preservationPreference},
          ${input.goal.confidence}, ${input.goal.notes ?? null}, ${initialStatus}
        )
      `;

      const selected = selectedVehicle(input.projection, input.vehicleCode);
      const planVersionId = ulid();
      await transaction`
        INSERT INTO plan_versions (
          id, goal_id, user_id, version, vehicle_code, assumption_version,
          normalized_input, calculation_output, calculation_context,
          application_date, schedule_anchor_date,
          calculation_policy_version, ranking_policy_version, health_policy_version,
          change_kind, change_reason_code
        ) VALUES (
          ${planVersionId}, ${goalId}, ${input.userId}, 1, ${input.vehicleCode},
          ${selected.assumption.assumptionVersion}, ${transaction.json(jsonValue(input.goal))},
          ${transaction.json(planCalculationOutput(input.projection, input.summary))},
          ${transaction.json(jsonValue(input.calculationContext))},
          ${input.applicationDate}, ${input.applicationDate}, 'product-experience-v1',
          ${input.projection.rankingPolicyVersion}, 'plan-health-v1',
          'initial_activation', 'INITIAL_ACTIVATION'
        )
      `;

      const accountId = ulid();
      await transaction`
        INSERT INTO simulated_accounts (
          id, goal_id, user_id, plan_version_id, status, next_contribution_date,
          last_processed_date, last_accrual_date
        ) VALUES (
          ${accountId}, ${goalId}, ${input.userId}, ${planVersionId}, ${initialStatus},
          ${funded ? null : input.nextContributionDate}, ${input.applicationDate},
          ${input.applicationDate}
        )
      `;
      const activityId = ulid();
      await transaction`
        INSERT INTO ledger_entries (
          id, account_id, user_id, entry_type, principal_cents, effective_date, description
        ) VALUES (
          ${activityId}, ${accountId}, ${input.userId}, 'account_opened',
          ${input.goal.currentSavedCents}, ${input.applicationDate},
          'Opening simulated savings'
        )
      `;
      await transaction`
        DELETE FROM goal_drafts
        WHERE id = ${input.draftId} AND user_id = ${input.userId}
          AND version = ${input.expectedDraftVersion}
      `;

      const output: InitialPlanActivationOutput = {
        goalId,
        goalVersion: 1,
        planVersionId,
        planVersion: 1,
        activityId,
        summary: input.summary,
      };
      await transaction`
        INSERT INTO idempotency_records (
          user_id, operation, key, request_hash, response_status, response_body
        ) VALUES (
          ${input.userId}, ${operation}, ${input.idempotencyKey}, ${input.requestHash}, 201,
          ${transaction.json(jsonValue(output))}
        )
      `;
      await transaction`
        INSERT INTO audit_events (id, user_id, event_name, resource_id, request_id)
        VALUES (
          ${ulid()}, ${input.userId}, 'goal.plan_activated', ${goalId}, ${input.requestId ?? null}
        )
      `;
      return { output, replayed: false };
    });
  }

  public async applyScenario(input: {
    readonly userId: string;
    readonly goalId: string;
    readonly expectedGoalVersion: number;
    readonly expectedPlanVersion: number;
    readonly goal: GoalInput;
    readonly projection: PreviewOutput;
    readonly summary: PlanDecisionSummary;
    readonly calculationContext: PlanCalculationContext;
    readonly comparison: ScenarioComparison;
    readonly changeKind: 'scenario_applied' | 'recovery_applied';
    readonly changedField:
      | 'recurring_contribution'
      | 'target_date'
      | 'target_amount'
      | 'missed_contribution';
    readonly changeReasonCode:
      | 'USER_CONTRIBUTION_CHANGED'
      | 'USER_DEADLINE_CHANGED'
      | 'USER_TARGET_CHANGED'
      | 'USER_MISSED_CONTRIBUTION_PLANNED'
      | 'RECOVERY_CONTRIBUTION_INCREASED'
      | 'RECOVERY_DEADLINE_EXTENDED'
      | 'RECOVERY_TARGET_REDUCED';
    readonly changePayload: Readonly<Record<string, string | number>>;
    readonly applicationDate: string;
    readonly nextContributionDate: string | null;
    readonly expectedFinancialRevision: {
      readonly accountId: string;
      readonly accountStatus: 'active' | 'paused' | 'purchase_ready' | 'completed';
      readonly nextContributionDate: string | null;
      readonly lastProcessedDate: string;
      readonly lastAccrualDate: string;
      readonly ledgerEntryCount: number;
      readonly personalPrincipalCents: number;
      readonly totalLedgerValueCents: number;
      readonly currentAvailableFundsCents: number;
      readonly currentAccruedInterestMicros: number;
    };
    readonly idempotencyKey: string;
    readonly requestHash: string;
    readonly requestId?: string;
  }): Promise<{ readonly output: ScenarioApplyOutput; readonly replayed: boolean }> {
    return this.database.begin(async (transaction) => {
      const operation = `goal-plan.${input.changeKind}`;
      await transaction`SELECT pg_advisory_xact_lock(hashtextextended(${`${input.userId}:${operation}:${input.idempotencyKey}`}, 0))`;
      const prior = await transaction<
        { readonly request_hash: string; readonly response_body: ScenarioApplyOutput }[]
      >`
        SELECT request_hash, response_body FROM idempotency_records
        WHERE user_id = ${input.userId} AND operation = ${operation}
          AND key = ${input.idempotencyKey}
      `;
      const previous = prior[0];
      if (previous !== undefined) {
        if (previous.request_hash !== input.requestHash) throw new IdempotencyConflictError();
        return { output: previous.response_body, replayed: true };
      }

      await lockOwnerFinancialMutation(transaction, input.userId, input.applicationDate);

      const current = await transaction<
        {
          readonly goal_version: number;
          readonly plan_version_id: string;
          readonly plan_version: number;
          readonly vehicle_code: VehicleCode;
          readonly schedule_anchor_date: string | Date;
          readonly omitted_contribution_dates: readonly (string | Date)[];
          readonly account_id: string;
          readonly account_status: 'active' | 'paused' | 'purchase_ready' | 'completed';
          readonly next_contribution_date: string | Date | null;
          readonly last_processed_date: string | Date;
          readonly last_accrual_date: string | Date;
          readonly accrued_interest_micros: string;
        }[]
      >`
        SELECT g.version AS goal_version, p.id AS plan_version_id, p.version AS plan_version,
               p.vehicle_code, p.schedule_anchor_date, p.omitted_contribution_dates,
               a.id AS account_id, a.status AS account_status, a.next_contribution_date,
               a.last_processed_date, a.last_accrual_date, a.accrued_interest_micros
        FROM goals g
        JOIN simulated_accounts a ON a.goal_id = g.id AND a.user_id = g.user_id
        JOIN plan_versions p ON p.id = a.plan_version_id
          AND p.goal_id = g.id AND p.user_id = g.user_id
        WHERE g.id = ${input.goalId} AND g.user_id = ${input.userId}
        FOR UPDATE OF g, a
      `;
      const row = current[0];
      if (row === undefined) throw new StateConflictError('The active plan is not available.');
      if (
        row.goal_version !== input.expectedGoalVersion ||
        row.plan_version !== input.expectedPlanVersion
      ) {
        throw new StateConflictError('The plan changed. Refresh before applying this scenario.');
      }
      const clocks = await transaction<{ readonly application_date: string | Date }[]>`
        SELECT application_date FROM user_application_clocks
        WHERE user_id = ${input.userId}
      `;
      const revision = input.expectedFinancialRevision;
      const balances = await transaction<
        {
          readonly personal_principal_cents: string;
          readonly ledger_balance_cents: string;
          readonly available_balance_cents: string;
          readonly ledger_entry_count: string;
        }[]
      >`
        SELECT COALESCE(SUM(entry.principal_cents) FILTER (
                 WHERE entry.entry_type IN ('account_opened', 'contribution_posted')
                    OR (entry.entry_type = 'reversal'
                        AND reversed_source.entry_type IN (
                          'account_opened', 'contribution_posted'
                        ))
               ), 0) AS personal_principal_cents,
               COALESCE(SUM(entry.principal_cents + entry.interest_cents), 0)
                 AS ledger_balance_cents,
               simulated_account_available_balance(
                 ${row.account_id}, ${input.userId}, ${input.applicationDate}::date
               ) AS available_balance_cents,
               COUNT(entry.id) AS ledger_entry_count
        FROM ledger_entries entry
        LEFT JOIN ledger_entries reversed_source
          ON reversed_source.id = entry.reverses_entry_id
          AND reversed_source.account_id = entry.account_id
          AND reversed_source.user_id = entry.user_id
        WHERE entry.account_id = ${row.account_id} AND entry.user_id = ${input.userId}
      `;
      const financial = balances[0];
      if (
        clocks[0] === undefined ||
        calendarDate(clocks[0].application_date) !== input.applicationDate ||
        row.account_id !== revision.accountId ||
        row.account_status !== revision.accountStatus ||
        (row.next_contribution_date === null ? null : calendarDate(row.next_contribution_date)) !==
          revision.nextContributionDate ||
        calendarDate(row.last_processed_date) !== revision.lastProcessedDate ||
        calendarDate(row.last_accrual_date) !== revision.lastAccrualDate ||
        Number(row.accrued_interest_micros) !== revision.currentAccruedInterestMicros ||
        Number(financial?.personal_principal_cents ?? 0) !== revision.personalPrincipalCents ||
        Number(financial?.ledger_balance_cents ?? 0) !== revision.totalLedgerValueCents ||
        Number(financial?.available_balance_cents ?? 0) !== revision.currentAvailableFundsCents ||
        Number(financial?.ledger_entry_count ?? 0) !== revision.ledgerEntryCount
      ) {
        throw new StateConflictError(
          'The account changed after this scenario was calculated. Refresh and try again.',
        );
      }
      const selected = selectedVehicle(input.projection, row.vehicle_code);
      const planVersion = row.plan_version + 1;
      const planVersionId = ulid();
      const inheritedOmissions = row.omitted_contribution_dates.map(calendarDate);
      const missedContributionDate =
        input.changedField === 'missed_contribution'
          ? input.changePayload['missedContributionDate']
          : undefined;
      if (missedContributionDate !== undefined && typeof missedContributionDate !== 'string') {
        throw new StateConflictError('A planned missed contribution requires its cadence date.');
      }
      const omittedContributionDates =
        typeof missedContributionDate === 'string'
          ? [...inheritedOmissions, missedContributionDate]
          : inheritedOmissions;
      if (
        input.calculationContext.applicationDate !== input.applicationDate ||
        input.calculationContext.scheduleAnchorDate !== calendarDate(row.schedule_anchor_date) ||
        JSON.stringify(input.calculationContext.omittedContributionDates) !==
          JSON.stringify(omittedContributionDates)
      ) {
        throw new StateConflictError(
          'The scenario calculation snapshot does not match its immutable schedule provenance.',
        );
      }
      await transaction`
        INSERT INTO plan_versions (
          id, goal_id, user_id, version, vehicle_code, assumption_version,
          normalized_input, calculation_output, calculation_context,
          application_date, schedule_anchor_date,
          omitted_contribution_dates,
          calculation_policy_version, ranking_policy_version, health_policy_version,
          change_kind, changed_field, change_reason_code, change_payload, base_plan_version_id
        ) VALUES (
          ${planVersionId}, ${input.goalId}, ${input.userId}, ${planVersion},
          ${row.vehicle_code}, ${selected.assumption.assumptionVersion},
          ${transaction.json(jsonValue(input.goal))},
          ${transaction.json(planCalculationOutput(input.projection, input.summary))},
          ${transaction.json(jsonValue(input.calculationContext))},
          ${input.applicationDate}, ${calendarDate(row.schedule_anchor_date)},
          ${omittedContributionDates},
          'product-experience-v1', ${input.projection.rankingPolicyVersion}, 'plan-health-v1',
          ${input.changeKind}, ${input.changedField}, ${input.changeReasonCode},
          ${transaction.json(jsonValue(input.changePayload))}, ${row.plan_version_id}
        )
      `;
      const updated = await transaction<{ readonly id: string }[]>`
        UPDATE goals SET
          name = ${input.goal.name}, category = ${input.goal.category ?? null},
          target_amount_cents = ${input.goal.targetAmountCents},
          current_saved_cents = ${input.goal.currentSavedCents},
          target_date = ${input.goal.targetDate},
          recurring_contribution_cents = ${input.goal.recurringContributionCents},
          contribution_cadence = ${input.goal.contributionCadence},
          liquidity_need = ${input.goal.liquidityNeed},
          preservation_preference = ${input.goal.preservationPreference},
          confidence = ${input.goal.confidence}, notes = ${input.goal.notes ?? null},
          version = version + 1, updated_at = now()
        WHERE id = ${input.goalId} AND user_id = ${input.userId}
          AND version = ${input.expectedGoalVersion}
          AND status IN ('active', 'paused', 'purchase_ready')
        RETURNING id
      `;
      if (updated[0] === undefined) {
        throw new StateConflictError('The plan changed. Refresh before applying this scenario.');
      }
      const ledgerBalanceCents = Number(balances[0]?.ledger_balance_cents ?? 0);
      const availableBalanceCents = Number(balances[0]?.available_balance_cents ?? 0);
      const lifecycleStatus =
        row.account_status === 'paused'
          ? 'paused'
          : availableBalanceCents >= input.goal.targetAmountCents
            ? 'purchase_ready'
            : 'active';
      await transaction`
        UPDATE goals SET status = ${lifecycleStatus}, updated_at = now()
        WHERE id = ${input.goalId} AND user_id = ${input.userId}
      `;
      await transaction`
        UPDATE simulated_accounts SET plan_version_id = ${planVersionId},
          status = ${lifecycleStatus},
          next_contribution_date = ${
            ledgerBalanceCents >= input.goal.targetAmountCents ? null : input.nextContributionDate
          }, updated_at = now()
        WHERE id = ${row.account_id} AND user_id = ${input.userId}
      `;
      const activityId = ulid();
      await transaction`
        INSERT INTO ledger_entries (
          id, account_id, user_id, entry_type, effective_date, occurrence_id, description
        ) VALUES (
          ${activityId}, ${row.account_id}, ${input.userId}, 'plan_changed',
          ${input.applicationDate}, ${`plan:${planVersionId}`},
          ${input.changeKind === 'recovery_applied' ? 'Recovery plan version applied' : 'What-If plan version applied'}
        )
      `;
      const output: ScenarioApplyOutput = {
        goalVersion: input.expectedGoalVersion + 1,
        planVersion,
        planVersionId,
        activityId,
        comparison: input.comparison,
      };
      await transaction`
        INSERT INTO idempotency_records (
          user_id, operation, key, request_hash, response_status, response_body
        ) VALUES (
          ${input.userId}, ${operation}, ${input.idempotencyKey}, ${input.requestHash}, 201,
          ${transaction.json(jsonValue(output))}
        )
      `;
      await transaction`
        INSERT INTO audit_events (id, user_id, event_name, resource_id, request_id)
        VALUES (
          ${ulid()}, ${input.userId}, 'goal.plan_version_applied', ${input.goalId},
          ${input.requestId ?? null}
        )
      `;
      return { output, replayed: false };
    });
  }

  private snapshotQuery(
    userId: string,
    goalId: string,
    currentOnly: boolean,
    asOfDate?: string,
  ): Promise<PlanSnapshotRow[]> {
    return this.database<PlanSnapshotRow[]>`
      SELECT g.*,
             p.id AS plan_version_id, p.version AS plan_version, p.vehicle_code,
             p.assumption_version, p.application_date, p.schedule_anchor_date,
             p.omitted_contribution_dates,
             p.calculation_policy_version, p.ranking_policy_version,
             p.health_policy_version, p.change_kind, p.changed_field,
             p.change_reason_code, p.change_payload, p.base_plan_version_id, p.normalized_input,
             p.calculation_output, p.calculation_context, p.created_at AS plan_created_at,
             a.id AS account_id, a.status AS account_status, a.next_contribution_date,
             a.last_processed_date, a.last_accrual_date, a.accrued_interest_micros,
             COALESCE(SUM(l.principal_cents) FILTER (
               WHERE l.entry_type = 'account_opened'
                  OR (l.entry_type = 'reversal'
                      AND reversed_source.entry_type = 'account_opened')
             ), 0) AS opening_savings_cents,
             COALESCE(SUM(l.principal_cents) FILTER (
               WHERE l.entry_type = 'contribution_posted'
                  OR (l.entry_type = 'reversal'
                      AND reversed_source.entry_type = 'contribution_posted')
             ), 0) AS posted_contributions_cents,
             COALESCE(SUM(l.interest_cents) FILTER (
               WHERE l.entry_type = 'interest_posted'
                  OR (l.entry_type = 'reversal'
                      AND reversed_source.entry_type = 'interest_posted')
             ), 0) AS posted_interest_cents,
             COALESCE(SUM(l.principal_cents + l.interest_cents), 0) AS ledger_balance_cents
             , COUNT(l.id) AS ledger_entry_count
      FROM goals g
      JOIN simulated_accounts a ON a.goal_id = g.id AND a.user_id = g.user_id
      JOIN plan_versions p ON p.goal_id = g.id AND p.user_id = g.user_id
      LEFT JOIN ledger_entries l ON l.account_id = a.id AND l.user_id = g.user_id
        AND (${asOfDate ?? null}::date IS NULL OR l.effective_date <= ${asOfDate ?? null}::date)
      LEFT JOIN ledger_entries reversed_source
        ON reversed_source.id = l.reverses_entry_id
        AND reversed_source.account_id = l.account_id
        AND reversed_source.user_id = l.user_id
      WHERE g.id = ${goalId} AND g.user_id = ${userId}
        AND (${currentOnly} = false OR p.id = a.plan_version_id)
      GROUP BY g.id, p.id, a.id
      ORDER BY p.version ASC
      LIMIT 100
    `;
  }
}
