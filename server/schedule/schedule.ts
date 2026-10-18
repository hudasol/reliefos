import { randomUUID } from 'node:crypto';
import type {
  DeliveryTask,
  DeliveryTaskStatus,
  FulfillmentQuote,
  Proposal,
} from '../../shared/types.js';
import { INTAKE_BUFFER_MINUTES } from '../planning/optimizer.js';
import { AT_RISK_MINUTES } from '../policy/engine.js';

// Delivery schedule derived from a proposal and the suppliers' current (simulated) commitments.
// One delivery task per supplier shipment, then shelter intake (depends on every delivery), then
// distribution. Recomputed whenever a quote changes so conflicts surface immediately.

const INTAKE_MINUTES = 30;
const DISTRIBUTION_MINUTES = 60;

export function classifyArrival(end: Date, deadline: Date): DeliveryTaskStatus {
  const slackMin = (deadline.getTime() - end.getTime()) / 60_000;
  if (slackMin < INTAKE_BUFFER_MINUTES) return 'CONFLICT';
  if (slackMin < INTAKE_BUFFER_MINUTES + AT_RISK_MINUTES) return 'AT_RISK';
  return 'PLANNED';
}

export function buildSchedule(input: {
  missionId: string;
  destination: string;
  windowStart: Date;
  deadline: Date;
  proposal: Pick<Proposal, 'id' | 'version' | 'lines'>;
  currentQuotes: Map<string, FulfillmentQuote>;
  confirmed: boolean;
}): DeliveryTask[] {
  const { proposal, deadline } = input;
  const byMerchant = new Map<string, Proposal['lines']>();
  for (const l of proposal.lines) {
    const list = byMerchant.get(l.merchantDomain) ?? [];
    list.push(l);
    byMerchant.set(l.merchantDomain, list);
  }

  const tasks: DeliveryTask[] = [];
  const deliveryIds: string[] = [];
  let latestArrival = input.windowStart;

  for (const [merchant, lines] of [...byMerchant.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const quotes = lines
      .map((l) => input.currentQuotes.get(l.candidateId))
      .filter((q): q is FulfillmentQuote => !!q);
    const start = quotes.length
      ? new Date(Math.min(...quotes.map((q) => new Date(q.dispatchAt).getTime())))
      : new Date(Math.min(...lines.map((l) => new Date(l.eta).getTime())) - 120 * 60_000);
    const end = new Date(
      Math.max(
        ...quotes.map((q) => new Date(q.eta).getTime()),
        ...lines.map((l) => new Date(l.eta).getTime()),
      ),
    );
    if (end > latestArrival) latestArrival = end;
    const status = classifyArrival(end, deadline);
    const id = randomUUID();
    deliveryIds.push(id);
    tasks.push({
      id,
      missionId: input.missionId,
      proposalId: proposal.id,
      proposalVersion: proposal.version,
      kind: 'delivery',
      label: `${lines.length} line${lines.length > 1 ? 's' : ''} · ${lines
        .map((l) => l.title.split(',')[0])
        .join(' / ')
        .slice(0, 80)}`,
      resource: `Supplier · ${merchant}`,
      startAt: start.toISOString(),
      endAt: end.toISOString(),
      status: input.confirmed && status !== 'CONFLICT' ? 'CONFIRMED' : status,
      dependsOn: [],
      lineIds: lines.map((l) => l.id),
      note:
        status === 'CONFLICT'
          ? `Arrives ${Math.round((end.getTime() - deadline.getTime()) / 60_000 + INTAKE_BUFFER_MINUTES)} min after the intake cutoff`
          : null,
      simulated: true,
    });
  }

  const intakeStart = latestArrival;
  const intakeEnd = new Date(intakeStart.getTime() + INTAKE_MINUTES * 60_000);
  const intakeId = randomUUID();
  tasks.push({
    id: intakeId,
    missionId: input.missionId,
    proposalId: proposal.id,
    proposalVersion: proposal.version,
    kind: 'intake',
    label: 'Receive, count and log supplies',
    resource: `${input.destination} · intake`,
    startAt: intakeStart.toISOString(),
    endAt: intakeEnd.toISOString(),
    status: intakeEnd > deadline ? 'CONFLICT' : input.confirmed ? 'CONFIRMED' : 'PLANNED',
    dependsOn: deliveryIds,
    lineIds: [],
    note: intakeEnd > deadline ? 'Intake cannot finish before the deadline' : null,
    simulated: false,
  });

  const distEnd = new Date(intakeEnd.getTime() + DISTRIBUTION_MINUTES * 60_000);
  tasks.push({
    id: randomUUID(),
    missionId: input.missionId,
    proposalId: proposal.id,
    proposalVersion: proposal.version,
    kind: 'distribution',
    label: 'Distribute to registered households',
    resource: `${input.destination} · distribution`,
    startAt: intakeEnd.toISOString(),
    endAt: distEnd.toISOString(),
    status: input.confirmed ? 'CONFIRMED' : 'PLANNED',
    dependsOn: [intakeId],
    lineIds: [],
    note: null,
    simulated: false,
  });

  return tasks;
}
