import { describe, expect, it } from 'vitest';
import { buildSchedule, classifyArrival } from '../../server/schedule/schedule.js';
import { DEADLINE, MISSION_ID, makeScenario, planFor, proposalFromPlan, WINDOW_START } from '../helpers/factories.js';

describe('delivery schedule', () => {
  it('creates one delivery per supplier, then intake depending on all deliveries', () => {
    const s = makeScenario();
    const proposal = proposalFromPlan(planFor(s));
    const tasks = buildSchedule({
      missionId: MISSION_ID,
      destination: 'East Shelter',
      windowStart: WINDOW_START,
      deadline: DEADLINE,
      proposal,
      currentQuotes: new Map(s.quotes.map((q) => [q.candidateId, q])),
      confirmed: false,
    });
    const deliveries = tasks.filter((t) => t.kind === 'delivery');
    expect(deliveries).toHaveLength(new Set(proposal.lines.map((l) => l.merchantDomain)).size);
    const intake = tasks.find((t) => t.kind === 'intake')!;
    expect(intake.dependsOn.sort()).toEqual(deliveries.map((d) => d.id).sort());
    expect(tasks.every((t) => t.status === 'PLANNED')).toBe(true);
  });

  it('marks a late shipment and the dependent intake as conflicts when an ETA slips', () => {
    const s = makeScenario();
    const proposal = proposalFromPlan(planFor(s));
    const quotes = new Map(s.quotes.map((q) => [q.candidateId, q]));
    const l = proposal.lines[0]!;
    quotes.set(l.candidateId, { ...quotes.get(l.candidateId)!, eta: new Date(DEADLINE.getTime() + 20 * 60_000).toISOString() });
    const tasks = buildSchedule({ missionId: MISSION_ID, destination: 'East Shelter', windowStart: WINDOW_START, deadline: DEADLINE, proposal, currentQuotes: quotes, confirmed: false });
    expect(tasks.find((t) => t.resource === `Supplier · ${l.merchantDomain}`)!.status).toBe('CONFLICT');
    expect(tasks.find((t) => t.kind === 'intake')!.status).toBe('CONFLICT');
  });

  it('classifies arrival slack against the intake buffer', () => {
    expect(classifyArrival(new Date(DEADLINE.getTime() - 20 * 60_000), DEADLINE)).toBe('CONFLICT');
    expect(classifyArrival(new Date(DEADLINE.getTime() - 60 * 60_000), DEADLINE)).toBe('AT_RISK');
    expect(classifyArrival(new Date(DEADLINE.getTime() - 120 * 60_000), DEADLINE)).toBe('PLANNED');
  });
});
