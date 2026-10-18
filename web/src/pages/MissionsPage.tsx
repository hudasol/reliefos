import { useEffect } from 'react';
import { Link, useNavigate } from 'react-router';
import { useCreateScenario, useMissions } from '../api/hooks';
import { Button, Empty, errorText, Panel, QueryView, StatusBadge, useToast } from '../components/ui';
import { IconPlus } from '../components/icons';
import { clock, dateTime, MISSION_TONE, usd } from '../lib/format';

export function MissionsPage({ autoOpen }: { autoOpen?: boolean }) {
  const q = useMissions();
  const navigate = useNavigate();
  const scenario = useCreateScenario();
  const toast = useToast();

  useEffect(() => {
    if (autoOpen && q.data?.[0]) navigate(`/missions/${q.data[0].id}`, { replace: true });
  }, [autoOpen, q.data, navigate]);

  return (
    <div className="content">
      <div className="page-head">
        <div>
          <h1>Missions</h1>
          <p className="lede">Each mission turns an urgent supply request into a validated, approved and auditable PayPal purchase. Missions are private to this browser workspace.</p>
        </div>
        <span style={{ flex: 1 }} />
        <Button
          loading={scenario.isPending}
          onClick={() =>
            scenario.mutate(undefined, {
              onSuccess: (m) => navigate(`/missions/${m.id}`),
              onError: (e) => toast('danger', errorText(e)),
            })
          }
        >
          Load flood scenario
        </Button>
        <Button variant="primary" onClick={() => navigate('/missions/new')}>
          <IconPlus width={14} height={14} /> New mission
        </Button>
      </div>
      <Panel title="All missions" flush>
        <QueryView q={q}>
          {(missions) =>
            missions.length === 0 ? (
              <Empty title="No missions yet" action={<Button variant="primary" onClick={() => navigate('/missions/new')}>Create a mission</Button>}>
                Describe what is needed, where and by when; RELIEFOS derives the requirements.
              </Empty>
            ) : (
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Mission</th>
                    <th>Status</th>
                    <th className="num">Budget</th>
                    <th className="num">People</th>
                    <th>Deadline</th>
                    <th>Created</th>
                  </tr>
                </thead>
                <tbody>
                  {missions.map((m) => (
                    <tr key={m.id}>
                      <td>
                        <Link to={`/missions/${m.id}`} className="strong">
                          {m.title}
                        </Link>
                        <div className="small muted">{m.organization}</div>
                      </td>
                      <td>
                        <StatusBadge status={m.status} tones={MISSION_TONE} />
                      </td>
                      <td className="num">{usd(m.budgetCents, { compact: true })}</td>
                      <td className="num">{m.population}</td>
                      <td>
                        {clock(m.deadline, m.timezone)} · {m.destination}
                      </td>
                      <td className="small muted">{dateTime(m.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          }
        </QueryView>
      </Panel>
    </div>
  );
}
