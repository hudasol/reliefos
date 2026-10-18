import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../../server/api/app.js';
import { makeHarness } from '../helpers/harness.js';

let h: Awaited<ReturnType<typeof makeHarness>>;
afterEach(async () => h?.close());

async function appWith(opts: { gateway?: 'scripted' | 'none' } = {}) {
  h = await makeHarness({ gateway: opts.gateway === 'none' ? null : undefined });
  const app = createApp({
    deps: h.deps,
    sessionSecret: 'test-secret',
    secureCookies: false,
    staticDir: null,
    publicConfig: () => ({ paypal: { enabled: !!h.deps.gateway, clientId: null, environment: 'sandbox' }, agStudioLicenseKey: null, agGridLicenseKey: null, integrations: [], build: { version: 't', commit: null } }),
  });
  const agent = request.agent(app);
  const session = await agent.get('/api/session').expect(200);
  return { app, agent, session };
}

const H = { 'x-reliefos-request': '1' };

describe('HTTP API', () => {
  it('bootstraps an isolated workspace seeded with the flood scenario', async () => {
    const { agent, session } = await appWith();
    expect(session.body.created).toBe(true);
    expect(session.headers['set-cookie']?.[0]).toMatch(/rlf_ws=.*HttpOnly; SameSite=Lax/);
    const missions = await agent.get('/api/missions').expect(200);
    expect(missions.body).toHaveLength(1);
    expect(missions.body[0]).toMatchObject({ budgetCents: 400_000, population: 120, status: 'DRAFT', scenarioKey: 'flood-east-shelter' });
  });

  it('rejects requests without a session and mutations without the request header', async () => {
    const { app, agent } = await appWith();
    await request(app).get('/api/missions').expect(401);
    const missions = await agent.get('/api/missions');
    await agent.post(`/api/missions/${missions.body[0].id}/plan`).send({}).expect(401);
  });

  it('does not reveal missions from another workspace', async () => {
    const { app, agent } = await appWith();
    const mine = (await agent.get('/api/missions')).body[0];
    const other = request.agent(app);
    await other.get('/api/session').expect(200);
    await other.get(`/api/missions/${mine.id}`).expect(404);
    await other.post(`/api/missions/${mine.id}/plan`).set(H).send({}).expect(404);
  });

  it('validates request bodies at the boundary', async () => {
    const { agent } = await appWith();
    const res = await agent.post('/api/missions').set(H).send({ title: 'x', budgetUsd: -5 }).expect(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(res.body.error.details.length).toBeGreaterThan(0);
  });

  it('runs plan → approve → PayPal order → capture over HTTP', async () => {
    const { agent } = await appWith();
    const mission = (await agent.get('/api/missions')).body[0];
    const plan = await agent.post(`/api/missions/${mission.id}/plan`).set(H).send({}).expect(200);
    expect(plan.body.decision.outcome).toBe('ALLOW');
    const p = plan.body.proposal;

    // Approval must be bound to what was reviewed.
    await agent
      .post(`/api/missions/${mission.id}/proposals/${p.id}/approve`)
      .set(H)
      .send({ approverName: 'Dana Reyes', expectedContentHash: 'a'.repeat(64), expectedTotalCents: p.totalCents, acknowledged: true })
      .expect(409);
    const approval = await agent
      .post(`/api/missions/${mission.id}/proposals/${p.id}/approve`)
      .set(H)
      .send({ approverName: 'Dana Reyes', expectedContentHash: p.contentHash, expectedTotalCents: p.totalCents, acknowledged: true })
      .expect(200);

    const op = await agent.post(`/api/missions/${mission.id}/proposals/${p.id}/payments`).set(H).send({ approvalId: approval.body.id }).expect(201);
    expect(op.body.status).toBe('APPROVAL_PENDING');
    expect(op.body).not.toHaveProperty('captureRequestId');

    // A forged order id is refused.
    await agent.post(`/api/missions/${mission.id}/payments/${op.body.id}/capture`).set(H).send({ orderId: 'FORGED-ORDER' }).expect(409);

    h.gateway.payerApproves(op.body.providerOrderId);
    const done = await agent.post(`/api/missions/${mission.id}/payments/${op.body.id}/capture`).set(H).send({ orderId: op.body.providerOrderId }).expect(200);
    expect(done.body.status).toBe('COMPLETED');

    const detail = await agent.get(`/api/missions/${mission.id}`).expect(200);
    expect(['COMPLETED', 'PARTIALLY_FULFILLED']).toContain(detail.body.mission.status);
    const audit = await agent.get(`/api/missions/${mission.id}/audit`).expect(200);
    expect(audit.body.chain.intact).toBe(true);
    const analytics = await agent.get(`/api/missions/${mission.id}/analytics`).expect(200);
    expect(analytics.body.lines.length).toBeGreaterThan(0);
    expect(analytics.body.payments[0]).toMatchObject({ status: 'COMPLETED', verified: true });
  });

  it('refuses checkout with a clear 503 when PayPal is not configured, rather than simulating it', async () => {
    const { agent } = await appWith({ gateway: 'none' });
    const mission = (await agent.get('/api/missions')).body[0];
    const p = (await agent.post(`/api/missions/${mission.id}/plan`).set(H).send({})).body.proposal;
    const approval = await agent
      .post(`/api/missions/${mission.id}/proposals/${p.id}/approve`)
      .set(H)
      .send({ approverName: 'Dana Reyes', expectedContentHash: p.contentHash, expectedTotalCents: p.totalCents, acknowledged: true });
    const res = await agent.post(`/api/missions/${mission.id}/proposals/${p.id}/payments`).set(H).send({ approvalId: approval.body.id }).expect(503);
    expect(res.body.error.code).toBe('INTEGRATION_NOT_CONFIGURED');
  });

  it('exposes liveness and readiness', async () => {
    const { app } = await appWith();
    await request(app).get('/api/health').expect(200);
    const ready = await request(app).get('/api/ready').expect(200);
    expect(ready.body).toMatchObject({ status: 'ready', dbOk: true, migrationsOk: true });
  });
});
