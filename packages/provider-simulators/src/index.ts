import type {
  Clock,
  ContributionProvider,
  GoalAccountProvider,
  InterestProvider,
  RateProvider,
} from '@goalpilot/provider-ports';
import type {
  AccountSummaryDto,
  ActivityDto,
  GoalDto,
  PreviewOutput,
  VehicleAssumption,
  VehicleCode,
} from '@goalpilot/contracts';
import {
  addCalendarDays,
  calculateDailyAccrualMicros,
  calculateMaturityInterestPosting,
  illustrativeAssumptions,
  isMonthEnd,
  roundAccruedInterestMicros,
} from '@goalpilot/domain';

interface SimulationActiveAccount {
  readonly accountId: string;
  readonly userId: string;
  readonly goalId: string;
  readonly apyBasisPoints: number;
  readonly vehicleCode: VehicleCode;
  readonly lockDays: number;
  readonly targetAmountCents: number;
  readonly targetDate: string;
  readonly balanceCents: number;
  readonly accruedInterestMicros: number;
  readonly lastAccrualDate: string;
}

interface SimulationMaturityLot {
  readonly sourceEntryId: string;
  readonly principalCents: number;
  readonly cycle: number;
  readonly maturityDate: string;
}

export interface SimulationStore {
  getApplicationDate(): Promise<string>;
  setApplicationDate(currentDate: string): Promise<void>;
  activateGoal(input: {
    readonly userId: string;
    readonly goal: GoalDto;
    readonly vehicleCode: VehicleCode;
    readonly projection: PreviewOutput;
    readonly asOfDate: string;
    readonly nextContributionDate: string | null;
  }): Promise<string>;
  getAccountSummary(
    userId: string,
    goalId: string,
    asOfDate: string,
  ): Promise<AccountSummaryDto | null>;
  getActivity(userId: string, goalId: string): Promise<readonly ActivityDto[]>;
  postContribution(input: {
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
  }>;
  listActiveAccounts(): Promise<readonly SimulationActiveAccount[]>;
  listDueMaturityLots(
    account: SimulationActiveAccount,
    processingDate: string,
  ): Promise<readonly SimulationMaturityLot[]>;
  postMaturityInterest(input: {
    readonly account: SimulationActiveAccount;
    readonly lot: SimulationMaturityLot;
    readonly interestCents: number;
  }): Promise<{ readonly posted: boolean; readonly purchaseReady: boolean }>;
  markPurchaseReadyIfFunded(
    account: SimulationActiveAccount,
    processingDate: string,
  ): Promise<boolean>;
  accrueInterestDay(input: {
    readonly account: SimulationActiveAccount;
    readonly accrualDate: string;
    readonly accrualMicros: number;
    readonly postInterestCents: number;
    readonly postingBoundary: boolean;
  }): Promise<{ readonly accrued: boolean; readonly purchaseReady: boolean }>;
}

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
  public constructor(private readonly repository: SimulationStore) {}

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
  public constructor(private readonly repository: SimulationStore) {}

  public async open(input: Parameters<GoalAccountProvider['open']>[0]) {
    return { accountId: await this.repository.activateGoal(input) };
  }

  public summary(userId: string, goalId: string, asOfDate: string) {
    return this.repository.getAccountSummary(userId, goalId, asOfDate);
  }

  public getActivity(userId: string, goalId: string) {
    return this.repository.getActivity(userId, goalId);
  }
}

export class SimulatedContributionProvider implements ContributionProvider {
  public constructor(private readonly repository: SimulationStore) {}

  public post(input: Parameters<ContributionProvider['post']>[0]) {
    return this.repository.postContribution({
      ...input,
      simulateFailure: input.simulateFailure ?? false,
    });
  }
}

export class SimulatedInterestProvider implements InterestProvider {
  public constructor(private readonly repository: SimulationStore) {}

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
          const postingBoundary = isMonthEnd(accrualDate) || accrualDate === account.targetDate;
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
