import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { GoalInput } from '@goalpilot/contracts';
import {
  createDatabaseClient,
  GoalPilotRepository,
  type DatabaseClient,
} from '@goalpilot/data-access';
import {
  addCalendarDays,
  compareVehicles,
  generateContributionDates,
  illustrativeAssumptions,
} from '@goalpilot/domain';

import { processDemoAutopilot } from './demo-autopilot.js';

const alexId = '01K3C8ALEX0000000000000000';
const initialDate = '2026-08-23';

describe('controlled Demo Autopilot', () => {
  let database: DatabaseClient;
  let repository: GoalPilotRepository;

  beforeAll(() => {
    process.loadEnvFile('.env.local');
    const url = process.env['TEST_DATABASE_URL'];
    if (url === undefined) throw new Error('TEST_DATABASE_URL is required.');
    database = createDatabaseClient(url, 2);
    repository = new GoalPilotRepository(database);
  });

  beforeEach(async () => {
    await database`UPDATE application_clock SET application_date = ${initialDate}`;
  });

  afterAll(async () => database.end());

  async function activate(goalInput: GoalInput, vehicleCode: 'hysa' | 'cd_ladder') {
    const goal = await repository.createGoal(alexId, goalInput);
    const projection = compareVehicles(goal, initialDate, illustrativeAssumptions);
    await repository.activateGoal({
      userId: alexId,
      goal,
      vehicleCode,
      projection,
      asOfDate: initialDate,
      nextContributionDate:
        generateContributionDates(initialDate, goal.targetDate, goal.contributionCadence)[0] ??
        null,
    });
    return goal;
  }

  it('posts deposit interest, honors pause, catches up, and replays the same date safely', async () => {
    const goal = await activate(
      {
        name: 'Autopilot HYSA fixture',
        targetAmountCents: 600_000,
        currentSavedCents: 100_000,
        targetDate: '2027-08-23',
        recurringContributionCents: 45_000,
        contributionCadence: 'monthly',
        liquidityNeed: 'goal_date',
        preservationPreference: 'required',
        confidence: 'expected',
      },
      'hysa',
    );
    try {
      const august = await processDemoAutopilot(repository, '2026-08-31');
      expect(august).toMatchObject({
        contributionsPosted: 0,
        interestPostings: 1,
        failures: [],
      });
      const afterAugust = await repository.getAccountSummary(alexId, goal.id);
      expect(afterAugust?.interestEarnedCents).toBeGreaterThan(0);

      const replay = await processDemoAutopilot(repository, '2026-08-31');
      expect(replay).toMatchObject({
        contributionsPosted: 0,
        interestPostings: 0,
        purchaseReadyTransitions: 0,
        failures: [],
      });

      await repository.setGoalState(alexId, goal.id, ['active'], 'paused', 'paused');
      const pausedAdvance = await processDemoAutopilot(repository, '2026-09-30');
      expect(pausedAdvance.contributionsPosted).toBe(0);
      expect(pausedAdvance.interestPostings).toBe(1);
      await repository.setGoalState(alexId, goal.id, ['paused'], 'active', 'resumed');
      const resumed = await processDemoAutopilot(repository, '2026-10-01');
      expect(resumed.contributionsPosted).toBe(1);

      const activity = await repository.getActivity(alexId, goal.id);
      expect(activity.filter((entry) => entry.type === 'contribution_posted')).toHaveLength(1);
      expect(activity.some((entry) => entry.type === 'contribution_scheduled')).toBe(true);
      expect(activity.some((entry) => entry.type === 'interest_accrued')).toBe(true);
    } finally {
      await repository.deleteGoal(alexId, goal.id);
      await database`UPDATE application_clock SET application_date = ${initialDate}`;
    }
  });

  it('posts fixed-term interest only at a maturity boundary', async () => {
    const maturityDate = addCalendarDays(initialDate, 180);
    const goal = await activate(
      {
        name: 'Autopilot CD fixture',
        targetAmountCents: 1_000_000,
        currentSavedCents: 50_000,
        targetDate: '2027-08-18',
        recurringContributionCents: 0,
        contributionCadence: 'monthly',
        liquidityNeed: 'goal_date',
        preservationPreference: 'required',
        confidence: 'expected',
      },
      'cd_ladder',
    );
    try {
      const result = await processDemoAutopilot(repository, maturityDate);
      expect(result).toMatchObject({ interestPostings: 1, failures: [] });
      const summary = await repository.getAccountSummary(alexId, goal.id);
      expect(summary).toMatchObject({
        principalContributedCents: 50_000,
        interestEarnedCents: 1_097,
        currentLedgerBalanceCents: 51_097,
        availableBalanceCents: 0,
      });
      const activity = await repository.getActivity(alexId, goal.id);
      expect(activity.filter((entry) => entry.type === 'interest_posted')).toHaveLength(1);
      const replay = await processDemoAutopilot(repository, maturityDate);
      expect(replay.interestPostings).toBe(0);
    } finally {
      await repository.deleteGoal(alexId, goal.id);
      await database`UPDATE application_clock SET application_date = ${initialDate}`;
    }
  });

  it('does not post deposit interest when a contribution alone reaches the target', async () => {
    const goal = await activate(
      {
        name: 'Autopilot posting boundary fixture',
        targetAmountCents: 100_000,
        currentSavedCents: 99_999,
        targetDate: '2026-12-31',
        recurringContributionCents: 1,
        contributionCadence: 'weekly',
        liquidityNeed: 'goal_date',
        preservationPreference: 'required',
        confidence: 'expected',
      },
      'hysa',
    );
    try {
      const targetCrossing = await processDemoAutopilot(repository, '2026-08-30');
      expect(targetCrossing).toMatchObject({
        contributionsPosted: 1,
        interestPostings: 0,
        failures: [],
      });
      const crossingActivity = await repository.getActivity(alexId, goal.id);
      expect(crossingActivity.some((entry) => entry.type === 'interest_posted')).toBe(false);

      const monthEnd = await processDemoAutopilot(repository, '2026-08-31');
      expect(monthEnd).toMatchObject({ interestPostings: 1, failures: [] });
      await expect(repository.getAccountSummary(alexId, goal.id)).resolves.toMatchObject({
        status: 'purchase_ready',
        principalContributedCents: 100_000,
      });
    } finally {
      await repository.deleteGoal(alexId, goal.id);
      await database`UPDATE application_clock SET application_date = ${initialDate}`;
    }
  });

  it('keeps funded fixed-term principal locked until the goal date', async () => {
    const goal = await activate(
      {
        name: 'Autopilot fixed lock fixture',
        targetAmountCents: 100_000,
        currentSavedCents: 50_000,
        targetDate: '2027-08-23',
        recurringContributionCents: 50_000,
        contributionCadence: 'monthly',
        liquidityNeed: 'goal_date',
        preservationPreference: 'required',
        confidence: 'expected',
      },
      'cd_ladder',
    );
    try {
      await processDemoAutopilot(repository, '2026-09-23');
      await expect(repository.getAccountSummary(alexId, goal.id)).resolves.toMatchObject({
        status: 'active',
        principalContributedCents: 100_000,
        availableBalanceCents: 0,
        nextContributionDate: null,
      });

      const target = await processDemoAutopilot(repository, goal.targetDate);
      expect(target).toMatchObject({ purchaseReadyTransitions: 1, failures: [] });
      const targetSummary = await repository.getAccountSummary(alexId, goal.id);
      expect(targetSummary).toMatchObject({
        status: 'purchase_ready',
      });
      expect(targetSummary?.availableBalanceCents).toBeGreaterThanOrEqual(100_000);

      await processDemoAutopilot(repository, '2027-08-24');
      await expect(repository.getAccountSummary(alexId, goal.id)).resolves.toMatchObject({
        assumptionReviewedDate: '2026-08-23',
        assumptionIsStale: true,
      });
    } finally {
      await repository.deleteGoal(alexId, goal.id);
      await database`UPDATE application_clock SET application_date = ${initialDate}`;
    }
  });

  it('keeps an already-funded fixed-term opening active until its target date', async () => {
    const goal = await activate(
      {
        name: 'Autopilot funded opening lock fixture',
        targetAmountCents: 100_000,
        currentSavedCents: 100_000,
        targetDate: '2027-08-23',
        recurringContributionCents: 0,
        contributionCadence: 'monthly',
        liquidityNeed: 'goal_date',
        preservationPreference: 'required',
        confidence: 'expected',
      },
      'cd_ladder',
    );
    try {
      await expect(repository.getAccountSummary(alexId, goal.id)).resolves.toMatchObject({
        status: 'active',
        availableBalanceCents: 0,
        nextContributionDate: null,
        projectedCompletionDate: '2027-08-23',
      });
      const target = await processDemoAutopilot(repository, goal.targetDate);
      expect(target).toMatchObject({ purchaseReadyTransitions: 1, failures: [] });
      await expect(repository.getAccountSummary(alexId, goal.id)).resolves.toMatchObject({
        status: 'purchase_ready',
      });
    } finally {
      await repository.deleteGoal(alexId, goal.id);
      await database`UPDATE application_clock SET application_date = ${initialDate}`;
    }
  });
});
