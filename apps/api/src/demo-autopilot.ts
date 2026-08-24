import type { DemoMilestone } from '@goalpilot/contracts';
import type { DemoMilestoneContext, DueAccount, GoalPilotRepository } from '@goalpilot/data-access';
import { addCalendarDays, addCalendarMonths, generateContributionDates } from '@goalpilot/domain';
import type { Clock, InterestProvider } from '@goalpilot/provider-ports';
import {
  PersistedApplicationClock,
  SimulatedInterestProvider,
} from '@goalpilot/provider-simulators';

export interface AutopilotResult {
  readonly fromDate: string;
  readonly toDate: string;
  readonly contributionsPosted: number;
  readonly interestPostings: number;
  readonly modeledInterestAddedCents: number;
  readonly skippedDuplicates: number;
  readonly purchaseReadyTransitions: number;
  readonly failures: readonly { readonly goalId: string; readonly message: string }[];
}

export interface DemoAutopilotTarget {
  readonly targetDate: string | null;
  readonly pendingRecoveryDate: string | null;
}

export function resolveDemoAutopilotTarget(
  applicationDate: string,
  milestone: DemoMilestone,
  context: DemoMilestoneContext,
): DemoAutopilotTarget {
  if (context.pendingFinancialDate !== null && context.pendingFinancialDate > applicationDate) {
    return {
      targetDate: context.pendingFinancialDate,
      pendingRecoveryDate: context.pendingFinancialDate,
    };
  }

  const targetDate =
    milestone === 'NEXT_CONTRIBUTION'
      ? context.nextContributionDate
      : milestone === 'ONE_MONTH'
        ? addCalendarMonths(applicationDate, 1)
        : milestone === 'SIX_MONTHS'
          ? addCalendarMonths(applicationDate, 6)
          : milestone === 'NEXT_MATURITY'
            ? context.nextMaturityDate
            : context.targetDate;
  return { targetDate, pendingRecoveryDate: null };
}

function nextContributionDate(account: DueAccount): string | null {
  const schedule = generateContributionDates(
    account.scheduleAnchorDate,
    account.targetDate,
    account.cadence,
  );
  const currentIndex = schedule.indexOf(account.nextContributionDate);
  if (currentIndex < 0) return null;
  return (
    schedule
      .slice(currentIndex + 1)
      .find((date) => !account.omittedContributionDates.includes(date)) ?? null
  );
}

export async function processDemoAutopilot(
  repository: GoalPilotRepository,
  targetDate: string,
  dependencies: {
    readonly clock?: Clock;
    readonly interestProvider?: InterestProvider;
    readonly userId?: string;
    readonly beforeClockAdvance?: (processingDate: string) => Promise<void> | void;
  } = {},
): Promise<AutopilotResult> {
  const clock = dependencies.clock ?? new PersistedApplicationClock(repository);
  const interestProvider =
    dependencies.interestProvider ?? new SimulatedInterestProvider(repository);
  const fromDate = await clock.today();
  if (targetDate < fromDate) throw new RangeError('Demo Autopilot cannot move backward.');
  let contributionsPosted = 0;
  let interestPostings = 0;
  let modeledInterestAddedCents = 0;
  let skippedDuplicates = 0;
  let purchaseReadyTransitions = 0;
  const failures: { readonly goalId: string; readonly message: string }[] = [];

  let processingDate = addCalendarDays(fromDate, 1);
  while (processingDate <= targetDate) {
    const failuresBeforeDay = failures.length;
    const dueAccounts = await repository.listDueAccounts(processingDate, dependencies.userId);
    for (const account of dueAccounts) {
      try {
        const result = await repository.processScheduledContribution({
          account,
          processingDate,
          nextContributionDate: nextContributionDate(account),
        });
        if (result.posted) contributionsPosted += 1;
        else skippedDuplicates += 1;
        if (result.purchaseReady) purchaseReadyTransitions += 1;
      } catch (error) {
        failures.push({
          goalId: account.goalId,
          message: error instanceof Error ? error.message : 'Unknown processing failure',
        });
      }
    }

    const interest = await interestProvider.processDay(processingDate, dependencies.userId);
    interestPostings += interest.interestPostings;
    modeledInterestAddedCents += interest.modeledInterestAddedCents;
    purchaseReadyTransitions += interest.purchaseReadyTransitions;
    failures.push(...interest.failures);
    if (failures.length > failuresBeforeDay) break;
    await dependencies.beforeClockAdvance?.(processingDate);
    await clock.advanceTo(processingDate);
    processingDate = addCalendarDays(processingDate, 1);
  }

  const completedThroughDate = await clock.today();
  return {
    fromDate,
    toDate: completedThroughDate,
    contributionsPosted,
    interestPostings,
    modeledInterestAddedCents,
    skippedDuplicates,
    purchaseReadyTransitions,
    failures,
  };
}
