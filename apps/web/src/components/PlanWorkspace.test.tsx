// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  AccountSummaryDto,
  GoalDto,
  PlanDecisionSummary,
  PlanHistoryOutput,
} from '@goalpilot/contracts';

import { api } from '../api.js';
import { PlanWorkspace } from './PlanWorkspace.js';

const goal: GoalDto = {
  id: '01TESTGOAL0000000000000000',
  name: 'Japan trip',
  targetAmountCents: 600_000,
  currentSavedCents: 100_000,
  targetDate: '2028-02-23',
  recurringContributionCents: 30_000,
  contributionCadence: 'monthly',
  liquidityNeed: 'within_30_days',
  preservationPreference: 'required',
  confidence: 'expected',
  status: 'active',
  version: 1,
  archivedAt: null,
  archiveReason: null,
  createdAt: '2026-08-23T00:00:00.000Z',
  updatedAt: '2026-08-23T00:00:00.000Z',
};

const account: AccountSummaryDto = {
  id: '01TESTACCOUNT00000000000000',
  goalId: goal.id,
  status: 'active',
  vehicleCode: 'hysa',
  principalContributedCents: 100_000,
  interestEarnedCents: 0,
  currentLedgerBalanceCents: 100_000,
  principalCompositionBasisPoints: 10_000,
  availableBalanceCents: 100_000,
  pendingContributionCents: 0,
  nextContributionDate: '2026-09-23',
  currentIllustrativeApyBasisPoints: 400,
  progressPercent: 16.67,
  projectedCompletionDate: '2028-01-23',
  assumptionVersion: 'demo-2026-08-v1',
  assumptionReviewedDate: '2026-08-23',
  assumptionIsStale: false,
};

const summary: PlanDecisionSummary = {
  safeContributionCents: 27_778,
  chosenContributionCents: 30_000,
  contributionCadence: 'monthly',
  currentSavingsCents: 100_000,
  postedPersonalContributionsCents: 0,
  postedModeledInterestCents: 0,
  currentTotalValueCents: 100_000,
  currentAvailableFundsCents: 100_000,
  futurePersonalContributionsCents: 540_000,
  futureModeledInterestCents: 10_000,
  projectedTargetDateBalanceCents: 650_000,
  cushionCents: 50_000,
  shortfallCents: 0,
  projectedReadinessDate: '2028-01-23',
  vehicleCode: 'hysa',
  assumptionVersion: 'demo-2026-08-v1',
  calculationPolicyVersion: 'product-experience-v1',
  rankingPolicyVersion: 'vehicle-fit-v2',
  rationaleVersion: 'product-experience-v1',
  rationaleCodes: [
    'SAFE_CONTRIBUTION_DOES_NOT_DEPEND_ON_INTEREST',
    'CHOSEN_CONTRIBUTION_ABOVE_SAFE_AMOUNT',
  ],
  health: 'ON_TRACK',
};

const scenarioComparison = {
  changedDimension: 'CONTRIBUTION' as const,
  current: summary,
  proposed: { ...summary, chosenContributionCents: 32_500 },
  personalContributionChangeCents: 45_000,
  modeledInterestChangeCents: 1_250,
  targetDateBalanceChangeCents: 46_250,
  cushionChangeCents: 46_250,
  accessConsequence: 'UNCHANGED' as const,
};

const history: PlanHistoryOutput = {
  goalId: goal.id,
  currentGoalVersion: 1,
  versions: [
    {
      id: '01TESTVERSION00000000000000',
      version: 1,
      activatedDate: '2026-08-23',
      appliedAt: '2026-08-23T00:00:00.000Z',
      changedDimension: null,
      change: null,
      basePlanVersionId: null,
      changeReason: 'INITIAL_ACTIVATION',
      calculationPolicyVersion: 'product-experience-v1',
      assumptionVersion: 'demo-2026-08-v1',
      fromRecovery: false,
      summary,
    },
  ],
};

describe('consumer plan workspace', () => {
  afterEach(cleanup);

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(api, 'capabilities').mockResolvedValue({
      demoStory: false,
      purchaseTimingLab: false,
      applicationDate: '2026-08-23',
    });
    vi.spyOn(api, 'planSummary').mockResolvedValue(summary);
    vi.spyOn(api, 'planHealth').mockResolvedValue({
      health: 'ON_TRACK',
      policyVersion: 'plan-health-v1',
      evidenceCodes: ['READINESS_ON_OR_BEFORE_TARGET'],
      projectedReadinessDate: '2028-01-23',
      nextEventDate: '2026-09-23',
    });
    vi.spyOn(api, 'recoveryOptions').mockResolvedValue({ health: 'ON_TRACK', options: [] });
    vi.spyOn(api, 'planHistory').mockResolvedValue(history);
    vi.spyOn(api, 'productEvent').mockResolvedValue({ accepted: true });
  });

  it('leads with safe/chosen/readiness and explicitly handles disabled premium/demo features', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <PlanWorkspace goal={goal} account={account} applicationDate="2026-08-23" />
      </QueryClientProvider>,
    );

    expect(await screen.findByText('$277.78')).toBeVisible();
    expect(screen.getByText('Does not depend on modeled interest.')).toBeVisible();
    expect(screen.getByText('$300.00')).toBeVisible();
    expect(screen.getByText('v1')).toBeVisible();
    expect(screen.getByText('Story mode is disabled in this local run.')).toBeVisible();
    expect(screen.getByText('Purchase Timing Lab is disabled.')).toBeVisible();
    expect(
      screen.getByRole('heading', { name: 'Change exactly one part of the plan.' }),
    ).toBeVisible();
    fireEvent.click(screen.getByText('Why this plan has this status'));
    expect(
      screen.getByText('The safe contribution is calculated without relying on modeled interest.'),
    ).toBeVisible();
    expect(screen.getByText('Projected readiness is on or before the target date.')).toBeVisible();
  });

  it('distinguishes a failed capability query from intentionally disabled features and retries it', async () => {
    vi.mocked(api.capabilities)
      .mockRejectedValueOnce(new Error('Capability endpoint unavailable.'))
      .mockResolvedValue({
        demoStory: false,
        purchaseTimingLab: false,
        applicationDate: '2026-08-23',
      });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <PlanWorkspace goal={goal} account={account} applicationDate="2026-08-23" />
      </QueryClientProvider>,
    );

    const errorTitle = await screen.findByText('Local feature availability could not load.');
    const errorState = errorTitle.closest('[role="alert"]');
    expect(errorState).toBeInstanceOf(HTMLElement);
    if (!(errorState instanceof HTMLElement)) throw new Error('Capability error was not rendered.');
    expect(errorState).toHaveTextContent('Capability endpoint unavailable.');
    expect(screen.queryByText('Story mode is disabled in this local run.')).not.toBeInTheDocument();
    expect(screen.queryByText('Purchase Timing Lab is disabled.')).not.toBeInTheDocument();

    fireEvent.click(within(errorState).getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Story mode is disabled in this local run.')).toBeVisible();
    expect(screen.getByText('Purchase Timing Lab is disabled.')).toBeVisible();
    expect(api.capabilities).toHaveBeenCalledTimes(2);
  });

  it('keeps the financial summary visible when health fails and provides a focused retry', async () => {
    vi.mocked(api.planHealth)
      .mockRejectedValueOnce(new Error('Health endpoint unavailable.'))
      .mockResolvedValue({
        health: 'ON_TRACK',
        policyVersion: 'plan-health-v1',
        evidenceCodes: ['READINESS_ON_OR_BEFORE_TARGET'],
        projectedReadinessDate: '2028-01-23',
        nextEventDate: '2026-09-23',
      });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <PlanWorkspace goal={goal} account={account} applicationDate="2026-08-23" />
      </QueryClientProvider>,
    );

    expect(await screen.findByText('$277.78')).toBeVisible();
    const errorTitle = await screen.findByText('Plan health could not load.');
    const errorState = errorTitle.closest('[role="alert"]');
    expect(errorState).toBeInstanceOf(HTMLElement);
    if (!(errorState instanceof HTMLElement)) throw new Error('Health error was not rendered.');
    expect(errorState).toHaveTextContent('The financial summary remains visible');
    expect(document.querySelector('.health-badge')).toBeNull();

    fireEvent.click(within(errorState).getByRole('button', { name: 'Try again' }));
    await waitFor(() =>
      expect(document.querySelector('.health-badge')).toHaveTextContent('On track'),
    );
    expect(api.planHealth).toHaveBeenCalledTimes(2);
  });

  it('keeps a partial What-If money input safe, associated, and focused', async () => {
    const previewScenario = vi.spyOn(api, 'previewScenario');
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <PlanWorkspace goal={goal} account={account} applicationDate="2026-08-23" />
      </QueryClientProvider>,
    );

    const input = await screen.findByLabelText(/New contribution/);
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Preview one change' }));

    const error = await screen.findByText('Enter a valid non-negative contribution amount.');
    expect(error).toHaveAttribute('role', 'alert');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAttribute('aria-describedby', error.id);
    await waitFor(() => expect(input).toHaveFocus());
    expect(previewScenario).not.toHaveBeenCalled();
  });

  it('shows the exact applied history change, base version, timestamp, and archive provenance', async () => {
    vi.mocked(api.planHistory).mockResolvedValue({
      ...history,
      currentGoalVersion: 2,
      versions: [
        ...history.versions,
        {
          id: '01TESTVERSION00000000000001',
          version: 2,
          activatedDate: '2026-09-23',
          appliedAt: '2026-09-23T14:30:00.000Z',
          changedDimension: 'CONTRIBUTION',
          change: { changedDimension: 'CONTRIBUTION', recurringContributionCents: 32_500 },
          basePlanVersionId: '01TESTVERSION00000000000000',
          changeReason: 'WHAT_IF_APPLIED',
          calculationPolicyVersion: 'product-experience-v1',
          assumptionVersion: 'demo-2026-08-v1',
          fromRecovery: false,
          summary: { ...summary, chosenContributionCents: 32_500 },
        },
      ],
    });
    const archivedGoal: GoalDto = {
      ...goal,
      status: 'archived',
      version: 2,
      archivedAt: '2026-09-24T15:45:00.000Z',
      archiveReason: 'GOAL_COMPLETED',
      updatedAt: '2026-09-24T15:45:00.000Z',
    };
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <PlanWorkspace
          goal={archivedGoal}
          account={{ ...account, status: 'completed' }}
          applicationDate="2026-09-24"
        />
      </QueryClientProvider>,
    );

    const versionTwo = (await screen.findByText('v2')).closest('li');
    expect(versionTwo).toHaveTextContent('Set the recurring contribution to $325.00.');
    expect(versionTwo).toHaveTextContent('Sep 23, 2026, 2:30 PM UTC');
    expect(versionTwo).toHaveTextContent('based on v1');
    expect(versionTwo).toHaveTextContent('Changed field: Recurring contribution.');
    expect(screen.getByText(/Archived Sep 24, 2026, 3:45 PM UTC/)).toHaveTextContent(
      'Archived after completion.',
    );
    expect(screen.queryByRole('button', { name: 'Archive plan' })).not.toBeInTheDocument();
  });

  it('shows a successful What-If preview even when telemetry is unavailable', async () => {
    vi.spyOn(api, 'previewScenario').mockResolvedValue({
      goalVersion: 1,
      planVersion: 1,
      comparison: {
        changedDimension: 'CONTRIBUTION',
        current: summary,
        proposed: summary,
        personalContributionChangeCents: 0,
        modeledInterestChangeCents: 0,
        targetDateBalanceChangeCents: 0,
        cushionChangeCents: 0,
        accessConsequence: 'UNCHANGED',
      },
    });
    vi.mocked(api.productEvent).mockRejectedValue(new Error('Telemetry unavailable'));
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <PlanWorkspace goal={goal} account={account} applicationDate="2026-08-23" />
      </QueryClientProvider>,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Preview one change' }));

    expect(await screen.findByText('Proposed')).toBeVisible();
    expect(screen.getByText('Personal contributions')).toBeVisible();
    expect(screen.getByText('Modeled interest', { exact: true })).toBeVisible();
    expect(screen.getByText('Target-date balance')).toBeVisible();
    expect(screen.getByText('Cushion')).toBeVisible();
    fireEvent.click(screen.getByText('Why the proposed outcome changes'));
    expect(
      screen.getAllByText(
        'The safe contribution is calculated without relying on modeled interest.',
      ).length,
    ).toBeGreaterThan(0);
    await waitFor(() =>
      expect(api.productEvent).toHaveBeenCalledWith({
        eventName: 'what_if_previewed',
        changedDimension: 'CONTRIBUTION',
        demo: false,
        applicationVersion: 'product-experience-v1',
      }),
    );
    expect(screen.queryByText('Telemetry unavailable')).not.toBeInTheDocument();
  });

  it('retains a What-If key across retries and replaces it when the proposed change changes', async () => {
    vi.spyOn(api, 'previewScenario').mockResolvedValue({
      goalVersion: 1,
      planVersion: 1,
      comparison: scenarioComparison,
    });
    const applyScenario = vi
      .spyOn(api, 'applyScenario')
      .mockRejectedValueOnce(new Error('Ambiguous apply response.'))
      .mockRejectedValueOnce(new Error('Ambiguous apply response.'))
      .mockResolvedValue({
        goalVersion: 2,
        planVersion: 2,
        planVersionId: '01TESTVERSION00000000000001',
        activityId: '01TESTACTIVITY0000000000000',
        comparison: scenarioComparison,
      });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <PlanWorkspace goal={goal} account={account} applicationDate="2026-08-23" />
      </QueryClientProvider>,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Preview one change' }));
    const applyButton = await screen.findByRole('button', { name: 'Apply as new version' });
    fireEvent.click(applyButton);
    expect(await screen.findByText('Ambiguous apply response.')).toBeVisible();
    fireEvent.click(applyButton);
    await waitFor(() => expect(applyScenario).toHaveBeenCalledTimes(2));

    const input = screen.getByLabelText(/New contribution/);
    fireEvent.change(input, { target: { value: '325' } });
    fireEvent.click(screen.getByRole('button', { name: 'Preview one change' }));
    await waitFor(() => expect(api.previewScenario).toHaveBeenCalledTimes(2));
    fireEvent.click(await screen.findByRole('button', { name: 'Apply as new version' }));
    expect(await screen.findByText('Applied as a new immutable plan version.')).toBeVisible();

    const firstKey = applyScenario.mock.calls[0]?.[2];
    expect(firstKey).toEqual(expect.any(String));
    expect(applyScenario.mock.calls[1]?.[2]).toBe(firstKey);
    expect(applyScenario.mock.calls[2]?.[2]).not.toBe(firstKey);
  });

  it('renders exact recovery changes, server deltas, and customer rationale', async () => {
    vi.mocked(api.planHealth).mockResolvedValue({
      health: 'ATTENTION_NEEDED',
      policyVersion: 'plan-health-v1',
      evidenceCodes: ['READINESS_AFTER_TARGET'],
      projectedReadinessDate: '2028-03-23',
      nextEventDate: '2026-09-23',
    });
    vi.mocked(api.recoveryOptions).mockResolvedValue({
      health: 'ATTENTION_NEEDED',
      options: [
        {
          availability: 'available',
          order: 1,
          optionType: 'CONTRIBUTION_INCREASE',
          change: { changedDimension: 'CONTRIBUTION', recurringContributionCents: 32_500 },
          rationaleCode: 'INCREASE_TO_ZERO_INTEREST_SAFE_AMOUNT',
          projectedReadinessDate: '2028-02-23',
          resultingHealth: 'ON_TRACK',
          personalContributionChangeCents: 45_000,
          modeledInterestChangeCents: 1_250,
        },
        {
          availability: 'unavailable',
          order: 2,
          optionType: 'DEADLINE_EXTENSION',
          reasonCode: 'SELECTED_VEHICLE_DOES_NOT_RESTORE_READINESS',
        },
      ],
    });
    const applyRecovery = vi
      .spyOn(api, 'applyRecovery')
      .mockRejectedValueOnce(new Error('Ambiguous recovery response.'))
      .mockResolvedValue({
        goalVersion: 2,
        planVersion: 2,
        planVersionId: '01TESTVERSION00000000000001',
        activityId: '01TESTACTIVITY0000000000000',
        comparison: scenarioComparison,
      });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <PlanWorkspace goal={goal} account={account} applicationDate="2026-08-23" />
      </QueryClientProvider>,
    );

    expect(await screen.findByText('Set the recurring contribution to $325.00.')).toBeVisible();
    expect(screen.getByText('+$450.00')).toBeVisible();
    expect(screen.getByText('+$12.50')).toBeVisible();
    expect(
      screen.getByText('Raises the recurring contribution to the contribution-only safe amount.'),
    ).toBeVisible();
    expect(
      screen.getByText(
        'Unavailable: This change does not restore purchase readiness under the selected simulated model.',
      ),
    ).toBeVisible();
    expect(screen.getByText(/Projected readiness Feb 23, 2028 · On track/)).toBeVisible();

    const applyButton = screen.getByRole('button', { name: 'Apply' });
    fireEvent.click(applyButton);
    expect(await screen.findByText('Ambiguous recovery response.')).toBeVisible();
    fireEvent.click(applyButton);
    expect(
      await screen.findByText('Recovery applied as a new immutable plan version.'),
    ).toBeVisible();
    expect(applyRecovery).toHaveBeenCalledTimes(2);
    const firstKey = applyRecovery.mock.calls[0]?.[2];
    expect(firstKey).toEqual(expect.any(String));
    expect(applyRecovery.mock.calls[1]?.[2]).toBe(firstKey);
  });

  it('reuses an archive key after an ambiguous failure and refreshes every plan view on success', async () => {
    const archiveGoal = vi
      .spyOn(api, 'archiveGoal')
      .mockRejectedValueOnce(new Error('Ambiguous archive response.'))
      .mockResolvedValue({
        goal: {
          ...goal,
          status: 'archived',
          version: 2,
          archivedAt: '2026-08-24T00:00:00.000Z',
          archiveReason: 'USER_REQUESTED',
        },
      });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <PlanWorkspace goal={goal} account={account} applicationDate="2026-08-23" />
      </QueryClientProvider>,
    );

    const archiveButton = await screen.findByRole('button', { name: 'Archive plan' });
    await screen.findByText('$277.78');
    fireEvent.click(archiveButton);
    expect(await screen.findByText('Ambiguous archive response.')).toBeVisible();
    fireEvent.click(archiveButton);

    await waitFor(() => expect(api.planSummary).toHaveBeenCalledTimes(2));
    expect(api.planHealth).toHaveBeenCalledTimes(2);
    expect(api.recoveryOptions).toHaveBeenCalledTimes(2);
    expect(api.planHistory).toHaveBeenCalledTimes(2);
    const firstKey = archiveGoal.mock.calls[0]?.[2];
    expect(firstKey).toEqual(expect.any(String));
    expect(archiveGoal.mock.calls[1]?.[2]).toBe(firstKey);
  });

  it('requires an explicit seeded reset confirmation with a keyboard-contained dialog', async () => {
    vi.mocked(api.capabilities).mockResolvedValue({
      demoStory: true,
      purchaseTimingLab: false,
      applicationDate: '2026-08-23',
    });
    const resetDemo = vi.spyOn(api, 'resetDemo').mockResolvedValue({ reset: true });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <PlanWorkspace goal={goal} account={account} applicationDate="2026-08-23" />
      </QueryClientProvider>,
    );

    const open = await screen.findByRole('button', { name: 'Reset fixture' });
    fireEvent.click(open);
    const dialog = screen.getByRole('alertdialog', { name: 'Reset the seeded Story Demo?' });
    expect(dialog).toHaveTextContent('Other users are not changed.');
    const confirm = screen.getByRole('button', { name: 'Reset seeded Story Demo' });
    const cancel = screen.getByRole('button', { name: 'Cancel' });
    await waitFor(() => expect(confirm).toHaveFocus());
    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(cancel).toHaveFocus();
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
    expect(confirm).toHaveFocus();
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(open).toHaveFocus();
    expect(resetDemo).not.toHaveBeenCalled();

    fireEvent.click(open);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(open).toHaveFocus();

    fireEvent.click(open);
    fireEvent.click(screen.getByRole('button', { name: 'Reset seeded Story Demo' }));
    await waitFor(() => expect(resetDemo).toHaveBeenCalledTimes(1));
    expect(resetDemo).toHaveBeenCalledWith(
      {
        goalId: goal.id,
        expectedGoalVersion: goal.version,
        confirmation: 'RESET_SEEDED_STORY_DEMO',
      },
      expect.any(String),
    );
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(open).toHaveFocus();
  });

  it('records demo actions and a seasonal Timing Lab view once under StrictMode', async () => {
    vi.mocked(api.capabilities).mockResolvedValue({
      demoStory: true,
      purchaseTimingLab: true,
      applicationDate: '2026-08-23',
    });
    vi.spyOn(api, 'timingLabLatest').mockResolvedValue({
      item: {
        id: '01TESTITEM00000000000000000',
        goalId: goal.id,
        fixtureCode: 'synthetic_oled_65_v1',
        displayName: '65-inch OLED television',
        currency: 'USD',
        targetPriceCents: 160_000,
        lifecycle: 'active',
        version: 1,
        createdAt: '2026-08-23T00:00:00.000Z',
        updatedAt: '2026-08-23T00:00:00.000Z',
      },
      policy: null,
      assessment: {
        id: '01TESTASSESS000000000000000',
        purchaseItemId: '01TESTITEM00000000000000000',
        priceCheckRunId: '01TESTRUN000000000000000000',
        asOfDate: '2026-08-23',
        currentPlanVersion: 1,
        planLifecycle: 'completed',
        planHealth: 'ON_TRACK',
        assessedTargetPriceCents: 150_000,
        state: 'HISTORICALLY_TYPICAL',
        statistics: {
          minimumPriceCents: 130_000,
          medianPriceCents: 145_000,
          maximumPriceCents: 170_000,
          currentPriceCents: 145_000,
          empiricalPercentileBasisPoints: 5_000,
          differenceFromMedianCents: 0,
          differenceFromTargetCents: -5_000,
          observationCount: 72,
          observationSpanDays: 730,
          freshnessDays: 0,
        },
        seasonal: {
          months: Array.from({ length: 12 }, (_, index) => ({
            month: index + 1,
            observationCount: 6,
            medianPriceCents: 135_000 + index * 1_000,
          })),
        },
        rationaleCodes: ['PRICE_WITHIN_TYPICAL_RANGE'],
        analysisPolicyVersion: 'purchase-timing-v1',
        sourceVersion: 'synthetic-prices-v1',
        sourceChecksum: 'a'.repeat(64),
        createdAt: '2026-08-23T00:00:00.000Z',
      },
      series: {
        fixtureCode: 'synthetic_oled_65_v1',
        displayDescriptor: '65-inch OLED television',
        currency: 'USD',
        asOfDate: '2026-08-23',
        sourceVersion: 'synthetic-prices-v1',
        sourceChecksum: 'a'.repeat(64),
        sourceType: 'deterministic_fixture',
        isDemoData: true,
        observations: Array.from({ length: 72 }, (_, index) => ({
          observationKey: `observation-${String(index + 1)}`,
          observedDate: '2026-08-23',
          priceCents: 145_000,
          currency: 'USD' as const,
        })),
      },
    });
    vi.spyOn(api, 'advanceDemo').mockResolvedValue({
      milestone: 'NEXT_CONTRIBUTION',
      fromDate: '2026-08-23',
      toDate: '2026-09-23',
      contributionsPosted: 1,
      interestPostings: 0,
      modeledInterestAddedCents: 0,
      skippedDuplicates: 0,
      purchaseReadyTransitions: 0,
      failureCodes: [],
      health: 'ON_TRACK',
    });
    const runDuePriceChecks = vi
      .spyOn(api, 'runDuePriceChecks')
      .mockRejectedValueOnce(new Error('Price check response was lost.'))
      .mockResolvedValue({
        asOfDate: '2026-08-23',
        status: 'completed',
        duePolicyCount: 1,
        completedRunCount: 1,
        inProgressRunCount: 0,
        replayedRunCount: 0,
        failedRunCount: 0,
        observationsInserted: 72,
        assessmentsCreated: 1,
        errorCodes: [],
      });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    render(
      <StrictMode>
        <QueryClientProvider client={queryClient}>
          <PlanWorkspace goal={goal} account={account} applicationDate="2026-08-23" />
        </QueryClientProvider>
      </StrictMode>,
    );

    expect(
      await screen.findByRole('heading', { name: 'Historical median by month' }),
    ).toBeVisible();
    const seasonalTable = screen.getByRole('table', {
      name: 'Monthly historical median price data',
    });
    expect(within(seasonalTable).getAllByRole('row')).toHaveLength(13);
    expect(within(seasonalTable).getByRole('row', { name: 'January 6 $1,350.00' })).toBeVisible();
    expect(screen.getByText('Assessed target $1,500.00')).toBeVisible();
    expect(screen.getByText('Plan lifecycle at assessment').closest('div')).toHaveTextContent(
      'Completed',
    );
    expect(screen.getByText(/This assessment used a target of \$1,500\.00/)).toHaveTextContent(
      'The item target is now $1,600.00',
    );
    fireEvent.click(screen.getByText('Historical source and replay provenance'));
    expect(screen.getByText('Deterministic synthetic fixture')).toBeVisible();
    expect(screen.getByText('synthetic-prices-v1')).toBeVisible();
    expect(screen.getByText('72', { exact: true })).toBeVisible();
    expect(screen.getByText('a'.repeat(64))).toBeVisible();
    await waitFor(() => {
      const timingEvents = vi
        .mocked(api.productEvent)
        .mock.calls.map(([event]) => event)
        .filter((event) => event.eventName === 'purchase_timing_viewed');
      expect(timingEvents).toEqual([
        {
          eventName: 'purchase_timing_viewed',
          demo: true,
          applicationVersion: 'product-experience-v1',
        },
      ]);
    });

    const runButton = screen.getByRole('button', { name: 'Run due price check (fixture only)' });
    fireEvent.click(runButton);
    expect(await screen.findByText('Price check response was lost.')).toBeVisible();
    fireEvent.click(runButton);
    expect(await screen.findByText(/Price check completed for Aug 23, 2026/i)).toBeVisible();
    expect(runDuePriceChecks).toHaveBeenCalledTimes(2);
    const firstRunKey = runDuePriceChecks.mock.calls[0]?.[0];
    expect(firstRunKey).toEqual(expect.any(String));
    expect(runDuePriceChecks.mock.calls[1]?.[0]).toBe(firstRunKey);
    await waitFor(() => expect(api.timingLabLatest).toHaveBeenCalledTimes(2));

    fireEvent.click(screen.getByRole('button', { name: 'Next contribution' }));
    expect(await screen.findByText(/Advanced Aug 23, 2026 to Sep 23, 2026/i)).toBeVisible();
    expect(screen.getByText(/\$0\.00 modeled interest added/i)).toBeVisible();
    await waitFor(() =>
      expect(api.productEvent).toHaveBeenCalledWith({
        eventName: 'autopilot_advanced',
        demo: true,
        applicationVersion: 'product-experience-v1',
      }),
    );
  });
});
