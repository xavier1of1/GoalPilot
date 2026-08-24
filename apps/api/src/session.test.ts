import { describe, expect, it } from 'vitest';

import { canonicalRequestHash } from './session.js';

describe('canonical request hashing', () => {
  it('binds idempotency to content independent of object key insertion order', () => {
    expect(canonicalRequestHash({ amount: 100, nested: { date: '2026-08-23', ok: true } })).toBe(
      canonicalRequestHash({ nested: { ok: true, date: '2026-08-23' }, amount: 100 }),
    );
  });

  it('keeps array order and changed values distinct', () => {
    expect(canonicalRequestHash({ values: [1, 2] })).not.toBe(
      canonicalRequestHash({ values: [2, 1] }),
    );
    expect(canonicalRequestHash({ amount: 100 })).not.toBe(canonicalRequestHash({ amount: 101 }));
  });
});
