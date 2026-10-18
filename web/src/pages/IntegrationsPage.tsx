import { useConfig } from '../api/hooks';
import { Badge, Panel, QueryView } from '../components/ui';

const TONE = { live: 'ok', fallback: 'warn', 'not-configured': 'neutral', error: 'danger' } as const;

export function IntegrationsPage() {
  const q = useConfig();
  return (
    <div className="content">
      <div className="page-head">
        <div>
          <h1>Integrations</h1>
          <p className="lede">Live state of every external dependency on this deployment. A fallback is always labelled in the UI; nothing that is not configured is ever presented as live.</p>
        </div>
      </div>
      <Panel title="Status" flush>
        <QueryView q={q}>
          {(c) => (
            <table className="tbl">
              <thead>
                <tr>
                  <th>Integration</th>
                  <th>State</th>
                  <th>Detail</th>
                </tr>
              </thead>
              <tbody>
                {c.integrations.map((i) => (
                  <tr key={i.id}>
                    <td className="strong">{i.label}</td>
                    <td>
                      <Badge tone={TONE[i.state]}>{i.state.replace('-', ' ')}</Badge>
                    </td>
                    <td className="small text-2">{i.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </QueryView>
      </Panel>
      <Panel title="Build">
        <QueryView q={q}>
          {(c) => (
            <dl className="kv">
              <dt>Version</dt>
              <dd>{c.build.version}</dd>
              <dt>Commit</dt>
              <dd className="mono">{c.build.commit ?? 'local'}</dd>
              <dt>PayPal environment</dt>
              <dd>{c.paypal.environment} (live payments are refused by configuration)</dd>
            </dl>
          )}
        </QueryView>
      </Panel>
    </div>
  );
}
