import { describe, expect, it } from 'vitest';

import { calculatePrincipalCompositionBasisPoints } from './repository.js';

describe('account summary composition', () => {
  it('derives a bounded basis-point share from principal and total ledger value', () => {
    expect(calculatePrincipalCompositionBasisPoints(100_000, 25_000)).toBe(8_000);
    expect(calculatePrincipalCompositionBasisPoints(100_000, 1)).toBe(10_000);
    expect(calculatePrincipalCompositionBasisPoints(0, 0)).toBe(0);
    expect(calculatePrincipalCompositionBasisPoints(600_000, 0)).toBe(10_000);
  });

  it('rejects invalid principal inputs', () => {
    expect(() => calculatePrincipalCompositionBasisPoints(-1, 100)).toThrow(RangeError);
    expect(() => calculatePrincipalCompositionBasisPoints(1.5, 100)).toThrow(RangeError);
    expect(() => calculatePrincipalCompositionBasisPoints(100, -1)).toThrow(RangeError);
  });
});
