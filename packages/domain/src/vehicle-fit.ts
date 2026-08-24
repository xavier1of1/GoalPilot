import type { VehicleCode } from '@goalpilot/contracts';

export const vehicleFitPolicyVersion = 'vehicle-fit-v2' as const;

export interface VehicleFitCandidate {
  readonly vehicleCode: VehicleCode;
  readonly eligible: boolean;
  readonly safeContributionPurchaseReadyDate: string | null;
  readonly accessRequirementSatisfied: boolean;
  /** Number of days of remaining lock/access conflict; zero means no conflict. */
  readonly lockConflictDays: number;
  readonly modeledTargetDateBalanceCents: number;
}

export interface VehicleFitRankingInput {
  readonly targetAmountCents: number;
  readonly targetDate: string;
  readonly candidates: readonly VehicleFitCandidate[];
}

export interface RankedVehicleFit extends VehicleFitCandidate {
  readonly policyVersion: typeof vehicleFitPolicyVersion;
  readonly rank: number | null;
  readonly readyByTargetUsingSafeContribution: boolean;
  readonly modeledCushionCents: number;
}

function compareVehicleCode(left: VehicleCode, right: VehicleCode): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function compareBooleansTrueFirst(left: boolean, right: boolean): number {
  return Number(right) - Number(left);
}

function assertCandidate(candidate: VehicleFitCandidate): void {
  if (!Number.isSafeInteger(candidate.lockConflictDays) || candidate.lockConflictDays < 0) {
    throw new RangeError('lockConflictDays must be a nonnegative safe integer.');
  }
  if (
    !Number.isSafeInteger(candidate.modeledTargetDateBalanceCents) ||
    candidate.modeledTargetDateBalanceCents < 0
  ) {
    throw new RangeError(
      'modeledTargetDateBalanceCents must be a nonnegative safe integer number of cents.',
    );
  }
}

/**
 * Assigns ranks under vehicle-fit-v2 while returning every candidate, including
 * cash and explained ineligible models, in the caller's presentation order.
 */
export function rankVehicleFits(input: VehicleFitRankingInput): readonly RankedVehicleFit[] {
  if (!Number.isSafeInteger(input.targetAmountCents) || input.targetAmountCents < 0) {
    throw new RangeError('targetAmountCents must be a nonnegative safe integer number of cents.');
  }
  const seen = new Set<VehicleCode>();
  const results = input.candidates.map((candidate): RankedVehicleFit => {
    assertCandidate(candidate);
    if (seen.has(candidate.vehicleCode)) {
      throw new RangeError(`Duplicate vehicle candidate: ${candidate.vehicleCode}.`);
    }
    seen.add(candidate.vehicleCode);
    return {
      ...candidate,
      policyVersion: vehicleFitPolicyVersion,
      rank: null,
      readyByTargetUsingSafeContribution:
        candidate.safeContributionPurchaseReadyDate !== null &&
        candidate.safeContributionPurchaseReadyDate <= input.targetDate,
      modeledCushionCents: Math.max(
        0,
        candidate.modeledTargetDateBalanceCents - input.targetAmountCents,
      ),
    };
  });

  const ranked = results
    .filter((candidate) => candidate.eligible)
    .sort(
      (left, right) =>
        compareBooleansTrueFirst(
          left.readyByTargetUsingSafeContribution,
          right.readyByTargetUsingSafeContribution,
        ) ||
        compareBooleansTrueFirst(
          left.accessRequirementSatisfied,
          right.accessRequirementSatisfied,
        ) ||
        left.lockConflictDays - right.lockConflictDays ||
        right.modeledCushionCents - left.modeledCushionCents ||
        compareVehicleCode(left.vehicleCode, right.vehicleCode),
    );
  const rankByVehicle = new Map(
    ranked.map((candidate, index) => [candidate.vehicleCode, index + 1] as const),
  );

  return results.map((candidate) => ({
    ...candidate,
    rank: candidate.eligible ? (rankByVehicle.get(candidate.vehicleCode) ?? null) : null,
  }));
}
