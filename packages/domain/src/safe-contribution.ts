export interface SafeContributionInput {
  readonly currentSavedCents: number;
  readonly targetAmountCents: number;
  readonly contributionDates: readonly string[];
}

export type SafeContribution =
  | {
      readonly status: 'already_funded';
      readonly occurrenceCount: 0;
      readonly safeContributionCents: 0;
      readonly projectedBalanceCents: number;
      readonly shortfallCents: 0;
    }
  | {
      readonly status: 'possible';
      readonly occurrenceCount: number;
      readonly safeContributionCents: number;
      readonly projectedBalanceCents: number;
      readonly shortfallCents: 0;
    }
  | {
      readonly status: 'no_remaining_occurrences';
      readonly occurrenceCount: 0;
      readonly safeContributionCents: null;
      readonly projectedBalanceCents: number;
      readonly shortfallCents: number;
    };

function assertCents(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${field} must be a nonnegative safe integer number of cents.`);
  }
}

/**
 * Calculates the recurring contribution that reaches the target without any
 * modeled interest. Contribution dates are supplied by the caller so cadence,
 * calendar anchoring, and deliberately missed occurrences remain explicit.
 */
export function calculateSafeContribution(input: SafeContributionInput): SafeContribution {
  assertCents(input.currentSavedCents, 'currentSavedCents');
  assertCents(input.targetAmountCents, 'targetAmountCents');

  if (input.currentSavedCents >= input.targetAmountCents) {
    return {
      status: 'already_funded',
      occurrenceCount: 0,
      safeContributionCents: 0,
      projectedBalanceCents: input.currentSavedCents,
      shortfallCents: 0,
    };
  }

  const occurrenceCount = input.contributionDates.length;
  const shortfallCents = input.targetAmountCents - input.currentSavedCents;
  if (occurrenceCount === 0) {
    return {
      status: 'no_remaining_occurrences',
      occurrenceCount: 0,
      safeContributionCents: null,
      projectedBalanceCents: input.currentSavedCents,
      shortfallCents,
    };
  }

  const safeContributionCents = Math.ceil(shortfallCents / occurrenceCount);
  const projectedBalanceCents = input.currentSavedCents + safeContributionCents * occurrenceCount;
  if (!Number.isSafeInteger(projectedBalanceCents)) {
    throw new RangeError('The projected balance exceeds the supported integer range.');
  }

  return {
    status: 'possible',
    occurrenceCount,
    safeContributionCents,
    projectedBalanceCents,
    shortfallCents: 0,
  };
}
