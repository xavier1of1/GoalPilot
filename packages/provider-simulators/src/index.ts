import type {
  Clock,
  ContributionProvider,
  GoalAccountProvider,
  InterestProvider,
  RateProvider,
} from '@goalpilot/provider-ports';
import type { VehicleAssumption } from '@goalpilot/contracts';
import type { GoalPilotRepository } from '@goalpilot/data-access';
import {
  addCalendarDays,
  calculateDailyAccrualMicros,
  calculateMaturityInterestPosting,
  illustrativeAssumptions,
  isMonthEnd,
  roundAccruedInterestMicros,
} from '@goalpilot/domain';

export class ControlledApplicationClock implements Clock {
  public constructor(private currentDate: string) {}

  public today(): Promise<string> {
    return Promise.resolve(this.currentDate);
  }

  public advanceTo(nextDate: string): Promise<void> {
    if (nextDate < this.currentDate)
      throw new RangeError('The controlled clock cannot move backward.');
    this.currentDate = nextDate;
    return Promise.resolve();
  }
}

export class PersistedApplicationClock implements Clock {
  public constructor(private readonly repository: GoalPilotRepository) {}

  public today(): Promise<string> {
    return this.repository.getApplicationDate();
  }

  public advanceTo(nextDate: string): Promise<void> {
    return this.repository.setApplicationDate(nextDate);
  }
}

export class StaticRateProvider implements RateProvider {
  public getCatalog(): Promise<readonly VehicleAssumption[]> {
    return Promise.resolve(illustrativeAssumptions);
  }
}

export class SimulatedGoalAccountProvider implements GoalAccountProvider {
  public constructor(private readonly repository: GoalPilotRepository) {}

  public async open(input: Parameters<GoalAccountProvider['open']>[0]) {
    return { accountId: await this.repository.activateGoal(input) };
  }

  public summary(userId: string, goalId: string) {
    return this.repository.getAccountSummary(userId, goalId);
  }

  public getActivity(userId: string, goalId: string) {
    return this.repository.getActivity(userId, goalId);
  }
}

export class SimulatedContributionProvider implements ContributionProvider {
  public constructor(private readonly repository: GoalPilotRepository) {}

  public post(input: Parameters<ContributionProvider['post']>[0]) {
    return this.repository.postContribution({
      ...input,
      simulateFailure: input.simulateFailure ?? false,
    });
  }
}

export class SimulatedInterestProvider implements InterestProvider {
  public constructor(private readonly repository: GoalPilotRepository) {}

  public async processDay(processingDate: string) {
    let interestPostings = 0;
    let purchaseReadyTransitions = 0;
    const failures: { readonly goalId: string; readonly message: string }[] = [];
    const accounts = await this.repository.listActiveAccounts();
    for (const account of accounts) {
      try {
        if (account.vehicleCode === 'cd_ladder' || account.vehicleCode === 'treasury_ladder') {
          const lots = await this.repository.listDueMaturityLots(account, processingDate);
          for (const lot of lots) {
            const result = await this.repository.postMaturityInterest({
              account,
              lot,
              interestCents: calculateMaturityInterestPosting(
                lot.principalCents,
                account.apyBasisPoints,
                account.lockDays,
                lot.cycle,
              ),
            });
            if (result.posted) interestPostings += 1;
            if (result.purchaseReady) purchaseReadyTransitions += 1;
          }
          if (await this.repository.markPurchaseReadyIfFunded(account, processingDate))
            purchaseReadyTransitions += 1;
          continue;
        }
        if (account.vehicleCode === 'cash') {
          if (await this.repository.markPurchaseReadyIfFunded(account, processingDate))
            purchaseReadyTransitions += 1;
          continue;
        }

        let lastAccrualDate = account.lastAccrualDate;
        let accruedInterestMicros = account.accruedInterestMicros;
        let balanceCents = account.balanceCents;
        while (lastAccrualDate < processingDate) {
          const accrualDate = addCalendarDays(lastAccrualDate, 1);
          const accrualMicros = calculateDailyAccrualMicros(balanceCents, account.apyBasisPoints);
          const totalMicros = accruedInterestMicros + accrualMicros;
          const postingBoundary =
            isMonthEnd(accrualDate) ||
            accrualDate === account.targetDate ||
            balanceCents >= account.targetAmountCents;
          const postedCents = postingBoundary ? roundAccruedInterestMicros(totalMicros) : 0;
          const result = await this.repository.accrueInterestDay({
            account,
            accrualDate,
            accrualMicros,
            postInterestCents: postedCents,
            postingBoundary,
          });
          if (!result.accrued) break;
          if (postedCents > 0) {
            interestPostings += 1;
            balanceCents += postedCents;
          }
          accruedInterestMicros = postingBoundary ? 0 : totalMicros;
          lastAccrualDate = accrualDate;
          if (result.purchaseReady) {
            purchaseReadyTransitions += 1;
            break;
          }
        }
      } catch (error) {
        failures.push({
          goalId: account.goalId,
          message: error instanceof Error ? error.message : 'Unknown interest failure',
        });
      }
    }
    return { interestPostings, purchaseReadyTransitions, failures };
  }
}
