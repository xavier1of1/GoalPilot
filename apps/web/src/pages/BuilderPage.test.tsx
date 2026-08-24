// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { GoalDraft, PlanDecisionSummary, PreviewOutput, UserDto } from '@goalpilot/contracts';

import { api } from '../api.js';
import { BuilderPage } from './BuilderPage.js';

function renderBuilder(user: UserDto | null = null): void {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <BuilderPage user={user} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function vehicle(
  vehicleCode: PreviewOutput['vehicles'][number]['vehicleCode'],
  overrides: Partial<PreviewOutput['vehicles'][number]>,
): PreviewOutput['vehicles'][number] {
  return {
    vehicleCode,
    displayName: vehicleCode === 'hysa' ? 'High-yield savings model' : 'Plain cash',
    eligible: true,
    rejectionCode: null,
    rejectionMessage: null,
    requiredContributionCents: 41_667,
    safeContributionCents: 41_667,
    modelAdjustedRequiredContributionCents: 39_000,
    fitRank: vehicleCode === 'hysa' ? 1 : 2,
    readyByTargetUsingSafeContribution: true,
    accessRequirementSatisfied: true,
    lockConflictDays: 0,
    safeContributionModeledCushionCents: vehicleCode === 'hysa' ? 30_000 : 0,
    fitRationaleCode: vehicleCode === 'cash' ? 'CASH_BASELINE' : 'ELIGIBLE_ACCESS_FIT',
    protectionClassification:
      vehicleCode === 'cash' ? 'SIMULATED_CASH' : 'SIMULATED_DEPOSIT_HELD_AS_MODELED',
    preservationRequirementSatisfied: true,
    firstMaturityDate: null,
    plannedContributionCents: 40_050,
    principalContributedCents: 870_900,
    futurePersonalContributionsCents: 720_900,
    modeledInterestCents: vehicleCode === 'hysa' ? 59_100 : 0,
    modeledBenefitVersusCashCents: vehicleCode === 'hysa' ? 59_100 : 0,
    endingBalanceCents: vehicleCode === 'hysa' ? 930_000 : 870_900,
    shortfallCents: vehicleCode === 'hysa' ? 0 : 29_100,
    surplusCents: vehicleCode === 'hysa' ? 30_000 : 0,
    projectedCompletionDate: vehicleCode === 'hysa' ? '2028-02-23' : null,
    accessSummary: 'Available within 30 days in this model.',
    assumption: {
      vehicleCode,
      displayName: vehicleCode === 'hysa' ? 'High-yield savings model' : 'Plain cash',
      assumptionVersion: 'demo-2026-08-v1',
      apyBasisPoints: vehicleCode === 'hysa' ? 400 : 0,
      effectiveDate: '2026-08-23',
      reviewedDate: '2026-08-23',
      sourceType: 'reviewed_demo_assumption',
      sourceLabel: 'Reviewed deterministic demo assumption',
      isLive: false,
      liquidityDays: vehicleCode === 'hysa' ? 2 : 0,
      lockDays: 0,
      minimumCents: 0,
      enabled: true,
    },
    ...overrides,
  };
}

const preview: PreviewOutput = {
  asOfDate: '2026-08-23',
  rankingPolicyVersion: 'vehicle-fit-v2',
  zeroInterestBaseline: {
    feasible: true,
    occurrenceCount: 18,
    requiredContributionCents: 41_667,
    projectedBalanceCents: 900_006,
    shortfallCents: 0,
  },
  vehicles: [
    vehicle('cash', {}),
    vehicle('hysa', {}),
    vehicle('cd_ladder', {
      displayName: 'Certificate ladder model',
      eligible: false,
      rejectionCode: 'LIQUIDITY_CONFLICT',
      rejectionMessage: 'The maturity lock conflicts with access within 30 days.',
      fitRank: null,
      readyByTargetUsingSafeContribution: false,
      accessRequirementSatisfied: false,
      lockConflictDays: 335,
      fitRationaleCode: 'INELIGIBLE_POLICY',
      protectionClassification: 'SIMULATED_DEPOSIT_HELD_AS_MODELED',
      preservationRequirementSatisfied: true,
      firstMaturityDate: '2027-08-23',
      modeledBenefitVersusCashCents: 40_000,
      assumption: {
        ...vehicle('cash', {}).assumption,
        vehicleCode: 'cd_ladder',
        displayName: 'Certificate ladder model',
        apyBasisPoints: 450,
        liquidityDays: 365,
        lockDays: 365,
      },
    }),
    vehicle('treasury_ladder', {
      displayName: 'Treasury-bill ladder model',
      eligible: false,
      rejectionCode: 'HORIZON_TOO_SHORT',
      rejectionMessage: 'The plan ends before the modeled maturity schedule.',
      fitRank: null,
      readyByTargetUsingSafeContribution: false,
      accessRequirementSatisfied: false,
      fitRationaleCode: 'INELIGIBLE_POLICY',
      protectionClassification: 'SIMULATED_TREASURY_HELD_TO_MATURITY',
      firstMaturityDate: '2028-08-23',
      modeledBenefitVersusCashCents: 45_000,
      assumption: {
        ...vehicle('cash', {}).assumption,
        vehicleCode: 'treasury_ladder',
        displayName: 'Treasury-bill ladder model',
        apyBasisPoints: 475,
        liquidityDays: 365,
        lockDays: 365,
      },
    }),
  ],
  recommendedVehicleCode: 'hysa',
  disclosure: 'Educational simulation only.',
};

const activationSummary: PlanDecisionSummary = {
  safeContributionCents: 41_667,
  chosenContributionCents: 40_050,
  contributionCadence: 'monthly',
  currentSavingsCents: 150_000,
  postedPersonalContributionsCents: 0,
  postedModeledInterestCents: 0,
  currentTotalValueCents: 150_000,
  currentAvailableFundsCents: 150_000,
  futurePersonalContributionsCents: 720_900,
  futureModeledInterestCents: 59_100,
  projectedTargetDateBalanceCents: 930_000,
  cushionCents: 30_000,
  shortfallCents: 0,
  projectedReadinessDate: '2028-02-23',
  vehicleCode: 'hysa',
  assumptionVersion: 'demo-2026-08-v1',
  calculationPolicyVersion: 'product-experience-v1',
  rankingPolicyVersion: 'vehicle-fit-v2',
  rationaleVersion: 'product-experience-v1',
  rationaleCodes: ['SAFE_CONTRIBUTION_DOES_NOT_DEPEND_ON_INTEREST'],
  health: 'ON_TRACK',
};

describe('progressive GoalPilot builder', () => {
  afterEach(cleanup);

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(api, 'safeBaseline').mockResolvedValue({
      baseline: {
        asOfDate: '2026-08-23',
        targetAmountCents: 900_000,
        currentSavedCents: 150_000,
        targetDate: '2028-02-23',
        contributionCadence: 'monthly',
        calculationPolicyVersion: 'product-experience-v1',
        status: 'possible',
        firstContributionDate: '2026-09-23',
        occurrenceCount: 18,
        safeContributionCents: 41_667,
        projectedBalanceCents: 900_006,
        shortfallCents: 0,
      },
    });
    vi.spyOn(api, 'capabilities').mockResolvedValue({
      demoStory: true,
      purchaseTimingLab: true,
      applicationDate: '2026-08-23',
    });
    vi.spyOn(api, 'drafts').mockResolvedValue({ drafts: [] });
    vi.spyOn(api, 'productEvent').mockResolvedValue({ accepted: true });
  });

  it('does not ask a budget question until the server baseline is visible', async () => {
    renderBuilder();
    expect(screen.queryByLabelText('Amount that fits your budget')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /continue/i }));
    expect(await screen.findByText(/no budget question appears/i)).toBeVisible();
    expect(screen.queryByLabelText('Amount that fits your budget')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /reveal my safe contribution/i }));
    expect(await screen.findByText('$416.67 per monthly')).toBeVisible();
    expect(screen.getByText('Does not depend on modeled interest')).toBeVisible();
    expect(screen.getByLabelText('Amount that fits your budget')).toHaveValue('416.67');
    expect(api.safeBaseline).toHaveBeenCalledWith(
      {
        targetAmountCents: 900_000,
        currentSavedCents: 150_000,
        targetDate: '2028-02-23',
        contributionCadence: 'monthly',
      },
      expect.anything(),
    );
  });

  it('refreshes the server baseline and resumes after the last completed draft step', async () => {
    const user: UserDto = {
      id: '01TESTUSER0000000000000000',
      email: 'alex@example.test',
      displayName: 'Alex',
    };
    const draft: GoalDraft = {
      id: '01TESTDRAFT000000000000000',
      data: {
        name: 'Japan trip',
        targetAmountCents: 900_000,
        currentSavedCents: 150_000,
        targetDate: '2028-02-23',
        contributionCadence: 'monthly',
        recurringContributionCents: 40_050,
      },
      lastCompletedStep: 'budget_fit',
      version: 2,
      createdAt: '2026-08-23T00:00:00.000Z',
      updatedAt: '2026-08-23T00:00:00.000Z',
    };
    vi.mocked(api.drafts).mockResolvedValue({ drafts: [draft] });
    renderBuilder(user);

    fireEvent.click(await screen.findByRole('button', { name: 'Resume' }));
    expect(await screen.findByText(/contribution-only baseline was refreshed/i)).toBeVisible();
    expect(screen.getByRole('group', { name: '4. When might you need this money?' })).toBeVisible();
    expect(api.safeBaseline).toHaveBeenCalledWith(
      {
        targetAmountCents: 900_000,
        currentSavedCents: 150_000,
        targetDate: '2028-02-23',
        contributionCadence: 'monthly',
      },
      expect.anything(),
    );
  });

  it('saves an empty partial draft without attempting to parse blank money fields', async () => {
    const user: UserDto = {
      id: '01TESTUSER0000000000000000',
      email: 'alex@example.test',
      displayName: 'Alex',
    };
    const draft: GoalDraft = {
      id: '01TESTDRAFT000000000000000',
      data: {},
      lastCompletedStep: null,
      version: 1,
      createdAt: '2026-08-23T00:00:00.000Z',
      updatedAt: '2026-08-23T00:00:00.000Z',
    };
    vi.mocked(api.drafts).mockResolvedValue({ drafts: [draft] });
    const updateDraft = vi.spyOn(api, 'updateDraft').mockResolvedValue({ ...draft, version: 2 });
    renderBuilder(user);

    fireEvent.click(await screen.findByRole('button', { name: 'Resume' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));

    await waitFor(() => expect(updateDraft).toHaveBeenCalledTimes(1));
    const savedInput = updateDraft.mock.calls[0]?.[1];
    expect(updateDraft.mock.calls[0]?.[0]).toBe(draft.id);
    expect(savedInput).toMatchObject({ expectedVersion: 1, data: {} });
    expect(savedInput?.data).not.toHaveProperty('targetAmountCents');
    expect(savedInput?.data).not.toHaveProperty('currentSavedCents');
    expect(savedInput?.data).not.toHaveProperty('recurringContributionCents');
    expect(await screen.findByText('Draft saved. You can safely resume it later.')).toBeVisible();
  });

  it('retains a draft-create key across retry and resets it after success before an update', async () => {
    const user: UserDto = {
      id: '01TESTUSER0000000000000000',
      email: 'alex@example.test',
      displayName: 'Alex',
    };
    const draft: GoalDraft = {
      id: '01TESTDRAFT000000000000000',
      data: { name: 'Japan trip' },
      lastCompletedStep: null,
      version: 1,
      createdAt: '2026-08-23T00:00:00.000Z',
      updatedAt: '2026-08-23T00:00:00.000Z',
    };
    const createDraft = vi
      .spyOn(api, 'createDraft')
      .mockRejectedValueOnce(new Error('Draft response was lost.'))
      .mockResolvedValue(draft);
    const updateDraft = vi
      .spyOn(api, 'updateDraft')
      .mockResolvedValue({ ...draft, data: { name: 'Japan adventure' }, version: 2 });
    renderBuilder(user);

    const saveButton = await screen.findByRole('button', { name: 'Save draft' });
    fireEvent.click(saveButton);
    expect(await screen.findByText('Draft response was lost.')).toBeVisible();
    fireEvent.click(saveButton);
    expect(await screen.findByText('Draft saved. You can safely resume it later.')).toBeVisible();

    const firstKey = createDraft.mock.calls[0]?.[1];
    expect(firstKey).toEqual(expect.any(String));
    expect(createDraft.mock.calls[1]?.[1]).toBe(firstKey);

    fireEvent.change(screen.getByLabelText('Goal name'), { target: { value: 'Japan adventure' } });
    fireEvent.click(saveButton);
    await waitFor(() => expect(updateDraft).toHaveBeenCalledTimes(1));
    expect(updateDraft.mock.calls[0]?.[2]).toEqual(expect.any(String));
    expect(updateDraft.mock.calls[0]?.[2]).not.toBe(firstKey);
  });

  it('retains a discard key until the draft deletion succeeds', async () => {
    const user: UserDto = {
      id: '01TESTUSER0000000000000000',
      email: 'alex@example.test',
      displayName: 'Alex',
    };
    const draft: GoalDraft = {
      id: '01TESTDRAFT000000000000000',
      data: { name: 'Japan trip' },
      lastCompletedStep: null,
      version: 1,
      createdAt: '2026-08-23T00:00:00.000Z',
      updatedAt: '2026-08-23T00:00:00.000Z',
    };
    vi.mocked(api.drafts).mockResolvedValue({ drafts: [draft] });
    const discardDraft = vi
      .spyOn(api, 'discardDraft')
      .mockRejectedValueOnce(new Error('Draft deletion response was lost.'))
      .mockResolvedValue(undefined);
    renderBuilder(user);

    const discardButton = await screen.findByRole('button', { name: 'Discard Japan trip draft' });
    fireEvent.click(discardButton);
    expect(await screen.findByText('Draft deletion response was lost.')).toBeVisible();
    fireEvent.click(discardButton);
    expect(await screen.findByText('Draft discarded. No active plan was changed.')).toBeVisible();

    const firstKey = discardDraft.mock.calls[0]?.[2];
    expect(firstKey).toEqual(expect.any(String));
    expect(discardDraft.mock.calls[1]?.[2]).toBe(firstKey);
  });

  it('reports a capability query failure separately and retries without false demo telemetry', async () => {
    const user: UserDto = {
      id: '01TESTUSER0000000000000000',
      email: 'alex@example.test',
      displayName: 'Alex',
    };
    vi.mocked(api.capabilities)
      .mockRejectedValueOnce(new Error('Capability response was lost.'))
      .mockResolvedValue({
        demoStory: false,
        purchaseTimingLab: false,
        applicationDate: '2026-08-23',
      });
    renderBuilder(user);

    const title = await screen.findByText('Local feature availability could not load.');
    const errorState = title.closest('[role="alert"]');
    expect(errorState).toBeInstanceOf(HTMLElement);
    if (!(errorState instanceof HTMLElement)) throw new Error('Capability error was not rendered.');
    expect(api.productEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({ eventName: 'builder_started' }),
    );
    fireEvent.click(within(errorState).getByRole('button', { name: 'Try again' }));
    await waitFor(() =>
      expect(api.productEvent).toHaveBeenCalledWith({
        eventName: 'builder_started',
        demo: false,
        applicationVersion: 'product-experience-v1',
      }),
    );
    expect(api.capabilities).toHaveBeenCalledTimes(2);
  });

  it('associates and focuses a budget error before changing steps', async () => {
    renderBuilder();
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));
    fireEvent.click(await screen.findByRole('button', { name: /reveal my safe contribution/i }));
    const budget = await screen.findByLabelText('Amount that fits your budget');
    fireEvent.change(budget, { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue to access' }));

    const error = await screen.findByText(/valid dollar amount/i);
    expect(error).toHaveAttribute('role', 'alert');
    expect(budget).toHaveAttribute('aria-invalid', 'true');
    expect(budget).toHaveAttribute('aria-describedby', expect.stringContaining(error.id));
    await waitFor(() => expect(budget).toHaveFocus());
    expect(screen.getByRole('group', { name: '3. Does this commitment fit?' })).toBeVisible();
  });

  it('renders server-owned contribution totals, vehicle benefit, fit, and constraint detail', async () => {
    vi.spyOn(api, 'preview').mockResolvedValue(preview);
    renderBuilder();

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Reveal my safe contribution' }));
    fireEvent.change(await screen.findByLabelText('Amount that fits your budget'), {
      target: { value: '400.50' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Continue to access' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Review plan' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Preview my plan' }));

    const results = await screen.findByText('Your Simulated Goal Plan');
    const resultsSection = results.closest('.results-section');
    expect(resultsSection).toBeInstanceOf(HTMLElement);
    if (!(resultsSection instanceof HTMLElement))
      throw new Error('Plan results were not rendered.');
    const planned = within(resultsSection)
      .getByText('+ planned personal contributions')
      .closest('div');
    expect(planned).toHaveTextContent('$7,209.00');

    const hysa = screen
      .getByRole('heading', { name: 'High-yield savings model' })
      .closest('article');
    expect(hysa).toBeInstanceOf(HTMLElement);
    if (!(hysa instanceof HTMLElement))
      throw new Error('High-yield vehicle card was not rendered.');
    expect(hysa).toHaveTextContent(
      'This modeled route fits the requested access timing and the product policy constraints.',
    );
    expect(hysa).toHaveTextContent('Projected ending balance$9,300.00');
    expect(hysa).toHaveTextContent('Modeled benefit versus cash+$591.00');
    fireEvent.click(within(hysa).getByText('Assumption and calculation detail'));
    expect(hysa).toHaveTextContent(
      'Modeled deposit treatment; no real deposit account or insurance is provided.',
    );
    expect(hysa).toHaveTextContent('First maturityNot applicable');

    const rejected = screen
      .getByRole('heading', { name: 'Certificate ladder model' })
      .closest('article');
    expect(rejected).toBeInstanceOf(HTMLElement);
    if (!(rejected instanceof HTMLElement))
      throw new Error('Rejected certificate card was not rendered.');
    expect(rejected).toHaveTextContent('This route cannot meet the requested access timing.');
    expect(rejected).toHaveTextContent(
      'What would need to change: Choose a route with earlier access or change the requested access timing.',
    );
  });

  it('retains draft-update and activation keys when the activation response is ambiguous', async () => {
    const user: UserDto = {
      id: '01TESTUSER0000000000000000',
      email: 'alex@example.test',
      displayName: 'Alex',
    };
    const draft: GoalDraft = {
      id: '01TESTDRAFT000000000000000',
      data: {
        name: 'Japan trip',
        targetAmountCents: 900_000,
        currentSavedCents: 150_000,
        targetDate: '2028-02-23',
        contributionCadence: 'monthly',
        recurringContributionCents: 40_050,
        liquidityNeed: 'within_30_days',
        preservationPreference: 'required',
        confidence: 'expected',
      },
      lastCompletedStep: 'budget_fit',
      version: 2,
      createdAt: '2026-08-23T00:00:00.000Z',
      updatedAt: '2026-08-23T00:00:00.000Z',
    };
    const updatedDraft: GoalDraft = { ...draft, lastCompletedStep: 'review', version: 3 };
    vi.mocked(api.drafts).mockResolvedValue({ drafts: [draft] });
    vi.spyOn(api, 'preview').mockResolvedValue(preview);
    const updateDraft = vi.spyOn(api, 'updateDraft').mockResolvedValue(updatedDraft);
    const activateDraft = vi
      .spyOn(api, 'activateDraft')
      .mockRejectedValueOnce(new Error('Activation response was lost.'))
      .mockResolvedValue({
        goalId: '01TESTGOAL0000000000000000',
        goalVersion: 1,
        planVersionId: '01TESTVERSION00000000000000',
        planVersion: 1,
        activityId: '01TESTACTIVITY0000000000000',
        summary: activationSummary,
      });
    renderBuilder(user);

    fireEvent.click(await screen.findByRole('button', { name: 'Resume' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Review plan' }));
    fireEvent.click(screen.getByRole('button', { name: 'Preview my plan' }));
    const hysa = (await screen.findByRole('heading', { name: 'High-yield savings model' })).closest(
      'article',
    );
    expect(hysa).toBeInstanceOf(HTMLElement);
    if (!(hysa instanceof HTMLElement)) throw new Error('Recommended vehicle was not rendered.');
    const activateButton = within(hysa).getByRole('button', {
      name: 'Activate this Simulated Goal Plan',
    });
    fireEvent.click(activateButton);
    expect(await screen.findByText('Activation response was lost.')).toBeVisible();
    fireEvent.click(activateButton);
    await waitFor(() => expect(activateDraft).toHaveBeenCalledTimes(2));

    const firstUpdateKey = updateDraft.mock.calls[0]?.[2];
    const firstActivationKey = activateDraft.mock.calls[0]?.[2];
    expect(firstUpdateKey).toEqual(expect.any(String));
    expect(updateDraft.mock.calls[1]?.[2]).toBe(firstUpdateKey);
    expect(firstActivationKey).toEqual(expect.any(String));
    expect(activateDraft.mock.calls[1]?.[2]).toBe(firstActivationKey);
  });

  it('keeps baseline workflow successful when privacy-safe telemetry fails', async () => {
    const user: UserDto = {
      id: '01TESTUSER0000000000000000',
      email: 'alex@example.test',
      displayName: 'Alex',
    };
    vi.mocked(api.productEvent).mockRejectedValue(new Error('Telemetry unavailable'));
    renderBuilder(user);

    await waitFor(() =>
      expect(api.productEvent).toHaveBeenCalledWith({
        eventName: 'builder_started',
        demo: true,
        applicationVersion: 'product-experience-v1',
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));
    expect(await screen.findByText(/no budget question appears/i)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: /reveal my safe contribution/i }));

    expect(await screen.findByText('$416.67 per monthly')).toBeVisible();
    await waitFor(() => {
      const events = vi.mocked(api.productEvent).mock.calls.map(([event]) => event);
      expect(events).toEqual(
        expect.arrayContaining([
          {
            eventName: 'builder_step_completed',
            builderStep: 'goal',
            demo: true,
            applicationVersion: 'product-experience-v1',
          },
          {
            eventName: 'builder_step_completed',
            builderStep: 'starting_point',
            demo: true,
            applicationVersion: 'product-experience-v1',
          },
          {
            eventName: 'safe_baseline_viewed',
            demo: true,
            applicationVersion: 'product-experience-v1',
          },
        ]),
      );
    });
    expect(screen.queryByText('Telemetry unavailable')).not.toBeInTheDocument();
  });
});
