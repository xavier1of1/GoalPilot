import { describe, expect, it, vi } from 'vitest';

import type { DatabaseClient } from './database.js';
import { PurchaseTimingRepository } from './purchase-timing-repository.js';

function databaseWithTransactionResults(
  results: readonly unknown[],
  queries: string[] = [],
): DatabaseClient {
  const remaining = [...results];
  const query = (first: unknown) => {
    if (Array.isArray(first) && 'raw' in first) {
      queries.push((first as unknown as readonly string[]).join('?'));
      return Promise.resolve(remaining.shift());
    }
    return 'bulk-values';
  };
  const transaction = Object.assign(vi.fn(query), {
    json: vi.fn((value: unknown) => value),
  });
  return Object.assign(vi.fn(query), {
    begin: <T>(callback: (sql: unknown) => Promise<T>) => callback(transaction),
  }) as unknown as DatabaseClient;
}

const baseInput = {
  userId: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
  item: {
    id: '01ARZ3NDEKTSV4RRFFQ69G5FAW',
    goalId: '01ARZ3NDEKTSV4RRFFQ69G5FAX',
    fixtureCode: 'synthetic_oled_65_v1',
    displayName: '65-inch OLED television',
    currency: 'USD',
    targetPriceCents: 150_000,
    lifecycle: 'active',
    version: 1,
    createdAt: '2026-08-23T00:00:00.000Z',
    updatedAt: '2026-08-23T00:00:00.000Z',
  },
  policy: {
    id: '01ARZ3NDEKTSV4RRFFQ69G5FAY',
    purchaseItemId: '01ARZ3NDEKTSV4RRFFQ69G5FAW',
    version: 1,
    cadence: 'weekly',
    nextDueDate: '2026-08-23',
    freshnessLimitDays: 14,
    analysisPolicyVersion: 'purchase-timing-v1',
    enabled: true,
    createdAt: '2026-08-23T00:00:00.000Z',
  },
  runId: '01ARZ3NDEKTSV4RRFFQ69G5FAZ',
  claimToken: '01ARZ3NDEKTSV4RRFFQ69G5FB4',
  applicationDate: '2026-08-23',
  sourceVersion: 'fixture-price-history-2026-08-23-v1',
  sourceChecksum: 'a'.repeat(64),
  observations: [
    {
      observationKey: 'oled-day-0001',
      observedDate: '2026-08-23',
      priceCents: 150_000,
      currency: 'USD',
    },
  ],
  expectedPlan: {
    goalId: '01ARZ3NDEKTSV4RRFFQ69G5FAX',
    goalVersion: 1,
    goalStatus: 'active',
    targetAmountCents: 600_000,
    targetDate: '2027-08-23',
    contributionCadence: 'monthly',
    planVersionId: '01ARZ3NDEKTSV4RRFFQ69G5FB0',
    planVersion: 1,
    vehicleCode: 'hysa',
    normalizedInput: null,
    calculationOutput: null,
    accountStatus: 'active',
    nextContributionDate: '2026-09-23',
    lastProcessedDate: '2026-08-23',
    lastAccrualDate: '2026-08-23',
    accruedInterestMicros: 0,
    ledgerBalanceCents: 100_000,
    ledgerEntryCount: 1,
    availableBalanceCents: 100_000,
  },
  assessment: {
    currentPlanVersionId: '01ARZ3NDEKTSV4RRFFQ69G5FB0',
    currentPlanVersion: 1,
    planLifecycle: 'active',
    planHealth: 'ON_TRACK',
    state: 'INSUFFICIENT_DATA',
    rationaleCodes: ['INSUFFICIENT_OBSERVATION_COUNT'],
    statistics: {
      minimumPriceCents: 150_000,
      medianPriceCents: 150_000,
      maximumPriceCents: 150_000,
      currentPriceCents: 150_000,
      empiricalPercentileBasisPoints: 5_000,
      differenceFromMedianCents: 0,
      differenceFromTargetCents: 0,
      observationCount: 1,
      observationSpanDays: 0,
      freshnessDays: 0,
    },
    seasonal: null,
  },
  nextDueDate: '2026-08-30',
} as const;

describe('purchase timing persistence provenance', () => {
  it('guards Timing mutations, due selection, and fresh claims against terminal owning goals', async () => {
    const mutationQueries: string[] = [];
    const mutationInputs = [
      (repository: PurchaseTimingRepository) =>
        repository.createPurchaseItem({
          userId: baseInput.userId,
          goalId: baseInput.item.goalId,
          fixtureCode: baseInput.item.fixtureCode,
          currency: baseInput.item.currency,
          targetPriceCents: baseInput.item.targetPriceCents,
          idempotencyKey: 'terminal-create',
          requestHash: 'create-hash',
        }),
      (repository: PurchaseTimingRepository) =>
        repository.updatePurchaseItem({
          userId: baseInput.userId,
          itemId: baseInput.item.id,
          expectedVersion: 1,
          targetPriceCents: 149_000,
          idempotencyKey: 'terminal-update',
          requestHash: 'update-hash',
        }),
      (repository: PurchaseTimingRepository) =>
        repository.archivePurchaseItem({
          userId: baseInput.userId,
          itemId: baseInput.item.id,
          expectedVersion: 1,
          idempotencyKey: 'terminal-archive',
          requestHash: 'archive-hash',
        }),
      (repository: PurchaseTimingRepository) =>
        repository.createWatchPolicy({
          userId: baseInput.userId,
          itemId: baseInput.item.id,
          cadence: 'weekly',
          nextDueDate: baseInput.applicationDate,
          enabled: true,
          idempotencyKey: 'terminal-watch',
          requestHash: 'watch-hash',
        }),
    ];
    for (const mutate of mutationInputs) {
      const queries: string[] = [];
      const repository = new PurchaseTimingRepository(
        databaseWithTransactionResults([[], [], []], queries),
      );
      await mutate(repository).catch(() => undefined);
      mutationQueries.push(queries.join('\n'));
    }

    const dueQueries: string[] = [];
    const dueRepository = new PurchaseTimingRepository(
      databaseWithTransactionResults([[]], dueQueries),
    );
    await expect(
      dueRepository.listDuePriceWatches(baseInput.userId, baseInput.applicationDate),
    ).resolves.toEqual([]);

    const claimQueries: string[] = [];
    const claimRepository = new PurchaseTimingRepository(
      databaseWithTransactionResults([[], [], []], claimQueries),
    );
    await expect(
      claimRepository.claimPriceCheck({
        userId: baseInput.userId,
        itemId: baseInput.item.id,
        policyId: baseInput.policy.id,
        applicationDate: baseInput.applicationDate,
      }),
    ).rejects.toThrow('The price watch is not due.');

    for (const query of [...mutationQueries, ...dueQueries, claimQueries.at(-1) ?? '']) {
      expect(query).toContain("status NOT IN ('completed', 'archived')");
    }
  });

  const correctRevisionResults: readonly unknown[] = [
    [
      {
        status: 'claimed',
        fixture_source_version: baseInput.sourceVersion,
        fixture_source_checksum: baseInput.sourceChecksum,
        worker_claim_token: baseInput.claimToken,
      },
    ],
    [{ application_date: baseInput.applicationDate }],
    [{ version: baseInput.item.version, lifecycle: 'active' }],
    [
      {
        id: baseInput.policy.id,
        version: baseInput.policy.version,
        next_due_date: baseInput.policy.nextDueDate,
        enabled: true,
      },
    ],
    [{ version: baseInput.expectedPlan.goalVersion, status: 'active' }],
    [
      {
        id: '01ARZ3NDEKTSV4RRFFQ69G5FB2',
        status: 'active',
        plan_version_id: baseInput.assessment.currentPlanVersionId,
        next_contribution_date: baseInput.expectedPlan.nextContributionDate,
        last_processed_date: baseInput.expectedPlan.lastProcessedDate,
        last_accrual_date: baseInput.expectedPlan.lastAccrualDate,
        accrued_interest_micros: '0',
      },
    ],
    [
      {
        ledger_balance_cents: '100000',
        available_balance_cents: '100000',
        ledger_entry_count: '1',
      },
    ],
  ];

  it.each([
    ['owner clock', 1, [{ application_date: '2026-08-24' }]],
    ['item version', 2, [{ version: 2, lifecycle: 'active' }]],
    ['item lifecycle', 2, [{ version: 1, lifecycle: 'archived' }]],
    [
      'latest policy',
      3,
      [
        {
          id: '01ARZ3NDEKTSV4RRFFQ69G5FB3',
          version: 2,
          next_due_date: '2026-08-30',
          enabled: true,
        },
      ],
    ],
    ['goal version', 4, [{ version: 2, status: 'active' }]],
    ['goal lifecycle', 4, [{ version: 1, status: 'paused' }]],
    [
      'account plan pointer',
      5,
      [
        {
          ...(correctRevisionResults[5] as readonly Record<string, unknown>[])[0],
          plan_version_id: '01ARZ3NDEKTSV4RRFFQ69G5FB1',
        },
      ],
    ],
    [
      'account accrual date',
      5,
      [
        {
          ...(correctRevisionResults[5] as readonly Record<string, unknown>[])[0],
          last_accrual_date: '2026-08-24',
        },
      ],
    ],
    [
      'account accrued micros',
      5,
      [
        {
          ...(correctRevisionResults[5] as readonly Record<string, unknown>[])[0],
          accrued_interest_micros: '1',
        },
      ],
    ],
    [
      'ledger balance',
      6,
      [
        {
          ledger_balance_cents: '100001',
          available_balance_cents: '100000',
          ledger_entry_count: '1',
        },
      ],
    ],
    [
      'ledger row count',
      6,
      [
        {
          ledger_balance_cents: '100000',
          available_balance_cents: '100000',
          ledger_entry_count: '2',
        },
      ],
    ],
    [
      'available balance',
      6,
      [
        {
          ledger_balance_cents: '100000',
          available_balance_cents: '99999',
          ledger_entry_count: '1',
        },
      ],
    ],
  ] as const)('fails closed when the %s changes after assessment', async (_label, index, row) => {
    const results = [...correctRevisionResults];
    results[index] = row;
    const repository = new PurchaseTimingRepository(databaseWithTransactionResults(results));
    await expect(repository.completePriceCheck(baseInput)).rejects.toThrow(
      /changed after this timing assessment was calculated/,
    );
  });

  it('rejects a replay that changes an observation key for an existing source date', async () => {
    const repository = new PurchaseTimingRepository(
      databaseWithTransactionResults([
        [
          {
            status: 'claimed',
            fixture_source_version: baseInput.sourceVersion,
            fixture_source_checksum: baseInput.sourceChecksum,
            worker_claim_token: baseInput.claimToken,
          },
        ],
        [{ application_date: baseInput.applicationDate }],
        [{ version: baseInput.item.version, lifecycle: 'active' }],
        [
          {
            id: baseInput.policy.id,
            version: baseInput.policy.version,
            next_due_date: baseInput.policy.nextDueDate,
            enabled: true,
          },
        ],
        [{ version: baseInput.expectedPlan.goalVersion, status: 'active' }],
        [
          {
            id: '01ARZ3NDEKTSV4RRFFQ69G5FB2',
            status: 'active',
            plan_version_id: baseInput.assessment.currentPlanVersionId,
            next_contribution_date: baseInput.expectedPlan.nextContributionDate,
            last_processed_date: baseInput.expectedPlan.lastProcessedDate,
            last_accrual_date: baseInput.expectedPlan.lastAccrualDate,
            accrued_interest_micros: '0',
          },
        ],
        [
          {
            ledger_balance_cents: '100000',
            available_balance_cents: '100000',
            ledger_entry_count: '1',
          },
        ],
        [
          {
            observation_key: 'different-provider-key',
            observed_on: '2026-08-23',
            price_cents: '150000',
            currency: 'USD',
          },
        ],
      ]),
    );
    await expect(repository.completePriceCheck(baseInput)).rejects.toThrow(
      'A historical observation conflicts with stored data.',
    );
  });

  it('rejects completion from a superseded price-check worker', async () => {
    const results = [...correctRevisionResults];
    results[0] = [
      {
        status: 'claimed',
        fixture_source_version: baseInput.sourceVersion,
        fixture_source_checksum: baseInput.sourceChecksum,
        worker_claim_token: '01ARZ3NDEKTSV4RRFFQ69G5FB5',
      },
    ];
    const repository = new PurchaseTimingRepository(databaseWithTransactionResults(results));

    await expect(repository.completePriceCheck(baseInput)).rejects.toThrow(
      'The price check is not claimable.',
    );
  });

  it('reclaims an expired price-check worker lease with a new generation token', async () => {
    const queries: string[] = [];
    const repository = new PurchaseTimingRepository(
      databaseWithTransactionResults(
        [
          [],
          [
            {
              id: baseInput.runId,
              status: 'claimed',
              fixture_source_version: null,
              fixture_source_checksum: null,
              attempt_count: 1,
              worker_claim_token: baseInput.claimToken,
              worker_lease_active: false,
              error_code: null,
              goal_status: 'active',
            },
          ],
          [{ id: baseInput.runId }],
          [{ id: baseInput.runId }],
        ],
        queries,
      ),
    );

    const reclaimed = await repository.claimPriceCheck({
      userId: baseInput.userId,
      itemId: baseInput.item.id,
      policyId: baseInput.policy.id,
      applicationDate: baseInput.applicationDate,
    });
    expect(reclaimed).toMatchObject({
      runId: baseInput.runId,
      status: 'claimed',
      replayed: false,
      sourceVersion: null,
      sourceChecksum: null,
    });
    expect(reclaimed.claimToken).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(reclaimed.claimToken).not.toBe(baseInput.claimToken);
    expect(queries.join('\n')).toContain('FOR UPDATE OF run');
  });

  it('fails an expired third worker attempt without starting an unbounded retry', async () => {
    const repository = new PurchaseTimingRepository(
      databaseWithTransactionResults([
        [],
        [
          {
            id: baseInput.runId,
            status: 'claimed',
            fixture_source_version: null,
            fixture_source_checksum: null,
            attempt_count: 3,
            worker_claim_token: baseInput.claimToken,
            worker_lease_active: false,
            error_code: null,
            goal_status: 'active',
          },
        ],
        [{ id: baseInput.runId }],
      ]),
    );

    await expect(
      repository.claimPriceCheck({
        userId: baseInput.userId,
        itemId: baseInput.item.id,
        policyId: baseInput.policy.id,
        applicationDate: baseInput.applicationDate,
      }),
    ).resolves.toEqual({
      runId: baseInput.runId,
      status: 'failed',
      claimToken: null,
      replayed: false,
      sourceVersion: null,
      sourceChecksum: null,
      errorCode: 'PROVIDER_FAILURE',
    });
  });

  it('returns the stored safe error code for a terminal failed claim without retrying it', async () => {
    const repository = new PurchaseTimingRepository(
      databaseWithTransactionResults([
        [],
        [
          {
            id: baseInput.runId,
            status: 'failed',
            fixture_source_version: null,
            fixture_source_checksum: null,
            attempt_count: 1,
            worker_claim_token: null,
            worker_lease_active: false,
            error_code: 'FUTURE_OBSERVATION',
            goal_status: 'archived',
          },
        ],
      ]),
    );

    await expect(
      repository.claimPriceCheck({
        userId: baseInput.userId,
        itemId: baseInput.item.id,
        policyId: baseInput.policy.id,
        applicationDate: baseInput.applicationDate,
      }),
    ).resolves.toEqual({
      runId: baseInput.runId,
      status: 'failed',
      claimToken: null,
      replayed: false,
      sourceVersion: null,
      sourceChecksum: null,
      errorCode: 'FUTURE_OBSERVATION',
    });
  });

  it('surfaces the stored error after the bounded retry limit is exhausted', async () => {
    const repository = new PurchaseTimingRepository(
      databaseWithTransactionResults([
        [],
        [
          {
            id: baseInput.runId,
            status: 'failed',
            fixture_source_version: null,
            fixture_source_checksum: null,
            attempt_count: 3,
            worker_claim_token: null,
            worker_lease_active: false,
            error_code: 'CURRENCY_MISMATCH',
            goal_status: 'active',
          },
        ],
        [],
      ]),
    );

    await expect(
      repository.claimPriceCheck({
        userId: baseInput.userId,
        itemId: baseInput.item.id,
        policyId: baseInput.policy.id,
        applicationDate: baseInput.applicationDate,
      }),
    ).resolves.toMatchObject({
      status: 'failed',
      errorCode: 'CURRENCY_MISMATCH',
    });
  });
});
