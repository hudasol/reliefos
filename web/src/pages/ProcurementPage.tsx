import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import type { AgentRun, Proposal } from '../../../shared/types';
import {
  useAgentRuns,
  useCandidates,
  useMission,
  usePlan,
  useRecover,
  useRejectProposal,
} from '../api/hooks';
import {
  Badge,
  Button,
  Callout,
  Empty,
  errorText,
  Modal,
  Panel,
  ProvenanceTag,
  QueryView,
  SimTag,
  StatusBadge,
  useToast,
} from '../components/ui';
import { ApprovalModal } from '../features/ApprovalModal';
import { PolicyVerdict } from '../features/PolicyVerdict';
import { clock, minutesBetween, num, PROPOSAL_TONE, usd } from '../lib/format';

function diff(
  prev: Proposal | undefined,
  next: Proposal,
): { kind: 'add' | 'remove' | 'change'; text: string }[] {
  if (!prev) return [];
  const key = (l: Proposal['lines'][number]) => `${l.requirementId}|${l.candidateId}`;
  const pm = new Map(prev.lines.map((l) => [key(l), l]));
  const nm = new Map(next.lines.map((l) => [key(l), l]));
  const out: { kind: 'add' | 'remove' | 'change'; text: string }[] = [];
  for (const [k, l] of pm) {
    const n = nm.get(k);
    if (!n)
      out.push({ kind: 'remove', text: `${l.quantityPacks} × ${l.title} (${l.merchantDomain})` });
    else if (n.quantityPacks !== l.quantityPacks || n.unitPriceCents !== l.unitPriceCents)
      out.push({
        kind: 'change',
        text: `${l.title}: ${l.quantityPacks} → ${n.quantityPacks} packs`,
      });
  }
  for (const [k, n] of nm)
    if (!pm.has(k))
      out.push({ kind: 'add', text: `${n.quantityPacks} × ${n.title} (${n.merchantDomain})` });
  return out;
}

function explanationFor(runs: AgentRun[] | undefined, proposalId: string) {
  const run = runs?.find(
    (r) =>
      r.role === 'explainer' && (r.output as { proposalId?: string })?.proposalId === proposalId,
  );
  return run
    ? { run, out: run.output as { headline: string; points: string[]; nextStep: string } }
    : null;
}

export function ProcurementPage() {
  const { missionId } = useParams();
  const id = missionId!;
  const q = useMission(id);
  const runs = useAgentRuns(id);
  const cands = useCandidates(id);
  const plan = usePlan(id);
  const recover = useRecover(id);
  const reject = useRejectProposal(id);
  const toast = useToast();
  const navigate = useNavigate();
  const [selected, setSelected] = useState<string | null>(null);
  const [approving, setApproving] = useState(false);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(false);

  const candidateById = useMemo(
    () => new Map((cands.data ?? []).map((c) => [c.id, c])),
    [cands.data],
  );

  return (
    <div className="content">
      <QueryView q={q} rows={8}>
        {(d) => {
          const { mission, proposals, requirements } = d;
          const active = d.activeProposal;
          const p = proposals.find((x) => x.id === selected) ?? active;
          const reqById = new Map(requirements.map((r) => [r.id, r]));
          const parent = p?.parentProposalId
            ? proposals.find((x) => x.id === p.parentProposalId)
            : undefined;
          const changes = p ? diff(parent, p) : [];
          const expl = p ? explanationFor(runs.data, p.id) : null;
          const canPlan =
            [
              'DRAFT',
              'PLANNING',
              'NEEDS_REVIEW',
              'READY_FOR_APPROVAL',
              'PARTIALLY_FULFILLED',
              'BLOCKED',
            ].includes(mission.status) && d.summary.unresolvedPayments === 0;
          const canRecover =
            p && ['REJECTED', 'INVALIDATED'].includes(p.status) && p.id === proposals[0]?.id;
          const isLatest = p?.id === proposals[0]?.id;

          const runPlan = () =>
            plan.mutate(
              { refreshCatalog: refresh },
              {
                onSuccess: (r) => {
                  setSelected(null);
                  toast(
                    r.decision.outcome === 'ALLOW' ? 'ok' : 'danger',
                    `Proposal v${r.proposal.version} ${r.decision.outcome === 'ALLOW' ? 'validated — awaiting approval' : 'rejected by the policy gate'}`,
                  );
                },
                onError: (e) => toast('danger', errorText(e)),
              },
            );
          const runRecover = () =>
            recover.mutate(p!.id, {
              onSuccess: (r) => {
                setSelected(null);
                toast(
                  r.decision.outcome === 'ALLOW' ? 'ok' : 'danger',
                  `Recovery plan v${r.proposal.version}: ${r.decision.outcome === 'ALLOW' ? 'passes every hard check' : 'still blocked'}`,
                );
              },
              onError: (e) => toast('danger', errorText(e)),
            });

          return (
            <>
              <div className="page-head">
                <div>
                  <h1>Procurement</h1>
                  <p className="lede">
                    The buyer agent ranks only listings that already passed specification, evidence
                    and deadline checks. Quantities, totals and the decision come from deterministic
                    code.
                  </p>
                </div>
                <span style={{ flex: 1 }} />
                <label
                  className="row small text-2"
                  title="Re-query the catalog instead of reusing results from the last 30 minutes"
                >
                  <input
                    type="checkbox"
                    checked={refresh}
                    onChange={(e) => setRefresh(e.target.checked)}
                  />{' '}
                  Refresh catalog
                </label>
                <Button onClick={runPlan} loading={plan.isPending} disabled={!canPlan}>
                  {proposals.length ? 'Re-plan' : 'Plan mission'}
                </Button>
                {canRecover && (
                  <Button variant="primary" onClick={runRecover} loading={recover.isPending}>
                    Generate recovery plan
                  </Button>
                )}
              </div>

              {!p ? (
                <Panel title="No proposal">
                  <Empty
                    title="Nothing planned yet"
                    action={
                      <Button
                        variant="primary"
                        onClick={runPlan}
                        loading={plan.isPending}
                        disabled={!canPlan}
                      >
                        Plan mission
                      </Button>
                    }
                  >
                    Planning derives requirements, retrieves products and submits a proposal to the
                    DEADMAN policy gate.
                  </Empty>
                </Panel>
              ) : (
                <div className="grid side">
                  <div className="stack" style={{ gap: 18 }}>
                    <Panel
                      title={`Proposal v${p.version}`}
                      sub={`${p.createdBy}${parent ? ` · revises v${parent.version}` : ''}`}
                      actions={
                        <>
                          <StatusBadge status={p.status} tones={PROPOSAL_TONE} />
                          {p.status === 'AWAITING_APPROVAL' && isLatest && (
                            <>
                              <Button size="sm" variant="danger" onClick={() => setRejecting(p.id)}>
                                Reject
                              </Button>
                              <Button
                                size="sm"
                                variant="primary"
                                onClick={() => setApproving(true)}
                              >
                                Review & approve
                              </Button>
                            </>
                          )}
                          {p.status === 'APPROVED' && (
                            <Button
                              size="sm"
                              variant="primary"
                              onClick={() => navigate(`/missions/${id}/payments`)}
                            >
                              Proceed to PayPal
                            </Button>
                          )}
                        </>
                      }
                      flush
                    >
                      {p.lines.length === 0 ? (
                        <div className="panel-body muted">
                          This proposal has no lines: nothing eligible could be bought within the
                          constraints.
                        </div>
                      ) : (
                        <table className="tbl">
                          <thead>
                            <tr>
                              <th>Requirement / product</th>
                              <th>Supplier</th>
                              <th className="num">Packs</th>
                              <th className="num">Covers</th>
                              <th className="num">Unit</th>
                              <th className="num">Line total</th>
                              <th>ETA</th>
                            </tr>
                          </thead>
                          <tbody>
                            {p.lines.map((l) => {
                              const req = reqById.get(l.requirementId);
                              const c = candidateById.get(l.candidateId);
                              const current = c?.quote;
                              const drift = current && current.unitPriceCents !== l.unitPriceCents;
                              const slack = minutesBetween(current?.eta ?? l.eta, mission.deadline);
                              return (
                                <tr key={l.id}>
                                  <td>
                                    <div className="small muted">
                                      {req?.label ?? 'Unlinked requirement'}
                                    </div>
                                    <div className="strong">{l.title}</div>
                                    <div className="row" style={{ marginTop: 3 }}>
                                      <ProvenanceTag p={l.provenance} />
                                      {c?.quarantined && <Badge tone="danger">Quarantined</Badge>}
                                      {c?.pack.evidence && (
                                        <span
                                          className="quote"
                                          title="Pack-size evidence quoted from the listing"
                                        >
                                          {c.pack.evidence}
                                        </span>
                                      )}
                                    </div>
                                  </td>
                                  <td className="small">{l.merchantDomain}</td>
                                  <td className="num">{l.quantityPacks}</td>
                                  <td className="num">
                                    {num(l.unitsCovered)} {req?.unit}
                                  </td>
                                  <td className="num">
                                    {usd(l.unitPriceCents)}
                                    {drift && (
                                      <div className="small" style={{ color: 'var(--danger)' }}>
                                        now {usd(current!.unitPriceCents)}
                                      </div>
                                    )}
                                  </td>
                                  <td className="num">{usd(l.lineTotalCents)}</td>
                                  <td>
                                    <div>{clock(current?.eta ?? l.eta, mission.timezone)}</div>
                                    <div
                                      className="small"
                                      style={{
                                        color:
                                          slack < 30
                                            ? 'var(--danger)'
                                            : slack < 75
                                              ? 'var(--warn)'
                                              : 'var(--text-3)',
                                      }}
                                    >
                                      {slack >= 0
                                        ? `${slack} min before deadline`
                                        : `${-slack} min late`}
                                    </div>
                                    <SimTag label="Sim ETA" />
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                          <tfoot>
                            <tr>
                              <td colSpan={5}>Goods subtotal</td>
                              <td className="num">{usd(p.subtotalCents)}</td>
                              <td />
                            </tr>
                            {p.shipping.map((s) => (
                              <tr key={s.merchantDomain}>
                                <td colSpan={5} className="small" style={{ fontWeight: 400 }}>
                                  Shipping · {s.merchantDomain} <SimTag label="Sim fee" />
                                </td>
                                <td className="num" style={{ fontWeight: 400 }}>
                                  {usd(s.cents)}
                                </td>
                                <td />
                              </tr>
                            ))}
                            <tr>
                              <td colSpan={5}>
                                Total · authority {usd(mission.budgetCents)} ·{' '}
                                {usd(
                                  mission.budgetCents -
                                    d.summary.committedCents -
                                    d.summary.pendingCents -
                                    p.totalCents,
                                )}{' '}
                                headroom
                              </td>
                              <td className="num">{usd(p.totalCents)}</td>
                              <td />
                            </tr>
                          </tfoot>
                        </table>
                      )}
                    </Panel>

                    {(p.gaps.length > 0 || p.tradeoffs.length > 0) && (
                      <Panel title="Gaps and trade-offs">
                        <div className="stack">
                          {p.gaps.map((g) => (
                            <Callout
                              key={g.requirementId}
                              tone="warn"
                              title={`${g.label}: short ${num(g.shortfallUnits)} of ${num(g.neededUnits)}`}
                            >
                              <div className="small">{g.reason}</div>
                            </Callout>
                          ))}
                          {p.tradeoffs.map((t) => (
                            <div key={t} className="small text-2">
                              • {t}
                            </div>
                          ))}
                        </div>
                      </Panel>
                    )}

                    {changes.length > 0 && (
                      <Panel title={`Changes from v${parent!.version}`} sub="Recovery diff">
                        <div className="stack small">
                          {changes.map((c, i) => (
                            <div key={i} className="row">
                              <Badge
                                tone={
                                  c.kind === 'add' ? 'ok' : c.kind === 'remove' ? 'danger' : 'warn'
                                }
                                plain
                              >
                                {c.kind}
                              </Badge>
                              {c.text}
                            </div>
                          ))}
                          <div className="muted">
                            Total {usd(parent!.totalCents)} → {usd(p.totalCents)}
                          </div>
                        </div>
                      </Panel>
                    )}
                  </div>

                  <div className="stack" style={{ gap: 18 }}>
                    <Panel title="Policy gate" sub="DEADMAN · deterministic">
                      {p.latestDecision ? (
                        <PolicyVerdict
                          key={p.latestDecision.id}
                          decision={p.latestDecision}
                          timeZone={mission.timezone}
                        />
                      ) : (
                        <span className="muted">Not evaluated.</span>
                      )}
                    </Panel>
                    {expl && (
                      <Panel
                        title="Explanation"
                        actions={
                          <Badge tone={expl.run.mode === 'claude' ? 'accent' : 'neutral'}>
                            {expl.run.mode === 'claude'
                              ? `Claude · ${expl.run.model}`
                              : 'Deterministic'}
                          </Badge>
                        }
                      >
                        <div className="stack">
                          <div className="strong">{expl.out.headline}</div>
                          <ul style={{ margin: 0, paddingLeft: 18 }} className="small">
                            {expl.out.points.map((pt) => (
                              <li key={pt}>{pt}</li>
                            ))}
                          </ul>
                          <div className="small text-2">{expl.out.nextStep}</div>
                          {!expl.run.valid && expl.run.error && (
                            <div className="small muted">
                              Model output not used: {expl.run.error}
                            </div>
                          )}
                          <div className="small muted">
                            Explanations are advisory; the gate never reads them.
                          </div>
                        </div>
                      </Panel>
                    )}
                    <Panel title="Versions" flush>
                      <table className="tbl">
                        <tbody>
                          {proposals.map((x) => (
                            <tr
                              key={x.id}
                              className={x.id === p.id ? '' : 'dim'}
                              style={{ cursor: 'pointer' }}
                              onClick={() => setSelected(x.id)}
                            >
                              <td>
                                <button
                                  className="btn ghost sm"
                                  onClick={() => setSelected(x.id)}
                                  aria-pressed={x.id === p.id}
                                >
                                  v{x.version}
                                </button>
                              </td>
                              <td>
                                <StatusBadge status={x.status} tones={PROPOSAL_TONE} />
                              </td>
                              <td className="small">{x.createdBy.split(':')[0]}</td>
                              <td className="num">{usd(x.totalCents)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </Panel>
                    <div className="small muted">
                      Evidence for every listing, including excluded ones, is on the{' '}
                      <Link to={`/missions/${id}/evidence`}>product evidence</Link> page.
                    </div>
                  </div>
                </div>
              )}

              {approving && active && (
                <ApprovalModal
                  mission={mission}
                  proposal={active}
                  onClose={() => setApproving(false)}
                />
              )}
              {rejecting && (
                <RejectModal
                  onClose={() => setRejecting(null)}
                  loading={reject.isPending}
                  onConfirm={(reason) =>
                    reject.mutate(
                      { proposalId: rejecting, reason },
                      {
                        onSuccess: () => {
                          setRejecting(null);
                          toast('info', 'Proposal rejected. Generate a recovery plan or re-plan.');
                        },
                        onError: (e) => toast('danger', errorText(e)),
                      },
                    )
                  }
                />
              )}
            </>
          );
        }}
      </QueryView>
    </div>
  );
}

function RejectModal({
  onClose,
  onConfirm,
  loading,
}: {
  onClose: () => void;
  onConfirm: (reason: string) => void;
  loading: boolean;
}) {
  const [reason, setReason] = useState('');
  return (
    <Modal
      title="Reject proposal"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="danger"
            disabled={reason.trim().length < 3}
            loading={loading}
            onClick={() => onConfirm(reason.trim())}
          >
            Reject
          </Button>
        </>
      }
    >
      <div className="field">
        <label htmlFor="reason">Reason (recorded in the audit trail)</label>
        <textarea
          id="reason"
          className="input"
          rows={3}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </div>
    </Modal>
  );
}
