import { calculateDailyAccrualMicros, calculateMaturityInterestPosting } from '@goalpilot/domain';
import { describe, expect, it, vi } from 'vitest';

import {
  FixtureHistoricalPriceProvider,
  SimulatedInterestProvider,
  type SimulationStore,
} from './index.js';

describe('FixtureHistoricalPriceProvider', () => {
  it('returns deterministic, versioned, demo-only history with no future observations', async () => {
    const provider = new FixtureHistoricalPriceProvider();
    const first = await provider.getHistory({
      fixtureCode: 'synthetic_oled_65_v1',
      asOfDate: '2026-08-23',
    });
    const replay = await provider.getHistory({
      fixtureCode: 'synthetic_oled_65_v1',
      asOfDate: '2026-08-23',
    });

    expect(first).toEqual(replay);
    expect(first.isDemoData).toBe(true);
    expect(first.sourceType).toBe('deterministic_fixture');
    expect(first.observations.length).toBeGreaterThanOrEqual(30);
    expect(first.observations.every((value) => value.observedDate <= '2026-08-23')).toBe(true);
    expect(first.observations.at(-1)?.observedDate).toBe('2026-08-23');
  });

  it('rejects arbitrary fixture identifiers instead of treating them as provider inputs', async () => {
    const provider = new FixtureHistoricalPriceProvider();
    await expect(
      provider.getHistory({
        fixtureCode: 'https://retailer.example/product',
        asOfDate: '2026-08-23',
      }),
    ).rejects.toThrow('not available');
  });

  it('reloads and recalculates daily interest after an authoritative revision conflict', async () => {
    const originalAccount = {
      accountId: '01K3D000000000000000000001',
      userId: '01K3D000000000000000000002',
      goalId: '01K3D000000000000000000003',
      goalVersion: 1,
      planVersionId: '01K3D000000000000000000004',
      apyBasisPoints: 400,
      vehicleCode: 'hysa' as const,
      lockDays: 0,
      targetAmountCents: 100_000,
      targetDate: '2027-08-23',
      balanceCents: 10_000,
      ledgerEntryCount: 1,
      accruedInterestMicros: 0,
      lastAccrualDate: '2026-08-23',
    };
    const refreshedAccount = {
      ...originalAccount,
      goalVersion: 2,
      balanceCents: 20_000,
      ledgerEntryCount: 2,
    };
    const accrueInterestDay = vi
      .fn<SimulationStore['accrueInterestDay']>()
      .mockResolvedValueOnce({ status: 'revision_conflict', purchaseReady: false })
      .mockResolvedValueOnce({ status: 'accrued', purchaseReady: false });
    const listActiveAccounts = vi
      .fn<SimulationStore['listActiveAccounts']>()
      .mockResolvedValueOnce([originalAccount])
      .mockResolvedValueOnce([refreshedAccount]);
    const store: SimulationStore = {
      getApplicationDate: vi.fn(() => Promise.resolve('2026-08-23')),
      setApplicationDate: vi.fn(() => Promise.resolve()),
      activateGoal: vi.fn(() => Promise.resolve(originalAccount.accountId)),
      getAccountSummary: vi.fn(() => Promise.resolve(null)),
      getActivity: vi.fn(() => Promise.resolve([])),
      postContribution: vi.fn(() =>
        Promise.resolve({
          activityId: '01K3D000000000000000000005',
          posted: true,
          duplicate: false,
        }),
      ),
      listActiveAccounts,
      listDueMaturityLots: vi.fn(() => Promise.resolve([])),
      postMaturityInterest: vi.fn(() => Promise.resolve({ posted: false, purchaseReady: false })),
      markPurchaseReadyIfFunded: vi.fn(() => Promise.resolve(false)),
      accrueInterestDay,
    };

    const result = await new SimulatedInterestProvider(store).processDay(
      '2026-08-24',
      originalAccount.userId,
    );

    expect(result.failures).toEqual([]);
    expect(accrueInterestDay).toHaveBeenCalledTimes(2);
    expect(accrueInterestDay).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        expectedBalanceCents: 10_000,
        expectedLedgerEntryCount: 1,
        accrualMicros: calculateDailyAccrualMicros(10_000, 400),
      }),
    );
    expect(accrueInterestDay).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        account: refreshedAccount,
        expectedBalanceCents: 20_000,
        expectedLedgerEntryCount: 2,
        accrualMicros: calculateDailyAccrualMicros(20_000, 400),
      }),
    );
  });

  it('compounds a corrected fixed-term lot from its authoritative current balance', async () => {
    const account = {
      accountId: '01K3D100000000000000000001',
      userId: '01K3D100000000000000000002',
      goalId: '01K3D100000000000000000003',
      goalVersion: 1,
      planVersionId: '01K3D100000000000000000004',
      apyBasisPoints: 450,
      vehicleCode: 'cd_ladder' as const,
      lockDays: 180,
      targetAmountCents: 500_000,
      targetDate: '2028-08-23',
      balanceCents: 100_000,
      ledgerEntryCount: 3,
      accruedInterestMicros: 0,
      lastAccrualDate: '2026-08-23',
    };
    const correctedLot = {
      sourceEntryId: '01K3D100000000000000000005',
      principalCents: 100_000,
      currentBalanceCents: 100_000,
      cycle: 2,
      maturityDate: '2027-08-18',
    };
    const postMaturityInterest = vi.fn<SimulationStore['postMaturityInterest']>(() =>
      Promise.resolve({ posted: true, purchaseReady: false }),
    );
    const store: SimulationStore = {
      getApplicationDate: vi.fn(() => Promise.resolve('2027-08-18')),
      setApplicationDate: vi.fn(() => Promise.resolve()),
      activateGoal: vi.fn(() => Promise.resolve(account.accountId)),
      getAccountSummary: vi.fn(() => Promise.resolve(null)),
      getActivity: vi.fn(() => Promise.resolve([])),
      postContribution: vi.fn(() =>
        Promise.resolve({
          activityId: '01K3D100000000000000000006',
          posted: true,
          duplicate: false,
        }),
      ),
      listActiveAccounts: vi.fn(() => Promise.resolve([account])),
      listDueMaturityLots: vi.fn(() => Promise.resolve([correctedLot])),
      postMaturityInterest,
      markPurchaseReadyIfFunded: vi.fn(() => Promise.resolve(false)),
      accrueInterestDay: vi.fn(() =>
        Promise.resolve({ status: 'inactive' as const, purchaseReady: false }),
      ),
    };

    await new SimulatedInterestProvider(store).processDay(
      correctedLot.maturityDate,
      account.userId,
    );

    const oneCorrectedTerm = calculateMaturityInterestPosting(100_000, 450, 180, 1);
    expect(oneCorrectedTerm).not.toBe(calculateMaturityInterestPosting(100_000, 450, 180, 2));
    expect(postMaturityInterest).toHaveBeenCalledWith({
      account,
      lot: correctedLot,
      interestCents: oneCorrectedTerm,
    });
  });
});
