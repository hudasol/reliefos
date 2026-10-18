import { Link, useNavigate, useParams } from 'react-router';
import { useAudit, useMission, usePlan } from '../api/hooks';
import { Badge, Button, Callout, errorText, Panel, QueryView, StatusBadge, useToast } from '../components/ui';
import { clock, dateTime, num, PROPOSAL_TONE, usd } from '../lib/format';
import type { MissionDetail } from '../../../shared/types';

function BudgetMeter({ d }: { d: MissionDetail }) {
  const s = d.summary;
  const pct = (c: number) => `${Math.min(100, (c / Math.max(1, s.budgetCents)) * 100)}%`;
  const planned = Math.max(0, s.plannedCents);
  return (
    <div>
      <div className="meter" aria-label="Budget allocation" style={{ height: 10 }}>
        <span style={{ width: pct(s.committedCents), background: 'var(--ok)' }} title={`Committed ${usd(s.committedCents)}`} />
        <span style={{ width: pct(s.pendingCents), background: 'var(--warn)' }} title={`Pending ${usd(s.pendingCents)}`} />
        <span style={{ width: pct(planned), background: 'var(--accent)', opacity: 0.55 }} title={`Planned ${usd(planned)}`} />
      </div>
      <div className="row small text-2" style={{ marginTop: 6, gap: 16 }}>
        <span><span className="dot" style={{ display: 'inline-block', background: 'var(--ok)' }} /> Paid (verified) {usd(s.committedCents)}</span>
        <span><span className="dot" style={{ display: 'inline-block', background: 'var(--warn)' }} /> In flight {usd(s.pendingCents)}</span>
        <span><span className="dot" style={{ display: 'inline-block', background: 'var(--accent)', opacity: 0.55 }} /> Planned, unpaid {usd(planned)}</span>
        <span style={{ marginLeft: 'auto' }}>Authority {usd(s.budgetCents)}</span>
      </div>
    </div>
  );
}

export function OverviewPage() {
  const { missionId } = useParams();
  const q = useMission(missionId!);
  const audit = useAudit(missionId!);
  const plan = usePlan(missionId!);
  const toast = useToast();
  const navigate = useNavigate();

  return (
    <div className="content">
      <QueryView q={q} rows={8}>
        {(d) => {
          const { mission, summary, requirements, activeProposal: ap } = d;
          const plannedByReq = new Map<string, number>();
          if (ap && !['REJECTED', 'INVALIDATED', 'FAILED', 'EXECUTED'].includes(ap.status)) {
            for (const l of ap.lines) plannedByReq.set(l.requirementId, (plannedByReq.get(l.requirementId) ?? 0) + l.unitsCovered);
          }
          const purchasedByReq = new Map<string, number>();
          for (const p of d.proposals.filter((x) => x.status === 'EXECUTED')) for (const l of p.lines) purchasedByReq.set(l.requirementId, (purchasedByReq.get(l.requirementId) ?? 0) + l.unitsCovered);
          const decision = ap?.latestDecision;
          return (
            <>
              {mission.status === 'DRAFT' && (
                <Callout tone="info" title="This mission has not been planned yet">
                  <div className="row" style={{ marginTop: 6 }}>
                    <span className="small">RELIEFOS will derive requirements, search products, rank them with the buyer agent and submit a proposal to the policy gate.</span>
                    <Button
                      variant="primary"
                      loading={plan.isPending}
                      onClick={() =>
                        plan.mutate(
                          {},
                          {
                            onSuccess: (r) => {
                              toast(r.decision.outcome === 'ALLOW' ? 'ok' : 'danger', `Proposal v${r.proposal.version}: ${r.decision.outcome === 'ALLOW' ? 'validated, awaiting approval' : 'rejected by policy'}`);
                              navigate(`/missions/${mission.id}/procurement`);
                            },
                            onError: (e) => toast('danger', errorText(e)),
                          },
                        )
                      }
                    >
                      Plan mission
                    </Button>
                  </div>
                </Callout>
              )}
              {summary.unresolvedPayments > 0 && (
                <Callout tone="warn" title="A payment outcome is unresolved">
                  RELIEFOS will not start another purchase until it is reconciled with PayPal. <Link to={`/missions/${mission.id}/payments`}>Reconcile now</Link>
                </Callout>
              )}

              <section className="panel">
                <div className="kpis">
                  <div className="kpi">
                    <div className="label">Budget authority</div>
                    <div className="value">{usd(summary.budgetCents, { compact: true })}</div>
                    <div className="hint">Hard cap incl. shipping</div>
                  </div>
                  <div className="kpi">
                    <div className="label">Planned</div>
                    <div className="value">{usd(summary.plannedCents)}</div>
                    <div className="hint">{ap ? `Proposal v${ap.version} · ${ap.status.replace(/_/g, ' ').toLowerCase()}` : 'No proposal yet'}</div>
                  </div>
                  <div className="kpi">
                    <div className="label">Paid (verified)</div>
                    <div className="value">{usd(summary.committedCents)}</div>
                    <div className="hint">{summary.pendingCents ? `${usd(summary.pendingCents)} in flight` : 'PayPal-verified captures only'}</div>
                  </div>
                  <div className="kpi">
                    <div className="label">Remaining authority</div>
                    <div className="value">{usd(summary.remainingCents)}</div>
                    <div className="hint">After paid and in-flight</div>
                  </div>
                  <div className="kpi">
                    <div className="label">Requirements purchased</div>
                    <div className="value">
                      {summary.requirementsCovered}/{summary.requirementsTotal}
                    </div>
                    <div className="hint">{summary.openGaps.length ? `${summary.openGaps.length} still open` : summary.requirementsTotal ? 'All covered' : 'Not derived yet'}</div>
                  </div>
                </div>
                <div className="panel-body">
                  <BudgetMeter d={d} />
                </div>
              </section>

              <div className="grid side">
                <Panel title="What the mission needs" sub={`${mission.population} people · ${mission.infants} infants · ${mission.coverageDays}-day coverage`} flush>
                  {requirements.length === 0 ? (
                    <div className="panel-body muted">Requirements are derived when the mission is planned.</div>
                  ) : (
                    <table className="tbl">
                      <thead>
                        <tr>
                          <th>Requirement</th>
                          <th>Priority</th>
                          <th className="num">Need</th>
                          <th className="num">Planned</th>
                          <th className="num">Purchased</th>
                          <th>State</th>
                        </tr>
                      </thead>
                      <tbody>
                        {requirements.map((r) => {
                          const planned = plannedByReq.get(r.id) ?? 0;
                          const bought = purchasedByReq.get(r.id) ?? 0;
                          const state = bought >= r.quantity ? ['ok', 'Purchased'] : planned + bought >= r.quantity ? ['accent', 'Planned'] : planned + bought > 0 ? ['warn', 'Partial'] : ['danger', 'Unmet'];
                          return (
                            <tr key={r.id}>
                              <td>
                                <div className="strong">{r.label}</div>
                                <div className="small muted">{r.rationale}</div>
                              </td>
                              <td>
                                <Badge plain tone={r.priority === 'critical' ? 'danger' : r.priority === 'high' ? 'warn' : 'neutral'}>
                                  {r.priority}
                                </Badge>
                              </td>
                              <td className="num">
                                {num(r.quantity)} {r.unit}
                              </td>
                              <td className="num">{num(planned)}</td>
                              <td className="num">{num(bought)}</td>
                              <td>
                                <Badge tone={state[0] as 'ok'}>{state[1]}</Badge>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </Panel>

                <div className="stack" style={{ gap: 18 }}>
                  <Panel title="Current proposal" actions={ap && <Link to={`/missions/${mission.id}/procurement`}>Open</Link>}>
                    {!ap ? (
                      <span className="muted">No proposal yet.</span>
                    ) : (
                      <div className="stack">
                        <div className="row">
                          <span className="strong">Version {ap.version}</span>
                          <StatusBadge status={ap.status} tones={PROPOSAL_TONE} />
                          <span style={{ marginLeft: 'auto' }} className="strong num">
                            {usd(ap.totalCents)}
                          </span>
                        </div>
                        <div className="small text-2">
                          {ap.lines.length} lines · {usd(ap.shippingCents)} shipping · by {ap.createdBy}
                        </div>
                        {decision && (
                          <Callout tone={decision.outcome === 'ALLOW' ? 'ok' : 'danger'} title={`DEADMAN ${decision.outcome === 'ALLOW' ? 'allowed' : 'denied'} at ${decision.stage}`}>
                            <div className="small">
                              {decision.outcome === 'ALLOW'
                                ? `${decision.checks.length} checks passed${decision.warnings.length ? `, ${decision.warnings.length} warnings` : ''}.`
                                : decision.violations.slice(0, 3).map((v) => <div key={v.checkId + v.message}>• {v.message}</div>)}
                            </div>
                          </Callout>
                        )}
                        {ap.gaps.length > 0 && (
                          <div className="small">
                            <span className="strong">Unmet in this plan:</span> {ap.gaps.map((g) => `${g.label} (−${num(g.shortfallUnits)})`).join('; ')}
                          </div>
                        )}
                      </div>
                    )}
                  </Panel>
                  <Panel title="Mission window">
                    <dl className="kv">
                      <dt>Opens</dt>
                      <dd>{clock(mission.windowStart, mission.timezone)}</dd>
                      <dt>Hard deadline</dt>
                      <dd className="strong">{clock(mission.deadline, mission.timezone)}</dd>
                      <dt>Destination</dt>
                      <dd>{mission.destination}</dd>
                      <dt>Catalog</dt>
                      <dd>{mission.catalogSource === 'channel3' ? <span className="tag live">Channel3 live</span> : <span className="tag fixture">Fixture catalog</span>}</dd>
                      <dt>Planner</dt>
                      <dd>{mission.plannerMode === 'claude' ? 'Claude (deterministic fallback)' : 'Deterministic'}</dd>
                    </dl>
                  </Panel>
                </div>
              </div>

              <Panel title="Recent activity" actions={<Link to={`/missions/${mission.id}/audit`}>Full audit trail</Link>}>
                <QueryView q={audit} rows={4}>
                  {(a) =>
                    a.events.length === 0 ? (
                      <span className="muted">No activity yet.</span>
                    ) : (
                      <div className="timeline">
                        {a.events.slice(0, 8).map((e) => (
                          <div key={e.id} className={`tl-item ${/rejected|blocked|failed|unknown|discrepancy/.test(e.type) ? 'danger' : /completed|granted|allowed/.test(e.type) ? 'ok' : /drill|fallback/.test(e.type) ? 'warn' : 'accent'}`}>
                            <div className="row small">
                              <span className="mono muted">{e.type}</span>
                              <span className="muted" style={{ marginLeft: 'auto' }}>
                                {dateTime(e.createdAt, mission.timezone)}
                              </span>
                            </div>
                            <div>{e.summary}</div>
                          </div>
                        ))}
                      </div>
                    )
                  }
                </QueryView>
              </Panel>
            </>
          );
        }}
      </QueryView>
    </div>
  );
}
