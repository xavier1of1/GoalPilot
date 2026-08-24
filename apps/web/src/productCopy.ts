import type {
  AccountSummaryDto,
  ActivityDto,
  ContributionCadence,
  DemoRunSummary,
  FitRationaleCode,
  GoalDto,
  GoalStatus,
  PlanHealth,
  PlanHealthEvidenceCode,
  PlanRationaleCode,
  PlanVersionSummary,
  PriceCheckRunSummary,
  ProtectionClassification,
  PurchaseTimingState,
  LiquidityNeed,
  RecoveryOption,
  ScenarioChange,
  ScenarioComparison,
  VehicleCode,
  VehicleProjection,
} from '@goalpilot/contracts';

import { formatDate, formatMoney } from './format.js';

export const planHealthCopy: Readonly<Record<PlanHealth, string>> = {
  AHEAD: 'Ahead',
  ON_TRACK: 'On track',
  ATTENTION_NEEDED: 'Needs attention',
  FUNDED_BUT_LOCKED: 'Funded, but not yet available',
  PURCHASE_READY: 'Purchase ready',
  PAUSED: 'Paused',
};

export const vehicleCopy: Readonly<Record<VehicleCode, string>> = {
  cash: 'Plain cash',
  hysa: 'High-yield savings model',
  cd_ladder: 'Certificate ladder model',
  treasury_ladder: 'Treasury-bill ladder model',
};

export const contributionCadenceCopy: Readonly<Record<ContributionCadence, string>> = {
  weekly: 'Weekly',
  biweekly: 'Every two weeks',
  monthly: 'Monthly',
};

export const liquidityNeedCopy: Readonly<Record<LiquidityNeed, string>> = {
  anytime: 'Anytime access',
  within_30_days: 'Access within 30 days',
  goal_date: 'Access by the goal date',
};

export const vehicleRejectionCopy: Readonly<
  Record<NonNullable<VehicleProjection['rejectionCode']>, string>
> = {
  ASSUMPTION_DISABLED: 'This modeled route is disabled.',
  ASSUMPTION_NOT_EFFECTIVE: 'The assumption is not effective for this plan date.',
  ASSUMPTION_STALE: 'The assumption needs review before this route can be selected.',
  LIQUIDITY_CONFLICT: 'This route cannot meet the requested access timing.',
  HORIZON_TOO_SHORT: 'The savings horizon is too short for this route.',
  BELOW_MINIMUM: 'The planned balance does not meet this route’s modeled minimum.',
};

export const vehicleRejectionResolutionCopy: Readonly<
  Record<NonNullable<VehicleProjection['rejectionCode']>, string>
> = {
  ASSUMPTION_DISABLED: 'A reviewed, enabled assumption would need to become available.',
  ASSUMPTION_NOT_EFFECTIVE: 'A reviewed assumption effective for the plan date would be needed.',
  ASSUMPTION_STALE: 'The modeled route would need a newly reviewed assumption.',
  LIQUIDITY_CONFLICT: 'Choose a route with earlier access or change the requested access timing.',
  HORIZON_TOO_SHORT: 'Choose a shorter-term route or move the target date later.',
  BELOW_MINIMUM: 'Choose a route with a lower minimum or raise the planned balance.',
};

export const fitRationaleCopy: Readonly<Record<FitRationaleCode, string>> = {
  ELIGIBLE_ACCESS_FIT:
    'This modeled route fits the requested access timing and the product policy constraints.',
  CASH_BASELINE:
    'This plain-cash model is the zero-interest comparison baseline with anytime access.',
  INELIGIBLE_POLICY: 'This modeled route conflicts with at least one plan constraint.',
};

export const protectionClassificationCopy: Readonly<Record<ProtectionClassification, string>> = {
  SIMULATED_CASH: 'Simulated cash treatment; no real account or protection applies.',
  SIMULATED_DEPOSIT_HELD_AS_MODELED:
    'Modeled deposit treatment; no real deposit account or insurance is provided.',
  SIMULATED_TREASURY_HELD_TO_MATURITY:
    'Modeled held-to-maturity Treasury treatment; no security is purchased.',
};

export const goalStatusCopy: Readonly<Record<GoalStatus, string>> = {
  draft: 'Draft',
  active: 'Active',
  paused: 'Paused',
  purchase_ready: 'Purchase ready',
  completed: 'Completed',
  archived: 'Archived',
};

export const archiveReasonCopy: Readonly<Record<NonNullable<GoalDto['archiveReason']>, string>> = {
  USER_REQUESTED: 'Archived by the user',
  GOAL_COMPLETED: 'Archived after completion',
  NO_LONGER_PURSUED: 'Goal is no longer being pursued',
};

export const accountStatusCopy: Readonly<Record<AccountSummaryDto['status'], string>> = {
  active: 'Active',
  paused: 'Paused',
  purchase_ready: 'Purchase ready',
  completed: 'Completed',
  archived: 'Archived',
};

export const activityTypeCopy: Readonly<Record<ActivityDto['type'], string>> = {
  account_opened: 'Simulated account opened',
  contribution_scheduled: 'Contribution scheduled',
  contribution_posted: 'Contribution posted',
  contribution_failed: 'Contribution not posted',
  interest_accrued: 'Modeled interest accrued',
  interest_posted: 'Modeled interest posted',
  paused: 'Simulation paused',
  resumed: 'Simulation resumed',
  goal_completed: 'Goal marked complete',
  simulated_withdrawal: 'Simulated withdrawal',
  reversal: 'Simulation entry reversed',
};

export const purchaseTimingStateCopy: Readonly<Record<PurchaseTimingState, string>> = {
  INSUFFICIENT_DATA: 'Not enough historical data',
  STALE_DATA: 'Historical data needs a refresh',
  HISTORICALLY_FAVORABLE_PLAN_READY: 'Historically favorable and plan ready',
  HISTORICALLY_FAVORABLE_PLAN_NOT_READY: 'Historically favorable, but plan not ready',
  WATCH: 'Watch the historical range',
  HISTORICALLY_TYPICAL: 'Within the typical historical range',
  HISTORICALLY_ELEVATED: 'Above the typical historical range',
};

export const priceCheckStatusCopy: Readonly<Record<PriceCheckRunSummary['status'], string>> = {
  completed: 'completed',
  failed: 'did not complete',
  in_progress: 'is already in progress',
  replayed: 'replayed the prior result',
  no_due_policies: 'found no price checks due',
};

export const priceCheckErrorCopy: Readonly<
  Record<PriceCheckRunSummary['errorCodes'][number], string>
> = {
  PROVIDER_FAILURE: 'The synthetic price source was unavailable.',
  INVALID_PRICE_BATCH: 'The synthetic price batch was invalid.',
  CURRENCY_MISMATCH: 'The fixture currency did not match.',
  FUTURE_OBSERVATION: 'A future-dated observation was rejected.',
  CONFLICTING_OBSERVATION: 'A conflicting historical observation was rejected.',
  ASSESSMENT_FAILURE: 'The historical assessment could not be created.',
};

export const demoFailureCopy: Readonly<Record<DemoRunSummary['failureCodes'][number], string>> = {
  NO_EVENT_DUE: 'No scheduled event was due.',
  ALREADY_PROCESSED: 'The scheduled event was already processed.',
  CONTRIBUTION_FAILED: 'A simulated contribution could not be posted.',
  LOCKED_UNTIL_MATURITY: 'Simulated funds remain locked until maturity.',
  PROCESSING_FAILED: 'A simulated event could not be processed.',
};

export const planRationaleCopy: Readonly<Record<PlanRationaleCode, string>> = {
  SAFE_CONTRIBUTION_DOES_NOT_DEPEND_ON_INTEREST:
    'The safe contribution is calculated without relying on modeled interest.',
  CHOSEN_CONTRIBUTION_BELOW_SAFE_AMOUNT:
    'The chosen contribution is below the safe contribution, so a shortfall is possible.',
  CHOSEN_CONTRIBUTION_MATCHES_SAFE_AMOUNT:
    'The chosen contribution matches the contribution-only safe amount.',
  CHOSEN_CONTRIBUTION_ABOVE_SAFE_AMOUNT:
    'The chosen contribution is above the safe amount and may create cushion or earlier readiness.',
  SELECTED_VEHICLE_SATISFIES_ACCESS_NEED:
    'The selected model satisfies the access timing you requested.',
  SELECTED_VEHICLE_HAS_MATURITY_LOCK:
    'The selected model includes a maturity lock that is reflected in availability.',
  MODELED_INTEREST_ADDS_CUSHION:
    'Modeled interest adds cushion but does not reduce the personal commitment.',
  MODELED_INTEREST_DOES_NOT_REDUCE_COMMITMENT:
    'The personal commitment stays the same even when modeled interest is shown.',
  READINESS_IS_BEFORE_TARGET: 'Projected purchase readiness is before the target date.',
  READINESS_IS_ON_TARGET: 'Projected purchase readiness is on the target date.',
  READINESS_IS_AFTER_TARGET: 'Projected purchase readiness is after the target date.',
  READINESS_CANNOT_BE_REACHED: 'The current inputs do not produce a projected purchase-ready date.',
};

export const healthEvidenceCopy: Readonly<Record<PlanHealthEvidenceCode, string>> = {
  PLAN_IS_PAUSED: 'The recurring simulation is paused.',
  AVAILABLE_FUNDS_MEET_TARGET: 'Available simulated funds meet the target amount.',
  TOTAL_VALUE_MEETS_TARGET_FUNDS_LOCKED:
    'Total simulated value meets the target, but some funds are not yet available.',
  READINESS_AFTER_TARGET: 'Projected purchase readiness falls after the target date.',
  NO_FEASIBLE_READINESS: 'No feasible purchase-ready date is projected from the current inputs.',
  READINESS_AT_LEAST_ONE_CADENCE_EARLY:
    'Projected readiness is at least one contribution interval early.',
  READINESS_ON_OR_BEFORE_TARGET: 'Projected readiness is on or before the target date.',
};

export const historyReasonCopy: Readonly<Record<PlanVersionSummary['changeReason'], string>> = {
  INITIAL_ACTIVATION: 'Initial activation',
  WHAT_IF_APPLIED: 'What-If change applied',
  RECOVERY_APPLIED: 'Recovery option applied',
};

export const historyDimensionCopy: Readonly<
  Record<NonNullable<PlanVersionSummary['changedDimension']>, string>
> = {
  CONTRIBUTION: 'Recurring contribution',
  DEADLINE: 'Target date',
  TARGET: 'Target amount',
  MISSED_CONTRIBUTION: 'Missed contribution',
};

export const accessConsequenceCopy: Readonly<
  Record<ScenarioComparison['accessConsequence'], string>
> = {
  UNCHANGED: 'Access timing is unchanged.',
  AVAILABLE_LATER: 'Simulated funds become available later.',
  AVAILABLE_EARLIER: 'Simulated funds become available earlier.',
  LOCK_CONFLICT: 'The change would conflict with the requested access timing.',
};

export const recoveryOptionCopy: Readonly<Record<RecoveryOption['optionType'], string>> = {
  CONTRIBUTION_INCREASE: 'Increase the recurring contribution',
  DEADLINE_EXTENSION: 'Extend the target date',
  TARGET_REDUCTION: 'Reduce the target amount',
};

const recoveryRationaleCopy = {
  INCREASE_TO_ZERO_INTEREST_SAFE_AMOUNT:
    'Raises the recurring contribution to the contribution-only safe amount.',
  EXTEND_TO_EARLIEST_CADENCE_DATE:
    'Moves the target to the earliest contribution date that restores the plan.',
  REDUCE_TO_HIGHEST_ATTAINABLE_TARGET:
    'Reduces the target to the highest amount attainable from the current commitment.',
} as const;

const recoveryUnavailableCopy = {
  NO_REMAINING_CONTRIBUTIONS: 'There are no remaining contribution dates to increase.',
  CONTRIBUTION_ALREADY_SUFFICIENT: 'The recurring contribution is already sufficient.',
  ZERO_CONTRIBUTION_CANNOT_RECOVER_BY_EXTENSION:
    'Extending the date cannot recover a plan with no recurring contribution.',
  DEADLINE_SEARCH_LIMIT_REACHED: 'No policy-valid target-date extension was found.',
  NO_DEADLINE_EXTENSION_NEEDED: 'A target-date extension is not needed.',
  ATTAINABLE_TARGET_BELOW_POLICY_MINIMUM:
    'The attainable target would fall below the minimum supported goal.',
  TARGET_ALREADY_ATTAINABLE: 'The current target is already attainable.',
  SELECTED_VEHICLE_DOES_NOT_RESTORE_READINESS:
    'This change does not restore purchase readiness under the selected simulated model.',
} as const;

export function describeScenarioChange(change: ScenarioChange): string {
  if (change.changedDimension === 'CONTRIBUTION')
    return `Set the recurring contribution to ${formatMoney(change.recurringContributionCents)}.`;
  if (change.changedDimension === 'DEADLINE')
    return `Move the target date to ${formatDate(change.targetDate)}.`;
  if (change.changedDimension === 'TARGET')
    return `Set the target amount to ${formatMoney(change.targetAmountCents)}.`;
  return `Skip the planned contribution on ${formatDate(change.missedContributionDate)}.`;
}

export function describeRecoveryRationale(
  option: Extract<RecoveryOption, { availability: 'available' }>,
): string {
  return recoveryRationaleCopy[option.rationaleCode];
}

export function describeUnavailableRecovery(
  option: Extract<RecoveryOption, { availability: 'unavailable' }>,
): string {
  return recoveryUnavailableCopy[option.reasonCode];
}

export function formatSignedMoney(cents: number): string {
  if (cents === 0) return 'No change';
  return `${cents > 0 ? '+' : '-'}${formatMoney(Math.abs(cents))}`;
}
