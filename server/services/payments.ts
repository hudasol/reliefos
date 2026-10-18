import type { Mission, PaymentOperation, Proposal } from '../../shared/types.js';
import { canTransition, MISSION_TRANSITIONS, type PaymentStatus } from '../../shared/states.js';
import { DomainError, conflict, illegalState } from '../domain/errors.js';
import type { GatewayOrder, GatewayResult, PaymentGateway } from '../payments/gateway.js';
import type { PaymentRow, Store } from '../repo/store.js';
import { PolicyDeniedError } from './approvals.js';
import { rebuildSchedule } from './planning.js';
import {
  evaluateAndRecord,
  inTx,
  loadPolicyContext,
  missionCommitments,
  newId,
  store,
  type Deps,
} from './core.js';

// PayPal Orders v2 lifecycle, bound to an approved proposal.
//  create order (server) → payer approves in PayPal → server verifies APPROVED with GET → capture
//  (with a stored PayPal-Request-Id) → server verifies the capture with GET → COMPLETED.
// A timeout or 5xx at any state-changing step moves the operation to UNKNOWN; only reconciliation
// (an authoritative read from PayPal) can move it on, and retries reuse the original request ids.

const clientView = (p: PaymentRow): PaymentOperation => {
  const { createRequestId: _a, captureRequestId: _b, attempts: _c, ...rest } = p;
  return rest;
};

function requireGateway(deps: Deps): PaymentGateway {
  if (!deps.gateway) {
    throw new DomainError(
      'INTEGRATION_NOT_CONFIGURED',
      'PayPal Sandbox credentials are not configured on this deployment; payments are disabled (never simulated).',
    );
  }
  return deps.gateway;
}

async function finalizeCompleted(
  s: Store,
  deps: Deps,
  workspaceId: string,
  mission: Mission,
  op: PaymentRow,
  from: PaymentStatus,
  order: GatewayOrder,
) {
  const capture = order.captures[0]!;
  await s.updatePayment(op.id, from, 'COMPLETED', {
    providerCaptureId: capture.id,
    providerCaptureStatus: capture.status,
    providerOrderStatus: order.status,
    verifiedAt: deps.now().toISOString(),
    lastError: null,
  });
  const proposal = await s.getProposal(mission.id, op.proposalId, true);
  if (proposal.status === 'EXECUTION_PENDING' || proposal.status === 'UNKNOWN')
    await s.setProposalStatus(proposal.id, proposal.status, 'EXECUTED');
  await s.consumeApproval(op.approvalId).catch(() => undefined);
  await rebuildSchedule(s, mission, proposal, true);

  const { purchasedUnits } = await missionCommitments(s, mission.id, null);
  const reqs = await s.listRequirements(mission.id);
  const gaps = reqs.filter((r) => (purchasedUnits[r.id] ?? 0) < r.quantity);
  const m = await s.getMission(workspaceId, mission.id, true);
  const next = gaps.length === 0 ? 'COMPLETED' : 'PARTIALLY_FULFILLED';
  if (canTransition(MISSION_TRANSITIONS, m.status, next))
    await s.setMissionStatus(mission.id, m.status, next);
  await s.audit({
    workspaceId,
    missionId: mission.id,
    type: 'payment.completed',
    actor: 'paypal:verified',
    summary: `PayPal capture ${capture.id} verified COMPLETED for $${(op.amountCents / 100).toFixed(2)} (order ${order.id})`,
    data: {
      operationId: op.id,
      orderId: order.id,
      captureId: capture.id,
      amountCents: capture.amountCents,
      verification: 'GET /v2/checkout/orders/{id}',
    },
  });
  await s.audit({
    workspaceId,
    missionId: mission.id,
    type: next === 'COMPLETED' ? 'mission.completed' : 'mission.partially_fulfilled',
    actor: 'system',
    summary:
      next === 'COMPLETED'
        ? 'All requirements purchased'
        : `Purchased; ${gaps.length} requirement(s) still short: ${gaps.map((g) => g.label).join(', ')}`,
    data: {
      gaps: gaps.map((g) => ({
        id: g.id,
        label: g.label,
        needed: g.quantity,
        purchased: purchasedUnits[g.id] ?? 0,
      })),
    },
  });
}

/** Return the operation to a state from which the coordinator can retry with a fresh order. */
async function releaseToApproved(s: Store, workspaceId: string, missionId: string, op: PaymentRow) {
  const proposal = await s.getProposal(missionId, op.proposalId, true);
  if (proposal.status === 'EXECUTION_PENDING' || proposal.status === 'UNKNOWN')
    await s.setProposalStatus(proposal.id, proposal.status, 'APPROVED');
  const m = await s.getMission(workspaceId, missionId, true);
  if (m.status === 'EXECUTING')
    await s.setMissionStatus(missionId, 'EXECUTING', 'READY_FOR_APPROVAL');
}

function validateCreatedOrder(
  order: GatewayOrder,
  op: PaymentRow,
  proposal: Proposal,
): string | null {
  if (!order.id) return 'PayPal returned no order id';
  if (!['CREATED', 'PAYER_ACTION_REQUIRED', 'APPROVED'].includes(order.status))
    return `Unexpected order status ${order.status}`;
  if (order.amountCents !== null && order.amountCents !== op.amountCents)
    return `Order amount ${order.amountCents} ≠ approved ${op.amountCents}`;
  if (order.currency !== null && order.currency !== op.currency)
    return `Order currency ${order.currency} ≠ ${op.currency}`;
  if (order.customId !== null && order.customId !== op.id)
    return 'Order custom_id does not match the payment operation';
  if (order.referenceId !== null && order.referenceId !== proposal.id)
    return 'Order reference_id does not match the proposal';
  return null;
}

async function applyCreateResult(
  deps: Deps,
  workspaceId: string,
  missionId: string,
  opId: string,
  from: PaymentStatus,
  result: GatewayResult<GatewayOrder>,
) {
  return inTx(deps, async (s) => {
    const op = await s.getPayment(missionId, opId, true);
    if (op.status !== from) throw conflict('Payment operation changed concurrently');
    const proposal = await s.getProposal(missionId, op.proposalId, true);
    if (result.kind === 'ok') {
      const problem = validateCreatedOrder(result.value, op, proposal);
      if (problem) {
        await s.updatePayment(op.id, from, 'FAILED', {
          providerOrderId: result.value.id || null,
          lastError: { code: 'ORDER_MISMATCH', message: problem },
        });
        await releaseToApproved(s, workspaceId, missionId, op);
        await s.audit({
          workspaceId,
          missionId,
          type: 'payment.failed',
          actor: 'system',
          summary: `PayPal order rejected by RELIEFOS validation: ${problem}`,
          data: { operationId: op.id },
        });
        return;
      }
      await s.updatePayment(op.id, from, 'CREATED', {
        providerOrderId: result.value.id,
        providerOrderStatus: result.value.status,
        providerDebugId: result.debugId,
        lastError: null,
      });
      await s.updatePayment(op.id, 'CREATED', 'APPROVAL_PENDING', {
        approveUrl: result.value.approveUrl,
      });
      if (proposal.status === 'UNKNOWN')
        await s.setProposalStatus(proposal.id, 'UNKNOWN', 'EXECUTION_PENDING');
      await s.audit({
        workspaceId,
        missionId,
        type: 'payment.order_created',
        actor: 'paypal',
        summary: `PayPal order ${result.value.id} created for $${(op.amountCents / 100).toFixed(2)}; awaiting payer approval`,
        data: {
          operationId: op.id,
          orderId: result.value.id,
          status: result.value.status,
          debugId: result.debugId,
        },
      });
    } else if (result.kind === 'rejected') {
      await s.updatePayment(op.id, from, 'FAILED', {
        lastError: {
          code: result.name,
          message: `${result.message}${result.issues.length ? ` (${result.issues.join(', ')})` : ''}`,
        },
        providerDebugId: result.debugId,
      });
      await releaseToApproved(s, workspaceId, missionId, op);
      await s.audit({
        workspaceId,
        missionId,
        type: 'payment.failed',
        actor: 'paypal',
        summary: `PayPal rejected order creation: ${result.name}`,
        data: { operationId: op.id, issues: result.issues, debugId: result.debugId },
      });
    } else {
      if (from !== 'UNKNOWN')
        await s.updatePayment(op.id, from, 'UNKNOWN', {
          lastError: { code: 'AMBIGUOUS_CREATE', message: result.reason },
        });
      if (proposal.status === 'EXECUTION_PENDING')
        await s.setProposalStatus(proposal.id, 'EXECUTION_PENDING', 'UNKNOWN');
      await s.audit({
        workspaceId,
        missionId,
        type: 'payment.outcome_unknown',
        actor: 'system',
        summary: `Order creation outcome unknown (${result.reason}); reconcile before any retry`,
        data: { operationId: op.id },
      });
    }
  });
}

export async function createPayment(
  deps: Deps,
  workspaceId: string,
  missionId: string,
  proposalId: string,
  approvalId: string,
  actor: string,
): Promise<PaymentOperation> {
  const gateway = requireGateway(deps);
  const now = deps.now();
  const prepared = await inTx(deps, async (s) => {
    const mission = await s.getMission(workspaceId, missionId, true);
    const proposal = await s.getProposal(missionId, proposalId, true);
    const live = (await s.listPayments(missionId)).find(
      (p) => p.proposalId === proposalId && !['FAILED', 'CANCELLED'].includes(p.status),
    );
    if (live) {
      if (live.status === 'APPROVAL_PENDING' || live.status === 'CREATED')
        return { existing: live } as const; // duplicate click: same order
      if (live.status === 'COMPLETED') throw conflict('This proposal has already been paid');
      throw new DomainError(
        'PAYMENT_UNRESOLVED',
        `A payment for this proposal is ${live.status}; reconcile it with PayPal before retrying`,
        { operationId: live.id },
      );
    }
    if (proposal.status !== 'APPROVED')
      throw illegalState(
        `Proposal v${proposal.version} is ${proposal.status}; it must be APPROVED`,
      );

    // Revalidate immediately before the payment operation.
    const ctx = await loadPolicyContext(s, mission, proposal, 'execution', { approvalId, now });
    const decision = await evaluateAndRecord(s, ctx);
    if (decision.outcome === 'DENY') {
      await s.invalidateApprovals(
        { missionId, proposalId },
        `Revalidation failed before payment: ${decision.violations.map((v) => v.checkId).join(', ')}`,
      );
      await s.setProposalStatus(proposal.id, 'APPROVED', 'INVALIDATED');
      await s.setMissionStatus(missionId, mission.status, 'NEEDS_REVIEW');
      await rebuildSchedule(s, mission, proposal, false);
      await s.audit({
        workspaceId,
        missionId,
        type: 'payment.blocked',
        actor: 'policy:deadman',
        summary: `Payment for v${proposal.version} blocked before reaching PayPal: ${decision.violations.map((v) => v.checkId).join(', ')}`,
        data: { decisionId: decision.id, violations: decision.violations },
      });
      return { denied: decision } as const;
    }

    const op: PaymentRow = {
      id: newId(),
      missionId,
      proposalId,
      proposalVersion: proposal.version,
      approvalId,
      status: 'NOT_CREATED',
      amountCents: proposal.totalCents,
      currency: proposal.currency,
      provider: 'paypal',
      providerEnvironment: gateway.environment,
      providerOrderId: null,
      providerCaptureId: null,
      providerOrderStatus: null,
      providerCaptureStatus: null,
      providerDebugId: null,
      lastError: null,
      approveUrl: null,
      verifiedAt: null,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      createRequestId: newId(),
      captureRequestId: newId(),
      attempts: 0,
    };
    await s.insertPayment(op);
    await s.setProposalStatus(proposal.id, 'APPROVED', 'EXECUTION_PENDING');
    await s.setMissionStatus(missionId, mission.status, 'EXECUTING');
    await s.audit({
      workspaceId,
      missionId,
      type: 'payment.initiated',
      actor,
      summary: `Payment operation started for v${proposal.version}: $${(op.amountCents / 100).toFixed(2)} via PayPal Sandbox`,
      data: { operationId: op.id, approvalId, decisionId: decision.id },
    });
    return { op, proposal, mission } as const;
  });
  if (prepared.denied)
    throw new PolicyDeniedError('Payment blocked by the policy gate', prepared.denied);
  if (prepared.existing) return clientView(prepared.existing);

  const { op, proposal, mission } = prepared as {
    op: PaymentRow;
    proposal: Proposal;
    mission: Mission;
  };
  const candidates = new Map(
    (await store(deps).candidatesByIds(proposal.lines.map((l) => l.candidateId))).map((c) => [
      c.id,
      c,
    ]),
  );
  const base = deps.publicBaseUrl.replace(/\/$/, '');
  const result = await gateway.createOrder({
    requestId: op.createRequestId,
    referenceId: proposal.id,
    customId: op.id,
    invoiceId: `RLF-${op.id}`,
    description: `RELIEFOS · ${mission.title} · proposal v${proposal.version} (sandbox)`,
    currency: 'USD',
    items: proposal.lines.map((l) => ({
      name: l.title,
      sku: `${l.provenance}:${candidates.get(l.candidateId)?.sourceProductId ?? l.candidateId}`,
      quantity: l.quantityPacks,
      unitAmountCents: l.unitPriceCents,
    })),
    itemTotalCents: proposal.subtotalCents,
    shippingCents: proposal.shippingCents,
    totalCents: proposal.totalCents,
    returnUrl: `${base}/missions/${missionId}/checkout?op=${op.id}&result=return`,
    cancelUrl: `${base}/missions/${missionId}/checkout?op=${op.id}&result=cancel`,
  });
  await applyCreateResult(deps, workspaceId, missionId, op.id, 'NOT_CREATED', result);
  return clientView(await store(deps).getPayment(missionId, op.id));
}

async function applyCaptureResult(
  deps: Deps,
  workspaceId: string,
  missionId: string,
  opId: string,
  result: GatewayResult<GatewayOrder>,
) {
  const gateway = requireGateway(deps);
  // A capture response is evidence; COMPLETED additionally requires an authoritative read.
  if (result.kind === 'ok') {
    const capture = result.value.captures[0];
    if (capture?.status === 'COMPLETED') {
      const verify = await gateway.getOrder(result.value.id);
      return inTx(deps, async (s) => {
        const op = await s.getPayment(missionId, opId, true);
        const mission = await s.getMission(workspaceId, missionId, true);
        if (verify.kind !== 'ok') {
          await s.updatePayment(op.id, op.status, 'UNKNOWN', {
            lastError: {
              code: 'VERIFICATION_UNAVAILABLE',
              message:
                'Capture reported COMPLETED but the order could not be re-read; reconcile to confirm',
            },
          });
          await setProposalUnknown(s, missionId, op.proposalId);
          return;
        }
        return applyAuthoritativeOrder(s, deps, workspaceId, mission, op, verify.value);
      });
    }
    return inTx(deps, async (s) => {
      const op = await s.getPayment(missionId, opId, true);
      const mission = await s.getMission(workspaceId, missionId, true);
      return applyAuthoritativeOrder(s, deps, workspaceId, mission, op, result.value);
    });
  }
  return inTx(deps, async (s) => {
    const op = await s.getPayment(missionId, opId, true);
    if (result.kind === 'ambiguous') {
      await s.updatePayment(op.id, op.status, 'UNKNOWN', {
        lastError: { code: 'AMBIGUOUS_CAPTURE', message: result.reason },
      });
      await setProposalUnknown(s, missionId, op.proposalId);
      await s.audit({
        workspaceId,
        missionId,
        type: 'payment.outcome_unknown',
        actor: 'system',
        summary: `Capture outcome unknown (${result.reason}). Not retried; reconcile with PayPal first.`,
        data: { operationId: op.id },
      });
      return;
    }
    if (result.issues.includes('ORDER_ALREADY_CAPTURED')) {
      const verify = await gateway.getOrder(op.providerOrderId!);
      if (verify.kind === 'ok') {
        const mission = await s.getMission(workspaceId, missionId, true);
        return applyAuthoritativeOrder(s, deps, workspaceId, mission, op, verify.value);
      }
      await s.updatePayment(op.id, op.status, 'UNKNOWN', {
        lastError: {
          code: 'ORDER_ALREADY_CAPTURED',
          message: 'PayPal reports a prior capture; verification unavailable',
        },
      });
      return;
    }
    const retryable = result.issues.some((i) =>
      ['INSTRUMENT_DECLINED', 'PAYER_ACTION_REQUIRED', 'ORDER_NOT_APPROVED'].includes(i),
    );
    await s.updatePayment(op.id, op.status, retryable ? 'APPROVAL_PENDING' : 'FAILED', {
      lastError: { code: result.issues[0] ?? result.name, message: result.message },
      providerDebugId: result.debugId,
    });
    if (!retryable) await releaseToApproved(s, workspaceId, missionId, op);
    await s.audit({
      workspaceId,
      missionId,
      type: retryable ? 'payment.payer_action_required' : 'payment.failed',
      actor: 'paypal',
      summary: retryable
        ? `PayPal needs the payer to act again (${result.issues.join(', ')})`
        : `PayPal rejected the capture: ${result.name}`,
      data: { operationId: op.id, issues: result.issues, debugId: result.debugId },
    });
  });
}

async function setProposalUnknown(s: Store, missionId: string, proposalId: string) {
  const p = await s.getProposal(missionId, proposalId, true);
  if (p.status === 'EXECUTION_PENDING')
    await s.setProposalStatus(p.id, 'EXECUTION_PENDING', 'UNKNOWN');
}

/** Map an authoritative PayPal order read onto the operation's state. */
async function applyAuthoritativeOrder(
  s: Store,
  deps: Deps,
  workspaceId: string,
  mission: Mission,
  opIn: PaymentRow,
  order: GatewayOrder,
) {
  let op = opIn;
  const capture = order.captures[0];
  if (capture) {
    // A capture exists although we never saw it start (e.g. the payer's return raced a reconcile).
    if (op.status === 'APPROVAL_PENDING') {
      await s.updatePayment(op.id, 'APPROVAL_PENDING', 'CAPTURE_PENDING', {});
      op = { ...op, status: 'CAPTURE_PENDING' };
    }
    if (capture.status === 'COMPLETED') {
      if (capture.amountCents !== op.amountCents || capture.currency !== op.currency) {
        if (op.status !== 'UNKNOWN') await s.updatePayment(op.id, op.status, 'UNKNOWN', {});
        await s.updatePayment(op.id, 'UNKNOWN', 'UNKNOWN', {
          providerCaptureId: capture.id,
          providerCaptureStatus: capture.status,
          lastError: {
            code: 'AMOUNT_MISMATCH',
            message: `Captured ${capture.amountCents} ${capture.currency} ≠ approved ${op.amountCents} ${op.currency}; requires manual review`,
          },
        });
        await setProposalUnknown(s, mission.id, op.proposalId);
        await s.audit({
          workspaceId,
          missionId: mission.id,
          type: 'payment.discrepancy',
          actor: 'system',
          summary: 'Captured amount does not match the approved amount; NOT marked complete',
          data: { operationId: op.id, captured: capture.amountCents, approved: op.amountCents },
        });
        return;
      }
      return finalizeCompleted(s, deps, workspaceId, mission, op, op.status, order);
    }
    if (capture.status === 'PENDING') {
      await s.updatePayment(op.id, op.status, 'PROVIDER_PENDING', {
        providerCaptureId: capture.id,
        providerCaptureStatus: 'PENDING',
        providerOrderStatus: order.status,
      });
      await setProposalUnknown(s, mission.id, op.proposalId);
      await s.audit({
        workspaceId,
        missionId: mission.id,
        type: 'payment.provider_pending',
        actor: 'paypal',
        summary: 'PayPal holds the capture as PENDING; funds not settled',
        data: { operationId: op.id },
      });
      return;
    }
    await s.updatePayment(op.id, op.status, 'FAILED', {
      providerCaptureId: capture.id,
      providerCaptureStatus: capture.status,
      lastError: { code: `CAPTURE_${capture.status}`, message: `Capture ${capture.status}` },
    });
    await releaseToApproved(s, workspaceId, mission.id, op);
    await s.audit({
      workspaceId,
      missionId: mission.id,
      type: 'payment.failed',
      actor: 'paypal',
      summary: `Capture ${capture.status}`,
      data: { operationId: op.id },
    });
    return;
  }
  if (order.status === 'VOIDED') {
    await s.updatePayment(op.id, op.status, 'CANCELLED', { providerOrderStatus: 'VOIDED' });
    await releaseToApproved(s, workspaceId, mission.id, op);
    return;
  }
  // No capture exists: the payer approval is the latest fact.
  if (op.status !== 'APPROVAL_PENDING')
    await s.updatePayment(op.id, op.status, 'APPROVAL_PENDING', {
      providerOrderStatus: order.status,
    });
  const p = await s.getProposal(mission.id, op.proposalId, true);
  if (p.status === 'UNKNOWN') await s.setProposalStatus(p.id, 'UNKNOWN', 'EXECUTION_PENDING');
}

export async function capturePayment(
  deps: Deps,
  workspaceId: string,
  missionId: string,
  opId: string,
  orderId: string,
): Promise<PaymentOperation> {
  const gateway = requireGateway(deps);
  const now = deps.now();
  // 1. Revalidate the authority immediately before capture.
  const gate = await inTx(deps, async (s) => {
    const op = await s.getPayment(missionId, opId, true);
    if (op.providerOrderId !== orderId)
      throw conflict('Order id does not belong to this payment operation');
    if (op.status === 'COMPLETED') return { done: op } as const;
    if (op.status !== 'APPROVAL_PENDING')
      throw illegalState(`Payment is ${op.status}; capture is not permitted`);
    const mission = await s.getMission(workspaceId, missionId, true);
    const proposal = await s.getProposal(missionId, op.proposalId, true);
    const ctx = await loadPolicyContext(s, mission, proposal, 'capture', {
      approvalId: op.approvalId,
      currentPaymentOpId: op.id,
      now,
    });
    const decision = await evaluateAndRecord(s, ctx);
    if (decision.outcome === 'DENY') {
      await s.updatePayment(op.id, 'APPROVAL_PENDING', 'CANCELLED', {
        lastError: {
          code: 'POLICY_DENIED',
          message: decision.violations.map((v) => v.message).join('; '),
        },
      });
      await s.invalidateApprovals(
        { missionId, proposalId: proposal.id },
        'Revalidation failed before capture',
      );
      if (proposal.status === 'EXECUTION_PENDING')
        await s.setProposalStatus(proposal.id, 'EXECUTION_PENDING', 'INVALIDATED');
      if (canTransition(MISSION_TRANSITIONS, mission.status, 'NEEDS_REVIEW'))
        await s.setMissionStatus(missionId, mission.status, 'NEEDS_REVIEW');
      await s.audit({
        workspaceId,
        missionId,
        type: 'payment.capture_blocked',
        actor: 'policy:deadman',
        summary: `Capture refused: ${decision.violations.map((v) => v.checkId).join(', ')}. The uncaptured PayPal order will expire; no funds moved.`,
        data: { operationId: op.id, decisionId: decision.id },
      });
      return { denied: decision } as const;
    }
    return { op } as const;
  });
  if (gate.denied) throw new PolicyDeniedError('Capture blocked by the policy gate', gate.denied);
  if (gate.done) return clientView(gate.done);

  // 2. Verify payer approval server-side; never trust the browser callback.
  const read = await gateway.getOrder(orderId);
  if (read.kind !== 'ok')
    throw new DomainError(
      'INTEGRATION_FAILED',
      'Could not verify the order with PayPal; nothing was captured. Try again.',
    );
  if (read.value.captures.length > 0) {
    await inTx(deps, async (s) =>
      applyAuthoritativeOrder(
        s,
        deps,
        workspaceId,
        await s.getMission(workspaceId, missionId, true),
        await s.getPayment(missionId, opId, true),
        read.value,
      ),
    );
    return clientView(await store(deps).getPayment(missionId, opId));
  }
  if (read.value.status !== 'APPROVED') {
    throw new DomainError(
      'CONFLICT',
      `PayPal reports the order as ${read.value.status}; the payer has not approved it yet`,
      { orderStatus: read.value.status },
    );
  }

  // 3. Persist intent before the state-changing call, then capture with the stored request id.
  await inTx(deps, async (s) => {
    await s.updatePayment(opId, 'APPROVAL_PENDING', 'CAPTURE_PENDING', {
      providerOrderStatus: 'APPROVED',
      incrementAttempts: true,
    });
    await s.audit({
      workspaceId,
      missionId,
      type: 'payment.capture_started',
      actor: 'system',
      summary: `Payer approval verified with PayPal; capturing order ${orderId}`,
      data: { operationId: opId },
    });
  });
  const op = await store(deps).getPayment(missionId, opId);
  const result = await gateway.captureOrder(orderId, op.captureRequestId);
  await applyCaptureResult(deps, workspaceId, missionId, opId, result);
  return clientView(await store(deps).getPayment(missionId, opId));
}

/** Resolve an UNKNOWN or PENDING operation from PayPal's authoritative state, then retry safely. */
export async function reconcilePayment(
  deps: Deps,
  workspaceId: string,
  missionId: string,
  opId: string,
): Promise<PaymentOperation> {
  const gateway = requireGateway(deps);
  const op = await store(deps).getPayment(missionId, opId);
  if (!['UNKNOWN', 'PROVIDER_PENDING', 'CAPTURE_PENDING'].includes(op.status))
    return clientView(op);

  if (!op.providerOrderId) {
    // Create was ambiguous. Re-sending with the same PayPal-Request-Id returns the original order if
    // PayPal received it, or creates it exactly once if it did not.
    const proposal = await store(deps).getProposal(missionId, op.proposalId);
    const mission = await store(deps).getMission(workspaceId, missionId);
    const candidates = new Map(
      (await store(deps).candidatesByIds(proposal.lines.map((l) => l.candidateId))).map((c) => [
        c.id,
        c,
      ]),
    );
    const base = deps.publicBaseUrl.replace(/\/$/, '');
    const result = await gateway.createOrder({
      requestId: op.createRequestId,
      referenceId: proposal.id,
      customId: op.id,
      invoiceId: `RLF-${op.id}`,
      description: `RELIEFOS · ${mission.title} · proposal v${proposal.version} (sandbox)`,
      currency: 'USD',
      items: proposal.lines.map((l) => ({
        name: l.title,
        sku: `${l.provenance}:${candidates.get(l.candidateId)?.sourceProductId ?? l.candidateId}`,
        quantity: l.quantityPacks,
        unitAmountCents: l.unitPriceCents,
      })),
      itemTotalCents: proposal.subtotalCents,
      shippingCents: proposal.shippingCents,
      totalCents: proposal.totalCents,
      returnUrl: `${base}/missions/${missionId}/checkout?op=${op.id}&result=return`,
      cancelUrl: `${base}/missions/${missionId}/checkout?op=${op.id}&result=cancel`,
    });
    await applyCreateResult(deps, workspaceId, missionId, op.id, 'UNKNOWN', result);
    await inTx(deps, (s) =>
      s.audit({
        workspaceId,
        missionId,
        type: 'payment.reconciled',
        actor: 'system',
        summary: `Reconciled ambiguous order creation using the original PayPal-Request-Id (${result.kind})`,
        data: { operationId: op.id },
      }),
    );
    return clientView(await store(deps).getPayment(missionId, op.id));
  }

  const read = await gateway.getOrder(op.providerOrderId);
  if (read.kind !== 'ok')
    throw new DomainError(
      'INTEGRATION_FAILED',
      'PayPal is unavailable; the payment remains unresolved. Try reconciling again shortly.',
    );
  const order = read.value;
  if (order.captures.length === 0 && order.status === 'APPROVED') {
    // The capture never happened. Retrying with the SAME request id cannot double-charge.
    await inTx(deps, async (s) => {
      const cur = await s.getPayment(missionId, opId, true);
      if (cur.status !== 'CAPTURE_PENDING')
        await s.updatePayment(opId, cur.status, 'CAPTURE_PENDING', { incrementAttempts: true });
      await s.audit({
        workspaceId,
        missionId,
        type: 'payment.reconciled',
        actor: 'system',
        summary:
          'PayPal shows the order approved but not captured; retrying capture with the original request id',
        data: { operationId: opId },
      });
    });
    const result = await gateway.captureOrder(order.id, op.captureRequestId);
    await applyCaptureResult(deps, workspaceId, missionId, opId, result);
  } else {
    await inTx(deps, async (s) => {
      await applyAuthoritativeOrder(
        s,
        deps,
        workspaceId,
        await s.getMission(workspaceId, missionId, true),
        await s.getPayment(missionId, opId, true),
        order,
      );
      await s.audit({
        workspaceId,
        missionId,
        type: 'payment.reconciled',
        actor: 'system',
        summary: `Reconciled with PayPal: order ${order.status}${order.captures[0] ? `, capture ${order.captures[0].status}` : ''}`,
        data: { operationId: opId },
      });
    });
  }
  return clientView(await store(deps).getPayment(missionId, opId));
}

/** The payer cancelled (or abandoned) the PayPal checkout. */
export async function cancelPayment(
  deps: Deps,
  workspaceId: string,
  missionId: string,
  opId: string,
): Promise<PaymentOperation> {
  const gateway = requireGateway(deps);
  const op = await store(deps).getPayment(missionId, opId);
  if (op.status !== 'APPROVAL_PENDING')
    throw illegalState(
      `Payment is ${op.status}; only a payment awaiting payer approval can be cancelled`,
    );
  const read = await gateway.getOrder(op.providerOrderId!);
  if (read.kind === 'ok' && read.value.captures.length > 0) {
    // Never cancel locally what PayPal already captured.
    await inTx(deps, async (s) =>
      applyAuthoritativeOrder(
        s,
        deps,
        workspaceId,
        await s.getMission(workspaceId, missionId, true),
        await s.getPayment(missionId, opId, true),
        read.value,
      ),
    );
    return clientView(await store(deps).getPayment(missionId, opId));
  }
  await inTx(deps, async (s) => {
    await s.updatePayment(opId, 'APPROVAL_PENDING', 'CANCELLED', {
      providerOrderStatus: read.kind === 'ok' ? read.value.status : null,
    });
    await releaseToApproved(s, workspaceId, missionId, op);
    await s.audit({
      workspaceId,
      missionId,
      type: 'payment.cancelled',
      actor: 'payer',
      summary:
        'Payer left PayPal checkout without paying; approval remains valid for a new attempt',
      data: { operationId: opId },
    });
  });
  return clientView(await store(deps).getPayment(missionId, opId));
}
