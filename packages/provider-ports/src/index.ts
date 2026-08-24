import type {
  AccountSummaryDto,
  ActivityDto,
  GoalDto,
  PreviewOutput,
  UserDto,
  VehicleAssumption,
  VehicleCode,
} from '@goalpilot/contracts';

export interface Clock {
  today(): Promise<string>;
  advanceTo(nextDate: string): Promise<void>;
}

export interface AuthProvider {
  register(input: {
    readonly email: string;
    readonly password: string;
    readonly displayName: string;
  }): Promise<UserDto>;
  verify(email: string, password: string): Promise<UserDto | null>;
}

export interface RateProvider {
  getCatalog(asOfDate: string): Promise<readonly VehicleAssumption[]>;
}

export interface GoalAccountProvider {
  open(input: {
    readonly userId: string;
    readonly goal: GoalDto;
    readonly vehicleCode: VehicleCode;
    readonly projection: PreviewOutput;
    readonly asOfDate: string;
    readonly nextContributionDate: string | null;
  }): Promise<{ readonly accountId: string }>;
  summary(userId: string, goalId: string, asOfDate: string): Promise<AccountSummaryDto | null>;
  getActivity(userId: string, goalId: string): Promise<readonly ActivityDto[]>;
}

export interface ContributionProvider {
  post(input: {
    readonly userId: string;
    readonly goalId: string;
    readonly amountCents: number;
    readonly effectiveDate: string;
    readonly occurrenceId: string;
    readonly idempotencyKey: string;
    readonly requestHash: string;
    readonly simulateFailure?: boolean;
  }): Promise<{
    readonly activityId: string;
    readonly posted: boolean;
    readonly duplicate: boolean;
  }>;
}

export interface InterestProvider {
  processDay(
    processingDate: string,
    userId?: string,
  ): Promise<{
    readonly interestPostings: number;
    readonly modeledInterestAddedCents: number;
    readonly purchaseReadyTransitions: number;
    readonly failures: readonly { readonly goalId: string; readonly message: string }[];
  }>;
}

export interface HistoricalPriceObservation {
  readonly observationKey: string;
  readonly observedDate: string;
  readonly priceCents: number;
  readonly currency: 'USD';
}

export interface HistoricalPriceDataset {
  readonly fixtureCode: 'synthetic_oled_65_v1';
  readonly displayDescriptor: '65-inch OLED television';
  readonly currency: 'USD';
  readonly asOfDate: string;
  readonly sourceVersion: string;
  readonly sourceChecksum: string;
  readonly sourceType: 'deterministic_fixture';
  readonly isDemoData: true;
  readonly observations: readonly HistoricalPriceObservation[];
}

export interface HistoricalPriceProvider {
  getHistory(input: {
    readonly fixtureCode: string;
    readonly asOfDate: string;
  }): Promise<HistoricalPriceDataset>;
}
