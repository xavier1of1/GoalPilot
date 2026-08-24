import { describe, expect, it, vi } from 'vitest';

import type { DatabaseClient } from './database.js';
import { ProductExperienceRepository } from './experience-repository.js';

function databaseReturning(rows: readonly unknown[], queries: string[]): DatabaseClient {
  return vi.fn((first: unknown) => {
    if (Array.isArray(first) && 'raw' in first) {
      queries.push((first as unknown as readonly string[]).join('?'));
      return Promise.resolve(rows);
    }
    return 'bulk-values';
  }) as unknown as DatabaseClient;
}

describe('Story Mode owner financial recovery', () => {
  it('selects the greatest owner-wide high-water while keeping milestone eligibility local', async () => {
    const queries: string[] = [];
    const repository = new ProductExperienceRepository(
      databaseReturning(
        [
          {
            goal_id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
            goal_version: 3,
            target_date: '2027-08-23',
            account_status: 'active',
            next_contribution_date: '2026-09-23',
            next_maturity_date: null,
            pending_financial_date: '2026-08-26',
          },
        ],
        queries,
      ),
    );

    await expect(
      repository.getDemoMilestoneContext(
        '01ARZ3NDEKTSV4RRFFQ69G5FAW',
        '01ARZ3NDEKTSV4RRFFQ69G5FAV',
        '2026-08-23',
      ),
    ).resolves.toMatchObject({
      goalId: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
      pendingFinancialDate: '2026-08-26',
    });

    const query = queries.join('\n');
    const selectedGoalStart = query.indexOf('SELECT g.id AS goal_id');
    expect(selectedGoalStart).toBeGreaterThan(0);
    const ownerScope = query.slice(0, selectedGoalStart);
    expect(ownerScope).toContain('FROM simulated_accounts owner_account');
    expect(ownerScope).toContain('owner_account.user_id = ?');
    expect(ownerScope).toContain('owner_account.last_processed_date');
    expect(ownerScope).toContain('owner_account.last_accrual_date');
    expect(ownerScope).toContain('MAX(owner_entry.effective_date)');
    expect(ownerScope).not.toContain('owner_account.status');
    expect(query).toContain('SELECT MAX(financial_date)');
    expect(query).toContain("g.status IN ('active', 'paused', 'purchase_ready')");
    expect(query).toContain("a.status IN ('active', 'paused', 'purchase_ready')");
  });
});
