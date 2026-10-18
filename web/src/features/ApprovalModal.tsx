import { useState } from 'react';
import type { Mission, Proposal } from '../../../shared/types';
import { useApprove } from '../api/hooks';
import { Button, Callout, errorText, Modal, useToast } from '../components/ui';
import { usd } from '../lib/format';
import { ApiError } from '../api/client';

export function ApprovalModal({
  mission,
  proposal,
  onClose,
}: {
  mission: Mission;
  proposal: Proposal;
  onClose: () => void;
}) {
  const approve = useApprove(mission.id);
  const toast = useToast();
  const [name, setName] = useState('');
  const [ack, setAck] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const statement = `I authorise RELIEFOS to purchase proposal v${proposal.version} for ${usd(proposal.totalCents)} USD (within the ${usd(mission.budgetCents)} mission authority) through PayPal Sandbox. Any change to products, quantities, prices, shipping or mission terms voids this approval.`;

  return (
    <Modal
      title={`Approve proposal v${proposal.version}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={name.trim().length < 2 || !ack}
            loading={approve.isPending}
            onClick={() =>
              approve.mutate(
                { proposal, approverName: name.trim() },
                {
                  onSuccess: () => {
                    toast(
                      'ok',
                      `Approved v${proposal.version}. Approval is bound to these exact terms.`,
                    );
                    onClose();
                  },
                  onError: (e) =>
                    setError(
                      e instanceof ApiError && e.code === 'POLICY_DENIED'
                        ? 'Conditions changed since validation; the policy gate blocked this approval. See the procurement page.'
                        : errorText(e),
                    ),
                },
              )
            }
          >
            Approve {usd(proposal.totalCents)}
          </Button>
        </>
      }
    >
      <dl className="kv">
        <dt>Goods</dt>
        <dd className="num">{usd(proposal.subtotalCents)}</dd>
        <dt>Shipping</dt>
        <dd className="num">{usd(proposal.shippingCents)}</dd>
        <dt>Total</dt>
        <dd className="num strong">{usd(proposal.totalCents)}</dd>
        <dt>Lines</dt>
        <dd>{proposal.lines.length}</dd>
        <dt>Bound to terms</dt>
        <dd className="hash">{proposal.contentHash}</dd>
      </dl>
      {proposal.gaps.length > 0 && (
        <Callout tone="warn" title="This plan does not cover everything">
          {proposal.gaps.map((g) => `${g.label}: short ${g.shortfallUnits}`).join('; ')}
        </Callout>
      )}
      <Callout tone="info">{statement}</Callout>
      <div className="field">
        <label htmlFor="approver">Approver name</label>
        <input
          id="approver"
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Full name of the authorised coordinator"
        />
      </div>
      <label className="row small" style={{ alignItems: 'flex-start' }}>
        <input
          type="checkbox"
          checked={ack}
          onChange={(e) => setAck(e.target.checked)}
          style={{ marginTop: 3 }}
        />
        <span>
          I have reviewed the lines, delivery times and remaining gaps, and I hold spending
          authority for this mission.
        </span>
      </label>
      {error && <Callout tone="danger">{error}</Callout>}
    </Modal>
  );
}
