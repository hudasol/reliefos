import { describe, expect, it } from 'vitest';
import { PayPalGateway } from '../../server/payments/paypal.js';
import type { CreateOrderInput } from '../../server/payments/gateway.js';

// Exercises the real APIMatic-generated SDK end to end with an in-process axios adapter (the seam the
// APIMatic testing skill documents): request serialisation, auth, headers and response/error parsing.

interface Captured {
  url: string;
  method: string;
  headers: Record<string, string>;
  data: unknown;
}

type Responder = (req: Captured) => { status: number; body: unknown } | 'timeout' | 'network';

function gatewayWith(responder: Responder, timeoutMs = 2000) {
  const requests: Captured[] = [];
  const gw = new PayPalGateway({
    clientId: 'test-client',
    clientSecret: 'test-secret',
    environment: 'sandbox',
    timeoutMs,
    httpAdapter: async (config: unknown) => {
      const c = config as {
        url: string;
        method: string;
        headers: Record<string, string>;
        data: unknown;
      };
      let data: unknown = c.data;
      if (typeof c.data === 'string') {
        try {
          data = JSON.parse(c.data);
        } catch {
          data = c.data; // form-encoded token request
        }
      }
      const req: Captured = {
        url: c.url,
        method: String(c.method).toUpperCase(),
        headers: c.headers,
        data,
      };
      requests.push(req);
      if (req.url.includes('/v1/oauth2/token')) {
        return {
          data: JSON.stringify({ access_token: 'tok', token_type: 'Bearer', expires_in: 32400 }),
          status: 200,
          statusText: 'OK',
          headers: { 'content-type': 'application/json' },
          config,
        };
      }
      const r = responder(req);
      if (r === 'timeout') return new Promise(() => undefined);
      if (r === 'network') throw Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' });
      return {
        data: JSON.stringify(r.body),
        status: r.status,
        statusText: '',
        headers: { 'content-type': 'application/json', 'paypal-debug-id': 'dbg-123' },
        config,
      };
    },
  });
  return { gw, requests: () => requests.filter((r) => !r.url.includes('oauth2')) };
}

const input: CreateOrderInput = {
  requestId: '6f1d3a4e-0000-4000-8000-000000000001',
  referenceId: 'proposal-1',
  customId: 'op-1',
  invoiceId: 'RLF-op-1',
  description: 'RELIEFOS mission procurement',
  currency: 'USD',
  items: [
    { name: 'Drinking Water, Pack of 24', sku: 'src-1', quantity: 3, unitAmountCents: 549 },
    { name: 'Fleece Blankets, Pack of 12', sku: 'src-2', quantity: 2, unitAmountCents: 9400 },
  ],
  itemTotalCents: 3 * 549 + 2 * 9400,
  shippingCents: 2650,
  totalCents: 3 * 549 + 2 * 9400 + 2650,
  returnUrl: 'https://example.test/return',
  cancelUrl: 'https://example.test/cancel',
};

const order = (status: string, extra: Record<string, unknown> = {}) => ({
  id: 'ORDER-1',
  status,
  purchase_units: [
    {
      reference_id: 'proposal-1',
      custom_id: 'op-1',
      amount: { currency_code: 'USD', value: '232.97' },
      ...extra,
    },
  ],
  links: [
    {
      href: 'https://www.sandbox.paypal.com/checkoutnow?token=ORDER-1',
      rel: 'payer-action',
      method: 'GET',
    },
  ],
});

describe('PayPal gateway (APIMatic Server SDK)', () => {
  it('serialises an Orders v2 request with breakdown, idempotency key and representation preference', async () => {
    const { gw, requests } = gatewayWith(() => ({
      status: 200,
      body: order('PAYER_ACTION_REQUIRED'),
    }));
    const res = await gw.createOrder(input);
    expect(res.kind).toBe('ok');
    if (res.kind !== 'ok') return;
    expect(res.value).toMatchObject({
      id: 'ORDER-1',
      status: 'PAYER_ACTION_REQUIRED',
      amountCents: 23297,
      referenceId: 'proposal-1',
      customId: 'op-1',
    });
    expect(res.value.approveUrl).toContain('checkoutnow');
    const [req] = requests();
    expect(req!.url).toMatch(/api-m\.sandbox\.paypal\.com\/v2\/checkout\/orders$/);
    expect(req!.headers['PayPal-Request-Id'] ?? req!.headers['paypal-request-id']).toBe(
      input.requestId,
    );
    expect(req!.headers['Prefer'] ?? req!.headers['prefer']).toBe('return=representation');
    const body = req!.data as Record<string, any>;
    expect(body.intent).toBe('CAPTURE');
    expect(body.purchase_units[0].amount).toEqual({
      currency_code: 'USD',
      value: '230.97',
      breakdown: {
        item_total: { currency_code: 'USD', value: '204.47' },
        shipping: { currency_code: 'USD', value: '26.50' },
      },
    });
    expect(body.purchase_units[0].items[0]).toMatchObject({
      quantity: '3',
      unit_amount: { value: '5.49' },
      category: 'PHYSICAL_GOODS',
    });
    expect(body.payment_source.paypal.experience_context).toMatchObject({
      user_action: 'PAY_NOW',
      shipping_preference: 'NO_SHIPPING',
    });
  });

  it('parses a completed capture', async () => {
    const { gw } = gatewayWith(() => ({
      status: 201,
      body: order('COMPLETED', {
        payments: {
          captures: [
            { id: 'CAP-1', status: 'COMPLETED', amount: { currency_code: 'USD', value: '232.97' } },
          ],
        },
      }),
    }));
    const res = await gw.captureOrder('ORDER-1', 'cap-req-1');
    expect(res.kind === 'ok' && res.value.captures).toEqual([
      { id: 'CAP-1', status: 'COMPLETED', amountCents: 23297, currency: 'USD' },
    ]);
  });

  it('maps a 422 business error to a definitive rejection with PayPal issue codes', async () => {
    const { gw } = gatewayWith(() => ({
      status: 422,
      body: {
        name: 'UNPROCESSABLE_ENTITY',
        message: 'The requested action could not be performed',
        debug_id: 'dbg-9',
        details: [{ issue: 'ORDER_ALREADY_CAPTURED', description: 'Order already captured.' }],
      },
    }));
    const res = await gw.captureOrder('ORDER-1', 'cap-req-1');
    expect(res).toMatchObject({
      kind: 'rejected',
      status: 422,
      name: 'UNPROCESSABLE_ENTITY',
      issues: ['ORDER_ALREADY_CAPTURED'],
      debugId: 'dbg-9',
    });
  });

  it('treats a 5xx on capture as ambiguous rather than failed', async () => {
    const { gw } = gatewayWith(() => ({
      status: 503,
      body: { name: 'SERVICE_UNAVAILABLE', debug_id: 'dbg-5' },
    }));
    expect((await gw.captureOrder('ORDER-1', 'cap-req-1')).kind).toBe('ambiguous');
  });

  it('treats a transport failure on create as ambiguous', async () => {
    const { gw } = gatewayWith(() => 'network');
    expect((await gw.createOrder(input)).kind).toBe('ambiguous');
  });

  it('bounds a hung capture with its own deadline and reports it as ambiguous', async () => {
    const { gw } = gatewayWith(() => 'timeout', 200);
    const started = Date.now();
    const res = await gw.captureOrder('ORDER-1', 'cap-req-1');
    expect(res.kind).toBe('ambiguous');
    expect(Date.now() - started).toBeLessThan(15_000);
  });
});
