import { describe, expect, it } from 'vitest';

import type { GoalInput, PreviewOutput } from '@goalpilot/contracts';
import type { PlanExperienceSnapshot } from '@goalpilot/data-access';
import { compareVehicles, illustrativeAssumptions } from '@goalpilot/domain';

import { immutableDecisionSummaryForSnapshot } from './app.js';

const validGoalFixture = {
  name: 'Legacy plan fixture',
  targetAmountCents: 600_000,
  currentSavedCents: 100_000,
  targetDate: '2027-08-23',
  recurringContributionCents: 45_000,
  contributionCadence: 'monthly',
  liquidityNeed: 'goal_date',
  preservationPreference: 'required',
  confidence: 'expected',
} satisfies GoalInput;

describe('pre-product-experience plan compatibility', () => {
  it('derives a deterministic decision summary from the immutable v1 activation snapshot', () => {
    const current = compareVehicles(validGoalFixture, '2026-08-23', illustrativeAssumptions);
    const legacyProjection = {
      asOfDate: current.asOfDate,
      zeroInterestBaseline: current.zeroInterestBaseline,
      vehicles: current.vehicles.map((vehicle) => ({
        vehicleCode: vehicle.vehicleCode,
        displayName: vehicle.displayName,
        eligible: vehicle.eligible,
        rejectionCode: vehicle.rejectionCode,
        rejectionMessage: vehicle.rejectionMessage,
        // This fixture deliberately emulates the deprecated M18 response shape.
        // eslint-disable-next-line @typescript-eslint/no-deprecated
        requiredContributionCents: vehicle.requiredContributionCents,
        plannedContributionCents: vehicle.plannedContributionCents,
        principalContributedCents: vehicle.principalContributedCents,
        modeledInterestCents: vehicle.modeledInterestCents,
        endingBalanceCents: vehicle.endingBalanceCents,
        shortfallCents: vehicle.shortfallCents,
        surplusCents: vehicle.surplusCents,
        projectedCompletionDate: vehicle.projectedCompletionDate,
        accessSummary: vehicle.accessSummary,
        assumption: vehicle.assumption,
      })),
      recommendedVehicleCode: current.recommendedVehicleCode,
      disclosure: current.disclosure,
    } as unknown as PreviewOutput;
    const snapshot = {
      normalizedInput: validGoalFixture,
      projection: legacyProjection,
      vehicleCode: 'hysa',
      applicationDate: '2026-08-23',
      scheduleAnchorDate: '2026-08-23',
      omittedContributionDates: [],
      storedDecisionSummary: null,
    } as unknown as PlanExperienceSnapshot;

    expect(immutableDecisionSummaryForSnapshot(snapshot)).toMatchObject({
      safeContributionCents: 41_667,
      chosenContributionCents: 45_000,
      currentSavingsCents: 100_000,
      postedPersonalContributionsCents: 0,
      postedModeledInterestCents: 0,
      currentTotalValueCents: 100_000,
      currentAvailableFundsCents: 100_000,
      vehicleCode: 'hysa',
      calculationPolicyVersion: 'product-experience-v1',
      rankingPolicyVersion: 'vehicle-fit-v2',
    });
  });
});
