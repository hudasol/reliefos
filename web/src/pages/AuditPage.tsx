import { Fragment, useState } from 'react';
import { useParams } from 'react-router';
import { useAgentRuns, useAudit, useDecisions, useMission } from '../api/hooks';
import { Badge, Panel, QueryView } from '../components/ui';
import { dateTime } from '../lib/format';

type Tab = 'events' | 'agents' | 'decisions';

export function AuditPage() {
  const { missionId } = useParams();
  const id = missionId!;
  const mq = useMission(id);
  const audit = useAudit(id);
  const runs = useAgentRuns(id);
  const decisions = useDecisions(id);
  const [tab, setTab] = useState<Tab>('events');
  const [open, setOpen] = useState<number | string | null>(null);
  const [filter, setFilter] = useState('');
  const tz = mq.data?.mission.timezone;

  return (
    <div className="content">
      <div className="page-head">
        <div>
          <h1>Audit trail</h1>
          <p className="lede">
            An append-only, hash-chained record of every mission event. The database rejects updates
            and deletes; the chain is re-verified on every view.
          </p>
        </div>
        <span style={{ flex: 1 }} />
        {audit.data && (
          <Badge tone={audit.data.chain.intact ? 'ok' : 'danger'}>
            {audit.data.chain.intact
              ? `Hash chain intact · ${audit.data.chain.events} events`
              : `Chain broken at event ${audit.data.chain.brokenAt}`}
          </Badge>
        )}
      </div>
      <div className="tabs" role="tablist">
        <button
          role="tab"
          className="tab"
          aria-selected={tab === 'events'}
          onClick={() => setTab('events')}
        >
          Events
        </button>
        <button
          role="tab"
          className="tab"
          aria-selected={tab === 'agents'}
          onClick={() => setTab('agents')}
        >
          AI agent runs
        </button>
        <button
          role="tab"
          className="tab"
          aria-selected={tab === 'decisions'}
          onClick={() => setTab('decisions')}
        >
          Policy decisions
        </button>
      </div>

      {tab === 'events' && (
        <Panel
          title="Events"
          actions={
            <input
              className="input"
              style={{ width: 240, height: 28 }}
              placeholder="Filter by type or text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              aria-label="Filter events"
            />
          }
          flush
        >
          <QueryView q={audit} rows={8}>
            {(a) => (
              <table className="tbl">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>When</th>
                    <th>Type</th>
                    <th>Actor</th>
                    <th>Summary</th>
                    <th>Hash</th>
                  </tr>
                </thead>
                <tbody>
                  {a.events
                    .filter(
                      (e) =>
                        !filter ||
                        `${e.type} ${e.summary} ${e.actor}`
                          .toLowerCase()
                          .includes(filter.toLowerCase()),
                    )
                    .map((e) => (
                      <Fragment key={e.id}>
                        <tr
                          onClick={() => setOpen(open === e.id ? null : e.id)}
                          style={{ cursor: 'pointer' }}
                          aria-expanded={open === e.id}
                        >
                          <td className="mono small muted">{e.id}</td>
                          <td className="small" style={{ whiteSpace: 'nowrap' }}>
                            {dateTime(e.createdAt, tz)}
                          </td>
                          <td>
                            <Badge
                              plain
                              tone={
                                /rejected|blocked|failed|unknown|discrepancy/.test(e.type)
                                  ? 'danger'
                                  : /completed|granted|allowed/.test(e.type)
                                    ? 'ok'
                                    : /drill|fallback|invalidat/.test(e.type)
                                      ? 'warn'
                                      : 'neutral'
                              }
                            >
                              {e.type}
                            </Badge>
                          </td>
                          <td className="small mono">{e.actor}</td>
                          <td>{e.summary}</td>
                          <td className="hash" title={`prev ${e.prevHash}`}>
                            {e.hash.slice(0, 10)}
                          </td>
                        </tr>
                        {open === e.id && (
                          <tr>
                            <td colSpan={6} style={{ background: 'var(--surface-2)' }}>
                              <pre
                                className="mono"
                                style={{ margin: 0, whiteSpace: 'pre-wrap', fontSize: 11.5 }}
                              >
                                {JSON.stringify(e.data, null, 2)}
                              </pre>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    ))}
                </tbody>
              </table>
            )}
          </QueryView>
        </Panel>
      )}

      {tab === 'agents' && (
        <Panel
          title="AI agent runs"
          sub="What the models were asked, what they returned, and whether it was accepted"
          flush
        >
          <QueryView q={runs}>
            {(list) =>
              list.length === 0 ? (
                <div className="panel-body muted">No agent runs yet.</div>
              ) : (
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>When</th>
                      <th>Role</th>
                      <th>Mode</th>
                      <th>Input</th>
                      <th>Accepted</th>
                      <th className="num">Latency</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((r) => (
                      <Fragment key={r.id}>
                        <tr
                          onClick={() => setOpen(open === r.id ? null : r.id)}
                          style={{ cursor: 'pointer' }}
                        >
                          <td className="small">{dateTime(r.createdAt, tz)}</td>
                          <td>{r.role}</td>
                          <td>
                            <Badge tone={r.mode === 'claude' ? 'accent' : 'neutral'}>
                              {r.mode === 'claude' ? r.model : 'deterministic'}
                            </Badge>
                          </td>
                          <td className="small">{r.inputSummary}</td>
                          <td>
                            {r.valid ? (
                              <Badge tone="ok">accepted</Badge>
                            ) : (
                              <Badge tone="warn">rejected → fallback</Badge>
                            )}
                            {r.error && <div className="small muted">{r.error}</div>}
                          </td>
                          <td className="num small">{r.latencyMs} ms</td>
                        </tr>
                        {open === r.id && (
                          <tr>
                            <td colSpan={6} style={{ background: 'var(--surface-2)' }}>
                              <pre
                                className="mono"
                                style={{ margin: 0, whiteSpace: 'pre-wrap', fontSize: 11.5 }}
                              >
                                {JSON.stringify(r.output, null, 2)}
                              </pre>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              )
            }
          </QueryView>
        </Panel>
      )}

      {tab === 'decisions' && (
        <Panel title="Policy decisions" flush>
          <QueryView q={decisions}>
            {(list) => (
              <table className="tbl">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Proposal</th>
                    <th>Stage</th>
                    <th>Outcome</th>
                    <th>Violations</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((dcs) => (
                    <tr key={dcs.id}>
                      <td className="small">{dateTime(dcs.evaluatedAt, tz)}</td>
                      <td>v{dcs.proposalVersion}</td>
                      <td className="mono small">{dcs.stage}</td>
                      <td>
                        <Badge tone={dcs.outcome === 'ALLOW' ? 'ok' : 'danger'}>
                          {dcs.outcome}
                        </Badge>
                      </td>
                      <td className="small">
                        {dcs.violations.map((v) => v.checkId).join(', ') || '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </QueryView>
        </Panel>
      )}
    </div>
  );
}
