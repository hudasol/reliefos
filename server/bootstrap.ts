import path from 'node:path';
import pino from 'pino';
import type { IntegrationStatus, PublicConfig } from '../shared/types.js';
import type { AppConfig } from './config.js';
import { openDatabase, type Database } from './db/database.js';
import { migrate } from './db/migrations.js';
import { ClaudeAgent } from './ai/claude.js';
import { DeterministicAgent } from './ai/deterministic.js';
import { Channel3Source } from './catalog/channel3.js';
import { FixtureSource } from './catalog/fixtures.js';
import { PayPalGateway } from './payments/paypal.js';
import { createApp } from './api/app.js';
import type { Deps } from './services/core.js';

export function makeLogger(level: AppConfig['logLevel']) {
  return pino({
    level,
    redact: { paths: ['req.headers.authorization', 'req.headers.cookie', '*.clientSecret', '*.apiKey', '*.access_token'], censor: '[redacted]' },
  });
}

export function integrationStatuses(config: AppConfig, db: Database): IntegrationStatus[] {
  return [
    config.paypal
      ? { id: 'paypal', label: 'PayPal Orders v2 (Sandbox)', state: 'live', detail: 'Server SDK configured; payments run against api-m.sandbox.paypal.com.' }
      : { id: 'paypal', label: 'PayPal Orders v2 (Sandbox)', state: 'not-configured', detail: 'PAYPAL_CLIENT_ID/SECRET not set: checkout is disabled (never simulated).' },
    config.channel3ApiKey
      ? { id: 'channel3', label: 'Channel3 product search', state: 'live', detail: 'Live product discovery via api.trychannel3.com; fixture fallback only on error (labelled).' }
      : { id: 'channel3', label: 'Channel3 product search', state: 'fallback', detail: 'CHANNEL3_API_KEY not set: using labelled fixture listings (.example merchants).' },
    config.anthropic
      ? { id: 'anthropic', label: `Claude planner (${config.anthropic.model})`, state: 'live', detail: 'Structured-output agent for interpretation, ranking and explanations.' }
      : { id: 'anthropic', label: 'Claude planner', state: 'fallback', detail: 'ANTHROPIC_API_KEY not set: deterministic planner runs, labelled as such.' },
    { id: 'database', label: db.kind === 'postgres' ? 'PostgreSQL' : 'PGlite (embedded PostgreSQL)', state: 'live', detail: db.kind === 'postgres' ? 'External PostgreSQL via DATABASE_URL.' : 'Local embedded store; set DATABASE_URL for a server database.' },
    config.agStudioLicenseKey
      ? { id: 'ag-studio', label: 'AG Studio / AG Grid Enterprise', state: 'live', detail: 'Licence key configured.' }
      : { id: 'ag-studio', label: 'AG Studio / AG Grid Enterprise', state: 'fallback', detail: 'No licence key: components run in evaluation mode with a watermark.' },
    config.renderWorkflows
      ? { id: 'render-workflows', label: 'Render Workflows', state: 'live', detail: `Long jobs dispatched to workflow ${config.renderWorkflows.slug}.` }
      : { id: 'render-workflows', label: 'Render Workflows', state: 'not-configured', detail: 'RENDER_API_KEY/RENDER_WORKFLOW_SLUG not set: jobs run in-process.' },
  ];
}

export async function buildServer(config: AppConfig) {
  const log = makeLogger(config.logLevel);
  const db = await openDatabase({ databaseUrl: config.databaseUrl, pgliteDataDir: config.databaseUrl ? null : (config.pgliteDataDir ?? '.data/pglite') });
  const ran = await migrate(db);
  if (ran.length) log.info({ migrations: ran }, 'applied migrations');

  const deps: Deps = {
    db,
    catalog: config.channel3ApiKey ? new Channel3Source(config.channel3ApiKey) : null,
    fixtures: new FixtureSource(),
    claudeAgent: config.anthropic ? new ClaudeAgent({ apiKey: config.anthropic.apiKey, model: config.anthropic.model }) : null,
    deterministicAgent: new DeterministicAgent(),
    gateway: config.paypal ? new PayPalGateway({ clientId: config.paypal.clientId, clientSecret: config.paypal.clientSecret, environment: 'sandbox', timeoutMs: config.paypal.timeoutMs }) : null,
    publicBaseUrl: config.publicBaseUrl ?? `http://localhost:${config.env === 'development' ? 5173 : config.port}`,
    now: () => new Date(),
    log,
  };

  // The compiled server runs from the repository root (npm start), where the client build lives.
  const staticDir = path.resolve(process.cwd(), 'dist/web');

  const publicConfig = (): PublicConfig => ({
    paypal: { enabled: !!config.paypal, clientId: config.paypal?.clientId ?? null, environment: 'sandbox' },
    agStudioLicenseKey: config.agStudioLicenseKey,
    agGridLicenseKey: config.agGridLicenseKey,
    integrations: integrationStatuses(config, db),
    build: { version: '0.1.0', commit: config.commit },
  });

  const app = createApp({
    deps,
    sessionSecret: config.sessionSecret,
    secureCookies: config.env === 'production',
    publicConfig,
    staticDir,
  });
  return { app, db, log, deps };
}
