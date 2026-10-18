import { Render } from '@renderinc/sdk';
import type { SecurityTestRun } from '../../shared/types.js';
import { Store } from '../repo/store.js';
import { newId, type Deps } from '../services/core.js';
import { reconcilePayment } from '../services/payments.js';
import { runSecuritySuite } from '../services/securityLab.js';

// Background jobs. Each job keeps all state in PostgreSQL and is safe to retry: reconciliation only
// reads PayPal and re-sends requests with their original PayPal-Request-Id; a repeated suite run just
// records another run. The same functions run in-process or as Render Workflow tasks.

export interface SweepResult {
  checked: number;
  resolved: { operationId: string; from: string; to: string }[];
  stillUnresolved: { operationId: string; status: string; reason: string }[];
}

/** Reconcile every payment whose outcome is unknown or pending at PayPal. */
export async function reconcileSweep(
  deps: Deps,
  opts: { olderThanMs?: number; limit?: number } = {},
): Promise<SweepResult> {
  const result: SweepResult = { checked: 0, resolved: [], stillUnresolved: [] };
  if (!deps.gateway) return result;
  const s = new Store(deps.db);
  const due = await s.listUnresolvedPayments(
    new Date(deps.now().getTime() - (opts.olderThanMs ?? 60_000)),
    opts.limit ?? 25,
  );
  for (const op of due) {
    result.checked += 1;
    const workspaceId = await s.workspaceOfMission(op.missionId);
    if (!workspaceId) continue;
    try {
      const after = await reconcilePayment(deps, workspaceId, op.missionId, op.id);
      if (after.status !== op.status)
        result.resolved.push({ operationId: op.id, from: op.status, to: after.status });
      else
        result.stillUnresolved.push({
          operationId: op.id,
          status: after.status,
          reason: after.lastError?.message ?? 'no change at PayPal',
        });
    } catch (err) {
      result.stillUnresolved.push({
        operationId: op.id,
        status: op.status,
        reason: (err as Error).message,
      });
    }
  }
  if (result.checked) deps.log.info({ ...result }, 'reconciliation sweep');
  return result;
}

/** Run the DEADMAN suite for a mission and persist the run with an audit event. */
export async function runSecuritySuiteJob(
  deps: Deps,
  workspaceId: string,
  missionId: string,
  actor: string,
): Promise<SecurityTestRun> {
  const mission = await new Store(deps.db).getMission(workspaceId, missionId);
  const run: SecurityTestRun = {
    id: newId(),
    missionId,
    ...(await runSecuritySuite({ now: deps.now(), db: deps.db })),
  };
  await deps.db.tx(async (q) => {
    const s = new Store(q);
    await s.insertSecurityRun(run);
    await s.audit({
      workspaceId,
      missionId,
      type: 'security.suite_run',
      actor,
      summary: `DEADMAN suite ${run.suiteVersion}: ${run.passed}/${run.results.length} scenarios enforced`,
      data: {
        runId: run.id,
        failed: run.results.filter((r) => !r.passed).map((r) => r.scenarioId),
        missionTitle: mission.title,
      },
    });
  });
  return run;
}

export type SuiteDispatch =
  { mode: 'inline'; run: SecurityTestRun } | { mode: 'render-workflows'; taskRunId: string };

export interface JobRunner {
  readonly mode: 'inline' | 'render-workflows';
  runSecuritySuite(workspaceId: string, missionId: string, actor: string): Promise<SuiteDispatch>;
  reconcile(): Promise<{ mode: string; taskRunId?: string; result?: SweepResult }>;
}

export function inlineRunner(deps: Deps): JobRunner {
  return {
    mode: 'inline',
    runSecuritySuite: async (w, m, a) => ({
      mode: 'inline',
      run: await runSecuritySuiteJob(deps, w, m, a),
    }),
    reconcile: async () => ({ mode: 'inline', result: await reconcileSweep(deps) }),
  };
}

/** Dispatch jobs to the RELIEFOS workflow service on Render (see server/workflows/index.ts). */
export function renderWorkflowsRunner(
  deps: Deps,
  cfg: { apiKey: string; slug: string },
): JobRunner {
  const render = new Render({ token: cfg.apiKey });
  return {
    mode: 'render-workflows',
    runSecuritySuite: async (w, m, a) => {
      // Verify ownership before dispatching so the task never runs for a foreign mission.
      await new Store(deps.db).getMission(w, m);
      const run = await render.workflows.startTask(`${cfg.slug}/run-security-suite`, [w, m, a]);
      return { mode: 'render-workflows', taskRunId: run.taskRunId };
    },
    reconcile: async () => {
      const run = await render.workflows.startTask(`${cfg.slug}/reconcile-payments`, []);
      return { mode: 'render-workflows', taskRunId: run.taskRunId };
    },
  };
}
