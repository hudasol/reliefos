import '@bryntum/scheduler/fontawesome/css/fontawesome.css';
import '@bryntum/scheduler/fontawesome/css/solid.css';
import '@bryntum/scheduler/scheduler.css';
import '@bryntum/scheduler/stockholm-light.css';
import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import { BryntumScheduler } from '@bryntum/scheduler-react';
import type { DeliveryTask } from '../../../shared/types';
import { useMission, useSchedule } from '../api/hooks';
import { Badge, Callout, Panel, QueryView, SimTag } from '../components/ui';
import { clock } from '../lib/format';

const COLOR: Record<DeliveryTask['status'], string> = {
  PLANNED: 'blue',
  AT_RISK: 'orange',
  CONFLICT: 'red',
  CONFIRMED: 'green',
  SUPERSEDED: 'gray',
};
const TONE: Record<DeliveryTask['status'], 'info' | 'warn' | 'danger' | 'ok' | 'neutral'> = {
  PLANNED: 'info',
  AT_RISK: 'warn',
  CONFLICT: 'danger',
  CONFIRMED: 'ok',
  SUPERSEDED: 'neutral',
};
const INTAKE_BUFFER_MIN = 30;

export default function SchedulePage() {
  const { missionId } = useParams();
  const sq = useSchedule(missionId!);
  const mq = useMission(missionId!);
  const [showSuperseded, setShowSuperseded] = useState(false);

  const model = useMemo(() => {
    if (!sq.data || !mq.data) return null;
    const activeId = mq.data.activeProposal?.id;
    const tasks = sq.data.tasks.filter((t) =>
      showSuperseded ? true : t.proposalId === activeId || t.status === 'CONFIRMED',
    );
    const resourceNames = [...new Set(tasks.map((t) => t.resource))]
      .sort(
        (a, b) =>
          Number(a.startsWith('Supplier')) - Number(b.startsWith('Supplier')) || a.localeCompare(b),
      )
      .reverse();
    const resources = resourceNames.map((name) => ({
      id: name,
      name,
      kind: name.startsWith('Supplier') ? 'Supplier shipment' : 'Shelter operations',
    }));
    const versions = new Map((mq.data.proposals ?? []).map((p) => [p.id, p.version]));
    const events = tasks.map((t) => ({
      id: t.id,
      resourceId: t.resource,
      name: `${t.proposalId !== activeId ? `v${versions.get(t.proposalId) ?? '?'} · ` : ''}${t.kind === 'delivery' ? 'Delivery' : t.kind === 'intake' ? 'Intake' : 'Distribution'} · ${t.label}`,
      startDate: new Date(t.startAt),
      endDate: new Date(
        Math.max(new Date(t.endAt).getTime(), new Date(t.startAt).getTime() + 5 * 60_000),
      ),
      eventColor: t.proposalId !== activeId && t.status !== 'CONFIRMED' ? 'gray' : COLOR[t.status],
      cls: t.status === 'CONFLICT' ? 'rlf-conflict' : '',
      status: t.status,
      note: t.note ?? '',
    }));
    const ids = new Set(events.map((e) => e.id));
    const dependencies = tasks.flatMap((t) =>
      t.dependsOn
        .filter((d) => ids.has(d))
        .map((from) => ({ id: `${from}->${t.id}`, from, to: t.id })),
    );
    const deadline = new Date(sq.data.deadline);
    const start = new Date(sq.data.windowStart);
    const latestEnd = Math.max(
      deadline.getTime(),
      ...tasks.map((t) => new Date(t.endAt).getTime()),
    );
    const timeRanges = [
      {
        id: 'window',
        name: 'Mission window',
        startDate: start,
        endDate: deadline,
        cls: 'rlf-window',
      },
      {
        id: 'cutoff',
        name: 'Intake cutoff',
        startDate: new Date(deadline.getTime() - INTAKE_BUFFER_MIN * 60_000),
        cls: 'rlf-cutoff',
      },
      {
        id: 'deadline',
        name: `Deadline ${clock(sq.data.deadline, sq.data.timezone)}`,
        startDate: deadline,
        cls: 'rlf-deadline',
      },
    ];
    return {
      resources,
      events,
      dependencies,
      timeRanges,
      startDate: new Date(start.getTime() - 30 * 60_000),
      endDate: new Date(latestEnd + 90 * 60_000),
      tasks,
    };
  }, [sq.data, mq.data, showSuperseded]);

  return (
    <div className="content">
      <style>{`
        .rlf-window { background: rgba(36, 89, 196, 0.05) !important; }
        .rlf-deadline { border-left: 2px solid #b1261b !important; }
        .rlf-deadline label, .rlf-cutoff label { font-weight: 600; }
        .rlf-cutoff { border-left: 2px dashed #9a5b0c !important; }
        .b-sch-event.rlf-conflict { box-shadow: 0 0 0 2px #b1261b inset; }
      `}</style>
      <div className="page-head">
        <div>
          <h1>Delivery schedule</h1>
          <p className="lede">
            Derived from the current proposal and each supplier's commitment. When an estimate
            changes, the schedule is recomputed and late deliveries surface as conflicts against the
            intake cutoff.
          </p>
        </div>
        <span style={{ flex: 1 }} />
        <label className="row small text-2">
          <input
            type="checkbox"
            checked={showSuperseded}
            onChange={(e) => setShowSuperseded(e.target.checked)}
          />{' '}
          Show superseded plans
        </label>
      </div>
      <QueryView q={sq} rows={8}>
        {(s) =>
          !model || model.tasks.length === 0 ? (
            <Panel title="No schedule yet">
              <span className="muted">Plan the mission to build a delivery schedule.</span>
            </Panel>
          ) : (
            <>
              {model.tasks.some((t) => t.status === 'CONFLICT') && (
                <Callout tone="danger" title="Schedule conflict">
                  {model.tasks
                    .filter((t) => t.status === 'CONFLICT')
                    .map((t) => `${t.resource}: ${t.note ?? 'misses the deadline'}`)
                    .join(' · ')}{' '}
                  <Link to={`/missions/${missionId}/procurement`}>Review proposal</Link>
                </Callout>
              )}
              <Panel
                title={`${s.destination} resupply`}
                sub={`Times in ${s.timezone}`}
                actions={<SimTag label="Simulated supplier ETAs" />}
                flush
              >
                <div className="scheduler-frame">
                  <BryntumScheduler
                    readOnly
                    timeZone={s.timezone}
                    startDate={model.startDate}
                    endDate={model.endDate}
                    viewPreset="hourAndDay"
                    rowHeight={56}
                    barMargin={8}
                    eventStyle="rounded"
                    zoomOnMouseWheel={false}
                    columns={[
                      { text: 'Lane', field: 'name', width: 260 },
                      { text: 'Type', field: 'kind', width: 140 },
                    ]}
                    resources={model.resources}
                    events={model.events}
                    dependencies={model.dependencies}
                    timeRanges={model.timeRanges}
                    timeRangesFeature={{ showCurrentTimeLine: false, showHeaderElements: true }}
                    dependenciesFeature
                    eventTooltipFeature={{
                      template: (data: {
                        eventRecord: {
                          name: string;
                          getData: (f: string) => string;
                          startDate: Date;
                          endDate: Date;
                        };
                      }) =>
                        `<div style="max-width:320px"><b>${escapeHtml(data.eventRecord.name)}</b><br/>${escapeHtml(data.eventRecord.getData('status'))}<br/>${escapeHtml(data.eventRecord.getData('note') || '')}</div>`,
                    }}
                    eventMenuFeature={false}
                    scheduleMenuFeature={false}
                    cellEditFeature={false}
                    eventEditFeature={false}
                    eventDragCreateFeature={false}
                  />
                </div>
              </Panel>
              <Panel title="Tasks" flush>
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Lane</th>
                      <th>Task</th>
                      <th>Start</th>
                      <th>End</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {model.tasks.map((t) => (
                      <tr key={t.id} className={t.status === 'SUPERSEDED' ? 'dim' : ''}>
                        <td>{t.resource}</td>
                        <td>
                          {t.label}
                          {t.note && (
                            <div className="small" style={{ color: 'var(--danger)' }}>
                              {t.note}
                            </div>
                          )}
                        </td>
                        <td>{clock(t.startAt, s.timezone)}</td>
                        <td>{clock(t.endAt, s.timezone)}</td>
                        <td>
                          <Badge tone={TONE[t.status]}>
                            {t.status.toLowerCase().replace('_', ' ')}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Panel>
            </>
          )
        }
      </QueryView>
    </div>
  );
}

function escapeHtml(s: string) {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}
