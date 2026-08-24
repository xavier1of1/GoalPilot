import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import {
  assertColumnRequirements,
  assertConstraintRequirements,
  assertFunctionRequirements,
  assertTriggerRequirements,
  extractCreatedTableColumns,
  extractMigrationFunctionBodies,
  newTableConstraintRequirements,
  requiredMigrationFunctionNames,
  requiredNamedConstraintRequirements,
  type ColumnCatalogRow,
  type ConstraintCatalogRow,
  type FunctionCatalogRow,
  type FunctionRequirement,
  type TriggerCatalogRow,
} from '../scripts/db-verify.js';

const migrationFilenames = [
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
] as const;

async function invariantMigrationSources() {
  return Promise.all(
    migrationFilenames.map(async (filename) => ({
      filename,
      source: await readFile(`packages/data-access/migrations/${filename}`, 'utf8'),
    })),
  );
}

describe('database verifier material assertions', () => {
  it('covers every new table constraint and migrations 010-017 material', () => {
    expect(
      newTableConstraintRequirements.filter(
        (requirement) => requirement.tableName === 'goal_drafts',
      ),
    ).toHaveLength(24);
    expect(
      newTableConstraintRequirements.filter(
        (requirement) => requirement.tableName === 'purchase_timing_assessments',
      ),
    ).toHaveLength(30);
    expect(
      newTableConstraintRequirements.filter(
        (requirement) => requirement.tableName === 'price_observations',
      ),
    ).toHaveLength(8);
    expect(
      newTableConstraintRequirements.filter(
        (requirement) => requirement.tableName === 'application_command_claims',
      ),
    ).toHaveLength(9);
    expect(
      requiredNamedConstraintRequirements.find(
        (requirement) => requirement.name === 'plan_versions_calculation_context_check',
      )?.fragments,
    ).toEqual(expect.arrayContaining(['fixedTermLots', 'totalLedgerValueCents']));
    expect(requiredMigrationFunctionNames).toContain('simulated_account_available_balance');
    expect(
      newTableConstraintRequirements
        .filter(
          (requirement) =>
            requirement.label === 'purchase item owner uniqueness' ||
            requirement.label === 'purchase item goal owner uniqueness',
        )
        .map((requirement) => requirement.name),
    ).toEqual(['purchase_items_id_user_id_key', 'purchase_items_id_goal_id_user_id_key']);
    expect(requiredNamedConstraintRequirements.map((requirement) => requirement.name)).toEqual(
      expect.arrayContaining([
        'goals_archive_provenance_check',
        'price_observations_observation_key_check',
        'price_observations_run_key_unique',
      ]),
    );
  });

  it('extracts all created column shapes and function bodies without a database', async () => {
    const migrations = await invariantMigrationSources();
    const columns = extractCreatedTableColumns(migrations);
    const functions = extractMigrationFunctionBodies(migrations);

    expect(columns).toContainEqual(
      expect.objectContaining({
        tableName: 'application_command_claims',
        columnName: 'state',
        dataType: 'text',
        isNotNull: true,
      }),
    );
    expect(columns).toContainEqual(
      expect.objectContaining({
        tableName: 'purchase_timing_assessments',
        columnName: 'seasonal_summary',
        dataType: 'jsonb',
        isNotNull: false,
      }),
    );
    const requiredNames = new Set<string>(requiredMigrationFunctionNames);
    expect([...functions.keys()].filter((name) => requiredNames.has(name))).toHaveLength(
      requiredMigrationFunctionNames.length,
    );
    expect(functions.get('simulated_account_available_balance')).toContain('available_lots');
  });

  it('rejects a named constraint whose material definition drifted', () => {
    const rows: readonly ConstraintCatalogRow[] = [
      {
        table_name: 'plan_versions',
        constraint_name: 'plan_versions_calculation_context_check',
        constraint_type: 'c',
        definition: "CHECK (calculation_context->>'contextVersion' = 'wrong-version')",
        is_validated: true,
      },
    ];
    const requirement = requiredNamedConstraintRequirements.filter(
      (candidate) => candidate.name === 'plan_versions_calculation_context_check',
    );

    expect(() => assertConstraintRequirements(rows, requirement)).toThrow(
      'missing or drifted: plan_versions_calculation_context_check',
    );
  });

  it('accepts PostgreSQL catalog normalization for terminal plan provenance', () => {
    const rows: readonly ConstraintCatalogRow[] = [
      {
        table_name: 'purchase_timing_assessments',
        constraint_name: 'purchase_timing_assessments_plan_provenance_check',
        constraint_type: 'c',
        definition:
          "CHECK (((plan_lifecycle = 'draft'::text AND plan_version_id IS NULL AND plan_health IS NULL) OR (plan_lifecycle = 'active'::text AND plan_version_id IS NOT NULL AND plan_health IS NOT NULL) OR (plan_lifecycle = ANY (ARRAY['completed'::text, 'archived'::text]) AND plan_version_id IS NOT NULL AND plan_health IS NULL)))",
        is_validated: true,
      },
    ];
    const requirement = requiredNamedConstraintRequirements.filter(
      (candidate) => candidate.name === 'purchase_timing_assessments_plan_provenance_check',
    );

    expect(() => assertConstraintRequirements(rows, requirement)).not.toThrow();
  });

  it('accepts PostgreSQL catalog normalization for terminal worker claims', () => {
    const rows: readonly ConstraintCatalogRow[] = [
      {
        table_name: 'price_check_runs',
        constraint_name: 'price_check_runs_worker_claim_shape_check',
        constraint_type: 'c',
        definition:
          "CHECK (((status = 'claimed'::text AND worker_claim_token ~ '^[0-9A-HJKMNP-TV-Z]{26}$'::text AND worker_lease_expires_at IS NOT NULL) OR (status = ANY (ARRAY['completed'::text, 'failed'::text]) AND worker_claim_token IS NULL AND worker_lease_expires_at IS NULL)))",
        is_validated: true,
      },
    ];
    const requirement = newTableConstraintRequirements.filter(
      (candidate) => candidate.label === 'price run worker claim shape',
    );

    expect(() => assertConstraintRequirements(rows, requirement)).not.toThrow();
  });

  it('rejects nullable or default drift in required columns', () => {
    const rows: readonly ColumnCatalogRow[] = [
      {
        table_name: 'plan_versions',
        column_name: 'calculation_context',
        data_type: 'jsonb',
        is_not_null: false,
        column_default: null,
      },
    ];

    expect(() =>
      assertColumnRequirements(rows, [
        {
          tableName: 'plan_versions',
          columnName: 'calculation_context',
          dataType: 'jsonb',
          isNotNull: true,
        },
      ]),
    ).toThrow('plan_versions.calculation_context');
  });

  it('rejects disabled triggers and altered function bodies', () => {
    const triggerRows: readonly TriggerCatalogRow[] = [
      {
        trigger_name: 'product_events_immutable',
        table_name: 'product_events',
        function_name: 'prevent_product_event_mutation',
        enabled: 'D',
        definition:
          'CREATE TRIGGER product_events_immutable BEFORE UPDATE OR DELETE ON product_events EXECUTE FUNCTION prevent_product_event_mutation()',
      },
    ];
    expect(() =>
      assertTriggerRequirements(triggerRows, [
        {
          name: 'product_events_immutable',
          tableName: 'product_events',
          functionName: 'prevent_product_event_mutation',
          fragments: ['before update or delete'],
        },
      ]),
    ).toThrow('disabled, or drifted');

    const functionRows: readonly FunctionCatalogRow[] = [
      {
        function_name: 'prevent_product_event_mutation',
        source: 'BEGIN RETURN OLD; END;',
        language_name: 'plpgsql',
        volatility: 'v',
        is_strict: false,
        security_definer: false,
        configuration: null,
      },
    ];
    const functionRequirements: readonly FunctionRequirement[] = [
      {
        name: 'prevent_product_event_mutation',
        language: 'plpgsql',
        volatility: 'v',
        isStrict: false,
        configuration: [],
      },
    ];
    expect(() =>
      assertFunctionRequirements(
        functionRows,
        new Map([['prevent_product_event_mutation', "BEGIN RAISE EXCEPTION 'append-only'; END;"]]),
        functionRequirements,
      ),
    ).toThrow('function is missing or drifted');
  });
});
