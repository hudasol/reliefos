// Money is always an integer number of minor units (cents) paired with an ISO currency code.
// Floating-point dollars only exist at the edges: parsing provider prices and formatting for display.

export type CurrencyCode = 'USD';
export const SUPPORTED_CURRENCIES: readonly CurrencyCode[] = ['USD'];

export function isSupportedCurrency(code: string): code is CurrencyCode {
  return (SUPPORTED_CURRENCIES as readonly string[]).includes(code);
}

/** Convert a provider decimal amount (e.g. 12.99) to integer cents. Rejects non-finite or negative values. */
export function toCents(amount: number): number {
  if (!Number.isFinite(amount) || amount < 0) {
    throw new RangeError(`Invalid monetary amount: ${amount}`);
  }
  return Math.round(amount * 100);
}

/** Parse a PayPal-style decimal string ("123.45") into cents without floating-point drift. */
export function decimalStringToCents(value: string): number {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!match) throw new RangeError(`Invalid decimal amount: ${value}`);
  const whole = Number(match[1]);
  const frac = Number((match[2] ?? '').padEnd(2, '0'));
  return whole * 100 + frac;
}

/** Format cents as the decimal string PayPal expects ("123.45"). */
export function centsToDecimalString(cents: number): string {
  assertCents(cents);
  const whole = Math.floor(cents / 100);
  const frac = cents % 100;
  return `${whole}.${frac.toString().padStart(2, '0')}`;
}

export function assertCents(cents: number): void {
  if (!Number.isInteger(cents) || cents < 0) {
    throw new RangeError(`Cents must be a non-negative integer, got ${cents}`);
  }
}

export function sumCents(values: readonly number[]): number {
  let total = 0;
  for (const v of values) {
    assertCents(v);
    total += v;
  }
  return total;
}

export function formatMoney(cents: number, currency: CurrencyCode = 'USD'): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100);
}
