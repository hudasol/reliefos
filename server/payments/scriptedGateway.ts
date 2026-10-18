import type { CreateOrderInput, GatewayOrder, GatewayResult, PaymentGateway } from './gateway.js';

// A scripted, in-memory stand-in for PayPal Orders v2. Used ONLY by the isolated Security Lab and the
// test suite to reproduce provider failure modes (timeouts, ambiguous responses, duplicate requests)
// that cannot be triggered on demand against the real sandbox. It never backs a live mission payment.
// It honours PayPal-Request-Id semantics: repeating a request id returns the original result.

interface StoredOrder {
  order: GatewayOrder;
  input: CreateOrderInput;
  approved: boolean;
}

export type ScriptedFault =
  | { op: 'create' | 'capture' | 'get'; kind: 'ambiguous-after-success' }
  | { op: 'create' | 'capture' | 'get'; kind: 'ambiguous-before-success' }
  | { op: 'capture'; kind: 'amount-mismatch' }
  | { op: 'capture'; kind: 'pending' }
  | { op: 'capture'; kind: 'declined' };

export class ScriptedGateway implements PaymentGateway {
  readonly environment = 'sandbox' as const;
  readonly orders = new Map<string, StoredOrder>();
  private readonly requestIds = new Map<string, GatewayResult<GatewayOrder>>();
  readonly calls: { op: string; orderId?: string; requestId?: string }[] = [];
  private faults: ScriptedFault[] = [];
  private seq = 0;

  /** Queue a fault for the next call of the given operation. */
  inject(fault: ScriptedFault) {
    this.faults.push(fault);
  }

  /** Simulate the payer approving the order in PayPal's UI. */
  payerApproves(orderId: string) {
    const o = this.orders.get(orderId);
    if (!o) throw new Error(`no order ${orderId}`);
    o.approved = true;
    o.order = { ...o.order, status: 'APPROVED' };
  }

  get captureCalls() {
    return this.calls.filter((c) => c.op === 'capture').length;
  }
  get createCalls() {
    return this.calls.filter((c) => c.op === 'create').length;
  }

  private takeFault(op: ScriptedFault['op']) {
    const i = this.faults.findIndex((f) => f.op === op);
    return i === -1 ? null : this.faults.splice(i, 1)[0]!;
  }

  async createOrder(input: CreateOrderInput): Promise<GatewayResult<GatewayOrder>> {
    this.calls.push({ op: 'create', requestId: input.requestId });
    const fault = this.takeFault('create');
    if (fault?.kind === 'ambiguous-before-success')
      return { kind: 'ambiguous', reason: 'scripted timeout before PayPal received the request' };
    const prior = this.requestIds.get(`create:${input.requestId}`);
    if (prior) return prior;
    const id = `SCRIPTED-${String(++this.seq).padStart(6, '0')}`;
    const order: GatewayOrder = {
      id,
      status: 'PAYER_ACTION_REQUIRED',
      approveUrl: `https://www.sandbox.paypal.com/checkoutnow?token=${id}`,
      amountCents: input.totalCents,
      currency: input.currency,
      referenceId: input.referenceId,
      customId: input.customId,
      captures: [],
    };
    this.orders.set(id, { order, input, approved: false });
    const result: GatewayResult<GatewayOrder> = { kind: 'ok', value: order, debugId: `dbg-${id}` };
    this.requestIds.set(`create:${input.requestId}`, result);
    if (fault?.kind === 'ambiguous-after-success')
      return { kind: 'ambiguous', reason: 'scripted timeout after PayPal created the order' };
    return result;
  }

  async getOrder(orderId: string): Promise<GatewayResult<GatewayOrder>> {
    this.calls.push({ op: 'get', orderId });
    const fault = this.takeFault('get');
    if (fault)
      return {
        kind: 'rejected',
        status: 503,
        name: 'SERVICE_UNAVAILABLE',
        message: 'scripted outage',
        issues: [],
        debugId: null,
      };
    const o = this.orders.get(orderId);
    if (!o)
      return {
        kind: 'rejected',
        status: 404,
        name: 'RESOURCE_NOT_FOUND',
        message: 'order not found',
        issues: ['INVALID_RESOURCE_ID'],
        debugId: null,
      };
    return { kind: 'ok', value: o.order, debugId: null };
  }

  async captureOrder(orderId: string, requestId: string): Promise<GatewayResult<GatewayOrder>> {
    this.calls.push({ op: 'capture', orderId, requestId });
    const fault = this.takeFault('capture');
    if (fault?.kind === 'ambiguous-before-success')
      return { kind: 'ambiguous', reason: 'scripted timeout before PayPal received the capture' };
    const prior = this.requestIds.get(`capture:${requestId}`);
    if (prior) return prior;
    const o = this.orders.get(orderId);
    if (!o)
      return {
        kind: 'rejected',
        status: 404,
        name: 'RESOURCE_NOT_FOUND',
        message: 'order not found',
        issues: [],
        debugId: null,
      };
    if (o.order.status === 'COMPLETED')
      return {
        kind: 'rejected',
        status: 422,
        name: 'UNPROCESSABLE_ENTITY',
        message: 'already captured',
        issues: ['ORDER_ALREADY_CAPTURED'],
        debugId: null,
      };
    if (!o.approved)
      return {
        kind: 'rejected',
        status: 422,
        name: 'UNPROCESSABLE_ENTITY',
        message: 'not approved',
        issues: ['ORDER_NOT_APPROVED'],
        debugId: null,
      };
    if (fault?.kind === 'declined') {
      return {
        kind: 'rejected',
        status: 422,
        name: 'UNPROCESSABLE_ENTITY',
        message: 'instrument declined',
        issues: ['INSTRUMENT_DECLINED'],
        debugId: null,
      };
    }
    const status = fault?.kind === 'pending' ? 'PENDING' : 'COMPLETED';
    const amount =
      fault?.kind === 'amount-mismatch' ? o.input.totalCents - 1000 : o.input.totalCents;
    o.order = {
      ...o.order,
      status: 'COMPLETED',
      captures: [{ id: `CAP-${orderId}`, status, amountCents: amount, currency: 'USD' }],
    };
    const result: GatewayResult<GatewayOrder> = {
      kind: 'ok',
      value: o.order,
      debugId: `dbg-cap-${orderId}`,
    };
    this.requestIds.set(`capture:${requestId}`, result);
    if (fault?.kind === 'ambiguous-after-success')
      return { kind: 'ambiguous', reason: 'scripted timeout after PayPal captured the payment' };
    return result;
  }
}
