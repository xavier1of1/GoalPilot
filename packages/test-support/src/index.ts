import type { GoalInput } from '@goalpilot/contracts';

export const validGoalFixture: GoalInput = {
  name: 'Japan trip',
  category: 'Travel',
  targetAmountCents: 600_000,
  currentSavedCents: 100_000,
  targetDate: '2027-08-23',
  recurringContributionCents: 45_000,
  contributionCadence: 'monthly',
  liquidityNeed: 'goal_date',
  preservationPreference: 'required',
  confidence: 'expected',
  notes: 'Synthetic fixture',
};
