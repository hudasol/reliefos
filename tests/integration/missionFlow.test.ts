import { afterEach, describe, expect, it } from 'vitest';
import { makeHarness } from '../helpers/harness.js';
import { planMission } from '../../server/services/planning.js';
import { approveProposal } from '../../server/services/approvals.js';
import { capturePayment, createPayment, reconcilePayment } from '../../server/services/payments.js';
import { runMarketEvent } from '../../server/services/events.js';
import { missionDetail, updateMission } from '../../server/services/missions.js';
import { DomainError } from '../../server/domain/errors.js';

let h: Awaited<ReturnType<typeof makeHarness>>;
afterEach(async () => h?.close());

async function planAndApprove() {
  const plan = await planMission(h.deps, h.workspaceId, h.mission.id, { actor: 'test' });
  expect(plan.decision.outcome).toBe('ALLOW');
  const approval = await approveProposal(h.deps, h.workspaceId, h.mission.id, plan.proposal.id, {
    approverName: 'Dana Reyes',
    expectedContentHash: plan.proposal.contentHash,
    expectedTotalCents: plan.proposal.totalCents,
  });
  return { plan, approval };
}

describe('mission workflow (service level, PGlite + scripted PayPal)', () => {
  it('runs the full demonstration sequence: plan → drill → reject → recover → approve → pay → verify', async () => {
    h = await makeHarness();
    const v1 = await planMission(h.deps, h.workspaceId, h.mission.id, { actor: 'test' });
    expect(v1.proposal.status).toBe('AWAITING_APPROVAL');
    expect(v1.proposal.totalCents).toBeLessThanOrEqual(400_000);
    expect((await missionDetail(h.deps, h.workspaceId, h.mission.id)).mission.status).toBe(
      'READY_FOR_APPROVAL',
    );

    // Adversarial scenario exposes a violation; the gate invalidates v1.
    const drill = await runMarketEvent(
      h.deps,
      h.workspaceId,
      h.mission.id,
      'delivery-slip',
      'test',
    );
    expect(drill.revalidated?.decision.outcome).toBe('DENY');
    expect(drill.revalidated?.decision.violations.map((v) => v.checkId)).toContain(
      'DELIVERY_DEADLINE',
    );
    let detail = await missionDetail(h.deps, h.workspaceId, h.mission.id);
    expect(detail.mission.status).toBe('NEEDS_REVIEW');
    expect(detail.proposals.find((p) => p.id === v1.proposal.id)!.status).toBe('INVALIDATED');

    // Recovery: re-plan against current commitments, re-validate.
    const v2 = await planMission(h.deps, h.workspaceId, h.mission.id, {
      actor: 'test',
      recoverFrom: v1.proposal.id,
    });
    expect(v2.proposal.parentProposalId).toBe(v1.proposal.id);
    expect(v2.decision.outcome).toBe('ALLOW');
    expect(v2.explanation.points.length).toBeGreaterThan(0);

    const approval = await approveProposal(h.deps, h.workspaceId, h.mission.id, v2.proposal.id, {
      approverName: 'Dana Reyes',
      expectedContentHash: v2.proposal.contentHash,
      expectedTotalCents: v2.proposal.totalCents,
    });

    const op = await createPayment(
      h.deps,
      h.workspaceId,
      h.mission.id,
      v2.proposal.id,
      approval.id,
      'test',
    );
    expect(op.status).toBe('APPROVAL_PENDING');
    expect(op.providerOrderId).toMatch(/^SCRIPTED-/);
    expect(h.gateway.orders.get(op.providerOrderId!)!.input.totalCents).toBe(
      v2.proposal.totalCents,
    );

    // The browser cannot complete the payment: capture without payer approval is refused.
    await expect(
      capturePayment(h.deps, h.workspaceId, h.mission.id, op.id, op.providerOrderId!),
    ).rejects.toThrow(/not approved/);

    h.gateway.payerApproves(op.providerOrderId!);
    const done = await capturePayment(
      h.deps,
      h.workspaceId,
      h.mission.id,
      op.id,
      op.providerOrderId!,
    );
    expect(done.status).toBe('COMPLETED');
    expect(done.verifiedAt).not.toBeNull();

    detail = await missionDetail(h.deps, h.workspaceId, h.mission.id);
    expect(['COMPLETED', 'PARTIALLY_FULFILLED']).toContain(detail.mission.status);
    expect(detail.summary.committedCents).toBe(v2.proposal.totalCents);
    expect(detail.approvals.find((a) => a.id === approval.id)!.status).toBe('CONSUMED');
    expect(detail.proposals.find((p) => p.id === v2.proposal.id)!.status).toBe('EXECUTED');

    const tasks = await h.store.listTasks(h.mission.id);
    expect(
      tasks.filter((t) => t.proposalId === v2.proposal.id).every((t) => t.status === 'CONFIRMED'),
    ).toBe(true);

    const chain = await h.store.verifyAuditChain(h.workspaceId);
    expect(chain.intact).toBe(true);
    const types = (await h.store.listAudit(h.mission.id)).map((e) => e.type);
    for (const t of [
      'mission.created',
      'catalog.retrieved',
      'proposal.generated',
      'policy.rejected',
      'approval.granted',
      'payment.initiated',
      'payment.order_created',
      'payment.completed',
    ]) {
      expect(types).toContain(t);
    }
  });

  it('blocks a payment when the price changes after approval, without contacting PayPal', async () => {
    h = await makeHarness();
    const { plan, approval } = await planAndApprove();
    await runMarketEvent(h.deps, h.workspaceId, h.mission.id, 'price-surge', 'test');
    const calls = h.gateway.createCalls;
    await expect(
      createPayment(h.deps, h.workspaceId, h.mission.id, plan.proposal.id, approval.id, 'test'),
    ).rejects.toThrow(DomainError);
    expect(h.gateway.createCalls).toBe(calls);
    const detail = await missionDetail(h.deps, h.workspaceId, h.mission.id);
    expect(detail.approvals[0]!.status).toBe('INVALIDATED');
  });

  it('invalidates approval when mission terms change after approval', async () => {
    h = await makeHarness();
    const { plan, approval } = await planAndApprove();
    await updateMission(
      h.deps,
      h.workspaceId,
      h.mission.id,
      1,
      { ...h.input, budgetUsd: 3000 },
      'test',
    );
    const detail = await missionDetail(h.deps, h.workspaceId, h.mission.id);
    expect(detail.approvals.find((a) => a.id === approval.id)!.status).toBe('INVALIDATED');
    expect(detail.proposals.find((p) => p.id === plan.proposal.id)!.status).toBe('INVALIDATED');
    await expect(
      createPayment(h.deps, h.workspaceId, h.mission.id, plan.proposal.id, approval.id, 'test'),
    ).rejects.toThrow(/APPROVED/);
  });

  it('never retries a capture after a timeout; reconciliation finds the real outcome', async () => {
    h = await makeHarness();
    const { plan, approval } = await planAndApprove();
    const op = await createPayment(
      h.deps,
      h.workspaceId,
      h.mission.id,
      plan.proposal.id,
      approval.id,
      'test',
    );
    h.gateway.payerApproves(op.providerOrderId!);
    h.gateway.inject({ op: 'capture', kind: 'ambiguous-after-success' });
    const unknown = await capturePayment(
      h.deps,
      h.workspaceId,
      h.mission.id,
      op.id,
      op.providerOrderId!,
    );
    expect(unknown.status).toBe('UNKNOWN');
    expect(h.gateway.captureCalls).toBe(1);

    // A duplicate purchase attempt is refused while the outcome is unknown.
    await expect(
      createPayment(h.deps, h.workspaceId, h.mission.id, plan.proposal.id, approval.id, 'test'),
    ).rejects.toThrow(/reconcile/);
    expect(h.gateway.createCalls).toBe(1);

    const resolved = await reconcilePayment(h.deps, h.workspaceId, h.mission.id, op.id);
    expect(resolved.status).toBe('COMPLETED');
    expect(h.gateway.captureCalls).toBe(1); // reconciliation read the outcome; it did not capture again
  });

  it('safely retries a capture that never reached PayPal, reusing the request id', async () => {
    h = await makeHarness();
    const { plan, approval } = await planAndApprove();
    const op = await createPayment(
      h.deps,
      h.workspaceId,
      h.mission.id,
      plan.proposal.id,
      approval.id,
      'test',
    );
    h.gateway.payerApproves(op.providerOrderId!);
    h.gateway.inject({ op: 'capture', kind: 'ambiguous-before-success' });
    expect(
      (await capturePayment(h.deps, h.workspaceId, h.mission.id, op.id, op.providerOrderId!))
        .status,
    ).toBe('UNKNOWN');
    const resolved = await reconcilePayment(h.deps, h.workspaceId, h.mission.id, op.id);
    expect(resolved.status).toBe('COMPLETED');
    const ids = h.gateway.calls.filter((c) => c.op === 'capture').map((c) => c.requestId);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(1);
  });

  it('never marks a payment complete when the captured amount differs from the approval', async () => {
    h = await makeHarness();
    const { plan, approval } = await planAndApprove();
    const op = await createPayment(
      h.deps,
      h.workspaceId,
      h.mission.id,
      plan.proposal.id,
      approval.id,
      'test',
    );
    h.gateway.payerApproves(op.providerOrderId!);
    h.gateway.inject({ op: 'capture', kind: 'amount-mismatch' });
    const res = await capturePayment(
      h.deps,
      h.workspaceId,
      h.mission.id,
      op.id,
      op.providerOrderId!,
    );
    expect(res.status).toBe('UNKNOWN');
    expect(res.lastError?.code).toBe('AMOUNT_MISMATCH');
    const detail = await missionDetail(h.deps, h.workspaceId, h.mission.id);
    expect(detail.mission.status).toBe('EXECUTING');
    expect(detail.summary.committedCents).toBe(0);
  });

  it('returns the same order for a duplicate create request instead of opening a second one', async () => {
    h = await makeHarness();
    const { plan, approval } = await planAndApprove();
    const a = await createPayment(
      h.deps,
      h.workspaceId,
      h.mission.id,
      plan.proposal.id,
      approval.id,
      'test',
    );
    const b = await createPayment(
      h.deps,
      h.workspaceId,
      h.mission.id,
      plan.proposal.id,
      approval.id,
      'test',
    );
    expect(b.id).toBe(a.id);
    expect(b.providerOrderId).toBe(a.providerOrderId);
    expect(h.gateway.createCalls).toBe(1);
  });

  it('rejects the compromised-agent proposal from a prompt-injected listing, then recovers', async () => {
    h = await makeHarness();
    await planMission(h.deps, h.workspaceId, h.mission.id, { actor: 'test' });
    const drill = await runMarketEvent(
      h.deps,
      h.workspaceId,
      h.mission.id,
      'injected-listing',
      'test',
    );
    const detail = await missionDetail(h.deps, h.workspaceId, h.mission.id);
    const compromised = detail.proposals.find(
      (p) => p.createdBy === 'simulated-compromised-agent',
    )!;
    expect(compromised.status).toBe('REJECTED');
    const ids = compromised.latestDecision!.violations.map((v) => v.checkId);
    expect(ids).toEqual(expect.arrayContaining(['CONTENT_QUARANTINE', 'QUANTITY_BOUNDS']));
    expect(drill.changed.join(' ')).toMatch(/REJECTED|DENY/);

    const recovered = await planMission(h.deps, h.workspaceId, h.mission.id, {
      actor: 'test',
      recoverFrom: compromised.id,
    });
    expect(recovered.decision.outcome).toBe('ALLOW');
    expect(recovered.proposal.lines.some((l) => l.provenance === 'simulated-adversarial')).toBe(
      false,
    );
  });

  it('scopes missions to their workspace', async () => {
    h = await makeHarness();
    await expect(
      missionDetail(h.deps, '22222222-2222-4222-8222-222222222222', h.mission.id),
    ).rejects.toThrow(/not found/);
  });
});
