import { useParams } from 'react-router';
import type { PaymentOperation } from '../../../shared/types';
import {
  useCancelPayment,
  useCapture,
  useConfig,
  useCreatePayment,
  useMission,
  useReconcile,
} from '../api/hooks';
import { ApiError } from '../api/client';
import {
  Badge,
  Button,
  Callout,
  errorText,
  Panel,
  QueryView,
  StatusBadge,
  useToast,
} from '../components/ui';
import { IconExternal } from '../components/icons';
import { PaymentLifecycle } from '../features/PaymentLifecycle';
import { dateTime, PAYMENT_TONE, usd } from '../lib/format';

export function PaymentsPage() {
  const { missionId } = useParams();
  const id = missionId!;
  const mq = useMission(id);
  const config = useConfig();
  const create = useCreatePayment(id);
  const capture = useCapture(id);
  const reconcile = useReconcile(id);
  const cancel = useCancelPayment(id);
  const toast = useToast();

  const goToPayPal = (op: PaymentOperation) => {
    if (op.approveUrl) window.location.assign(op.approveUrl);
    else toast('danger', 'PayPal did not return an approval link for this order.');
  };

  return (
    <div className="content">
      <div className="page-head">
        <div>
          <h1>Approvals & payments</h1>
          <p className="lede">
            Orders are created on the server from the approved proposal, approved by the payer in
            PayPal, and captured only after RELIEFOS re-validates the approval and verifies the
            order with PayPal. A browser redirect is never treated as proof of payment.
          </p>
        </div>
      </div>
      {config.data && !config.data.paypal.enabled && (
        <Callout tone="warn" title="PayPal Sandbox is not configured on this deployment">
          Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET (sandbox REST app) to enable checkout. Until
          then RELIEFOS refuses to create orders — it never simulates a payment.
        </Callout>
      )}
      <QueryView q={mq} rows={6}>
        {(d) => {
          const { mission, approvals, payments, proposals } = d;
          const approved = proposals.find(
            (p) =>
              p.status === 'APPROVED' || p.status === 'EXECUTION_PENDING' || p.status === 'UNKNOWN',
          );
          const activeApproval = approved
            ? approvals.find((a) => a.proposalId === approved.id && a.status === 'ACTIVE')
            : undefined;
          const liveOp = approved
            ? payments.find(
                (p) => p.proposalId === approved.id && !['FAILED', 'CANCELLED'].includes(p.status),
              )
            : undefined;
          return (
            <>
              {approved && (
                <Panel
                  title={`Execute proposal v${approved.version}`}
                  sub={`${usd(approved.totalCents)} · approved by ${activeApproval?.approverName ?? approvals.find((a) => a.proposalId === approved.id)?.approverName ?? '—'}`}
                >
                  <div className="stack">
                    {liveOp ? (
                      <>
                        <PaymentLifecycle op={liveOp} />
                        {liveOp.status === 'APPROVAL_PENDING' && (
                          <div className="row wrap">
                            <Button variant="primary" onClick={() => goToPayPal(liveOp)}>
                              Continue to PayPal <IconExternal width={13} height={13} />
                            </Button>
                            <Button
                              loading={capture.isPending}
                              onClick={() =>
                                capture.mutate(
                                  { opId: liveOp.id, orderId: liveOp.providerOrderId! },
                                  {
                                    onSuccess: (op) =>
                                      toast(
                                        op.status === 'COMPLETED' ? 'ok' : 'info',
                                        `Payment ${op.status.toLowerCase()}`,
                                      ),
                                    onError: (e) => toast('danger', errorText(e)),
                                  },
                                )
                              }
                            >
                              I approved in PayPal — verify & capture
                            </Button>
                            <Button
                              variant="ghost"
                              loading={cancel.isPending}
                              onClick={() =>
                                cancel.mutate(liveOp.id, {
                                  onError: (e) => toast('danger', errorText(e)),
                                })
                              }
                            >
                              Abandon checkout
                            </Button>
                          </div>
                        )}
                        {['UNKNOWN', 'PROVIDER_PENDING', 'CAPTURE_PENDING'].includes(
                          liveOp.status,
                        ) && (
                          <Callout tone="warn" title="Outcome not yet confirmed by PayPal">
                            <div className="small">
                              {liveOp.lastError?.message ??
                                'The last PayPal call did not return a definitive result.'}{' '}
                              RELIEFOS will not retry blindly or start another purchase.
                            </div>
                            <div style={{ marginTop: 8 }}>
                              <Button
                                size="sm"
                                variant="primary"
                                loading={reconcile.isPending}
                                onClick={() =>
                                  reconcile.mutate(liveOp.id, {
                                    onSuccess: (op) => toast('info', `Reconciled: ${op.status}`),
                                    onError: (e) => toast('danger', errorText(e)),
                                  })
                                }
                              >
                                Reconcile with PayPal
                              </Button>
                            </div>
                          </Callout>
                        )}
                      </>
                    ) : (
                      <div className="row wrap">
                        <Button
                          variant="primary"
                          size="lg"
                          disabled={!activeApproval || !config.data?.paypal.enabled}
                          loading={create.isPending}
                          onClick={() =>
                            create.mutate(
                              { proposalId: approved.id, approvalId: activeApproval!.id },
                              {
                                onSuccess: (op) =>
                                  op.status === 'APPROVAL_PENDING'
                                    ? goToPayPal(op)
                                    : toast(
                                        'info',
                                        `Payment ${op.status.toLowerCase()}: ${op.lastError?.message ?? ''}`,
                                      ),
                                onError: (e) =>
                                  toast(
                                    'danger',
                                    e instanceof ApiError && e.code === 'POLICY_DENIED'
                                      ? 'Blocked by DEADMAN before reaching PayPal: conditions changed since approval. See Procurement.'
                                      : errorText(e),
                                  ),
                              },
                            )
                          }
                        >
                          Pay {usd(approved.totalCents)} with PayPal Sandbox
                        </Button>
                        <span className="small muted">
                          RELIEFOS re-validates the approval against current prices, delivery times
                          and mission terms first.
                        </span>
                      </div>
                    )}
                  </div>
                </Panel>
              )}

              <Panel title="Payment operations" flush>
                {payments.length === 0 ? (
                  <div className="panel-body muted">
                    No payment has been attempted for this mission.
                  </div>
                ) : (
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th>Operation</th>
                        <th>Status</th>
                        <th className="num">Amount</th>
                        <th>PayPal references</th>
                        <th>Lifecycle</th>
                        <th>Updated</th>
                      </tr>
                    </thead>
                    <tbody>
                      {payments.map((p) => (
                        <tr key={p.id}>
                          <td>
                            <div className="mono small">{p.id.slice(0, 8)}</div>
                            <div className="small muted">
                              proposal v{p.proposalVersion} · {p.providerEnvironment}
                            </div>
                          </td>
                          <td>
                            <StatusBadge status={p.status} tones={PAYMENT_TONE} />
                            {p.verifiedAt && (
                              <div className="small" style={{ color: 'var(--ok)', marginTop: 3 }}>
                                Verified via GET order
                              </div>
                            )}
                            {p.lastError && (
                              <div
                                className="small"
                                style={{ color: 'var(--danger)', marginTop: 3 }}
                              >
                                {p.lastError.code}: {p.lastError.message}
                              </div>
                            )}
                          </td>
                          <td className="num">{usd(p.amountCents)}</td>
                          <td className="small">
                            <div>
                              order <span className="mono">{p.providerOrderId ?? '—'}</span>
                            </div>
                            <div>
                              capture <span className="mono">{p.providerCaptureId ?? '—'}</span>{' '}
                              {p.providerCaptureStatus && (
                                <Badge plain tone="neutral">
                                  {p.providerCaptureStatus}
                                </Badge>
                              )}
                            </div>
                            {p.providerDebugId && (
                              <div className="muted">debug {p.providerDebugId}</div>
                            )}
                          </td>
                          <td style={{ minWidth: 260 }}>
                            <PaymentLifecycle op={p} />
                          </td>
                          <td className="small muted">{dateTime(p.updatedAt, mission.timezone)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </Panel>

              <Panel
                title="Approvals"
                sub="Each approval is bound to one proposal's exact terms"
                flush
              >
                {approvals.length === 0 ? (
                  <div className="panel-body muted">No approvals yet.</div>
                ) : (
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th>Approver</th>
                        <th>Proposal</th>
                        <th className="num">Amount</th>
                        <th>Bound terms</th>
                        <th>Status</th>
                        <th>When</th>
                      </tr>
                    </thead>
                    <tbody>
                      {approvals.map((a) => (
                        <tr key={a.id}>
                          <td className="strong">{a.approverName}</td>
                          <td>
                            v{a.proposalVersion} · mission v{a.missionVersion}
                          </td>
                          <td className="num">{usd(a.amountCents)}</td>
                          <td className="hash">{a.contentHash.slice(0, 16)}…</td>
                          <td>
                            <Badge
                              tone={
                                a.status === 'ACTIVE'
                                  ? 'accent'
                                  : a.status === 'CONSUMED'
                                    ? 'ok'
                                    : 'warn'
                              }
                            >
                              {a.status.toLowerCase()}
                            </Badge>
                            {a.invalidatedReason && (
                              <div className="small muted" style={{ marginTop: 3 }}>
                                {a.invalidatedReason}
                              </div>
                            )}
                          </td>
                          <td className="small muted">{dateTime(a.createdAt, mission.timezone)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </Panel>
            </>
          );
        }}
      </QueryView>
    </div>
  );
}
