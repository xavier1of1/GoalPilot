// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';

import { LandingPage } from './LandingPage.js';

describe('GoalPilot landing page', () => {
  it('explains the journey and makes the simulation boundary visible', () => {
    render(
      <MemoryRouter>
        <LandingPage />
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Turn “someday”');
    expect(screen.getByRole('link', { name: /build my plan/i })).toHaveAttribute('href', '/plan');
    expect(screen.getByText('Illustrative rate, not a live offer.')).toBeVisible();
    expect(screen.getByText(/does not hold, transfer, or invest money/i)).toBeVisible();
  });
});
