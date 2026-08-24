import type {
  Clock,
  ContributionProvider,
  GoalAccountProvider,
  HistoricalPriceProvider,
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
import { createHash } from 'node:crypto';
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
  readonly goalVersion: number;
  readonly planVersionId: string;
  readonly apyBasisPoints: number;
  readonly vehicleCode: VehicleCode;
  readonly lockDays: number;
  readonly targetAmountCents: number;
  readonly targetDate: string;
  readonly balanceCents: number;
  readonly ledgerEntryCount: number;
  readonly accruedInterestMicros: number;
  readonly lastAccrualDate: string;
}

interface SimulationMaturityLot {
  readonly sourceEntryId: string;
  readonly principalCents: number;
  readonly currentBalanceCents: number;
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
  listActiveAccounts(
    userId?: string,
    processingDate?: string,
  ): Promise<readonly SimulationActiveAccount[]>;
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
    readonly expectedLastAccrualDate: string;
    readonly expectedAccruedInterestMicros: number;
    readonly expectedBalanceCents: number;
    readonly expectedLedgerEntryCount: number;
  }): Promise<{
    readonly status: 'accrued' | 'already_processed' | 'revision_conflict' | 'inactive';
    readonly purchaseReady: boolean;
  }>;
}

export interface UserApplicationClockStore {
  getUserApplicationDate(userId: string): Promise<{
    readonly applicationDate: string;
    readonly initialApplicationDate: string;
    readonly version: number;
  } | null>;
  advanceUserApplicationDate(input: {
    readonly userId: string;
    readonly nextDate: string;
    readonly expectedVersion: number;
  }): Promise<{
    readonly applicationDate: string;
    readonly initialApplicationDate: string;
    readonly version: number;
  } | null>;
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

/** Owner-scoped controlled clock used by authenticated Story Mode operations. */
export class PersistedUserApplicationClock implements Clock {
  public constructor(
    private readonly store: UserApplicationClockStore,
    private readonly userId: string,
  ) {}

  public async today(): Promise<string> {
    const state = await this.store.getUserApplicationDate(this.userId);
    if (state === null) throw new Error('The user application clock is unavailable.');
    return state.applicationDate;
  }

  public async advanceTo(nextDate: string): Promise<void> {
    const state = await this.store.getUserApplicationDate(this.userId);
    if (state === null) throw new Error('The user application clock is unavailable.');
    if (nextDate < state.applicationDate) {
      throw new RangeError('The controlled clock cannot move backward.');
    }
    const updated = await this.store.advanceUserApplicationDate({
      userId: this.userId,
      nextDate,
      expectedVersion: state.version,
    });
    if (updated === null) {
      throw new Error('The user application clock changed concurrently.');
    }
  }
}

export class StaticRateProvider implements RateProvider {
  public getCatalog(): Promise<readonly VehicleAssumption[]> {
    return Promise.resolve(illustrativeAssumptions);
  }
}

const oledFixtureCode = 'synthetic_oled_65_v1' as const;
const priceFixtureVersion = 'fixture-price-history-2026-08-23-v1';

function utcCalendarDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function createOledPriceHistory(): readonly {
  readonly observationKey: string;
  readonly observedDate: string;
  readonly priceCents: number;
  readonly currency: 'USD';
}[] {
  const observations: {
    observationKey: string;
    observedDate: string;
    priceCents: number;
    currency: 'USD';
  }[] = [];
  const current = new Date(Date.UTC(2024, 7, 23));
  const final = new Date(Date.UTC(2028, 7, 20));
  const seasonalByMonth = [
    12_000, 10_000, 8_000, 6_000, 4_000, 2_000, 3_000, 5_000, 7_000, 2_000, -14_000, -8_000,
  ] as const;
  let index = 0;
  while (current <= final) {
    const seasonal = seasonalByMonth[current.getUTCMonth()] ?? 0;
    const deterministicVariation = ((index * 7_919) % 21_000) - 10_500;
    observations.push({
      observationKey: `oled-day-${String(index + 1).padStart(4, '0')}`,
      observedDate: utcCalendarDate(current),
      priceCents: 159_900 + seasonal + deterministicVariation,
      currency: 'USD',
    });
    current.setUTCDate(current.getUTCDate() + 1);
    index += 1;
  }
  return observations;
}

const oledPriceHistory = createOledPriceHistory();
const oledPriceHistoryChecksum = createHash('sha256')
  .update(JSON.stringify(oledPriceHistory))
  .digest('hex');

export class FixtureHistoricalPriceProvider implements HistoricalPriceProvider {
  public getHistory(input: Parameters<HistoricalPriceProvider['getHistory']>[0]) {
    if (input.fixtureCode !== oledFixtureCode)
      return Promise.reject(
        new RangeError('The requested historical demo fixture is not available.'),
      );
    const observations = oledPriceHistory.filter(
      (observation) => observation.observedDate <= input.asOfDate,
    );
    return Promise.resolve({
      fixtureCode: oledFixtureCode,
      displayDescriptor: '65-inch OLED television' as const,
      currency: 'USD' as const,
      asOfDate: input.asOfDate,
      sourceVersion: priceFixtureVersion,
      sourceChecksum: oledPriceHistoryChecksum,
      sourceType: 'deterministic_fixture' as const,
      isDemoData: true as const,
      observations,
    });
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

  public async processDay(processingDate: string, userId?: string) {
    let interestPostings = 0;
    let modeledInterestAddedCents = 0;
    let purchaseReadyTransitions = 0;
    const failures: { readonly goalId: string; readonly message: string }[] = [];
    const accounts = await this.repository.listActiveAccounts(userId, processingDate);
    accountLoop: for (const initialAccount of accounts) {
      let account = initialAccount;
      try {
        if (account.vehicleCode === 'cd_ladder' || account.vehicleCode === 'treasury_ladder') {
          const lots = await this.repository.listDueMaturityLots(account, processingDate);
          for (const lot of lots) {
            const interestCents = calculateMaturityInterestPosting(
              lot.currentBalanceCents,
              account.apyBasisPoints,
              account.lockDays,
              1,
            );
            const result = await this.repository.postMaturityInterest({
              account,
              lot,
              interestCents,
            });
            if (result.posted) {
              interestPostings += 1;
              modeledInterestAddedCents += interestCents;
            }
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
        let ledgerEntryCount = account.ledgerEntryCount;
        while (lastAccrualDate < processingDate) {
          let revisionConflicts = 0;
          for (;;) {
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
              expectedLastAccrualDate: lastAccrualDate,
              expectedAccruedInterestMicros: accruedInterestMicros,
              expectedBalanceCents: balanceCents,
              expectedLedgerEntryCount: ledgerEntryCount,
            });
            if (result.status === 'revision_conflict') {
              revisionConflicts += 1;
              if (revisionConflicts >= 3) {
                throw new Error('Interest accrual could not obtain a stable financial snapshot.');
              }
              const refreshed = (
                await this.repository.listActiveAccounts(userId, processingDate)
              ).find((candidate) => candidate.accountId === account.accountId);
              if (refreshed === undefined) continue accountLoop;
              account = refreshed;
              lastAccrualDate = refreshed.lastAccrualDate;
              accruedInterestMicros = refreshed.accruedInterestMicros;
              balanceCents = refreshed.balanceCents;
              ledgerEntryCount = refreshed.ledgerEntryCount;
              continue;
            }
            if (result.status !== 'accrued') continue accountLoop;
            ledgerEntryCount += postedCents > 0 ? 2 : 1;
            if (postedCents > 0) {
              interestPostings += 1;
              modeledInterestAddedCents += postedCents;
              balanceCents += postedCents;
            }
            accruedInterestMicros = postingBoundary ? 0 : totalMicros;
            lastAccrualDate = accrualDate;
            if (result.purchaseReady) {
              purchaseReadyTransitions += 1;
              continue accountLoop;
            }
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
    return { interestPostings, modeledInterestAddedCents, purchaseReadyTransitions, failures };
  }
}
