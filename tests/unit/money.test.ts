import { describe, expect, it } from 'vitest';
import { centsToDecimalString, decimalStringToCents, sumCents, toCents } from '../../shared/money.js';

describe('money', () => {
  it('converts provider decimals to integer cents without drift', () => {
    expect(toCents(19.99)).toBe(1999);
    expect(toCents(0.1 + 0.2)).toBe(30);
  });
  it('round-trips PayPal decimal strings', () => {
    expect(centsToDecimalString(123456)).toBe('1234.56');
    expect(centsToDecimalString(5)).toBe('0.05');
    expect(decimalStringToCents('1234.5')).toBe(123450);
    expect(decimalStringToCents('7')).toBe(700);
  });
  it('rejects invalid amounts', () => {
    expect(() => toCents(-1)).toThrow(RangeError);
    expect(() => toCents(Number.NaN)).toThrow(RangeError);
    expect(() => decimalStringToCents('12.345')).toThrow(RangeError);
    expect(() => centsToDecimalString(1.5)).toThrow(RangeError);
    expect(() => sumCents([100, -1])).toThrow(RangeError);
  });
});
