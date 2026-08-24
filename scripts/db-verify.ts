import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { createDatabaseClient, schemaTables } from '@goalpilot/data-access';
import {
  catalogVersion,
  illustrativeAssumptions,
  planHealthPolicyVersion,
  purchaseTimingPolicyVersion,
  vehicleFitPolicyVersion,
} from '@goalpilot/domain';

import { getDatabaseUrl } from './runtime-config.js';

const migrationsDirectory = path.resolve('packages/data-access/migrations');
const productExperiencePolicyVersion = 'product-experience-v1';

export interface ConstraintCatalogRow {
  readonly table_name: string;
  readonly constraint_name: string;
  readonly constraint_type: string;
  readonly definition: string;
  readonly is_validated: boolean;
}

export interface ConstraintRequirement {
  readonly tableName: string;
  readonly type: string;
  readonly label: string;
  readonly fragments: readonly string[];
  readonly name?: string;
}

export interface ColumnCatalogRow {
  readonly table_name: string;
  readonly column_name: string;
  readonly data_type: string;
  readonly is_not_null: boolean;
  readonly column_default: string | null;
}

export interface ColumnRequirement {
  readonly tableName: string;
  readonly columnName: string;
  readonly dataType: string;
  readonly isNotNull: boolean;
  readonly defaultExpression?: string;
}

export interface TriggerCatalogRow {
  readonly trigger_name: string;
  readonly table_name: string;
  readonly function_name: string;
  readonly enabled: string;
  readonly definition: string;
}

export interface TriggerRequirement {
  readonly name: string;
  readonly tableName: string;
  readonly functionName: string;
  readonly fragments: readonly string[];
}

export interface IndexCatalogRow {
  readonly index_name: string;
  readonly table_name: string;
  readonly definition: string;
}

export interface IndexRequirement {
  readonly name: string;
  readonly tableName: string;
  readonly fragments: readonly string[];
}

export interface FunctionCatalogRow {
  readonly function_name: string;
  readonly source: string;
  readonly language_name: string;
  readonly volatility: string;
  readonly is_strict: boolean;
  readonly security_definer: boolean;
  readonly configuration: readonly string[] | null;
}

interface MigrationSource {
  readonly filename: string;
  readonly source: string;
}

export interface FunctionRequirement {
  readonly name: string;
  readonly language: string;
  readonly volatility: string;
  readonly isStrict: boolean;
  readonly configuration: readonly string[];
}

function constraint(
  tableName: string,
  type: string,
  label: string,
  fragments: readonly string[],
  name?: string,
): ConstraintRequirement {
  const base = { tableName, type, label, fragments };
  return name === undefined ? base : { ...base, name };
}

function check(
  tableName: string,
  label: string,
  ...fragments: readonly string[]
): ConstraintRequirement {
  return constraint(tableName, 'c', label, fragments);
}

function namedCheck(
  tableName: string,
  name: string,
  ...fragments: readonly string[]
): ConstraintRequirement {
  return constraint(tableName, 'c', name, fragments, name);
}

export const requiredNamedConstraintRequirements: readonly ConstraintRequirement[] = [
  constraint(
    'interest_posting_periods',
    'f',
    'interest posting account owner',
    [],
    'interest_posting_periods_account_owner_fkey',
  ),
  constraint(
    'interest_posting_periods',
    'f',
    'interest posting ledger account owner',
    [],
    'interest_posting_periods_ledger_account_owner_fkey',
  ),
  constraint(
    'interest_posting_periods',
    'u',
    'interest posting ledger entry uniqueness',
    [],
    'interest_posting_periods_ledger_entry_unique',
  ),
  namedCheck(
    'ledger_entries',
    'ledger_amount_policy_check',
    'entry_type = account_opened',
    'entry_type = contribution_posted',
    'entry_type = interest_posted',
    'simulated_withdrawal',
    'principal_cents + interest_cents < 0',
    'plan_changed',
  ),
  namedCheck(
    'ledger_entries',
    'ledger_entries_entry_type_check',
    'account_opened',
    'contribution_scheduled',
    'contribution_posted',
    'contribution_failed',
    'interest_accrued',
    'interest_posted',
    'simulated_withdrawal',
    'reversal',
    'plan_changed',
  ),
  constraint(
    'ledger_entries',
    'f',
    'ledger entry account owner',
    [],
    'ledger_entries_account_owner_fkey',
  ),
  constraint(
    'ledger_entries',
    'f',
    'ledger reversal account owner',
    [],
    'ledger_entries_reversal_account_owner_fkey',
  ),
  constraint(
    'ledger_entries',
    'c',
    'ledger reversal reference policy',
    [],
    'ledger_reversal_reference_policy_check',
  ),
  constraint(
    'plan_versions',
    'f',
    'plan assumption vehicle',
    [],
    'plan_versions_assumption_vehicle_fkey',
  ),
  constraint(
    'plan_versions',
    'f',
    'base plan owner and goal',
    ['base_plan_version_id', 'goal_id', 'user_id', 'references plan_versions', 'on delete cascade'],
    'plan_versions_base_same_goal_owner_fkey',
  ),
  namedCheck(
    'plan_versions',
    'plan_versions_calculation_context_check',
    'contextVersion',
    'plan-calculation-context-v1',
    'personalPrincipalCents',
    'totalLedgerValueCents',
    'currentAvailableFundsCents',
    'omittedContributionDates',
    'fixedTermLots',
    '0',
  ),
  namedCheck(
    'goals',
    'goals_archive_provenance_check',
    'status = archived',
    'archived_at is not null',
    'archive_reason',
    'USER_REQUESTED',
    'GOAL_COMPLETED',
    'NO_LONGER_PURSUED',
  ),
  namedCheck(
    'price_observations',
    'price_observations_observation_key_check',
    'observation_key',
    '^[a-z0-9_-]{1,40}$',
  ),
  namedCheck(
    'purchase_timing_assessments',
    'purchase_timing_assessments_plan_provenance_check',
    'plan_lifecycle = draft',
    'plan_lifecycle = active',
    'plan_lifecycle = any array completed archived',
    'plan_version_id is not null',
    'plan_health is null',
  ),
  constraint(
    'price_observations',
    'u',
    'price observation run key uniqueness',
    ['price_check_run_id', 'observation_key'],
    'price_observations_run_key_unique',
  ),
  namedCheck(
    'plan_versions',
    'plan_versions_change_kind_check',
    'initial_activation',
    'scenario_applied',
    'recovery_applied',
  ),
  namedCheck(
    'plan_versions',
    'plan_versions_changed_field_check',
    'recurring_contribution',
    'target_date',
    'target_amount',
    'missed_contribution',
  ),
  namedCheck(
    'plan_versions',
    'plan_versions_change_payload_check',
    'recurringContributionCents',
    'targetDate',
    'targetAmountCents',
    'missedContributionDate',
    'pg_input_is_valid',
  ),
  namedCheck(
    'plan_versions',
    'plan_versions_change_reason_check',
    'INITIAL_ACTIVATION',
    'USER_MISSED_CONTRIBUTION_PLANNED',
    'RECOVERY_CONTRIBUTION_INCREASED',
    'RECOVERY_DEADLINE_EXTENDED',
    'RECOVERY_TARGET_REDUCED',
  ),
  namedCheck(
    'plan_versions',
    'plan_versions_change_shape_check',
    'change_kind = initial_activation',
    'change_kind = scenario_applied',
    'change_kind = recovery_applied',
    'base_plan_version_id is not null',
  ),
  namedCheck(
    'plan_versions',
    'plan_versions_omitted_contribution_dates_check',
    'cardinality',
    'omitted_contribution_dates',
    '<= 24',
  ),
  constraint('plan_versions', 'f', 'plan goal owner', [], 'plan_versions_goal_owner_fkey'),
  namedCheck(
    'plan_versions',
    'plan_versions_policy_version_check',
    'calculation_policy_version',
    'ranking_policy_version',
    'health_policy_version',
    '^[a-z][a-z0-9-]{0,63}$',
  ),
  constraint(
    'schedule_occurrences',
    'f',
    'schedule account owner',
    [],
    'schedule_occurrences_account_owner_fkey',
  ),
  constraint(
    'simulated_accounts',
    'f',
    'simulated account goal owner',
    [],
    'simulated_accounts_goal_owner_fkey',
  ),
  constraint(
    'simulated_accounts',
    'f',
    'simulated account plan and goal owner',
    [],
    'simulated_accounts_plan_goal_owner_fkey',
  ),
];

export const newTableConstraintRequirements: readonly ConstraintRequirement[] = [
  constraint('goal_drafts', 'p', 'goal draft primary key', ['primary key', 'id']),
  check('goal_drafts', 'goal draft id length', 'char_length', 'id', '26'),
  constraint('goal_drafts', 'f', 'goal draft owner', [
    'user_id',
    'references users',
    'on delete cascade',
  ]),
  check('goal_drafts', 'goal draft schema version', 'schema_version', 'goal-draft-v1'),
  check(
    'goal_drafts',
    'goal draft completed step',
    'last_completed_step',
    'starting_point',
    'review',
  ),
  check('goal_drafts', 'goal draft positive version', 'version > 0'),
  constraint('goal_drafts', 'u', 'goal draft owner uniqueness', ['unique', 'id', 'user_id']),
  check('goal_drafts', 'goal draft timestamp order', 'updated_at >= created_at'),
  check('goal_drafts', 'goal draft object shape', 'jsonb_typeof', 'draft_data', 'object'),
  check(
    'goal_drafts',
    'goal draft allowed keys',
    'draft_data - array',
    'safeContributionCents',
    'preservationPreference',
    'notes',
  ),
  check(
    'goal_drafts',
    'goal draft first contribution date',
    'firstContributionDate',
    'pg_input_is_valid',
    'date',
  ),
  check('goal_drafts', 'goal draft name', 'draft_data', 'name', 'char_length', '1', '80'),
  check('goal_drafts', 'goal draft category', 'draft_data', 'category', 'char_length', '<= 40'),
  check('goal_drafts', 'goal draft target amount', 'targetAmountCents', '50000', '100000000'),
  check('goal_drafts', 'goal draft target date', 'targetDate', 'pg_input_is_valid', 'date'),
  check('goal_drafts', 'goal draft current savings', 'currentSavedCents', '0', '100000000'),
  check('goal_drafts', 'goal draft safe contribution', 'safeContributionCents', '0', '100000000'),
  check('goal_drafts', 'goal draft budget fit', 'budgetFit', 'equal', 'lower', 'higher'),
  check('goal_drafts', 'goal draft confidence', 'confidence', 'expected'),
  check(
    'goal_drafts',
    'goal draft recurring contribution',
    'recurringContributionCents',
    '0',
    '100000000',
  ),
  check(
    'goal_drafts',
    'goal draft cadence',
    'contributionCadence',
    'weekly',
    'biweekly',
    'monthly',
  ),
  check(
    'goal_drafts',
    'goal draft liquidity need',
    'liquidityNeed',
    'anytime',
    'within_30_days',
    'goal_date',
  ),
  check(
    'goal_drafts',
    'goal draft preservation preference',
    'preservationPreference',
    'required',
    'flexible',
  ),
  check('goal_drafts', 'goal draft notes', 'notes', 'char_length', '<= 500'),

  constraint('user_application_clocks', 'p', 'controlled clock primary key', [
    'primary key',
    'user_id',
  ]),
  constraint('user_application_clocks', 'f', 'controlled clock owner', [
    'user_id',
    'references users',
    'on delete cascade',
  ]),
  check('user_application_clocks', 'controlled clock positive version', 'version > 0'),
  check(
    'user_application_clocks',
    'controlled clock cannot precede initial date',
    'application_date >= initial_application_date',
  ),
  check('user_application_clocks', 'controlled clock timestamp order', 'updated_at >= created_at'),
  check(
    'user_application_clocks',
    'controlled financial run lease shape',
    'financial_run_token is null',
    'financial_run_expires_at is null',
    'financial_run_token',
    '^[0-9A-HJKMNP-TV-Z]{26}$',
  ),

  constraint('demo_fixture_users', 'p', 'demo fixture primary key', ['primary key', 'user_id']),
  constraint('demo_fixture_users', 'f', 'demo fixture owner', [
    'user_id',
    'references users',
    'on delete cascade',
  ]),
  constraint('demo_fixture_users', 'u', 'demo fixture key uniqueness', ['unique', 'fixture_key']),
  check('demo_fixture_users', 'demo fixture key', 'fixture_key', 'japan-trip'),
  check('demo_fixture_users', 'demo fixture version', 'fixture_version', '^[a-z][a-z0-9-]{0,63}$'),
  check('demo_fixture_users', 'demo fixture generation', 'reset_generation >= 0'),
  check('demo_fixture_users', 'demo fixture timestamp order', 'updated_at >= created_at'),

  constraint('product_events', 'p', 'product event primary key', ['primary key', 'id']),
  check('product_events', 'product event id length', 'char_length', 'id', '26'),
  check(
    'product_events',
    'product event name allowlist',
    'event_name',
    'sample_goal_opened',
    'purchase_timing_viewed',
    'purchase_timing_check_no_due',
  ),
  check('product_events', 'product event subject kind', 'subject_kind', 'user', 'anonymous'),
  check('product_events', 'product event subject hash', 'subject_hash', '^[0-9a-f]{64}$'),
  check('product_events', 'product event builder step', 'builder_step', 'starting_point', 'review'),
  check('product_events', 'product event vehicle', 'vehicle_code', 'cash', 'treasury_ladder'),
  check(
    'product_events',
    'product event rejection',
    'rejection_code',
    'ASSUMPTION_DISABLED',
    'BELOW_MINIMUM',
  ),
  check(
    'product_events',
    'product event changed dimension',
    'changed_dimension',
    'recurring_contribution',
    'missed_contribution',
  ),
  check(
    'product_events',
    'product event application version',
    'application_version',
    'product-experience-v1',
  ),
  check(
    'product_events',
    'product event builder shape',
    'event_name = builder_step_completed',
    'builder_step is not null',
    'event_name <> builder_step_completed',
  ),
  check(
    'product_events',
    'product event vehicle shape',
    'vehicle_details_opened',
    'simulated_plan_activated',
    'vehicle_code is not null',
  ),
  check(
    'product_events',
    'product event rejection shape',
    'rejection_code is null',
    'event_name = vehicle_details_opened',
  ),
  check(
    'product_events',
    'product event change shape',
    'what_if_previewed',
    'recovery_option_applied',
    'changed_dimension is not null',
  ),
  check(
    'product_events',
    'product event recovery dimensions',
    'event_name <> recovery_option_applied',
    'target_amount',
  ),

  constraint('purchase_items', 'p', 'purchase item primary key', ['primary key', 'id']),
  check('purchase_items', 'purchase item id length', 'char_length', 'id', '26'),
  constraint('purchase_items', 'f', 'purchase item owner', [
    'user_id',
    'references users',
    'on delete cascade',
  ]),
  check('purchase_items', 'purchase item fixture', 'fixture_code', 'synthetic_oled_65_v1'),
  check('purchase_items', 'purchase item display name', 'display_name', '65-inch oled television'),
  check('purchase_items', 'purchase item currency', 'currency', 'usd'),
  check('purchase_items', 'purchase item target price', 'target_price_cents', '1', '100000000'),
  check('purchase_items', 'purchase item positive version', 'version > 0'),
  check('purchase_items', 'purchase item lifecycle', 'lifecycle', 'active', 'archived'),
  constraint(
    'purchase_items',
    'u',
    'purchase item owner uniqueness',
    ['unique', 'id', 'user_id'],
    'purchase_items_id_user_id_key',
  ),
  constraint(
    'purchase_items',
    'u',
    'purchase item goal owner uniqueness',
    ['unique', 'id', 'goal_id', 'user_id'],
    'purchase_items_id_goal_id_user_id_key',
  ),
  constraint('purchase_items', 'f', 'purchase item goal owner', [
    'goal_id',
    'user_id',
    'references goals',
    'on delete cascade',
  ]),
  check('purchase_items', 'purchase item timestamp order', 'updated_at >= created_at'),

  constraint('price_watch_policies', 'p', 'price policy primary key', ['primary key', 'id']),
  check('price_watch_policies', 'price policy id length', 'char_length', 'id', '26'),
  constraint('price_watch_policies', 'f', 'price policy owner', [
    'user_id',
    'references users',
    'on delete cascade',
  ]),
  check('price_watch_policies', 'price policy positive version', 'version > 0'),
  check('price_watch_policies', 'price policy cadence', 'cadence', 'weekly', 'monthly'),
  check('price_watch_policies', 'price policy freshness', 'freshness_limit_days = 14'),
  check(
    'price_watch_policies',
    'price policy analysis version',
    'analysis_policy_version',
    'purchase-timing-v1',
  ),
  constraint('price_watch_policies', 'u', 'price policy item version uniqueness', [
    'unique',
    'purchase_item_id',
    'version',
  ]),
  constraint('price_watch_policies', 'u', 'price policy owner uniqueness', [
    'unique',
    'id',
    'purchase_item_id',
    'user_id',
  ]),
  constraint('price_watch_policies', 'f', 'price policy item owner', [
    'purchase_item_id',
    'user_id',
    'references purchase_items',
    'on delete cascade',
  ]),

  constraint('price_check_runs', 'p', 'price run primary key', ['primary key', 'id']),
  check('price_check_runs', 'price run id length', 'char_length', 'id', '26'),
  constraint('price_check_runs', 'f', 'price run owner', [
    'user_id',
    'references users',
    'on delete cascade',
  ]),
  check(
    'price_check_runs',
    'price run source version',
    'fixture_source_version',
    '^[a-z0-9._-]{1,80}$',
  ),
  check(
    'price_check_runs',
    'price run source checksum',
    'fixture_source_checksum',
    '^[0-9a-f]{64}$',
  ),
  check('price_check_runs', 'price run status', 'status = any', 'claimed', 'completed', 'failed'),
  check(
    'price_check_runs',
    'price run error code',
    'error_code',
    'PROVIDER_FAILURE',
    'ASSESSMENT_FAILURE',
  ),
  check('price_check_runs', 'price run attempts', 'attempt_count', '1', '3'),
  constraint('price_check_runs', 'u', 'price run policy date uniqueness', [
    'unique',
    'price_watch_policy_id',
    'application_date',
  ]),
  constraint('price_check_runs', 'u', 'price run owner uniqueness', [
    'unique',
    'id',
    'purchase_item_id',
    'user_id',
  ]),
  constraint('price_check_runs', 'f', 'price run policy owner', [
    'price_watch_policy_id',
    'purchase_item_id',
    'user_id',
    'references price_watch_policies',
  ]),
  check(
    'price_check_runs',
    'price run terminal shape',
    'status = claimed',
    'status = completed',
    'status = failed',
    'completed_at',
  ),
  check(
    'price_check_runs',
    'price run source pair',
    'fixture_source_version is null',
    'fixture_source_checksum is null',
    'fixture_source_version is not null',
  ),
  check(
    'price_check_runs',
    'price run worker claim shape',
    'status = claimed',
    'worker_claim_token',
    '^[0-9A-HJKMNP-TV-Z]{26}$',
    'worker_lease_expires_at is not null',
    'status = any array completed failed',
  ),

  constraint('price_observations', 'p', 'price observation primary key', ['primary key', 'id']),
  check('price_observations', 'price observation id length', 'char_length', 'id', '26'),
  constraint('price_observations', 'f', 'price observation owner', [
    'user_id',
    'references users',
    'on delete cascade',
  ]),
  check(
    'price_observations',
    'price observation source version',
    'fixture_source_version',
    '^[a-z0-9._-]{1,80}$',
  ),
  check('price_observations', 'price observation amount', 'price_cents', '1', '100000000'),
  check('price_observations', 'price observation currency', 'currency', '^[a-z]{3}$'),
  constraint('price_observations', 'f', 'price observation run owner', [
    'price_check_run_id',
    'purchase_item_id',
    'user_id',
    'references price_check_runs',
  ]),
  constraint('price_observations', 'f', 'price observation item owner', [
    'purchase_item_id',
    'user_id',
    'references purchase_items',
  ]),

  constraint('purchase_timing_assessments', 'p', 'timing assessment primary key', [
    'primary key',
    'id',
  ]),
  check('purchase_timing_assessments', 'timing assessment id length', 'char_length', 'id', '26'),
  constraint('purchase_timing_assessments', 'u', 'timing assessment run uniqueness', [
    'unique',
    'price_check_run_id',
  ]),
  constraint('purchase_timing_assessments', 'f', 'timing assessment owner', [
    'user_id',
    'references users',
    'on delete cascade',
  ]),
  check(
    'purchase_timing_assessments',
    'timing assessment policy version',
    'price_watch_policy_version > 0',
  ),
  check(
    'purchase_timing_assessments',
    'timing assessment plan version',
    'plan_version_number is null',
    'plan_version_number > 0',
  ),
  check(
    'purchase_timing_assessments',
    'timing assessment lifecycle',
    'plan_lifecycle',
    'draft',
    'completed',
    'archived',
  ),
  check(
    'purchase_timing_assessments',
    'timing assessment health',
    'plan_health',
    'PURCHASE_READY',
    'ON_TRACK',
  ),
  check(
    'purchase_timing_assessments',
    'timing assessment health policy',
    'plan_health_policy_version',
    'plan-health-v1',
  ),
  check(
    'purchase_timing_assessments',
    'timing assessment analysis policy',
    'analysis_policy_version',
    'purchase-timing-v1',
  ),
  check(
    'purchase_timing_assessments',
    'timing assessment source version',
    'fixture_source_version',
    '^[a-z0-9._-]{1,80}$',
  ),
  check(
    'purchase_timing_assessments',
    'timing assessment checksum',
    'fixture_source_checksum',
    '^[0-9a-f]{64}$',
  ),
  check('purchase_timing_assessments', 'timing assessment currency', 'currency', '^[a-z]{3}$'),
  check(
    'purchase_timing_assessments',
    'timing assessment state allowlist',
    'assessment_state = any',
    'INSUFFICIENT_DATA',
    'HISTORICALLY_TYPICAL',
  ),
  check(
    'purchase_timing_assessments',
    'timing assessment rationale allowlist',
    'rationale_codes <@ array',
    'INSUFFICIENT_OBSERVATION_COUNT',
    'PLAN_NOT_PURCHASE_READY',
  ),
  check(
    'purchase_timing_assessments',
    'timing assessment observation count',
    'observation_count > 0',
  ),
  check('purchase_timing_assessments', 'timing assessment span', 'data_span_days >= 0'),
  check('purchase_timing_assessments', 'timing assessment freshness', 'freshness_days >= 0'),
  check(
    'purchase_timing_assessments',
    'timing assessment current price',
    'current_price_cents',
    '1',
    '100000000',
  ),
  check(
    'purchase_timing_assessments',
    'timing assessment target price',
    'target_price_cents',
    '1',
    '100000000',
  ),
  check(
    'purchase_timing_assessments',
    'timing assessment minimum price',
    'minimum_price_cents',
    '1',
    '100000000',
  ),
  check(
    'purchase_timing_assessments',
    'timing assessment median price',
    'median_price_cents',
    '1',
    '100000000',
  ),
  check(
    'purchase_timing_assessments',
    'timing assessment maximum price',
    'maximum_price_cents',
    '1',
    '100000000',
  ),
  check(
    'purchase_timing_assessments',
    'timing assessment percentile',
    'current_percentile_basis_points',
    '0',
    '10000',
  ),
  constraint('purchase_timing_assessments', 'f', 'timing assessment run owner', [
    'price_check_run_id',
    'purchase_item_id',
    'user_id',
    'references price_check_runs',
  ]),
  constraint('purchase_timing_assessments', 'f', 'timing assessment item goal owner', [
    'purchase_item_id',
    'goal_id',
    'user_id',
    'references purchase_items',
  ]),
  constraint('purchase_timing_assessments', 'f', 'timing assessment plan owner', [
    'plan_version_id',
    'goal_id',
    'user_id',
    'references plan_versions',
  ]),
  check(
    'purchase_timing_assessments',
    'timing assessment metric consistency',
    'earliest_observation_date <= latest_observation_date',
    'difference_from_median_cents',
    'current_price_cents - median_price_cents',
  ),
  check(
    'purchase_timing_assessments',
    'timing assessment seasonal shape',
    'seasonal_summary is null',
    'data_span_days >= 730',
    'valid_purchase_timing_seasonal_summary',
  ),
  check(
    'purchase_timing_assessments',
    'timing assessment state rationale shape',
    'assessment_state = insufficient_data',
    'assessment_state = historically_typical',
    'current_percentile_basis_points < 7500',
  ),

  constraint('application_command_claims', 'f', 'application command owner', [
    'user_id',
    'references users',
    'on delete cascade',
  ]),
  check(
    'application_command_claims',
    'application command operation',
    'char_length',
    'operation',
    '1',
    '100',
  ),
  check('application_command_claims', 'application command key', 'char_length', 'key', '8', '128'),
  check(
    'application_command_claims',
    'application command request hash',
    'request_hash',
    '^[0-9a-f]{64}$',
  ),
  check(
    'application_command_claims',
    'application command state',
    'state = any',
    'claimed',
    'retryable',
  ),
  check(
    'application_command_claims',
    'application command claim token',
    'claim_token is null',
    'char_length',
    '26',
  ),
  constraint('application_command_claims', 'p', 'application command primary key', [
    'primary key',
    'user_id',
    'operation',
    'key',
  ]),
  check(
    'application_command_claims',
    'application command timestamp order',
    'updated_at >= created_at',
  ),
  check(
    'application_command_claims',
    'application command claim shape',
    'state = claimed',
    'claim_token is not null',
    'state = retryable',
    'lease_expires_at is null',
  ),
];

const newTableConstraintCounts = new Map<string, number>([
  ['goal_drafts', 24],
  ['user_application_clocks', 6],
  ['demo_fixture_users', 7],
  ['product_events', 15],
  ['purchase_items', 13],
  ['price_watch_policies', 10],
  ['price_check_runs', 14],
  ['price_observations', 10],
  ['purchase_timing_assessments', 31],
  ['application_command_claims', 9],
]);

export const requiredIndexRequirements: readonly IndexRequirement[] = [
  {
    name: 'goal_drafts_owner_updated_idx',
    tableName: 'goal_drafts',
    fragments: ['user_id', 'updated_at desc', 'id'],
  },
  {
    name: 'product_events_funnel_idx',
    tableName: 'product_events',
    fragments: ['event_name', 'occurred_at'],
  },
  {
    name: 'product_events_subject_idx',
    tableName: 'product_events',
    fragments: ['subject_hash', 'occurred_at'],
  },
  {
    name: 'purchase_items_owner_lifecycle_idx',
    tableName: 'purchase_items',
    fragments: ['user_id', 'lifecycle', 'updated_at desc', 'id'],
  },
  {
    name: 'price_watch_policies_due_idx',
    tableName: 'price_watch_policies',
    fragments: ['user_id', 'enabled', 'next_due_date', 'purchase_item_id', 'version desc'],
  },
  {
    name: 'price_check_runs_owner_status_idx',
    tableName: 'price_check_runs',
    fragments: ['user_id', 'status', 'application_date desc', 'id'],
  },
  {
    name: 'price_observations_item_date_idx',
    tableName: 'price_observations',
    fragments: ['user_id', 'purchase_item_id', 'observed_on', 'id'],
  },
  {
    name: 'price_observations_source_key_idx',
    tableName: 'price_observations',
    fragments: ['user_id', 'purchase_item_id', 'fixture_source_version', 'observation_key'],
  },
  {
    name: 'purchase_timing_assessments_item_date_idx',
    tableName: 'purchase_timing_assessments',
    fragments: ['user_id', 'purchase_item_id', 'as_of_date desc', 'id'],
  },
  {
    name: 'application_command_claims_lease_idx',
    tableName: 'application_command_claims',
    fragments: ['state', 'lease_expires_at', 'where', 'claimed'],
  },
];

export const requiredTriggerRequirements: readonly TriggerRequirement[] = [
  {
    name: 'application_clock_initialize_user_clocks',
    tableName: 'application_clock',
    functionName: 'initialize_missing_user_application_clocks',
    fragments: ['after insert'],
  },
  {
    name: 'demo_fixture_users_validate_mutation',
    tableName: 'demo_fixture_users',
    functionName: 'validate_demo_fixture_user_mutation',
    fragments: ['before', 'update', 'delete'],
  },
  {
    name: 'goal_drafts_validate_update',
    tableName: 'goal_drafts',
    functionName: 'validate_goal_draft_update',
    fragments: ['before update'],
  },
  {
    name: 'interest_posting_periods_validate_entry',
    tableName: 'interest_posting_periods',
    functionName: 'validate_interest_posting_period',
    fragments: ['before', 'insert', 'update'],
  },
  {
    name: 'ledger_entries_no_update',
    tableName: 'ledger_entries',
    functionName: 'prevent_ledger_mutation',
    fragments: ['before', 'update', 'delete'],
  },
  {
    name: 'ledger_entries_validate_reversal',
    tableName: 'ledger_entries',
    functionName: 'validate_ledger_reversal',
    fragments: ['before', 'insert', 'update'],
  },
  {
    name: 'plan_versions_immutable',
    tableName: 'plan_versions',
    functionName: 'prevent_plan_mutation',
    fragments: ['before', 'update', 'delete'],
  },
  {
    name: 'plan_versions_validate_insert',
    tableName: 'plan_versions',
    functionName: 'validate_plan_version_insert',
    fragments: ['before insert'],
  },
  {
    name: 'price_check_runs_validate_mutation',
    tableName: 'price_check_runs',
    functionName: 'validate_price_check_run_mutation',
    fragments: ['before', 'insert', 'update', 'delete'],
  },
  {
    name: 'price_observations_immutable',
    tableName: 'price_observations',
    functionName: 'prevent_price_observation_mutation',
    fragments: ['before', 'update', 'delete'],
  },
  {
    name: 'price_observations_validate_insert',
    tableName: 'price_observations',
    functionName: 'validate_price_observation',
    fragments: ['before insert'],
  },
  {
    name: 'price_watch_policies_immutable',
    tableName: 'price_watch_policies',
    functionName: 'prevent_price_watch_policy_mutation',
    fragments: ['before', 'update', 'delete'],
  },
  {
    name: 'product_events_immutable',
    tableName: 'product_events',
    functionName: 'prevent_product_event_mutation',
    fragments: ['before', 'update', 'delete'],
  },
  {
    name: 'purchase_items_validate_update',
    tableName: 'purchase_items',
    functionName: 'validate_purchase_item_update',
    fragments: ['before update'],
  },
  {
    name: 'purchase_timing_assessments_immutable',
    tableName: 'purchase_timing_assessments',
    functionName: 'prevent_purchase_timing_assessment_mutation',
    fragments: ['before', 'update', 'delete'],
  },
  {
    name: 'purchase_timing_assessments_validate_insert',
    tableName: 'purchase_timing_assessments',
    functionName: 'validate_purchase_timing_assessment',
    fragments: ['before insert'],
  },
  {
    name: 'simulated_accounts_validate_plan_evolution',
    tableName: 'simulated_accounts',
    functionName: 'validate_account_plan_evolution',
    fragments: ['before update of plan_version_id'],
  },
  {
    name: 'user_application_clocks_validate_update',
    tableName: 'user_application_clocks',
    functionName: 'validate_user_application_clock_update',
    fragments: ['before update'],
  },
  {
    name: 'users_initialize_application_clock',
    tableName: 'users',
    functionName: 'initialize_user_application_clock',
    fragments: ['after insert'],
  },
];

export const requiredMigrationFunctionNames = [
  'initialize_missing_user_application_clocks',
  'initialize_user_application_clock',
  'prevent_price_observation_mutation',
  'prevent_price_watch_policy_mutation',
  'prevent_product_event_mutation',
  'prevent_purchase_timing_assessment_mutation',
  'simulated_account_available_balance',
  'valid_purchase_timing_seasonal_summary',
  'validate_account_plan_evolution',
  'validate_demo_fixture_user_mutation',
  'validate_goal_draft_update',
  'validate_plan_version_insert',
  'validate_price_check_run_mutation',
  'validate_price_observation',
  'validate_purchase_item_update',
  'validate_purchase_timing_assessment',
  'validate_user_application_clock_update',
] as const;

const requiredFunctionRequirements: readonly FunctionRequirement[] =
  requiredMigrationFunctionNames.map((name) => {
    if (name === 'valid_purchase_timing_seasonal_summary') {
      return {
        name,
        language: 'plpgsql',
        volatility: 'i',
        isStrict: true,
        configuration: [],
      };
    }
    if (name === 'simulated_account_available_balance') {
      return {
        name,
        language: 'sql',
        volatility: 's',
        isStrict: false,
        configuration: ['search_path=public, pg_temp'],
      };
    }
    return {
      name,
      language: 'plpgsql',
      volatility: 'v',
      isStrict: false,
      configuration: [],
    };
  });

const alteredPlanColumnRequirements: readonly ColumnRequirement[] = [
  {
    tableName: 'user_application_clocks',
    columnName: 'financial_run_token',
    dataType: 'text',
    isNotNull: false,
  },
  {
    tableName: 'price_check_runs',
    columnName: 'worker_claim_token',
    dataType: 'text',
    isNotNull: false,
  },
  {
    tableName: 'price_check_runs',
    columnName: 'worker_lease_expires_at',
    dataType: 'timestamp with time zone',
    isNotNull: false,
  },
  {
    tableName: 'user_application_clocks',
    columnName: 'financial_run_expires_at',
    dataType: 'timestamp with time zone',
    isNotNull: false,
  },
  {
    tableName: 'goals',
    columnName: 'archived_at',
    dataType: 'timestamp with time zone',
    isNotNull: false,
  },
  {
    tableName: 'goals',
    columnName: 'archive_reason',
    dataType: 'text',
    isNotNull: false,
  },
  {
    tableName: 'price_observations',
    columnName: 'observation_key',
    dataType: 'text',
    isNotNull: true,
  },
  {
    tableName: 'plan_versions',
    columnName: 'application_date',
    dataType: 'date',
    isNotNull: true,
  },
  {
    tableName: 'plan_versions',
    columnName: 'schedule_anchor_date',
    dataType: 'date',
    isNotNull: true,
  },
  {
    tableName: 'plan_versions',
    columnName: 'calculation_policy_version',
    dataType: 'text',
    isNotNull: true,
    defaultExpression: 'legacy-calculation-v1',
  },
  {
    tableName: 'plan_versions',
    columnName: 'ranking_policy_version',
    dataType: 'text',
    isNotNull: true,
    defaultExpression: 'vehicle-fit-v1',
  },
  {
    tableName: 'plan_versions',
    columnName: 'health_policy_version',
    dataType: 'text',
    isNotNull: true,
    defaultExpression: 'legacy-account-status-v1',
  },
  {
    tableName: 'plan_versions',
    columnName: 'change_kind',
    dataType: 'text',
    isNotNull: true,
    defaultExpression: 'initial_activation',
  },
  {
    tableName: 'plan_versions',
    columnName: 'changed_field',
    dataType: 'text',
    isNotNull: false,
  },
  {
    tableName: 'plan_versions',
    columnName: 'change_reason_code',
    dataType: 'text',
    isNotNull: true,
    defaultExpression: 'INITIAL_ACTIVATION',
  },
  {
    tableName: 'plan_versions',
    columnName: 'change_payload',
    dataType: 'jsonb',
    isNotNull: false,
  },
  {
    tableName: 'plan_versions',
    columnName: 'omitted_contribution_dates',
    dataType: 'date[]',
    isNotNull: true,
    defaultExpression: '{}',
  },
  {
    tableName: 'plan_versions',
    columnName: 'base_plan_version_id',
    dataType: 'text',
    isNotNull: false,
  },
  {
    tableName: 'plan_versions',
    columnName: 'calculation_context',
    dataType: 'jsonb',
    isNotNull: true,
  },
];

const createdInvariantTables = new Set([
  'application_command_claims',
  'demo_fixture_users',
  'goal_drafts',
  'price_check_runs',
  'price_observations',
  'price_watch_policies',
  'product_events',
  'purchase_items',
  'purchase_timing_assessments',
  'user_application_clocks',
]);

export function normalizeSqlMaterial(value: string): string {
  return value
    .toLowerCase()
    .replace(
      /::(?:bigint|boolean|bpchar|character varying|date(?:\[\])?|integer(?:\[\])?|jsonb|numeric|text|timestamp with time zone)/g,
      '',
    )
    .replace(/["'()[\],]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizedDefault(value: string): string {
  return normalizeSqlMaterial(value).replace(/[{}\s]/g, '');
}

function normalizeColumnType(value: string): string {
  const normalized = value.toLowerCase().replace(/\s+/g, ' ').trim();
  if (normalized === 'timestamptz') return 'timestamp with time zone';
  return normalized.replace(/^char\(/, 'character(');
}

function splitTopLevel(source: string): readonly string[] {
  const segments: string[] = [];
  let depth = 0;
  let quote: "'" | '"' | null = null;
  let start = 0;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quote !== null) {
      if (character === quote) {
        if (source[index + 1] === quote) index += 1;
        else quote = null;
      }
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }
    if (character === '(') depth += 1;
    else if (character === ')') depth -= 1;
    else if (character === ',' && depth === 0) {
      segments.push(source.slice(start, index).trim());
      start = index + 1;
    }
  }
  segments.push(source.slice(start).trim());
  return segments.filter((segment) => segment.length > 0);
}

function closingParenthesis(source: string, openingIndex: number): number {
  let depth = 0;
  let quote: "'" | '"' | null = null;
  for (let index = openingIndex; index < source.length; index += 1) {
    const character = source[index];
    if (quote !== null) {
      if (character === quote) {
        if (source[index + 1] === quote) index += 1;
        else quote = null;
      }
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }
    if (character === '(') depth += 1;
    else if (character === ')') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  throw new Error('Unterminated CREATE TABLE definition in an immutable migration.');
}

export function extractCreatedTableColumns(
  migrations: readonly MigrationSource[],
  tableNames: ReadonlySet<string> = createdInvariantTables,
): readonly ColumnRequirement[] {
  const columns: ColumnRequirement[] = [];
  const createTablePattern = /\bCREATE\s+TABLE\s+([a-z_][a-z0-9_]*)\s*\(/gi;
  for (const migration of migrations) {
    createTablePattern.lastIndex = 0;
    for (const match of migration.source.matchAll(createTablePattern)) {
      const tableName = match[1];
      if (tableName === undefined || !tableNames.has(tableName)) continue;
      const openingIndex = match.index + match[0].lastIndexOf('(');
      const body = migration.source.slice(
        openingIndex + 1,
        closingParenthesis(migration.source, openingIndex),
      );
      for (const segment of splitTopLevel(body)) {
        if (/^(?:CHECK|CONSTRAINT|FOREIGN\s+KEY|PRIMARY\s+KEY|UNIQUE)\b/i.test(segment)) continue;
        const columnMatch = /^"?([a-z_][a-z0-9_]*)"?\s+([\s\S]+)$/i.exec(segment);
        const columnName = columnMatch?.[1];
        const definition = columnMatch?.[2];
        if (columnName === undefined || definition === undefined)
          throw new Error(`Cannot parse ${tableName} column material from ${migration.filename}.`);
        const typeMatch =
          /^(.+?)(?=\s+(?:CHECK|DEFAULT|NOT\s+NULL|NULL|PRIMARY\s+KEY|REFERENCES|UNIQUE)\b|$)/i.exec(
            definition,
          );
        const dataType = typeMatch?.[1];
        if (dataType === undefined)
          throw new Error(
            `Cannot parse ${tableName}.${columnName} type from ${migration.filename}.`,
          );
        const defaultMatch =
          /\bDEFAULT\s+(.+?)(?=\s+(?:CHECK|NOT\s+NULL|NULL|PRIMARY\s+KEY|REFERENCES|UNIQUE)\b|$)/i.exec(
            definition,
          );
        const defaultExpression = defaultMatch?.[1];
        const base = {
          tableName,
          columnName,
          dataType: normalizeColumnType(dataType),
          isNotNull: /\bNOT\s+NULL\b|\bPRIMARY\s+KEY\b/i.test(definition),
        };
        columns.push(defaultExpression === undefined ? base : { ...base, defaultExpression });
      }
    }
  }
  return columns;
}

export function extractMigrationFunctionBodies(
  migrations: readonly MigrationSource[],
): ReadonlyMap<string, string> {
  const bodies = new Map<string, string>();
  const functionPattern = /\bCREATE(?:\s+OR\s+REPLACE)?\s+FUNCTION\s+([a-z_][a-z0-9_]*)\s*\(/gi;
  for (const migration of migrations) {
    functionPattern.lastIndex = 0;
    for (const match of migration.source.matchAll(functionPattern)) {
      const name = match[1];
      if (name === undefined) continue;
      const remainder = migration.source.slice(match.index + match[0].length);
      const bodyMarker = /\bAS\s+\$\$/i.exec(remainder);
      if (bodyMarker === null)
        throw new Error(`Cannot find the body of ${name} in ${migration.filename}.`);
      const bodyStart = match.index + match[0].length + bodyMarker.index + bodyMarker[0].length;
      const bodyEnd = migration.source.indexOf('$$', bodyStart);
      if (bodyEnd < 0) throw new Error(`Cannot find the end of ${name} in ${migration.filename}.`);
      bodies.set(name, migration.source.slice(bodyStart, bodyEnd));
    }
  }
  return bodies;
}

export function assertConstraintRequirements(
  rows: readonly ConstraintCatalogRow[],
  requirements: readonly ConstraintRequirement[],
  exactCounts: ReadonlyMap<string, number> = new Map(),
): void {
  for (const [tableName, expectedCount] of exactCounts) {
    const actualCount = rows.filter((row) => row.table_name === tableName).length;
    if (actualCount !== expectedCount) {
      throw new Error(
        `Database constraint count drifted for ${tableName}: expected ${String(expectedCount)}, received ${String(actualCount)}.`,
      );
    }
  }

  const usedConstraints = new Set<string>();
  for (const requirement of requirements) {
    const row = rows.find((candidate) => {
      const key = `${candidate.table_name}.${candidate.constraint_name}`;
      if (usedConstraints.has(key)) return false;
      if (
        candidate.table_name !== requirement.tableName ||
        candidate.constraint_type !== requirement.type ||
        (requirement.name !== undefined && candidate.constraint_name !== requirement.name) ||
        !candidate.is_validated
      )
        return false;
      const definition = normalizeSqlMaterial(candidate.definition);
      return requirement.fragments.every((fragment) =>
        definition.includes(normalizeSqlMaterial(fragment)),
      );
    });
    if (row === undefined) {
      throw new Error(`Required database constraint is missing or drifted: ${requirement.label}.`);
    }
    usedConstraints.add(`${row.table_name}.${row.constraint_name}`);
  }
}

export function assertColumnRequirements(
  rows: readonly ColumnCatalogRow[],
  requirements: readonly ColumnRequirement[],
  exactTables: ReadonlySet<string> = new Set(),
): void {
  for (const tableName of exactTables) {
    const actualNames = rows
      .filter((row) => row.table_name === tableName)
      .map((row) => row.column_name)
      .sort();
    const expectedNames = requirements
      .filter((requirement) => requirement.tableName === tableName)
      .map((requirement) => requirement.columnName)
      .sort();
    if (JSON.stringify(actualNames) !== JSON.stringify(expectedNames))
      throw new Error(`Database column set drifted for ${tableName}.`);
  }

  for (const requirement of requirements) {
    const row = rows.find(
      (candidate) =>
        candidate.table_name === requirement.tableName &&
        candidate.column_name === requirement.columnName,
    );
    const expectedDefault = requirement.defaultExpression;
    if (
      row === undefined ||
      normalizeColumnType(row.data_type) !== normalizeColumnType(requirement.dataType) ||
      row.is_not_null !== requirement.isNotNull ||
      (expectedDefault === undefined
        ? row.column_default !== null
        : row.column_default === null ||
          normalizedDefault(row.column_default) !== normalizedDefault(expectedDefault))
    ) {
      throw new Error(
        `Required database column is missing or drifted: ${requirement.tableName}.${requirement.columnName}.`,
      );
    }
  }
}

export function assertTriggerRequirements(
  rows: readonly TriggerCatalogRow[],
  requirements: readonly TriggerRequirement[],
): void {
  for (const requirement of requirements) {
    const row = rows.find((candidate) => candidate.trigger_name === requirement.name);
    if (
      row?.table_name !== requirement.tableName ||
      row.function_name !== requirement.functionName ||
      !['A', 'O'].includes(row.enabled) ||
      !requirement.fragments.every((fragment) =>
        normalizeSqlMaterial(row.definition).includes(normalizeSqlMaterial(fragment)),
      )
    ) {
      throw new Error(
        `Required database trigger is missing, disabled, or drifted: ${requirement.name}.`,
      );
    }
  }
}

export function assertIndexRequirements(
  rows: readonly IndexCatalogRow[],
  requirements: readonly IndexRequirement[],
): void {
  for (const requirement of requirements) {
    const row = rows.find((candidate) => candidate.index_name === requirement.name);
    if (
      row?.table_name !== requirement.tableName ||
      !requirement.fragments.every((fragment) =>
        normalizeSqlMaterial(row.definition).includes(normalizeSqlMaterial(fragment)),
      )
    ) {
      throw new Error(`Required database index is missing or drifted: ${requirement.name}.`);
    }
  }
}

export function assertFunctionRequirements(
  rows: readonly FunctionCatalogRow[],
  expectedBodies: ReadonlyMap<string, string>,
  requirements: readonly FunctionRequirement[] = requiredFunctionRequirements,
): void {
  for (const requirement of requirements) {
    const matches = rows.filter((row) => row.function_name === requirement.name);
    const row = matches[0];
    const expectedBody = expectedBodies.get(requirement.name);
    const actualConfiguration = [...(row?.configuration ?? [])].sort();
    const expectedConfiguration = [...requirement.configuration].sort();
    if (
      matches.length !== 1 ||
      row === undefined ||
      expectedBody === undefined ||
      normalizeSqlMaterial(row.source) !== normalizeSqlMaterial(expectedBody) ||
      row.language_name !== requirement.language ||
      row.volatility !== requirement.volatility ||
      row.is_strict !== requirement.isStrict ||
      row.security_definer ||
      JSON.stringify(actualConfiguration) !== JSON.stringify(expectedConfiguration)
    ) {
      throw new Error(`Required database function is missing or drifted: ${requirement.name}.`);
    }
  }
}

function calendarDate(value: string | Date): string {
  return typeof value === 'string' ? value : value.toISOString().slice(0, 10);
}

async function loadMigrationSources(): Promise<readonly MigrationSource[]> {
  const filenames = (await readdir(migrationsDirectory))
    .filter((filename) => filename.endsWith('.sql'))
    .sort();
  return Promise.all(
    filenames.map(async (filename) => ({
      filename,
      source: await readFile(path.join(migrationsDirectory, filename), 'utf8'),
    })),
  );
}

export async function verifyDatabase(): Promise<string> {
  const migrationSources = await loadMigrationSources();
  const expectedMigrations = migrationSources.map(({ filename, source }) => ({
    filename,
    checksum: createHash('sha256').update(source).digest('hex'),
  }));
  const database = createDatabaseClient(getDatabaseUrl(), 1);
  try {
    const migrations = await database<{ filename: string; checksum: string }[]>`
      SELECT filename, checksum FROM schema_migrations ORDER BY filename
    `;
    if (JSON.stringify(migrations) !== JSON.stringify(expectedMigrations))
      throw new Error('Applied migrations do not exactly match the ordered migration files.');

    const tables = await database<{ table_name: string }[]>`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' ORDER BY table_name
    `;
    const expectedTables = [...schemaTables, 'schema_migrations'].sort();
    if (JSON.stringify(tables.map((row) => row.table_name)) !== JSON.stringify(expectedTables))
      throw new Error('Public database tables do not exactly match the required local schema.');

    const constraints = await database<ConstraintCatalogRow[]>`
      SELECT relation.relname AS table_name, catalog.conname AS constraint_name,
             catalog.contype::text AS constraint_type,
             pg_get_constraintdef(catalog.oid, true) AS definition,
             catalog.convalidated AS is_validated
      FROM pg_constraint catalog
      JOIN pg_class relation ON relation.oid = catalog.conrelid
      JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = 'public'
      ORDER BY relation.relname, catalog.conname
    `;
    assertConstraintRequirements(
      constraints,
      [...requiredNamedConstraintRequirements, ...newTableConstraintRequirements],
      newTableConstraintCounts,
    );

    const columns = await database<ColumnCatalogRow[]>`
      SELECT relation.relname AS table_name, attribute.attname AS column_name,
             format_type(attribute.atttypid, attribute.atttypmod) AS data_type,
             attribute.attnotnull AS is_not_null,
             pg_get_expr(default_value.adbin, default_value.adrelid) AS column_default
      FROM pg_attribute attribute
      JOIN pg_class relation ON relation.oid = attribute.attrelid
      JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
      LEFT JOIN pg_attrdef default_value
        ON default_value.adrelid = attribute.attrelid
       AND default_value.adnum = attribute.attnum
      WHERE namespace.nspname = 'public'
        AND relation.relkind IN ('p', 'r')
        AND attribute.attnum > 0
        AND NOT attribute.attisdropped
      ORDER BY relation.relname, attribute.attnum
    `;
    const createdTableColumns = extractCreatedTableColumns(migrationSources);
    assertColumnRequirements(
      columns,
      [...createdTableColumns, ...alteredPlanColumnRequirements],
      createdInvariantTables,
    );

    const triggers = await database<TriggerCatalogRow[]>`
      SELECT trigger.tgname AS trigger_name, relation.relname AS table_name,
             procedure.proname AS function_name, trigger.tgenabled::text AS enabled,
             pg_get_triggerdef(trigger.oid, true) AS definition
      FROM pg_trigger trigger
      JOIN pg_class relation ON relation.oid = trigger.tgrelid
      JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
      JOIN pg_proc procedure ON procedure.oid = trigger.tgfoid
      WHERE namespace.nspname = 'public' AND NOT trigger.tgisinternal
      ORDER BY trigger.tgname
    `;
    assertTriggerRequirements(triggers, requiredTriggerRequirements);

    const indexes = await database<IndexCatalogRow[]>`
      SELECT indexname AS index_name, tablename AS table_name, indexdef AS definition
      FROM pg_indexes
      WHERE schemaname = 'public'
      ORDER BY indexname
    `;
    assertIndexRequirements(indexes, requiredIndexRequirements);

    const functions = await database<FunctionCatalogRow[]>`
      SELECT procedure.proname AS function_name, procedure.prosrc AS source,
             language.lanname AS language_name, procedure.provolatile::text AS volatility,
             procedure.proisstrict AS is_strict,
             procedure.prosecdef AS security_definer,
             procedure.proconfig AS configuration
      FROM pg_proc procedure
      JOIN pg_namespace namespace ON namespace.oid = procedure.pronamespace
      JOIN pg_language language ON language.oid = procedure.prolang
      WHERE namespace.nspname = 'public' AND procedure.prokind = 'f'
      ORDER BY procedure.proname
    `;
    assertFunctionRequirements(functions, extractMigrationFunctionBodies(migrationSources));

    const catalog = await database<
      {
        vehicle_code: (typeof illustrativeAssumptions)[number]['vehicleCode'];
        display_name: string;
        assumption_version: string;
        apy_basis_points: number;
        effective_date: string | Date;
        reviewed_date: string | Date;
        source_type: string;
        source_label: string;
        is_live: boolean;
        liquidity_days: number;
        lock_days: number;
        minimum_cents: string;
        enabled: boolean;
      }[]
    >`
      SELECT va.vehicle_code, va.display_name, va.version AS assumption_version,
             va.apy_basis_points, vav.effective_date, vav.reviewed_date, vav.source_type,
             va.source_label, vav.is_live, va.liquidity_days, va.lock_days,
             va.minimum_cents, va.enabled
      FROM vehicle_assumptions va
      JOIN vehicle_assumption_versions vav ON vav.version = va.version
      WHERE va.version = ${catalogVersion}
      ORDER BY CASE va.vehicle_code
        WHEN 'cash' THEN 1 WHEN 'hysa' THEN 2 WHEN 'cd_ladder' THEN 3 ELSE 4 END
    `;
    const storedCatalog = catalog.map((row) => ({
      vehicleCode: row.vehicle_code,
      displayName: row.display_name,
      assumptionVersion: row.assumption_version,
      apyBasisPoints: row.apy_basis_points,
      effectiveDate: calendarDate(row.effective_date),
      reviewedDate: calendarDate(row.reviewed_date),
      sourceType: row.source_type,
      sourceLabel: row.source_label,
      isLive: row.is_live,
      liquidityDays: row.liquidity_days,
      lockDays: row.lock_days,
      minimumCents: Number(row.minimum_cents),
      enabled: row.enabled,
    }));
    if (JSON.stringify(storedCatalog) !== JSON.stringify(illustrativeAssumptions))
      throw new Error('Seeded illustrative assumptions have drifted from the reviewed catalog.');

    const seededPolicies = await database<
      {
        fixture_version: string;
        calculation_policy_version: string;
        ranking_policy_version: string;
        health_policy_version: string;
        analysis_policy_version: string;
      }[]
    >`
      SELECT DISTINCT dfu.fixture_version, pv.calculation_policy_version,
             pv.ranking_policy_version, pv.health_policy_version,
             pwp.analysis_policy_version
      FROM demo_fixture_users dfu
      JOIN goals g ON g.user_id = dfu.user_id
      JOIN plan_versions pv ON pv.goal_id = g.id AND pv.user_id = g.user_id AND pv.version = 1
      JOIN purchase_items pi ON pi.goal_id = g.id AND pi.user_id = g.user_id
      JOIN price_watch_policies pwp
        ON pwp.purchase_item_id = pi.id AND pwp.user_id = pi.user_id
      WHERE dfu.fixture_key = 'japan-trip'
    `;
    const expectedPolicySnapshot = {
      fixture_version: productExperiencePolicyVersion,
      calculation_policy_version: productExperiencePolicyVersion,
      ranking_policy_version: vehicleFitPolicyVersion,
      health_policy_version: planHealthPolicyVersion,
      analysis_policy_version: purchaseTimingPolicyVersion,
    };
    if (
      seededPolicies.length === 0 ||
      seededPolicies.some(
        (policy) => JSON.stringify(policy) !== JSON.stringify(expectedPolicySnapshot),
      )
    )
      throw new Error('Seeded product-experience and Timing Lab policy versions have drifted.');

    const materialConstraintCount =
      requiredNamedConstraintRequirements.length + newTableConstraintRequirements.length;
    const materialColumnCount = createdTableColumns.length + alteredPlanColumnRequirements.length;
    return (
      `Verified ${String(migrations.length)} immutable migrations, ${String(tables.length)} public tables, ` +
      `${String(materialColumnCount)} column definitions, ${String(materialConstraintCount)} constraint definitions, ` +
      `${String(requiredTriggerRequirements.length)} trigger definitions, ` +
      `${String(requiredMigrationFunctionNames.length)} function bodies, ` +
      `${String(requiredIndexRequirements.length)} indexes, ${String(catalog.length)} reviewed assumptions, ` +
      'and the seeded feature-policy versions.\n'
    );
  } finally {
    await database.end();
  }
}

export async function main(): Promise<void> {
  process.stdout.write(await verifyDatabase());
}

function isEntrypoint(): boolean {
  const entry = process.argv[1];
  return entry !== undefined && pathToFileURL(path.resolve(entry)).href === import.meta.url;
}

if (isEntrypoint()) await main();
