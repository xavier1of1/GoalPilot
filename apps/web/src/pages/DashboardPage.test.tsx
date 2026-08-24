// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  AccountSummaryDto,
  GoalDto,
  PlanDecisionSummary,
  PlanHistoryOutput,
} from '@goalpilot/contracts';

import { api } from '../api.js';
import { DashboardPage } from './DashboardPage.js';

const goal: GoalDto = {
  id: '01TESTGOAL0000000000000000',
  name: 'Accessible contribution fixture',
  targetAmountCents: 600_000,
  currentSavedCents: 100_000,
  targetDate: '2027-08-23',
  recurringContributionCents: 45_000,
  contributionCadence: 'monthly',
  liquidityNeed: 'goal_date',
  preservationPreference: 'required',
  confidence: 'expected',
  status: 'active',
  version: 2,
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
  projectedCompletionDate: '2027-08-23',
  assumptionVersion: 'demo-2026-08-v1',
  assumptionReviewedDate: '2026-08-23',
  assumptionIsStale: false,
};

const dashboardSummary: PlanDecisionSummary = {
  safeContributionCents: 41_667,
  chosenContributionCents: 45_000,
  contributionCadence: 'monthly',
  currentSavingsCents: 100_000,
  postedPersonalContributionsCents: 0,
  postedModeledInterestCents: 0,
  currentTotalValueCents: 100_000,
  currentAvailableFundsCents: 100_000,
  futurePersonalContributionsCents: 500_000,
  futureModeledInterestCents: 10_000,
  projectedTargetDateBalanceCents: 610_000,
  cushionCents: 10_000,
  shortfallCents: 0,
  projectedReadinessDate: '2027-08-23',
  vehicleCode: 'hysa',
  assumptionVersion: 'demo-2026-08-v1',
  calculationPolicyVersion: 'product-experience-v1',
  rankingPolicyVersion: 'vehicle-fit-v2',
  rationaleVersion: 'product-experience-v1',
  rationaleCodes: ['SAFE_CONTRIBUTION_DOES_NOT_DEPEND_ON_INTEREST'],
  health: 'ON_TRACK',
};

const dashboardHistory: PlanHistoryOutput = {
  goalId: goal.id,
  currentGoalVersion: goal.version,
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
      summary: dashboardSummary,
    },
  ],
};

describe('GoalPilot dashboard contribution dialog', () => {
  afterEach(cleanup);

  beforeEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
      configurable: true,
      value(this: HTMLDialogElement) {
        this.setAttribute('open', '');
      },
    });
    Object.defineProperty(HTMLDialogElement.prototype, 'close', {
      configurable: true,
      value(this: HTMLDialogElement) {
        this.removeAttribute('open');
      },
    });
    vi.spyOn(api, 'goals').mockResolvedValue({ goals: [goal] });
    vi.spyOn(api, 'drafts').mockResolvedValue({ drafts: [] });
    vi.spyOn(api, 'goal').mockResolvedValue({
      goal,
      account,
      applicationDate: '2026-08-23',
    });
    vi.spyOn(api, 'activity').mockResolvedValue({ activity: [] });
    vi.spyOn(api, 'capabilities').mockResolvedValue({
      demoStory: false,
      purchaseTimingLab: false,
      applicationDate: '2026-08-23',
    });
    vi.spyOn(api, 'planSummary').mockResolvedValue(dashboardSummary);
    vi.spyOn(api, 'planHealth').mockResolvedValue({
      health: 'ON_TRACK',
      policyVersion: 'plan-health-v1',
      evidenceCodes: ['READINESS_ON_OR_BEFORE_TARGET'],
      projectedReadinessDate: '2027-08-23',
      nextEventDate: '2026-09-23',
    });
    vi.spyOn(api, 'recoveryOptions').mockResolvedValue({ health: 'ON_TRACK', options: [] });
    vi.spyOn(api, 'planHistory').mockResolvedValue(dashboardHistory);
    vi.spyOn(api, 'productEvent').mockResolvedValue({ accepted: true });
  });

  it('does not turn a plan-library failure into an empty dashboard and retries it', async () => {
    vi.mocked(api.goals)
      .mockRejectedValueOnce(new Error('Plan library response was lost.'))
      .mockResolvedValue({ goals: [goal] });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[`/dashboard?goal=${goal.id}`]}>
          <DashboardPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    const title = await screen.findByText('Plan library could not load.');
    const errorState = title.closest('[role="alert"]');
    expect(errorState).toBeInstanceOf(HTMLElement);
    if (!(errorState instanceof HTMLElement)) throw new Error('Plan-library error was not shown.');
    expect(errorState).toHaveTextContent('Plan library response was lost.');
    expect(screen.queryByRole('heading', { name: 'Ready when you are.' })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'This goal has not been activated yet.' }),
    ).not.toBeInTheDocument();
    expect(api.goal).not.toHaveBeenCalled();

    fireEvent.click(within(errorState).getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('button', { name: 'Add simulated contribution' })).toBeVisible();
    expect(api.goals).toHaveBeenCalledTimes(2);
    expect(api.goal).toHaveBeenCalledTimes(1);
  });

  it('does not infer a missing account when plan details fail and delays account queries until retry', async () => {
    vi.mocked(api.goal)
      .mockRejectedValueOnce(new Error('Plan detail response was lost.'))
      .mockResolvedValue({ goal, account, applicationDate: '2026-08-23' });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[`/dashboard?goal=${goal.id}`]}>
          <DashboardPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    const title = await screen.findByText('Plan details could not load.');
    const errorState = title.closest('[role="alert"]');
    expect(errorState).toBeInstanceOf(HTMLElement);
    if (!(errorState instanceof HTMLElement)) throw new Error('Plan-detail error was not shown.');
    expect(errorState).toHaveTextContent('activation and account state are unknown');
    expect(
      screen.queryByRole('heading', { name: 'This goal has not been activated yet.' }),
    ).not.toBeInTheDocument();
    expect(api.activity).not.toHaveBeenCalled();

    fireEvent.click(within(errorState).getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('button', { name: 'Add simulated contribution' })).toBeVisible();
    await waitFor(() => expect(api.activity).toHaveBeenCalledTimes(1));
    expect(api.goal).toHaveBeenCalledTimes(2);
  });

  it('treats a saved-drafts query failure as incomplete navigation rather than zero drafts', async () => {
    vi.mocked(api.drafts)
      .mockRejectedValueOnce(new Error('Saved drafts response was lost.'))
      .mockResolvedValue({ drafts: [] });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[`/dashboard?goal=${goal.id}`]}>
          <DashboardPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    const title = await screen.findByText('Saved drafts could not load.');
    const errorState = title.closest('[role="alert"]');
    expect(errorState).toBeInstanceOf(HTMLElement);
    if (!(errorState instanceof HTMLElement)) throw new Error('Saved-drafts error was not shown.');
    expect(screen.queryByText('Start a new plan')).not.toBeInTheDocument();

    fireEvent.click(within(errorState).getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('navigation', { name: 'Plan library' })).toBeVisible();
    expect(api.drafts).toHaveBeenCalledTimes(2);
  });

  it('shows an activity-specific retry instead of claiming a failed history is empty', async () => {
    vi.mocked(api.activity)
      .mockRejectedValueOnce(new Error('Activity response was lost.'))
      .mockResolvedValue({ activity: [] });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[`/dashboard?goal=${goal.id}`]}>
          <DashboardPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByRole('button', { name: 'Add simulated contribution' })).toBeVisible();
    const title = await screen.findByText('Account activity could not load.');
    const errorState = title.closest('[role="alert"]');
    expect(errorState).toBeInstanceOf(HTMLElement);
    if (!(errorState instanceof HTMLElement)) throw new Error('Activity error was not shown.');
    expect(errorState).toHaveTextContent('could not verify the append-only activity history');
    expect(
      screen.queryByText('Activity will appear after activation or a contribution.'),
    ).not.toBeInTheDocument();

    fireEvent.click(within(errorState).getByRole('button', { name: 'Try again' }));
    expect(
      await screen.findByText('Activity will appear after activation or a contribution.'),
    ).toBeVisible();
    expect(api.activity).toHaveBeenCalledTimes(2);
  });

  it('associates an invalid amount error and returns focus to the amount field', async () => {
    const contribute = vi.spyOn(api, 'contribute').mockResolvedValue({});
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[`/dashboard?goal=${goal.id}`]}>
          <DashboardPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Add simulated contribution' }));
    const amount = document.querySelector<HTMLInputElement>('#contribution-amount');
    expect(amount).not.toBeNull();
    if (amount === null) throw new Error('Contribution amount input was not rendered.');
    expect(document.querySelector('label[for="contribution-amount"]')).toHaveTextContent('Amount');
    fireEvent.change(amount, { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: 'Post simulated contribution' }));

    const alert = await screen.findByText('Enter an amount between $0.01 and $1,000,000.');
    expect(alert).toHaveAttribute('role', 'alert');
    expect(alert).toHaveTextContent('between $0.01 and $1,000,000');
    expect(amount).toHaveAttribute('aria-invalid', 'true');
    expect(amount).toHaveAttribute('aria-describedby', alert.id);
    await waitFor(() => expect(amount).toHaveFocus());
    expect(contribute).not.toHaveBeenCalled();
  });

  it('announces an operation failure without marking a valid amount invalid', async () => {
    vi.spyOn(api, 'contribute').mockRejectedValue(new Error('The local API is unavailable.'));
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[`/dashboard?goal=${goal.id}`]}>
          <DashboardPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Add simulated contribution' }));
    const amount = document.querySelector<HTMLInputElement>('#contribution-amount');
    expect(amount).not.toBeNull();
    if (amount === null) throw new Error('Contribution amount input was not rendered.');
    fireEvent.change(amount, { target: { value: '100' } });
    fireEvent.click(screen.getByRole('button', { name: 'Post simulated contribution' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('The local API is unavailable.');
    expect(amount).not.toHaveAttribute('aria-invalid');
    expect(amount).not.toHaveAttribute('aria-describedby');
    await waitFor(() => expect(alert).toHaveFocus());
  });

  it('uses the fresh version, retains the lifecycle key on retry, and refreshes terminal views', async () => {
    const staleListGoal = { ...goal, status: 'active', version: 7 } as const;
    const currentGoal = { ...goal, status: 'purchase_ready', version: 3 } as const;
    const completedGoal = { ...currentGoal, status: 'completed', version: 4 } as const;
    const purchaseReadyAccount = { ...account, status: 'purchase_ready' } as const;
    vi.mocked(api.goals)
      .mockResolvedValueOnce({ goals: [staleListGoal] })
      .mockResolvedValue({ goals: [completedGoal] });
    vi.mocked(api.goal)
      .mockResolvedValueOnce({
        goal: currentGoal,
        account: purchaseReadyAccount,
        applicationDate: '2027-08-23',
      })
      .mockResolvedValue({
        goal: completedGoal,
        account: { ...purchaseReadyAccount, status: 'completed' },
        applicationDate: '2027-08-23',
      });
    const action = vi
      .spyOn(api, 'action')
      .mockRejectedValueOnce(new Error('Lifecycle response was lost.'))
      .mockResolvedValue({ goal: completedGoal });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[`/dashboard?goal=${goal.id}`]}>
          <DashboardPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    const completeButton = await screen.findByRole('button', { name: 'Mark purchase complete' });
    fireEvent.click(completeButton);
    expect(await screen.findByText('Lifecycle response was lost.')).toBeVisible();
    fireEvent.click(completeButton);

    expect(await screen.findByText('Goal completed and retained in your history.')).toBeVisible();
    expect(await screen.findByRole('heading', { name: 'This plan is complete.' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Apply as new version' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Archive plan' })).not.toBeInTheDocument();
    expect(action).toHaveBeenCalledTimes(2);
    const firstKey = action.mock.calls[0]?.[3];
    expect(firstKey).toEqual(expect.any(String));
    expect(action.mock.calls[0]?.slice(0, 3)).toEqual([goal.id, 'complete', 3]);
    expect(action.mock.calls[1]?.[3]).toBe(firstKey);
    await waitFor(() => expect(api.planSummary).toHaveBeenCalledTimes(2));
    expect(api.planHealth).toHaveBeenCalledTimes(2);
    expect(api.recoveryOptions).toHaveBeenCalledTimes(2);
    expect(api.planHistory).toHaveBeenCalledTimes(2);
  });

  it('groups active, completed, archived, and draft navigation with customer labels', async () => {
    const completedGoal = {
      ...goal,
      id: '01TESTGOALCOMPLETED000000000',
      status: 'completed',
    } as const;
    const archivedGoal = {
      ...goal,
      id: '01TESTGOALARCHIVED0000000000',
      status: 'archived',
    } as const;
    vi.mocked(api.goals).mockResolvedValue({ goals: [goal, completedGoal, archivedGoal] });
    vi.mocked(api.drafts).mockResolvedValue({
      drafts: [
        {
          id: '01TESTDRAFT000000000000000',
          data: { name: 'Kitchen update' },
          lastCompletedStep: 'goal',
          version: 1,
          createdAt: '2026-08-23T00:00:00.000Z',
          updatedAt: '2026-08-23T00:00:00.000Z',
        },
      ],
    });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[`/dashboard?goal=${goal.id}`]}>
          <DashboardPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    const library = await screen.findByRole('navigation', { name: 'Plan library' });
    expect(library).toHaveTextContent('1 active · 1 completed · 1 archived');
    const selector = screen.getByLabelText('View goal');
    expect(selector.querySelector('optgroup[label="Active plans"]')).not.toBeNull();
    expect(selector.querySelector('optgroup[label="Completed plans"]')).not.toBeNull();
    expect(selector.querySelector('optgroup[label="Archived plans"]')).not.toBeNull();
    expect(screen.getByRole('link', { name: 'Resume saved drafts (1)' })).toHaveAttribute(
      'href',
      '/plan',
    );
    expect(screen.getByRole('option', { name: /Archived$/ })).toBeInTheDocument();
  });

  it('uses the server-owned principal composition basis points for chart width', async () => {
    vi.mocked(api.goal).mockResolvedValue({
      goal,
      account: {
        ...account,
        principalContributedCents: 75_000,
        interestEarnedCents: 25_000,
        currentLedgerBalanceCents: 100_000,
        principalCompositionBasisPoints: 7_500,
      },
      applicationDate: '2026-08-23',
    });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[`/dashboard?goal=${goal.id}`]}>
          <DashboardPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await screen.findByText('$750.00');
    const principalBar = document.querySelector<HTMLElement>('.composition-principal');
    expect(principalBar).not.toBeNull();
    expect(principalBar).toHaveStyle({ width: '75.00%' });
    expect(screen.getByText(/Current funding is \$1,000\.00/)).toHaveTextContent(
      '$750.00 principal and $250.00 modeled interest',
    );
  });

  it('reuses the export idempotency key until a retry succeeds', async () => {
    const exportData = vi
      .spyOn(api, 'exportData')
      .mockRejectedValueOnce(new Error('Temporary export failure.'))
      .mockResolvedValue({ goals: [] });
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn(() => 'blob:goalpilot-export'),
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: vi.fn(),
    });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[`/dashboard?goal=${goal.id}`]}>
          <DashboardPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    const exportButton = await screen.findByRole('button', { name: 'Export JSON' });
    expect(
      screen.getByText(
        /Exports include your profile, saved drafts, goals and plans, simulated activity, and Timing Lab history you own\. Operational secrets and security records are excluded\./,
      ),
    ).toBeVisible();
    fireEvent.click(exportButton);
    expect(await screen.findByText(/Temporary export failure/)).toBeVisible();
    fireEvent.click(exportButton);
    expect(await screen.findByText('Your GoalPilot data export was created.')).toBeVisible();

    expect(exportData).toHaveBeenCalledTimes(2);
    const firstKey = exportData.mock.calls[0]?.[0];
    const secondKey = exportData.mock.calls[1]?.[0];
    expect(firstKey).toEqual(expect.any(String));
    expect(secondKey).toBe(firstKey);
  });
});
