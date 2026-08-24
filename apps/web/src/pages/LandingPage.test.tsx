// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';

import { LandingPage } from './LandingPage.js';

describe('GoalPilot landing page', () => {
  it('explains the journey and makes the simulation boundary visible', () => {
    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <LandingPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Turn “someday”');
    expect(screen.getByRole('link', { name: /open sample plan/i })).toHaveAttribute(
      'href',
      '/plan',
    );
    expect(screen.getByLabelText('Example goal progress')).toHaveTextContent('Japan trip');
    expect(screen.getByLabelText('Example goal progress')).toHaveTextContent('$1,500');
    expect(
      screen.getByText(/No real financial account is opened and no money moves/i),
    ).toBeVisible();
    expect(screen.getByText(/Rates are illustrative, not live offers/i)).toBeVisible();
    expect(screen.getByText(/outcomes are not guaranteed/i)).toBeVisible();
    expect(screen.getByText(/assumption version stays fixed/i)).toBeVisible();
  });
});
