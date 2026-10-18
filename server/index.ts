import { loadConfig } from './config.js';
import { buildServer } from './bootstrap.js';

const config = loadConfig();
const { app, db, log, jobs, deps } = await buildServer(config);

const server = app.listen(config.port, () => {
  log.info(
    {
      port: config.port,
      env: config.env,
      database: db.kind,
      paypal: !!config.paypal,
      channel3: !!config.channel3ApiKey,
      claude: !!config.anthropic,
      jobs: jobs.mode,
    },
    'RELIEFOS listening',
  );
});

// Periodically reconcile payments whose outcome PayPal has not yet confirmed. Safe to repeat: it only
// reads PayPal and re-sends requests with their original idempotency keys.
const RECONCILE_EVERY_MS = 2 * 60_000;
const reconciler = deps.gateway
  ? setInterval(() => {
      jobs
        .reconcile()
        .catch((err: Error) => log.warn({ err: err.message }, 'reconciliation dispatch failed'));
    }, RECONCILE_EVERY_MS)
  : null;
reconciler?.unref();

async function shutdown(signal: string) {
  log.info({ signal }, 'shutting down');
  if (reconciler) clearInterval(reconciler);
  server.close(() => undefined);
  await db.close().catch(() => undefined);
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
