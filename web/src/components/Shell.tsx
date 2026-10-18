import { NavLink, Outlet, useNavigate, useParams } from 'react-router';
import { useConfig, useMission, useSession } from '../api/hooks';
import { clock, MISSION_TONE } from '../lib/format';
import { Button, ErrorBlock, LoadingBlock, StatusBadge } from './ui';
import {
  IconCard,
  IconCart,
  IconEvidence,
  IconGrid,
  IconLedger,
  IconList,
  IconOverview,
  IconPlug,
  IconReport,
  IconSchedule,
  IconShield,
} from './icons';

const MISSION_NAV = [
  { to: '', label: 'Overview', icon: IconOverview, end: true },
  { to: 'procurement', label: 'Procurement', icon: IconCart },
  { to: 'evidence', label: 'Product evidence', icon: IconEvidence },
  { to: 'decision-center', label: 'Decision center', icon: IconGrid },
  { to: 'schedule', label: 'Delivery schedule', icon: IconSchedule },
  { to: 'security', label: 'Security lab', icon: IconShield },
  { to: 'payments', label: 'Approvals & payments', icon: IconCard },
  { to: 'audit', label: 'Audit trail', icon: IconLedger },
  { to: 'report', label: 'Mission report', icon: IconReport },
];

function Sidebar() {
  const { missionId } = useParams();
  const config = useConfig();
  const mission = useMission(missionId ?? '');
  return (
    <aside className="sidebar" aria-label="Primary">
      <div className="brand">
        <div className="brand-mark" aria-hidden="true">
          R
        </div>
        <div>
          <div className="brand-name">RELIEFOS</div>
          <div className="brand-sub">Emergency procurement</div>
        </div>
      </div>
      <nav className="nav-section" aria-label="Workspace">
        <NavLink
          to="/missions"
          end
          className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
        >
          <IconList /> Missions
        </NavLink>
      </nav>
      {missionId && (
        <>
          <div className="mission-switch">
            <div className="t">{mission.data?.mission.title ?? 'Loading mission…'}</div>
            <div className="s">{mission.data ? `${mission.data.mission.organization}` : ' '}</div>
          </div>
          <nav className="nav-section" aria-label="Mission">
            {MISSION_NAV.map((n) => (
              <NavLink
                key={n.to}
                to={`/missions/${missionId}${n.to ? `/${n.to}` : ''}`}
                end={n.end}
                className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
              >
                <n.icon /> {n.label}
              </NavLink>
            ))}
          </nav>
        </>
      )}
      <nav className="nav-section" aria-label="System">
        <NavLink
          to="/integrations"
          className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
        >
          <IconPlug /> Integrations
        </NavLink>
      </nav>
      <div className="sidebar-foot">
        {(config.data?.integrations ?? []).map((i) => (
          <div className="int-row" key={i.id} title={i.detail}>
            <span className={`dot ${i.state}`} />
            <span>{i.label.replace(/\s*\(.*\)/, '')}</span>
          </div>
        ))}
        <div style={{ marginTop: 8 }} className="muted">
          PayPal Sandbox only · no real funds
        </div>
      </div>
    </aside>
  );
}

export function AppShell() {
  const session = useSession();
  return (
    <div className="shell">
      <Sidebar />
      <main className="main" id="main">
        {session.isLoading ? (
          <div className="content">
            <LoadingBlock rows={6} />
          </div>
        ) : session.error ? (
          <div className="content">
            <ErrorBlock error={session.error} retry={() => void session.refetch()} />
          </div>
        ) : (
          <Outlet />
        )}
      </main>
    </div>
  );
}

export function MissionLayout() {
  const { missionId } = useParams();
  const navigate = useNavigate();
  const q = useMission(missionId!);
  if (q.isLoading)
    return (
      <div className="content">
        <LoadingBlock rows={8} />
      </div>
    );
  if (q.error || !q.data)
    return (
      <div className="content">
        <ErrorBlock error={q.error} retry={() => void q.refetch()} />
      </div>
    );
  const { mission, summary } = q.data;
  const target: Record<string, string> = {
    PLAN: 'procurement',
    RECOVER: 'procurement',
    APPROVE: 'procurement',
    PAY: 'payments',
    RECONCILE: 'payments',
    EDIT: 'edit',
    DONE: 'report',
  };
  return (
    <>
      <header className="topbar">
        <div>
          <div className="crumbs">
            {mission.organization} · v{mission.version} · deadline{' '}
            {clock(mission.deadline, mission.timezone)} at {mission.destination}
          </div>
          <div className="row" style={{ marginTop: 2 }}>
            <span className="title">{mission.title}</span>
            <StatusBadge status={mission.status} tones={MISSION_TONE} />
          </div>
        </div>
        <div className="spacer" />
        <div className="small text-2" style={{ maxWidth: 320, textAlign: 'right' }}>
          <div className="muted">Next action</div>
          {summary.nextAction.label}
        </div>
        {target[summary.nextAction.code] && (
          <Button
            variant="primary"
            onClick={() => navigate(`/missions/${mission.id}/${target[summary.nextAction.code]}`)}
          >
            Go
          </Button>
        )}
      </header>
      <Outlet />
    </>
  );
}
