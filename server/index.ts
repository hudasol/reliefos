import { loadConfig } from './config.js';
import { buildServer } from './bootstrap.js';

const config = loadConfig();
const { app, db, log } = await buildServer(config);

const server = app.listen(config.port, () => {
  log.info({ port: config.port, env: config.env, database: db.kind, paypal: !!config.paypal, channel3: !!config.channel3ApiKey, claude: !!config.anthropic }, 'RELIEFOS listening');
});

async function shutdown(signal: string) {
  log.info({ signal }, 'shutting down');
  server.close(() => undefined);
  await db.close().catch(() => undefined);
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
