import { task, type TaskContext } from '@renderinc/sdk/workflows';
import { loadConfig } from '../config.js';
import { loadDotEnv } from '../env.js';
import { buildDeps } from '../bootstrap.js';
import { reconcileSweep, runSecuritySuiteJob } from '../jobs/jobs.js';

// RELIEFOS Render Workflows service. Deploy as a Render workflow (see render-workflows.yaml) with the
// same DATABASE_URL and PayPal credentials as the web service; the web service dispatches to these
// tasks when RENDER_API_KEY and RENDER_WORKFLOW_SLUG are set. All state lives in PostgreSQL, so a
// retried task resumes from persisted state; reconciliation reuses the original PayPal-Request-Ids
// and therefore cannot create a second order or capture.

loadDotEnv();
const { deps } = await buildDeps(loadConfig());

task(
  {
    name: 'reconcile-payments',
    retry: { maxRetries: 4, waitDurationMs: 5_000, backoffScaling: 2 },
    timeoutSeconds: 300,
  },
  async function reconcilePayments(ctx: TaskContext) {
    const result = await reconcileSweep(deps);
    // Throwing makes the platform retry with backoff while PayPal still cannot confirm an outcome.
    if (result.stillUnresolved.length > 0 && result.resolved.length === 0) {
      throw new Error(
        `${result.stillUnresolved.length} payment(s) still unresolved (run ${ctx.metadata.taskRunId})`,
      );
    }
    return result;
  },
);

task(
  {
    name: 'run-security-suite',
    retry: { maxRetries: 1, waitDurationMs: 2_000, backoffScaling: 1 },
    timeoutSeconds: 600,
  },
  async function runSuite(
    _ctx: TaskContext,
    workspaceId: string,
    missionId: string,
    actor: string,
  ) {
    const run = await runSecuritySuiteJob(
      deps,
      workspaceId,
      missionId,
      `${actor} via render-workflows`,
    );
    return { runId: run.id, passed: run.passed, failed: run.failed };
  },
);
