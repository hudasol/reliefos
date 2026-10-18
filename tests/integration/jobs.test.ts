import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../../server/api/app.js';
import { reconcileSweep, type JobRunner } from '../../server/jobs/jobs.js';
import { approveProposal } from '../../server/services/approvals.js';
import { capturePayment, createPayment } from '../../server/services/payments.js';
import { planMission } from '../../server/services/planning.js';
import { makeHarness } from '../helpers/harness.js';

let h: Awaited<ReturnType<typeof makeHarness>>;
afterEach(async () => h?.close());

describe('background jobs', () => {
  it('reconciliation sweep resolves an ambiguous capture without capturing twice', async () => {
    // Row timestamps come from the database clock, so this test runs on the real clock.
    h = await makeHarness({ now: new Date() });
    const plan = await planMission(h.deps, h.workspaceId, h.mission.id, { actor: 'test' });
    const approval = await approveProposal(h.deps, h.workspaceId, h.mission.id, plan.proposal.id, {
      approverName: 'Dana Reyes',
      expectedContentHash: plan.proposal.contentHash,
      expectedTotalCents: plan.proposal.totalCents,
    });
    const op = await createPayment(
      h.deps,
      h.workspaceId,
      h.mission.id,
      plan.proposal.id,
      approval.id,
      'test',
    );
    h.gateway.payerApproves(op.providerOrderId!);
    h.gateway.inject({ op: 'capture', kind: 'ambiguous-after-success' });
    expect(
      (await capturePayment(h.deps, h.workspaceId, h.mission.id, op.id, op.providerOrderId!))
        .status,
    ).toBe('UNKNOWN');

    // Too recent: the sweep waits before touching it.
    expect((await reconcileSweep(h.deps)).checked).toBe(0);

    h.advance(5 * 60_000);
    const res = await reconcileSweep(h.deps);
    expect(res.resolved).toEqual([{ operationId: op.id, from: 'UNKNOWN', to: 'COMPLETED' }]);
    expect(h.gateway.captureCalls).toBe(1);

    // Nothing left to do on the next sweep.
    h.advance(5 * 60_000);
    expect((await reconcileSweep(h.deps)).checked).toBe(0);
  });

  it('dispatches the security suite to Render Workflows when configured', async () => {
    h = await makeHarness();
    const calls: unknown[][] = [];
    const jobs: JobRunner = {
      mode: 'render-workflows',
      runSecuritySuite: async (...args) => {
        calls.push(args);
        return { mode: 'render-workflows', taskRunId: 'trn-test-1' };
      },
      reconcile: async () => ({ mode: 'render-workflows', taskRunId: 'trn-test-2' }),
    };
    const app = createApp({
      deps: h.deps,
      sessionSecret: 's',
      secureCookies: false,
      staticDir: null,
      jobs,
      publicConfig: () => ({
        paypal: { enabled: true, clientId: null, environment: 'sandbox' },
        agStudioLicenseKey: null,
        agGridLicenseKey: null,
        integrations: [],
        build: { version: 't', commit: null },
      }),
    });
    const agent = request.agent(app);
    const { body } = await agent.get('/api/session');
    const mission = (await agent.get('/api/missions')).body[0];
    const res = await agent
      .post(`/api/missions/${mission.id}/security-runs`)
      .set('x-reliefos-request', '1')
      .send({})
      .expect(202);
    expect(res.body).toEqual({ dispatched: 'render-workflows', taskRunId: 'trn-test-1' });
    expect(calls[0]).toEqual([body.workspaceId, mission.id, expect.stringMatching(/^workspace:/)]);
  });
});
