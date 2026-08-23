import { describe, expect, it } from 'vitest';

import { dollarsToCents, formatMoney } from './format.js';

describe('currency presentation boundary', () => {
  it('parses dollars into exact integer cents', () => {
    expect(dollarsToCents('$1,234.50')).toBe(123_450);
    expect(dollarsToCents('10.2')).toBe(1_020);
    expect(() => dollarsToCents('1.234')).toThrow('valid dollar amount');
  });

  it('formats integer cents as USD', () => {
    expect(formatMoney(123_450)).toBe('$1,234.50');
  });
});
