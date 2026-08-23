import type { DueAccount, GoalPilotRepository } from '@goalpilot/data-access';
import { addCalendarDays, generateContributionDates } from '@goalpilot/domain';
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
  readonly skippedDuplicates: number;
  readonly purchaseReadyTransitions: number;
  readonly failures: readonly { readonly goalId: string; readonly message: string }[];
}

function nextContributionDate(account: DueAccount): string | null {
  const schedule = generateContributionDates(
    account.scheduleAnchorDate,
    account.targetDate,
    account.cadence,
  );
  const currentIndex = schedule.indexOf(account.nextContributionDate);
  return currentIndex < 0 ? null : (schedule[currentIndex + 1] ?? null);
}

export async function processDemoAutopilot(
  repository: GoalPilotRepository,
  targetDate: string,
  dependencies: {
    readonly clock?: Clock;
    readonly interestProvider?: InterestProvider;
  } = {},
): Promise<AutopilotResult> {
  const clock = dependencies.clock ?? new PersistedApplicationClock(repository);
  const interestProvider =
    dependencies.interestProvider ?? new SimulatedInterestProvider(repository);
  const fromDate = await clock.today();
  if (targetDate < fromDate) throw new RangeError('Demo Autopilot cannot move backward.');
  let contributionsPosted = 0;
  let interestPostings = 0;
  let skippedDuplicates = 0;
  let purchaseReadyTransitions = 0;
  const failures: { readonly goalId: string; readonly message: string }[] = [];

  let processingDate = addCalendarDays(fromDate, 1);
  while (processingDate <= targetDate) {
    const dueAccounts = await repository.listDueAccounts(processingDate);
    for (const account of dueAccounts) {
      try {
        const result = await repository.processScheduledContribution({
          account,
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

    const interest = await interestProvider.processDay(processingDate);
    interestPostings += interest.interestPostings;
    purchaseReadyTransitions += interest.purchaseReadyTransitions;
    failures.push(...interest.failures);
    await clock.advanceTo(processingDate);
    processingDate = addCalendarDays(processingDate, 1);
  }

  return {
    fromDate,
    toDate: targetDate,
    contributionsPosted,
    interestPostings,
    skippedDuplicates,
    purchaseReadyTransitions,
    failures,
  };
}
