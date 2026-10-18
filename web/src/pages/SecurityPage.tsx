import { useState } from 'react';
import { useParams } from 'react-router';
import { MARKET_EVENT_INFO, MARKET_EVENTS, type MarketEventKind } from '../../../shared/contracts';
import { useMarketEvent, useMission, useRunSecuritySuite, useSecurityCatalog, useSecurityRuns } from '../api/hooks';
import type { DrillOutcome } from '../api/types';
import { Badge, Button, Callout, errorText, Panel, QueryView, useToast } from '../components/ui';
import { PolicyVerdict } from '../features/PolicyVerdict';
import { dateTime } from '../lib/format';

export function SecurityPage() {
  const { missionId } = useParams();
  const id = missionId!;
  const mq = useMission(id);
  const runs = useSecurityRuns(id);
  const catalog = useSecurityCatalog();
  const drill = useMarketEvent(id);
  const suite = useRunSecuritySuite(id);
  const toast = useToast();
  const [last, setLast] = useState<DrillOutcome | null>(null);
  const [running, setRunning] = useState<MarketEventKind | null>(null);

  return (
    <div className="content">
      <div className="page-head">
        <div>
          <h1>Security lab</h1>
          <p className="lede">
            DEADMAN is the independent policy gate between every AI proposal and PayPal. Drills attack this mission's live plan; the suite replays eight attack scenarios against the real services in an isolated database. The adversary can find failures — it can never grant permission.
          </p>
        </div>
      </div>

      <QueryView q={mq}>
        {(d) => {
          const open = d.activeProposal && ['AWAITING_APPROVAL', 'APPROVED', 'VALIDATED'].includes(d.activeProposal.status);
          const blocked = d.mission.status === 'EXECUTING';
          return (
            <Panel title="Live drills on this mission" sub="Changes simulated supplier state, then re-runs the gate on the open proposal">
              {!d.activeProposal && <Callout tone="info">Plan the mission first; drills attack the open proposal.</Callout>}
              {blocked && <Callout tone="warn">A payment is in progress. Drills are disabled until it resolves.</Callout>}
              <div className="grid cols-4" style={{ marginTop: d.activeProposal && !blocked ? 0 : 12 }}>
                {MARKET_EVENTS.map((k) => (
                  <div key={k} className="panel" style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div className="strong">{MARKET_EVENT_INFO[k].title}</div>
                    <div className="small text-2" style={{ flex: 1 }}>
                      {MARKET_EVENT_INFO[k].description}
                    </div>
                    <Button
                      size="sm"
                      variant={k === 'injected-listing' ? 'danger' : undefined}
                      disabled={!d.activeProposal || blocked || (k !== 'injected-listing' && !open) || drill.isPending}
                      loading={running === k}
                      onClick={() => {
                        setRunning(k);
                        drill.mutate(k, {
                          onSuccess: (r) => {
                            setLast(r);
                            const denied = r.revalidated?.decision.outcome === 'DENY' || r.changed.some((c) => /DENY/.test(c));
                            toast(denied ? 'ok' : 'info', denied ? 'Gate blocked the drill' : 'Drill applied; the open proposal still passes');
                          },
                          onError: (e) => toast('danger', errorText(e)),
                          onSettled: () => setRunning(null),
                        });
                      }}
                    >
                      Run drill
                    </Button>
                  </div>
                ))}
              </div>
              {last && (
                <div className="stack" style={{ marginTop: 14 }}>
                  <div className="strong">Result: {last.title}</div>
                  <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
                    {last.changed.map((c) => (
                      <li key={c}>{c}</li>
                    ))}
                  </ul>
                  {last.revalidated ? (
                    <PolicyVerdict decision={last.revalidated.decision} timeZone={d.mission.timezone} />
                  ) : (
                    <div className="small muted">See Procurement for the compromised proposal and its rejection.</div>
                  )}
                </div>
              )}
            </Panel>
          );
        }}
      </QueryView>

      <Panel
        title="DEADMAN adversarial suite"
        sub="8 scenarios · isolated PGlite database · scripted PayPal double for timeouts"
        actions={
          <Button
            variant="primary"
            loading={suite.isPending}
            onClick={() =>
              suite.mutate(undefined, {
                onSuccess: (r) => toast(r.failed === 0 ? 'ok' : 'danger', `${r.passed}/${r.results.length} scenarios enforced`),
                onError: (e) => toast('danger', errorText(e)),
              })
            }
          >
            Run suite
          </Button>
        }
        flush
      >
        <QueryView q={runs}>
          {(list) => {
            const run = list[0];
            if (!run)
              return (
                <QueryView q={catalog}>
                  {(c) => (
                    <table className="tbl">
                      <thead>
                        <tr>
                          <th>Scenario</th>
                          <th>Attack</th>
                          <th>Expected enforcement</th>
                        </tr>
                      </thead>
                      <tbody>
                        {c.scenarios.map((s) => (
                          <tr key={s.id}>
                            <td className="strong">{s.title}</td>
                            <td className="small">{s.attack}</td>
                            <td className="small">{s.expected}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </QueryView>
              );
            return (
              <>
                <div className="panel-body row">
                  <Badge tone={run.failed === 0 ? 'ok' : 'danger'}>
                    {run.passed}/{run.results.length} enforced
                  </Badge>
                  <span className="small muted">
                    {run.suiteVersion} · {dateTime(run.finishedAt)} · {Math.round(run.results.reduce((a, r) => a + r.durationMs, 0) / 100) / 10}s
                  </span>
                </div>
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Result</th>
                      <th>Scenario & attack</th>
                      <th>Expected</th>
                      <th>Observed</th>
                      <th>Enforced by</th>
                    </tr>
                  </thead>
                  <tbody>
                    {run.results.map((r) => (
                      <tr key={r.scenarioId}>
                        <td>
                          <Badge tone={r.passed ? 'ok' : 'danger'}>{r.passed ? 'Pass' : 'Fail'}</Badge>
                        </td>
                        <td>
                          <div className="strong">{r.title}</div>
                          <div className="small text-2">{r.attack}</div>
                        </td>
                        <td className="small">{r.expected}</td>
                        <td className="small">{r.observed}</td>
                        <td className="small mono">{r.enforcedBy.join(', ')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            );
          }}
        </QueryView>
      </Panel>

      <Panel title="Policy rules" sub="Hard rules cannot be traded away" flush>
        <QueryView q={catalog}>
          {(c) => (
            <table className="tbl">
              <thead>
                <tr>
                  <th>Rule</th>
                  <th>What it enforces</th>
                  <th>Stages</th>
                </tr>
              </thead>
              <tbody>
                {c.checks.map((r) => (
                  <tr key={r.id}>
                    <td className="mono small">{r.id}</td>
                    <td>{r.title}</td>
                    <td className="small">{r.stages.join(' · ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </QueryView>
      </Panel>
    </div>
  );
}
