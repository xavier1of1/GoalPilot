import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ulid } from 'ulid';

import type { GoalInput } from '@goalpilot/contracts';
import {
  createDatabaseClient,
  GoalPilotRepository,
  ProductExperienceRepository,
  type DatabaseClient,
} from '@goalpilot/data-access';
import { PersistedUserApplicationClock } from '@goalpilot/provider-simulators';
import {
  addCalendarDays,
  compareVehicles,
  generateContributionDates,
  illustrativeAssumptions,
} from '@goalpilot/domain';

import { processDemoAutopilot } from './demo-autopilot.js';

let alexId = '';
const initialDate = '2026-08-23';

describe('controlled Demo Autopilot', () => {
  let database: DatabaseClient;
  let repository: GoalPilotRepository;
  let experienceRepository: ProductExperienceRepository;

  beforeAll(() => {
    process.loadEnvFile('.env.local');
    const url = process.env['TEST_DATABASE_URL'];
    if (url === undefined) throw new Error('TEST_DATABASE_URL is required.');
    database = createDatabaseClient(url, 2);
    repository = new GoalPilotRepository(database);
    experienceRepository = new ProductExperienceRepository(database);
  });

  beforeEach(async () => {
    alexId = ulid();
    await database`
      INSERT INTO users (id, email, display_name, password_hash)
      VALUES (
        ${alexId}, ${`autopilot-${alexId.toLowerCase()}@example.test`},
        'Autopilot integration fixture', 'local-test-password-hash'
      )
    `;
    await expect(experienceRepository.getUserApplicationDate(alexId)).resolves.toMatchObject({
      applicationDate: initialDate,
    });
  });

  afterEach(async () => {
    await expect(repository.deleteAccount(alexId, 'a'.repeat(64))).resolves.toBe(true);
  });

  afterAll(async () => database.end());

  function runAutopilot(targetDate: string) {
    return processDemoAutopilot(repository, targetDate, {
      clock: new PersistedUserApplicationClock(experienceRepository, alexId),
      userId: alexId,
    });
  }

  async function advanceOwnerDate(nextDate: string): Promise<void> {
    const current = await experienceRepository.getUserApplicationDate(alexId);
    if (current === null) throw new Error('The seeded owner clock is unavailable.');
    const updated = await experienceRepository.advanceUserApplicationDate({
      userId: alexId,
      nextDate,
      expectedVersion: current.version,
    });
    if (updated === null) throw new Error('The seeded owner clock changed concurrently.');
  }

  async function activate(goalInput: GoalInput, vehicleCode: 'hysa' | 'cd_ladder') {
    const goal = await repository.createGoal(alexId, goalInput);
    try {
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
    } catch (error) {
      await repository.deleteGoal(alexId, goal.id);
      throw error;
    }
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
      const august = await runAutopilot('2026-08-31');
      expect(august).toMatchObject({
        contributionsPosted: 0,
        interestPostings: 1,
        failures: [],
      });
      const afterAugust = await repository.getAccountSummary(alexId, goal.id);
      expect(afterAugust?.interestEarnedCents).toBeGreaterThan(0);
      expect(august.modeledInterestAddedCents).toBe(afterAugust?.interestEarnedCents);

      const replay = await runAutopilot('2026-08-31');
      expect(replay).toMatchObject({
        contributionsPosted: 0,
        interestPostings: 0,
        purchaseReadyTransitions: 0,
        failures: [],
      });

      await repository.setGoalState(alexId, goal.id, ['active'], 'paused', 'paused', '2026-08-31');
      const pausedAdvance = await runAutopilot('2026-09-30');
      expect(pausedAdvance.contributionsPosted).toBe(0);
      expect(pausedAdvance.interestPostings).toBe(1);
      await repository.setGoalState(alexId, goal.id, ['paused'], 'active', 'resumed', '2026-10-01');
      const resumed = await runAutopilot('2026-10-01');
      expect(resumed.contributionsPosted).toBe(1);

      const activity = await repository.getActivity(alexId, goal.id);
      expect(activity.filter((entry) => entry.type === 'contribution_posted')).toHaveLength(1);
      expect(activity.find((entry) => entry.type === 'contribution_posted')).toMatchObject({
        effectiveDate: '2026-10-01',
      });
      expect(activity.some((entry) => entry.type === 'contribution_scheduled')).toBe(true);
      expect(activity.some((entry) => entry.type === 'interest_accrued')).toBe(true);
    } finally {
      await repository.deleteGoal(alexId, goal.id);
    }
  }, 30_000);

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
      const result = await runAutopilot(maturityDate);
      expect(result).toMatchObject({
        interestPostings: 1,
        modeledInterestAddedCents: 1_097,
        failures: [],
      });
      const summary = await repository.getAccountSummary(alexId, goal.id);
      expect(summary).toMatchObject({
        principalContributedCents: 50_000,
        interestEarnedCents: 1_097,
        currentLedgerBalanceCents: 51_097,
        availableBalanceCents: 0,
      });
      const activity = await repository.getActivity(alexId, goal.id);
      expect(activity.filter((entry) => entry.type === 'interest_posted')).toHaveLength(1);
      const replay = await runAutopilot(maturityDate);
      expect(replay.interestPostings).toBe(0);
    } finally {
      await repository.deleteGoal(alexId, goal.id);
    }
  }, 30_000);

  it('does not advance past a failed final day and repairs it on retry', async () => {
    const goal = await activate(
      {
        name: 'Autopilot final-day recovery fixture',
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
    const original = repository.processScheduledContribution.bind(repository);
    let injected = false;
    repository.processScheduledContribution = async (input) => {
      if (!injected) {
        injected = true;
        throw new Error('Injected final-day contribution failure.');
      }
      return original(input);
    };
    try {
      const first = await runAutopilot('2026-09-23');
      expect(first).toMatchObject({
        toDate: '2026-09-22',
        contributionsPosted: 0,
        failures: [{ goalId: goal.id, message: 'Injected final-day contribution failure.' }],
      });
      await expect(experienceRepository.getUserApplicationDate(alexId)).resolves.toMatchObject({
        applicationDate: '2026-09-22',
      });

      const retry = await runAutopilot('2026-09-23');
      expect(retry).toMatchObject({
        fromDate: '2026-09-22',
        toDate: '2026-09-23',
        contributionsPosted: 1,
        failures: [],
      });
      await expect(experienceRepository.getUserApplicationDate(alexId)).resolves.toMatchObject({
        applicationDate: '2026-09-23',
      });
    } finally {
      repository.processScheduledContribution = original;
      await repository.deleteGoal(alexId, goal.id);
    }
  }, 30_000);

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
      const targetCrossing = await runAutopilot('2026-08-30');
      expect(targetCrossing).toMatchObject({
        contributionsPosted: 1,
        interestPostings: 0,
        failures: [],
      });
      const crossingActivity = await repository.getActivity(alexId, goal.id);
      expect(crossingActivity.some((entry) => entry.type === 'interest_posted')).toBe(false);

      const monthEnd = await runAutopilot('2026-08-31');
      expect(monthEnd).toMatchObject({ interestPostings: 1, failures: [] });
      await expect(repository.getAccountSummary(alexId, goal.id)).resolves.toMatchObject({
        status: 'purchase_ready',
        principalContributedCents: 100_000,
      });
    } finally {
      await repository.deleteGoal(alexId, goal.id);
    }
  }, 30_000);

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
      await runAutopilot('2026-09-23');
      await expect(repository.getAccountSummary(alexId, goal.id)).resolves.toMatchObject({
        status: 'active',
        principalContributedCents: 100_000,
        availableBalanceCents: 0,
        nextContributionDate: null,
      });

      const target = await runAutopilot(goal.targetDate);
      expect(target).toMatchObject({ purchaseReadyTransitions: 1, failures: [] });
      const targetSummary = await repository.getAccountSummary(alexId, goal.id);
      expect(targetSummary).toMatchObject({
        status: 'purchase_ready',
      });
      expect(targetSummary?.availableBalanceCents).toBeGreaterThanOrEqual(100_000);

      await runAutopilot('2027-08-24');
      await expect(repository.getAccountSummary(alexId, goal.id)).resolves.toMatchObject({
        assumptionReviewedDate: '2026-08-23',
        assumptionIsStale: true,
      });
    } finally {
      await repository.deleteGoal(alexId, goal.id);
    }
  }, 30_000);

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
      const target = await runAutopilot(goal.targetDate);
      expect(target).toMatchObject({ purchaseReadyTransitions: 1, failures: [] });
      await expect(repository.getAccountSummary(alexId, goal.id)).resolves.toMatchObject({
        status: 'purchase_ready',
      });
    } finally {
      await repository.deleteGoal(alexId, goal.id);
    }
  }, 30_000);

  it('keeps a late fixed-term lot unavailable until its first post-target maturity', async () => {
    const goal = await activate(
      {
        name: 'Autopilot late fixed lot fixture',
        targetAmountCents: 100_000,
        currentSavedCents: 0,
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
      const lateContributionDate = '2027-07-23';
      const firstMaturityDate = '2028-01-19';
      await advanceOwnerDate(lateContributionDate);
      await repository.postContribution({
        userId: alexId,
        goalId: goal.id,
        amountCents: 100_000,
        effectiveDate: lateContributionDate,
        occurrenceId: `late-lot:${goal.id}`,
        idempotencyKey: `late-lot:${goal.id}`,
        requestHash: `late-lot:${goal.id}:100000`,
        simulateFailure: false,
      });

      const targetRun = await runAutopilot(goal.targetDate);
      expect(targetRun).toMatchObject({ interestPostings: 0, purchaseReadyTransitions: 0 });
      await expect(repository.getAccountSummary(alexId, goal.id)).resolves.toMatchObject({
        status: 'active',
        principalContributedCents: 100_000,
        interestEarnedCents: 0,
        currentLedgerBalanceCents: 100_000,
        availableBalanceCents: 0,
        nextContributionDate: null,
      });

      const maturityRun = await runAutopilot(firstMaturityDate);
      expect(maturityRun).toMatchObject({ interestPostings: 0, purchaseReadyTransitions: 1 });
      await expect(
        repository.getAccountSummary(alexId, goal.id, firstMaturityDate),
      ).resolves.toMatchObject({
        status: 'purchase_ready',
        currentLedgerBalanceCents: 100_000,
        availableBalanceCents: 100_000,
      });
    } finally {
      await repository.deleteGoal(alexId, goal.id);
    }
  }, 30_000);
});
