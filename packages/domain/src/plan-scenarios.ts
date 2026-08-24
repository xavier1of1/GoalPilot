import type { ContributionCadence } from '@goalpilot/contracts';

import { addCalendarMonths, generateContributionDates } from './dates.js';
import type { PlanHealthCode } from './plan-health.js';
import { calculateSafeContribution, type SafeContribution } from './safe-contribution.js';

export interface ZeroInterestPlanInput {
  readonly asOfDate: string;
  readonly scheduleAnchorDate?: string;
  readonly omittedContributionDates?: readonly string[];
  readonly currentSavedCents: number;
  readonly targetAmountCents: number;
  readonly targetDate: string;
  readonly recurringContributionCents: number;
  readonly contributionCadence: ContributionCadence;
}

export type PlanScenario =
  | {
      readonly kind: 'contribution';
      readonly newRecurringContributionCents: number;
    }
  | {
      readonly kind: 'deadline';
      readonly newTargetDate: string;
    }
  | {
      readonly kind: 'target';
      readonly newTargetAmountCents: number;
    }
  | {
      readonly kind: 'missed_contribution';
      readonly contributionDate: string;
    };

export interface ZeroInterestPlanAnalysis {
  readonly contributionDates: readonly string[];
  readonly safeContribution: SafeContribution;
  readonly plannedPersonalContributionsCents: number;
  readonly projectedTargetDateBalanceCents: number;
  readonly cushionCents: number;
  readonly shortfallCents: number;
  readonly projectedPurchaseReadyDate: string | null;
}

export interface ScenarioComparison {
  readonly scenario: PlanScenario;
  readonly current: ZeroInterestPlanAnalysis;
  readonly proposedPlan: ZeroInterestPlanInput;
  readonly proposed: ZeroInterestPlanAnalysis;
  readonly delta: {
    readonly plannedPersonalContributionsCents: number;
    readonly projectedTargetDateBalanceCents: number;
    readonly cushionCents: number;
    readonly shortfallCents: number;
  };
}

export type RecoveryOption =
  | {
      readonly availability: 'available';
      readonly order: 1 | 2 | 3;
      readonly kind: 'contribution' | 'deadline' | 'target';
      readonly scenario: Exclude<PlanScenario, { readonly kind: 'missed_contribution' }>;
      readonly comparison: ScenarioComparison;
      readonly rationaleCode:
        | 'INCREASE_TO_ZERO_INTEREST_SAFE_AMOUNT'
        | 'EXTEND_TO_EARLIEST_CADENCE_DATE'
        | 'REDUCE_TO_HIGHEST_ATTAINABLE_TARGET';
    }
  | {
      readonly availability: 'unavailable';
      readonly order: 1 | 2 | 3;
      readonly kind: 'contribution' | 'deadline' | 'target';
      readonly reasonCode:
        | 'NO_REMAINING_CONTRIBUTIONS'
        | 'CONTRIBUTION_ALREADY_SUFFICIENT'
        | 'ZERO_CONTRIBUTION_CANNOT_RECOVER_BY_EXTENSION'
        | 'DEADLINE_SEARCH_LIMIT_REACHED'
        | 'NO_DEADLINE_EXTENSION_NEEDED'
        | 'ATTAINABLE_TARGET_BELOW_POLICY_MINIMUM'
        | 'TARGET_ALREADY_ATTAINABLE';
    };

export interface RecoveryOptionsInput {
  readonly plan: ZeroInterestPlanInput;
  readonly planHealth: PlanHealthCode;
  readonly maximumDeadlineExtensionMonths?: number;
  readonly minimumTargetAmountCents?: number;
}

function assertCents(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${field} must be a nonnegative safe integer number of cents.`);
  }
}

function assertPlan(plan: ZeroInterestPlanInput): void {
  assertCents(plan.currentSavedCents, 'currentSavedCents');
  assertCents(plan.targetAmountCents, 'targetAmountCents');
  assertCents(plan.recurringContributionCents, 'recurringContributionCents');
}

function analyzePlan(
  plan: ZeroInterestPlanInput,
  omittedContributionDate: string | null = null,
): ZeroInterestPlanAnalysis {
  assertPlan(plan);
  const scheduledDates = generateContributionDates(
    plan.scheduleAnchorDate ?? plan.asOfDate,
    plan.targetDate,
    plan.contributionCadence,
  ).filter((date) => date > plan.asOfDate);
  const omittedDates = new Set(plan.omittedContributionDates ?? []);
  const contributionDates =
    omittedContributionDate === null
      ? scheduledDates.filter((date) => !omittedDates.has(date))
      : scheduledDates.filter(
          (date) => !omittedDates.has(date) && date !== omittedContributionDate,
        );
  const safeContribution = calculateSafeContribution({
    currentSavedCents: plan.currentSavedCents,
    targetAmountCents: plan.targetAmountCents,
    contributionDates,
  });
  const plannedPersonalContributionsCents =
    contributionDates.length * plan.recurringContributionCents;
  const projectedTargetDateBalanceCents =
    plan.currentSavedCents + plannedPersonalContributionsCents;
  if (!Number.isSafeInteger(projectedTargetDateBalanceCents)) {
    throw new RangeError('The projected balance exceeds the supported integer range.');
  }

  let projectedPurchaseReadyDate: string | null =
    plan.currentSavedCents >= plan.targetAmountCents ? plan.asOfDate : null;
  let runningBalanceCents = plan.currentSavedCents;
  if (projectedPurchaseReadyDate === null && plan.recurringContributionCents > 0) {
    for (const date of contributionDates) {
      runningBalanceCents += plan.recurringContributionCents;
      if (runningBalanceCents >= plan.targetAmountCents) {
        projectedPurchaseReadyDate = date;
        break;
      }
    }
  }

  return {
    contributionDates,
    safeContribution,
    plannedPersonalContributionsCents,
    projectedTargetDateBalanceCents,
    cushionCents: Math.max(0, projectedTargetDateBalanceCents - plan.targetAmountCents),
    shortfallCents: Math.max(0, plan.targetAmountCents - projectedTargetDateBalanceCents),
    projectedPurchaseReadyDate,
  };
}

export function analyzeZeroInterestPlan(plan: ZeroInterestPlanInput): ZeroInterestPlanAnalysis {
  return analyzePlan(plan);
}

/** Evaluates one and only one discriminated plan change without mutating the plan. */
export function evaluatePlanScenario(
  plan: ZeroInterestPlanInput,
  scenario: PlanScenario,
): ScenarioComparison {
  assertPlan(plan);
  const current = analyzePlan(plan);
  let proposedPlan: ZeroInterestPlanInput;
  let omittedContributionDate: string | null = null;

  switch (scenario.kind) {
    case 'contribution': {
      assertCents(scenario.newRecurringContributionCents, 'newRecurringContributionCents');
      if (scenario.newRecurringContributionCents === plan.recurringContributionCents) {
        throw new RangeError('A What-If scenario cannot be a no-op.');
      }
      proposedPlan = {
        ...plan,
        recurringContributionCents: scenario.newRecurringContributionCents,
      };
      break;
    }
    case 'deadline': {
      if (scenario.newTargetDate === plan.targetDate) {
        throw new RangeError('A What-If scenario cannot be a no-op.');
      }
      if (scenario.newTargetDate < plan.asOfDate) {
        throw new RangeError('A scenario deadline cannot be before asOfDate.');
      }
      proposedPlan = { ...plan, targetDate: scenario.newTargetDate };
      break;
    }
    case 'target': {
      assertCents(scenario.newTargetAmountCents, 'newTargetAmountCents');
      if (scenario.newTargetAmountCents === plan.targetAmountCents) {
        throw new RangeError('A What-If scenario cannot be a no-op.');
      }
      proposedPlan = { ...plan, targetAmountCents: scenario.newTargetAmountCents };
      break;
    }
    case 'missed_contribution': {
      if (!current.contributionDates.includes(scenario.contributionDate)) {
        throw new RangeError('The missed contribution must name a planned contribution date.');
      }
      proposedPlan = { ...plan };
      omittedContributionDate = scenario.contributionDate;
      break;
    }
  }

  const proposed = analyzePlan(proposedPlan, omittedContributionDate);
  return {
    scenario,
    current,
    proposedPlan,
    proposed,
    delta: {
      plannedPersonalContributionsCents:
        proposed.plannedPersonalContributionsCents - current.plannedPersonalContributionsCents,
      projectedTargetDateBalanceCents:
        proposed.projectedTargetDateBalanceCents - current.projectedTargetDateBalanceCents,
      cushionCents: proposed.cushionCents - current.cushionCents,
      shortfallCents: proposed.shortfallCents - current.shortfallCents,
    },
  };
}

/** Returns the three policy-ordered recovery dimensions and never changes vehicle or risk. */
export function buildRecoveryOptions(input: RecoveryOptionsInput): readonly RecoveryOption[] {
  if (input.planHealth !== 'ATTENTION_NEEDED') return [];
  const maximumDeadlineExtensionMonths = input.maximumDeadlineExtensionMonths ?? 60;
  const minimumTargetAmountCents = input.minimumTargetAmountCents ?? 50_000;
  if (!Number.isSafeInteger(maximumDeadlineExtensionMonths) || maximumDeadlineExtensionMonths < 1) {
    throw new RangeError('maximumDeadlineExtensionMonths must be a positive integer.');
  }
  assertCents(minimumTargetAmountCents, 'minimumTargetAmountCents');

  const analysis = analyzePlan(input.plan);
  const options: RecoveryOption[] = [];

  if (analysis.safeContribution.status === 'no_remaining_occurrences') {
    options.push({
      availability: 'unavailable',
      order: 1,
      kind: 'contribution',
      reasonCode: 'NO_REMAINING_CONTRIBUTIONS',
    });
  } else if (
    analysis.safeContribution.safeContributionCents <= input.plan.recurringContributionCents
  ) {
    options.push({
      availability: 'unavailable',
      order: 1,
      kind: 'contribution',
      reasonCode: 'CONTRIBUTION_ALREADY_SUFFICIENT',
    });
  } else {
    const scenario: PlanScenario & { readonly kind: 'contribution' } = {
      kind: 'contribution',
      newRecurringContributionCents: analysis.safeContribution.safeContributionCents,
    };
    options.push({
      availability: 'available',
      order: 1,
      kind: 'contribution',
      scenario,
      comparison: evaluatePlanScenario(input.plan, scenario),
      rationaleCode: 'INCREASE_TO_ZERO_INTEREST_SAFE_AMOUNT',
    });
  }

  if (input.plan.recurringContributionCents === 0) {
    options.push({
      availability: 'unavailable',
      order: 2,
      kind: 'deadline',
      reasonCode: 'ZERO_CONTRIBUTION_CANNOT_RECOVER_BY_EXTENSION',
    });
  } else {
    const requiredOccurrences = Math.ceil(
      Math.max(0, input.plan.targetAmountCents - input.plan.currentSavedCents) /
        input.plan.recurringContributionCents,
    );
    const searchLimit = addCalendarMonths(input.plan.targetDate, maximumDeadlineExtensionMonths);
    const futureCadenceDates = generateContributionDates(
      input.plan.scheduleAnchorDate ?? input.plan.asOfDate,
      searchLimit,
      input.plan.contributionCadence,
    ).filter(
      (date) =>
        date > input.plan.asOfDate && !(input.plan.omittedContributionDates ?? []).includes(date),
    );
    const earliestDeadline =
      requiredOccurrences === 0 ? input.plan.asOfDate : futureCadenceDates[requiredOccurrences - 1];
    if (earliestDeadline === undefined) {
      options.push({
        availability: 'unavailable',
        order: 2,
        kind: 'deadline',
        reasonCode: 'DEADLINE_SEARCH_LIMIT_REACHED',
      });
    } else if (earliestDeadline <= input.plan.targetDate) {
      options.push({
        availability: 'unavailable',
        order: 2,
        kind: 'deadline',
        reasonCode: 'NO_DEADLINE_EXTENSION_NEEDED',
      });
    } else if (earliestDeadline > searchLimit) {
      options.push({
        availability: 'unavailable',
        order: 2,
        kind: 'deadline',
        reasonCode: 'DEADLINE_SEARCH_LIMIT_REACHED',
      });
    } else {
      const scenario: PlanScenario & { readonly kind: 'deadline' } = {
        kind: 'deadline',
        newTargetDate: earliestDeadline,
      };
      options.push({
        availability: 'available',
        order: 2,
        kind: 'deadline',
        scenario,
        comparison: evaluatePlanScenario(input.plan, scenario),
        rationaleCode: 'EXTEND_TO_EARLIEST_CADENCE_DATE',
      });
    }
  }

  const attainableTargetCents = analysis.projectedTargetDateBalanceCents;
  if (attainableTargetCents >= input.plan.targetAmountCents) {
    options.push({
      availability: 'unavailable',
      order: 3,
      kind: 'target',
      reasonCode: 'TARGET_ALREADY_ATTAINABLE',
    });
  } else if (attainableTargetCents < minimumTargetAmountCents) {
    options.push({
      availability: 'unavailable',
      order: 3,
      kind: 'target',
      reasonCode: 'ATTAINABLE_TARGET_BELOW_POLICY_MINIMUM',
    });
  } else {
    const scenario: PlanScenario & { readonly kind: 'target' } = {
      kind: 'target',
      newTargetAmountCents: attainableTargetCents,
    };
    options.push({
      availability: 'available',
      order: 3,
      kind: 'target',
      scenario,
      comparison: evaluatePlanScenario(input.plan, scenario),
      rationaleCode: 'REDUCE_TO_HIGHEST_ATTAINABLE_TARGET',
    });
  }

  return options;
}
