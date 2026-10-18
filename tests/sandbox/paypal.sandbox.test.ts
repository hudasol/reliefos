import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { PayPalGateway } from '../../server/payments/paypal.js';

// Live PayPal Sandbox contract test. Runs only when PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET are set
// (sandbox REST app). It creates a real sandbox order, proves PayPal-Request-Id idempotency returns
// the same order, and reads it back. Capture needs a sandbox buyer to approve in the browser, which is
// exercised manually through the app (see docs/DEMO.md).

const id = process.env.PAYPAL_CLIENT_ID;
const secret = process.env.PAYPAL_CLIENT_SECRET;

describe.skipIf(!id || !secret)('PayPal Sandbox (live)', () => {
  const gw = new PayPalGateway({
    clientId: id!,
    clientSecret: secret!,
    environment: 'sandbox',
    timeoutMs: 20_000,
  });
  const requestId = randomUUID();
  const input = {
    requestId,
    referenceId: `sandbox-test-${requestId.slice(0, 8)}`,
    customId: `op-${requestId.slice(0, 8)}`,
    invoiceId: `RLF-TEST-${requestId}`,
    description: 'RELIEFOS sandbox contract test',
    currency: 'USD' as const,
    items: [
      { name: 'Drinking water, pack of 24', sku: 'test-water', quantity: 2, unitAmountCents: 549 },
    ],
    itemTotalCents: 1098,
    shippingCents: 300,
    totalCents: 1398,
    returnUrl: 'https://example.com/return',
    cancelUrl: 'https://example.com/cancel',
  };

  it('creates an order, honours the idempotency key, and reads it back', async () => {
    const first = await gw.createOrder(input);
    expect(first.kind, JSON.stringify(first)).toBe('ok');
    if (first.kind !== 'ok') return;
    expect(['CREATED', 'PAYER_ACTION_REQUIRED']).toContain(first.value.status);
    expect(first.value.amountCents).toBe(1398);
    expect(first.value.approveUrl).toMatch(/sandbox\.paypal\.com/);

    const repeat = await gw.createOrder(input);
    expect(repeat.kind === 'ok' && repeat.value.id).toBe(first.value.id);

    const read = await gw.getOrder(first.value.id);
    expect(read.kind === 'ok' && read.value.customId).toBe(input.customId);
  }, 60_000);

  it('refuses to capture an order the payer has not approved', async () => {
    const created = await gw.createOrder({
      ...input,
      requestId: randomUUID(),
      invoiceId: `RLF-TEST-${randomUUID()}`,
    });
    if (created.kind !== 'ok') throw new Error(JSON.stringify(created));
    const cap = await gw.captureOrder(created.value.id, randomUUID());
    expect(cap.kind).toBe('rejected');
    if (cap.kind === 'rejected')
      expect(cap.issues.join(',')).toMatch(/ORDER_NOT_APPROVED|PAYER_ACTION_REQUIRED/);
  }, 60_000);
});
