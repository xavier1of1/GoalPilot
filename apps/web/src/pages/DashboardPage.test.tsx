// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AccountSummaryDto, GoalDto } from '@goalpilot/contracts';

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
    vi.spyOn(api, 'goal').mockResolvedValue({
      goal,
      account,
      applicationDate: '2026-08-23',
    });
    vi.spyOn(api, 'activity').mockResolvedValue({ activity: [] });
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
});
