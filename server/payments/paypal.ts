import {
  ApiError,
  CheckoutPaymentIntent,
  Client,
  Environment,
  ItemCategory,
  OrdersController,
  PaypalExperienceUserAction,
  PaypalWalletContextShippingPreference,
} from '@paypal/paypal-server-sdk';
import type { Order, OrderRequest } from '@paypal/paypal-server-sdk';
import { centsToDecimalString, decimalStringToCents } from '../../shared/money.js';
import type { CreateOrderInput, GatewayOrder, GatewayResult, PaymentGateway } from './gateway.js';

// PayPal Orders v2 through the APIMatic-generated PayPal Server SDK (@paypal/paypal-server-sdk 2.5.0).
// Integration rules taken from the SDK source and the APIMatic PayPal context plugin skills:
//  - DEFAULT_CONFIGURATION.timeout is 0 (no timeout), so a timeout is always set explicitly.
//  - The SDK retries only GET/PUT by default; POSTs (create, capture) are never retried by the SDK.
//    RELIEFOS owns retries for POSTs and only repeats them with the same PayPal-Request-Id.
//  - The per-request timeout does not cover the OAuth token exchange, so each call is also raced
//    against an overall deadline.
//  - Error payloads keep PayPal's wire field names (debug_id, details[].issue).

export interface PayPalOptions {
  clientId: string;
  clientSecret: string;
  environment: 'sandbox';
  timeoutMs: number;
  /** Test seam: an axios adapter passed through `unstable_httpClientOptions`. */
  httpAdapter?: (config: unknown) => Promise<unknown>;
}

class DeadlineExceeded extends Error {}

function withDeadline<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout;
  return Promise.race([
    p.finally(() => clearTimeout(timer)),
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new DeadlineExceeded(`PayPal call exceeded ${ms} ms`)), ms);
    }),
  ]);
}

export function toGatewayOrder(o: Order): GatewayOrder {
  const pu = o.purchaseUnits?.[0];
  const link = o.links?.find((l) => l.rel === 'payer-action') ?? o.links?.find((l) => l.rel === 'approve');
  return {
    id: o.id ?? '',
    status: o.status ?? 'UNKNOWN',
    approveUrl: link?.href ?? null,
    amountCents: pu?.amount?.value ? decimalStringToCents(pu.amount.value) : null,
    currency: pu?.amount?.currencyCode ?? null,
    referenceId: pu?.referenceId ?? null,
    customId: pu?.customId ?? null,
    captures: (pu?.payments?.captures ?? []).map((c) => ({
      id: c.id ?? '',
      status: c.status ?? 'UNKNOWN',
      amountCents: c.amount?.value ? decimalStringToCents(c.amount.value) : null,
      currency: c.amount?.currencyCode ?? null,
    })),
  };
}

export function buildOrderRequest(input: CreateOrderInput): OrderRequest {
  const money = (cents: number) => ({ currencyCode: input.currency, value: centsToDecimalString(cents) });
  return {
    intent: CheckoutPaymentIntent.Capture,
    purchaseUnits: [
      {
        referenceId: input.referenceId,
        customId: input.customId,
        invoiceId: input.invoiceId,
        description: input.description.slice(0, 127),
        amount: {
          ...money(input.totalCents),
          breakdown: { itemTotal: money(input.itemTotalCents), shipping: money(input.shippingCents) },
        },
        items: input.items.map((i) => ({
          name: i.name.slice(0, 127),
          sku: i.sku.slice(0, 127),
          quantity: String(i.quantity),
          unitAmount: money(i.unitAmountCents),
          category: ItemCategory.PhysicalGoods,
        })),
      },
    ],
    paymentSource: {
      paypal: {
        experienceContext: {
          brandName: 'RELIEFOS',
          returnUrl: input.returnUrl,
          cancelUrl: input.cancelUrl,
          userAction: PaypalExperienceUserAction.PayNow,
          shippingPreference: PaypalWalletContextShippingPreference.NoShipping,
        },
      },
    },
  };
}

interface PayPalErrorBody {
  name?: string;
  message?: string;
  debug_id?: string;
  details?: { issue?: string; description?: string }[];
}

function parseErrorBody(err: ApiError): PayPalErrorBody {
  const fromResult = (err as ApiError<PayPalErrorBody>).result;
  if (fromResult && typeof fromResult === 'object') return fromResult;
  if (typeof err.body === 'string') {
    try {
      return JSON.parse(err.body) as PayPalErrorBody;
    } catch {
      return {};
    }
  }
  return {};
}

export class PayPalGateway implements PaymentGateway {
  readonly environment = 'sandbox' as const;
  private readonly orders: OrdersController;
  private readonly overallMs: number;

  constructor(opts: PayPalOptions) {
    const client = new Client({
      clientCredentialsAuthCredentials: { oAuthClientId: opts.clientId, oAuthClientSecret: opts.clientSecret },
      environment: Environment.Sandbox,
      timeout: opts.timeoutMs,
      httpClientOptions: {
        timeout: opts.timeoutMs,
        retryConfig: {
          maxNumberOfRetries: 2,
          maximumRetryWaitTime: 6,
          retryInterval: 1,
          backoffFactor: 2,
          retryOnTimeout: true,
          httpStatusCodesToRetry: [408, 429, 500, 502, 503, 504],
          httpMethodsToRetry: ['GET'],
        },
      },
      ...(opts.httpAdapter ? { unstable_httpClientOptions: { adapter: opts.httpAdapter } } : {}),
    });
    this.orders = new OrdersController(client);
    // Token exchange + request + bounded GET retries.
    this.overallMs = opts.timeoutMs * 2 + 8_000;
  }

  private async call(fn: () => Promise<{ result: Order; headers: Record<string, string> }>, stateChanging: boolean): Promise<GatewayResult<GatewayOrder>> {
    try {
      const res = await withDeadline(fn(), this.overallMs);
      return { kind: 'ok', value: toGatewayOrder(res.result), debugId: res.headers['paypal-debug-id'] ?? null };
    } catch (err) {
      if (err instanceof ApiError) {
        const body = parseErrorBody(err);
        // A 5xx on a state-changing call is ambiguous: PayPal may or may not have acted.
        if (err.statusCode >= 500 && stateChanging) {
          return { kind: 'ambiguous', reason: `PayPal returned HTTP ${err.statusCode} (${body.debug_id ?? 'no debug id'})` };
        }
        return {
          kind: 'rejected',
          status: err.statusCode,
          name: body.name ?? `HTTP_${err.statusCode}`,
          message: body.message ?? 'PayPal rejected the request',
          issues: (body.details ?? []).map((d) => d.issue ?? '').filter(Boolean),
          debugId: body.debug_id ?? null,
        };
      }
      // Timeouts, connection resets and DNS failures: the request may have reached PayPal.
      const reason = err instanceof DeadlineExceeded ? err.message : `Transport error: ${(err as Error).message}`;
      if (stateChanging) return { kind: 'ambiguous', reason };
      return { kind: 'rejected', status: 0, name: 'TRANSPORT_ERROR', message: reason, issues: [], debugId: null };
    }
  }

  createOrder(input: CreateOrderInput) {
    return this.call(
      () => this.orders.createOrder({ body: buildOrderRequest(input), paypalRequestId: input.requestId, prefer: 'return=representation' }),
      true,
    );
  }

  getOrder(orderId: string) {
    return this.call(() => this.orders.getOrder({ id: orderId }), false);
  }

  captureOrder(orderId: string, requestId: string) {
    return this.call(
      () => this.orders.captureOrder({ id: orderId, paypalRequestId: requestId, prefer: 'return=representation' }),
      true,
    );
  }
}
