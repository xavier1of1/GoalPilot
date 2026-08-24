import { describe, expect, it, vi } from 'vitest';

import type { DatabaseClient } from '@goalpilot/data-access';

import { assertPriceWatchRunTarget, resolveJapanFixtureClock } from '../scripts/price-watch-run.js';

function databaseReturning(rows: readonly Record<string, unknown>[]): DatabaseClient {
  return vi.fn(() => Promise.resolve(rows)) as unknown as DatabaseClient;
}

describe('price-watch runner safety', () => {
  it('permits only the matching loopback local/test databases', () => {
    expect(
      assertPriceWatchRunTarget('postgres://goalpilot@localhost/goalpilot_local', 'local'),
    ).toBe('goalpilot_local');
    expect(assertPriceWatchRunTarget('postgres://goalpilot@127.0.0.1/goalpilot_test', 'test')).toBe(
      'goalpilot_test',
    );
    expect(() =>
      assertPriceWatchRunTarget('postgres://goalpilot@localhost/production', 'local'),
    ).toThrow(/Refusing destructive database action/);
    expect(() =>
      assertPriceWatchRunTarget('postgres://goalpilot@example.com/goalpilot_local', 'local'),
    ).toThrow(/Refusing destructive database action/);
    expect(() =>
      assertPriceWatchRunTarget('postgres://goalpilot@localhost/goalpilot_local', 'production'),
    ).toThrow(/disabled outside local\/test/);
  });

  it('resolves exactly one dedicated Japan fixture owner clock', async () => {
    const resolved = await resolveJapanFixtureClock(
      databaseReturning([
        {
          user_id: '01K3C8DEMX0000000000000000',
          application_date: new Date('2026-08-23T00:00:00Z'),
        },
      ]),
    );
    expect(resolved).toEqual({
      userId: '01K3C8DEMX0000000000000000',
      applicationDate: '2026-08-23',
    });
    await expect(resolveJapanFixtureClock(databaseReturning([]))).rejects.toThrow(
      /must exist exactly once/,
    );
    await expect(
      resolveJapanFixtureClock(
        databaseReturning([
          { user_id: 'one', application_date: '2026-08-23' },
          { user_id: 'two', application_date: '2026-08-23' },
        ]),
      ),
    ).rejects.toThrow(/must exist exactly once/);
  });
});
