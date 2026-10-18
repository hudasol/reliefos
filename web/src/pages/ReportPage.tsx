import { useParams } from 'react-router';
import { useReport } from '../api/hooks';
import { Badge, Button, Callout, Panel, QueryView, StatusBadge } from '../components/ui';
import { clock, MISSION_TONE, num, usd } from '../lib/format';

export function ReportPage() {
  const { missionId } = useParams();
  const q = useReport(missionId!);
  return (
    <div className="content">
      <QueryView q={q} rows={10}>
        {(r) => {
          const purchased = new Map<string, number>();
          for (const p of r.executedProposals) for (const l of p.lines) purchased.set(l.requirementId, (purchased.get(l.requirementId) ?? 0) + l.unitsCovered);
          const spent = r.verifiedPayments.reduce((a, p) => a + p.amountCents, 0);
          return (
            <>
              <div className="page-head">
                <div>
                  <h1>Mission report</h1>
                  <p className="lede">Actual outcomes only: purchases count when PayPal has verified the capture. Simulated inputs are listed at the end.</p>
                </div>
                <span style={{ flex: 1 }} />
                <Button onClick={() => window.print()}>Print / save PDF</Button>
              </div>

              <Panel title={r.mission.title} sub={`${r.mission.organization} · ${r.mission.destination} · deadline ${clock(r.mission.deadline, r.mission.timezone)}`} actions={<StatusBadge status={r.mission.status} tones={MISSION_TONE} />}>
                <div className="grid cols-4">
                  <div>
                    <div className="muted small">Verified spend</div>
                    <div className="strong" style={{ fontSize: 20 }}>{usd(spent)}</div>
                    <div className="small text-2">of {usd(r.mission.budgetCents)} authority</div>
                  </div>
                  <div>
                    <div className="muted small">Requirements purchased</div>
                    <div className="strong" style={{ fontSize: 20 }}>
                      {r.summary.requirementsCovered}/{r.summary.requirementsTotal}
                    </div>
                    <div className="small text-2">{r.summary.openGaps.length} with remaining gaps</div>
                  </div>
                  <div>
                    <div className="muted small">Proposals stopped by DEADMAN</div>
                    <div className="strong" style={{ fontSize: 20 }}>{r.rejectedProposals.length}</div>
                    <div className="small text-2">before any payment</div>
                  </div>
                  <div>
                    <div className="muted small">Audit integrity</div>
                    <div className="strong" style={{ fontSize: 20 }}>{r.audit.chainIntact ? 'Intact' : 'Broken'}</div>
                    <div className="small text-2">{r.audit.chainEvents} hash-chained events</div>
                  </div>
                </div>
              </Panel>

              {r.unresolvedPayments.length > 0 && <Callout tone="warn" title={`${r.unresolvedPayments.length} payment(s) unresolved`}>These are not counted as spend until PayPal confirms them.</Callout>}

              <div className="grid cols-2">
                <Panel title="Outcome by requirement" flush>
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th>Requirement</th>
                        <th className="num">Need</th>
                        <th className="num">Purchased</th>
                        <th className="num">Gap</th>
                      </tr>
                    </thead>
                    <tbody>
                      {r.requirements.map((q) => {
                        const got = purchased.get(q.id) ?? 0;
                        return (
                          <tr key={q.id}>
                            <td>{q.label}</td>
                            <td className="num">
                              {num(q.quantity)} {q.unit}
                            </td>
                            <td className="num">{num(got)}</td>
                            <td className="num">{got >= q.quantity ? <Badge tone="ok">met</Badge> : <span style={{ color: 'var(--danger)' }}>{num(q.quantity - got)}</span>}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </Panel>
                <Panel title="Verified PayPal payments" flush>
                  {r.verifiedPayments.length === 0 ? (
                    <div className="panel-body muted">No verified payments.</div>
                  ) : (
                    <table className="tbl">
                      <thead>
                        <tr>
                          <th>Proposal</th>
                          <th>Order / capture</th>
                          <th className="num">Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {r.verifiedPayments.map((p) => (
                          <tr key={p.id}>
                            <td>v{p.proposalVersion}</td>
                            <td className="mono small">
                              {p.providerOrderId}
                              <br />
                              {p.providerCaptureId}
                            </td>
                            <td className="num">{usd(p.amountCents)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </Panel>
              </div>

              <Panel title="What the policy gate stopped" flush>
                {r.rejectedProposals.length === 0 ? (
                  <div className="panel-body muted">No proposals were rejected.</div>
                ) : (
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th>Proposal</th>
                        <th>Author</th>
                        <th>Status</th>
                        <th>Reasons</th>
                      </tr>
                    </thead>
                    <tbody>
                      {r.rejectedProposals.map((p) => (
                        <tr key={p.version}>
                          <td>v{p.version}</td>
                          <td className="small">{p.createdBy}</td>
                          <td>
                            <Badge tone="danger">{p.status.toLowerCase()}</Badge>
                          </td>
                          <td className="small">{p.violations.length ? p.violations.map((v) => v.message).join(' · ') : 'Superseded or withdrawn'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </Panel>

              <div className="grid cols-2">
                <Panel title="Deliveries">
                  {r.confirmedDeliveries.length === 0 ? (
                    <span className="muted">No deliveries confirmed (confirmed only after verified payment).</span>
                  ) : (
                    <div className="stack small">
                      {r.confirmedDeliveries.map((t) => (
                        <div key={t.id} className="row">
                          <Badge tone="ok">confirmed</Badge>
                          <span>{t.resource}</span>
                          <span className="muted" style={{ marginLeft: 'auto' }}>
                            {clock(t.endAt, r.mission.timezone)}
                          </span>
                        </div>
                      ))}
                      <div className="muted">Delivery times are simulated supplier commitments.</div>
                    </div>
                  )}
                </Panel>
                <Panel title="Security assurance">
                  {r.security ? (
                    <div className="stack small">
                      <Badge tone={r.security.failed === 0 ? 'ok' : 'danger'}>
                        {r.security.passed}/{r.security.results.length} adversarial scenarios enforced
                      </Badge>
                      {r.security.results.map((s) => (
                        <div key={s.scenarioId} className="row">
                          <span style={{ color: s.passed ? 'var(--ok)' : 'var(--danger)' }}>{s.passed ? '✓' : '✗'}</span> {s.title}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <span className="muted">The DEADMAN suite has not been run for this mission.</span>
                  )}
                </Panel>
              </div>

              <Panel title="Data provenance and limitations">
                <div className="grid cols-2">
                  <div className="stack small">
                    <div className="strong">Listings by source</div>
                    {Object.entries(r.dataProvenance).map(([k, v]) => (
                      <div key={k}>
                        {k}: {v}
                      </div>
                    ))}
                    <div className="strong" style={{ marginTop: 8 }}>Simulated in this build</div>
                    <ul style={{ margin: 0, paddingLeft: 18 }}>
                      {r.simulated.map((s) => (
                        <li key={s}>{s}</li>
                      ))}
                    </ul>
                  </div>
                  <div className="stack small">
                    <div className="strong">Planning assumptions</div>
                    {Object.entries(r.assumptions).map(([k, a]) => (
                      <div key={k}>
                        <span className="mono">{k}</span> = {a.value} — <span className="muted">{a.source}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </Panel>
            </>
          );
        }}
      </QueryView>
    </div>
  );
}
