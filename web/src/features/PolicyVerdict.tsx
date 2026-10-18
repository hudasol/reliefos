import { useState } from 'react';
import type { PolicyDecision } from '../../../shared/types';
import { Badge, Callout } from '../components/ui';
import { IconCheck, IconX } from '../components/icons';
import { dateTime } from '../lib/format';

function Evidence({ data }: { data: Record<string, unknown> }) {
  const entries = Object.entries(data).filter(
    ([, v]) => v !== null && v !== undefined && !(Array.isArray(v) && v.length === 0),
  );
  if (entries.length === 0) return null;
  return (
    <dl className="kv" style={{ marginTop: 6 }}>
      {entries.map(([k, v]) => (
        <div key={k} style={{ display: 'contents' }}>
          <dt>{k}</dt>
          <dd className="mono" style={{ wordBreak: 'break-word' }}>
            {typeof v === 'object' ? JSON.stringify(v) : String(v)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** The DEADMAN decision, with every violation's evidence and the full check list. */
export function PolicyVerdict({
  decision,
  timeZone,
}: {
  decision: PolicyDecision;
  timeZone: string;
}) {
  const [showChecks, setShowChecks] = useState(decision.outcome === 'DENY');
  const denied = decision.outcome === 'DENY';
  return (
    <div className="stack">
      <Callout
        tone={denied ? 'danger' : 'ok'}
        title={
          denied
            ? `Blocked by DEADMAN — ${decision.violations.length} hard rule${decision.violations.length === 1 ? '' : 's'} failed`
            : `Allowed by DEADMAN — ${decision.checks.length} checks passed`
        }
      >
        <div className="small">
          Stage <span className="mono">{decision.stage}</span> · engine{' '}
          <span className="mono">{decision.engineVersion}</span> ·{' '}
          {dateTime(decision.evaluatedAt, timeZone)} · terms hash{' '}
          <span className="hash">{decision.contentHash.slice(0, 12)}</span>
        </div>
      </Callout>
      {denied &&
        decision.violations.map((v, i) => (
          <div key={i} className="panel" style={{ padding: '10px 12px', borderColor: '#efc4be' }}>
            <div className="row">
              <Badge tone="danger" plain>
                {v.checkId}
              </Badge>
              <span className="strong">{v.message}</span>
            </div>
            <Evidence data={v.evidence} />
          </div>
        ))}
      {decision.warnings.length > 0 && (
        <div className="stack small">
          {[...new Map(decision.warnings.map((w) => [w.checkId + w.message, w])).values()]
            .slice(0, 6)
            .map((w, i) => (
              <div key={i} className="row">
                <Badge tone={w.checkId === 'NON_LIVE_DATA' ? 'sim' : 'warn'} plain>
                  {w.checkId}
                </Badge>
                <span className="text-2">{w.message}</span>
              </div>
            ))}
        </div>
      )}
      <button
        className="btn ghost sm"
        style={{ alignSelf: 'flex-start' }}
        onClick={() => setShowChecks((s) => !s)}
        aria-expanded={showChecks}
      >
        {showChecks ? 'Hide' : 'Show'} all {decision.checks.length} checks
      </button>
      {showChecks && (
        <div>
          {decision.checks.map((c) => (
            <div className="check-row" key={c.checkId}>
              {c.passed ? (
                <IconCheck className="check-ic pass" />
              ) : (
                <IconX className="check-ic fail" />
              )}
              <div>
                <div className="strong small">{c.title}</div>
                <div className="small muted">{c.detail}</div>
              </div>
              <span className="mono small muted">{c.checkId}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
