import type { ContributionCadence } from '@goalpilot/contracts';

import { addCalendarDays, addCalendarMonths } from './dates.js';

export const planHealthPolicyVersion = 'plan-health-v1' as const;

export type PlanHealthCode =
  | 'PAUSED'
  | 'PURCHASE_READY'
  | 'FUNDED_BUT_LOCKED'
  | 'ATTENTION_NEEDED'
  | 'AHEAD'
  | 'ON_TRACK';

export interface PlanHealthInput {
  readonly paused: boolean;
  readonly currentAvailableFundsCents: number;
  readonly currentTotalValueCents: number;
  readonly targetAmountCents: number;
  readonly accessConditionsSatisfied: boolean;
  readonly projectedPurchaseReadyDate: string | null;
  readonly targetDate: string;
  readonly contributionCadence: ContributionCadence;
}

export interface PlanHealth {
  readonly policyVersion: typeof planHealthPolicyVersion;
  readonly code: PlanHealthCode;
  readonly evidenceCodes: readonly string[];
}

function assertCents(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${field} must be a nonnegative safe integer number of cents.`);
  }
}

function oneCadenceBefore(date: string, cadence: ContributionCadence): string {
  if (cadence === 'weekly') return addCalendarDays(date, -7);
  if (cadence === 'biweekly') return addCalendarDays(date, -14);
  return addCalendarMonths(date, -1);
}

/** Applies the complete plan-health-v1 precedence without an opaque score. */
export function derivePlanHealth(input: PlanHealthInput): PlanHealth {
  assertCents(input.currentAvailableFundsCents, 'currentAvailableFundsCents');
  assertCents(input.currentTotalValueCents, 'currentTotalValueCents');
  assertCents(input.targetAmountCents, 'targetAmountCents');

  if (input.paused) {
    return {
      policyVersion: planHealthPolicyVersion,
      code: 'PAUSED',
      evidenceCodes: ['PLAN_IS_PAUSED'],
    };
  }
  if (
    input.currentAvailableFundsCents >= input.targetAmountCents &&
    input.accessConditionsSatisfied
  ) {
    return {
      policyVersion: planHealthPolicyVersion,
      code: 'PURCHASE_READY',
      evidenceCodes: ['AVAILABLE_FUNDS_MEET_TARGET'],
    };
  }
  if (input.currentTotalValueCents >= input.targetAmountCents) {
    return {
      policyVersion: planHealthPolicyVersion,
      code: 'FUNDED_BUT_LOCKED',
      evidenceCodes: ['TOTAL_VALUE_MEETS_TARGET_FUNDS_LOCKED'],
    };
  }
  if (
    input.projectedPurchaseReadyDate === null ||
    input.projectedPurchaseReadyDate > input.targetDate
  ) {
    return {
      policyVersion: planHealthPolicyVersion,
      code: 'ATTENTION_NEEDED',
      evidenceCodes: [
        input.projectedPurchaseReadyDate === null
          ? 'NO_FEASIBLE_READINESS'
          : 'READINESS_AFTER_TARGET',
      ],
    };
  }
  if (
    input.projectedPurchaseReadyDate <=
    oneCadenceBefore(input.targetDate, input.contributionCadence)
  ) {
    return {
      policyVersion: planHealthPolicyVersion,
      code: 'AHEAD',
      evidenceCodes: ['READINESS_AT_LEAST_ONE_CADENCE_EARLY'],
    };
  }
  return {
    policyVersion: planHealthPolicyVersion,
    code: 'ON_TRACK',
    evidenceCodes: ['READINESS_ON_OR_BEFORE_TARGET'],
  };
}
