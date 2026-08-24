import { describe, expect, it, vi } from 'vitest';

import type { DemoMilestoneContext, DueAccount, GoalPilotRepository } from '@goalpilot/data-access';
import type { Clock, InterestProvider } from '@goalpilot/provider-ports';

import { processDemoAutopilot, resolveDemoAutopilotTarget } from './demo-autopilot.js';

const activeContext: DemoMilestoneContext = {
  goalId: '01K3D000000000000000000001',
  goalVersion: 1,
  targetDate: '2027-09-22',
  accountStatus: 'active',
  nextContributionDate: '2026-10-22',
  nextMaturityDate: null,
  pendingFinancialDate: null,
};

describe('Demo Autopilot recovery', () => {
  it('selects exactly the durable pending day instead of recomputing a relative milestone', () => {
    const context = { ...activeContext, pendingFinancialDate: '2026-09-23' };

    expect(resolveDemoAutopilotTarget('2026-09-22', 'ONE_MONTH', context)).toEqual({
      targetDate: '2026-09-23',
      pendingRecoveryDate: '2026-09-23',
    });
    expect(resolveDemoAutopilotTarget('2026-09-22', 'SIX_MONTHS', context)).toEqual({
      targetDate: '2026-09-23',
      pendingRecoveryDate: '2026-09-23',
    });
    expect(resolveDemoAutopilotTarget('2026-09-22', 'ONE_MONTH', activeContext)).toEqual({
      targetDate: '2026-10-22',
      pendingRecoveryDate: null,
    });
  });

  it('repairs a committed overdue contribution after a pre-clock-advance failure', async () => {
    const dueAccount: DueAccount = {
      accountId: '01K3D000000000000000000002',
      userId: '01K3D000000000000000000003',
      goalId: activeContext.goalId,
      nextContributionDate: '2026-09-20',
      recurringContributionCents: 10_000,
      cadence: 'weekly',
      targetAmountCents: 500_000,
      targetDate: activeContext.targetDate,
      scheduleAnchorDate: '2026-09-20',
      omittedContributionDates: [],
      omitContribution: false,
      apyBasisPoints: 400,
      vehicleCode: 'hysa',
      lastProcessedDate: '2026-09-19',
    };
    let contributionCommitted = false;
    const listDueAccounts = vi.fn(() => Promise.resolve(contributionCommitted ? [] : [dueAccount]));
    const processScheduledContribution = vi.fn(() => {
      contributionCommitted = true;
      return Promise.resolve({ posted: true, purchaseReady: false });
    });
    const repository = {
      listDueAccounts,
      processScheduledContribution,
    } as unknown as GoalPilotRepository;
    let currentDate = '2026-09-22';
    const clock: Clock = {
      today: () => Promise.resolve(currentDate),
      advanceTo: (nextDate) => {
        currentDate = nextDate;
        return Promise.resolve();
      },
    };
    const interestProvider: InterestProvider = {
      processDay: vi.fn(() =>
        Promise.resolve({
          interestPostings: 0,
          modeledInterestAddedCents: 0,
          purchaseReadyTransitions: 0,
          failures: [],
        }),
      ),
    };
    let injectFailure = true;
    const beforeClockAdvance = vi.fn(() => {
      if (injectFailure) {
        injectFailure = false;
        throw new Error('Injected failure after financial commit.');
      }
    });

    await expect(
      processDemoAutopilot(repository, '2026-09-23', {
        clock,
        interestProvider,
        userId: dueAccount.userId,
        beforeClockAdvance,
      }),
    ).rejects.toThrow('Injected failure after financial commit.');
    expect(contributionCommitted).toBe(true);
    expect(currentDate).toBe('2026-09-22');
    expect(processScheduledContribution).toHaveBeenCalledOnce();

    const repaired = await processDemoAutopilot(repository, '2026-09-23', {
      clock,
      interestProvider,
      userId: dueAccount.userId,
      beforeClockAdvance,
    });

    expect(repaired).toMatchObject({
      fromDate: '2026-09-22',
      toDate: '2026-09-23',
      contributionsPosted: 0,
      failures: [],
    });
    expect(currentDate).toBe('2026-09-23');
    expect(listDueAccounts).toHaveBeenNthCalledWith(1, '2026-09-23', dueAccount.userId);
    expect(listDueAccounts).toHaveBeenNthCalledWith(2, '2026-09-23', dueAccount.userId);
    expect(processScheduledContribution).toHaveBeenCalledOnce();
  });
});
