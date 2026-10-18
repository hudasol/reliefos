import type { Approval, PolicyDecision, Proposal } from '../../shared/types.js';
import { DomainError, illegalState } from '../domain/errors.js';
import { rebuildSchedule } from './planning.js';
import { evaluateAndRecord, inTx, loadPolicyContext, newId, type Deps } from './core.js';

export const APPROVAL_STATEMENT = (p: Proposal, budgetCents: number) =>
  `I authorise RELIEFOS to purchase proposal v${p.version} for $${(p.totalCents / 100).toFixed(2)} USD ` +
  `(within the $${(budgetCents / 100).toFixed(2)} mission authority) through PayPal Sandbox. ` +
  `Any change to products, quantities, prices, shipping or mission terms voids this approval.`;

export class PolicyDeniedError extends DomainError {
  constructor(
    message: string,
    readonly decision: PolicyDecision,
  ) {
    super('POLICY_DENIED', message, { decision });
  }
}

/** Human approval, bound to the exact content hash and total the coordinator reviewed. */
export async function approveProposal(
  deps: Deps,
  workspaceId: string,
  missionId: string,
  proposalId: string,
  input: { approverName: string; expectedContentHash: string; expectedTotalCents: number },
): Promise<Approval> {
  const now = deps.now();
  const outcome = await inTx(deps, async (s) => {
    const mission = await s.getMission(workspaceId, missionId, true);
    const proposal = await s.getProposal(missionId, proposalId, true);
    if (proposal.status !== 'AWAITING_APPROVAL')
      throw illegalState(
        `Proposal v${proposal.version} is ${proposal.status}, not awaiting approval`,
      );
    if (
      proposal.contentHash !== input.expectedContentHash ||
      proposal.totalCents !== input.expectedTotalCents
    ) {
      throw new DomainError(
        'STALE_VERSION',
        'The proposal changed since you reviewed it; reload before approving',
        {
          reviewedHash: input.expectedContentHash,
          currentHash: proposal.contentHash,
        },
      );
    }
    const ctx = await loadPolicyContext(s, mission, proposal, 'approval', { now });
    const decision = await evaluateAndRecord(s, ctx);
    if (decision.outcome === 'DENY') {
      await s.setProposalStatus(proposal.id, 'AWAITING_APPROVAL', 'INVALIDATED');
      await s.setMissionStatus(missionId, mission.status, 'NEEDS_REVIEW');
      await rebuildSchedule(s, mission, proposal, false);
      await s.audit({
        workspaceId,
        missionId,
        type: 'approval.blocked',
        actor: 'policy:deadman',
        summary: `Approval of v${proposal.version} blocked: conditions changed (${decision.violations.map((v) => v.checkId).join(', ')})`,
        data: { decisionId: decision.id, violations: decision.violations },
      });
      return { denied: decision } as const;
    }
    const approval: Approval = {
      id: newId(),
      missionId,
      proposalId,
      proposalVersion: proposal.version,
      contentHash: proposal.contentHash,
      missionVersion: mission.version,
      amountCents: proposal.totalCents,
      currency: proposal.currency,
      approverName: input.approverName,
      statement: APPROVAL_STATEMENT(proposal, mission.budgetCents),
      status: 'ACTIVE',
      invalidatedReason: null,
      createdAt: now.toISOString(),
    };
    await s.insertApproval(approval);
    await s.setProposalStatus(proposal.id, 'AWAITING_APPROVAL', 'APPROVED');
    await s.audit({
      workspaceId,
      missionId,
      type: 'approval.granted',
      actor: `coordinator:${input.approverName}`,
      summary: `${input.approverName} approved v${proposal.version} for $${(proposal.totalCents / 100).toFixed(2)}`,
      data: {
        approvalId: approval.id,
        contentHash: approval.contentHash,
        missionVersion: approval.missionVersion,
        amountCents: approval.amountCents,
      },
    });
    return { approval } as const;
  });
  if (outcome.denied)
    throw new PolicyDeniedError('Approval blocked by the policy gate', outcome.denied);
  return outcome.approval!;
}

export async function rejectProposal(
  deps: Deps,
  workspaceId: string,
  missionId: string,
  proposalId: string,
  reason: string,
  actor: string,
) {
  await inTx(deps, async (s) => {
    const mission = await s.getMission(workspaceId, missionId, true);
    const proposal = await s.getProposal(missionId, proposalId, true);
    if (proposal.status !== 'AWAITING_APPROVAL' && proposal.status !== 'APPROVED') {
      throw illegalState(
        `Proposal v${proposal.version} is ${proposal.status} and cannot be rejected`,
      );
    }
    if (proposal.status === 'APPROVED') {
      await s.invalidateApprovals({ missionId, proposalId }, `Withdrawn by ${actor}: ${reason}`);
      await s.setProposalStatus(proposal.id, 'APPROVED', 'INVALIDATED');
    } else {
      await s.setProposalStatus(proposal.id, 'AWAITING_APPROVAL', 'REJECTED');
    }
    await s.setMissionStatus(missionId, mission.status, 'NEEDS_REVIEW');
    await s.audit({
      workspaceId,
      missionId,
      type: 'proposal.rejected_by_coordinator',
      actor,
      summary: `v${proposal.version} rejected by coordinator: ${reason}`,
      data: { reason },
    });
  });
}
