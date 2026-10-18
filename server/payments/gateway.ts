// Provider-neutral contract for the payment gateway. The PayPal implementation lives in paypal.ts;
// tests substitute a scripted gateway. Every call returns one of three outcomes, and "ambiguous" is a
// first-class result: a timeout or 5xx on a state-changing call proves nothing about what happened.

export interface GatewayOrderItem {
  name: string;
  sku: string;
  quantity: number;
  unitAmountCents: number;
}

export interface CreateOrderInput {
  /** Idempotency key sent as PayPal-Request-Id. Reusing it returns the original order. */
  requestId: string;
  referenceId: string;
  customId: string;
  invoiceId: string;
  description: string;
  currency: 'USD';
  items: GatewayOrderItem[];
  itemTotalCents: number;
  shippingCents: number;
  totalCents: number;
  returnUrl: string;
  cancelUrl: string;
}

export interface GatewayCapture {
  id: string;
  status: string;
  amountCents: number | null;
  currency: string | null;
}

export interface GatewayOrder {
  id: string;
  status: string;
  approveUrl: string | null;
  amountCents: number | null;
  currency: string | null;
  referenceId: string | null;
  customId: string | null;
  captures: GatewayCapture[];
}

export type GatewayResult<T> =
  | { kind: 'ok'; value: T; debugId: string | null }
  | {
      kind: 'rejected';
      status: number;
      name: string;
      message: string;
      issues: string[];
      debugId: string | null;
    }
  | { kind: 'ambiguous'; reason: string };

export interface PaymentGateway {
  readonly environment: 'sandbox' | 'live';
  createOrder(input: CreateOrderInput): Promise<GatewayResult<GatewayOrder>>;
  getOrder(orderId: string): Promise<GatewayResult<GatewayOrder>>;
  captureOrder(orderId: string, requestId: string): Promise<GatewayResult<GatewayOrder>>;
}
