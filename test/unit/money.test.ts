import { describe, expect, it } from 'vitest';
import { formatMinor } from '../../src/shared/money';

describe('formatMinor', () => {
  it('formats EUR and USD with 2 minor digits', () => {
    expect(formatMinor(25000, 'EUR')).toBe('€250.00');
    expect(formatMinor(600, 'USD')).toBe('$6.00');
    expect(formatMinor(4900, 'USD')).toBe('$49.00');
  });

  it('handles zero, sub-unit values and grouping', () => {
    expect(formatMinor(0, 'USD')).toBe('$0.00');
    expect(formatMinor(5, 'USD')).toBe('$0.05');
    expect(formatMinor(9900000, 'USD')).toBe('$99,000.00');
  });

  it('is exact for large safe integers', () => {
    expect(formatMinor(Number.MAX_SAFE_INTEGER, 'USD')).toBe(
      '$90,071,992,547,409.91',
    );
  });
});
