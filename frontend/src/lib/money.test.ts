import { describe, expect, it } from 'vitest';
import { inr } from './money';

describe('inr', () => {
  it('sits the symbol tight against the digits, as the design sets prices', () => {
    expect(inr(12499)).toBe('₹12,499');
  });

  it('groups the Indian way past a lakh', () => {
    expect(inr(1250000)).toBe('₹12,50,000');
  });

  it('accepts the decimal strings the API serves for money fields', () => {
    expect(inr('21999.00')).toBe('₹21,999');
  });

  it('falls back to zero rather than printing NaN into a cart or invoice', () => {
    expect(inr(undefined)).toBe('₹0');
    expect(inr(null)).toBe('₹0');
    expect(inr('')).toBe('₹0');
    expect(inr('sold out')).toBe('₹0');
  });
});
