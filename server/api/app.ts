import { existsSync } from 'node:fs';
import path from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import {
  ApproveRequestSchema,
  CaptureRequestSchema,
  CreatePaymentRequestSchema,
  InterpretRequestSchema,
  MarketEventRequestSchema,
  MissionInputSchema,
  MissionUpdateSchema,
  PlanRequestSchema,
  RejectRequestSchema,
} from '../../shared/contracts.js';
import type { PublicConfig } from '../../shared/types.js';
import { DomainError } from '../domain/errors.js';
import { newId, store, type Deps } from '../services/core.js';
import { createMission, floodScenarioInput, FLOOD_SCENARIO_KEY, interpretNarrative, missionDetail, updateMission } from '../services/missions.js';
import { planMission } from '../services/planning.js';
import { approveProposal, rejectProposal } from '../services/approvals.js';
import { cancelPayment, capturePayment, createPayment, reconcilePayment } from '../services/payments.js';
import { runMarketEvent } from '../services/events.js';
import { runSecuritySuite, SECURITY_SCENARIOS } from '../services/securityLab.js';
import { analytics, candidateViews, missionReport } from '../services/readModels.js';
import { POLICY_CHECK_CATALOG } from '../policy/engine.js';
import { MIGRATIONS } from '../db/migrations.js';
import { Store } from '../repo/store.js';
import { utcToZonedParts } from '../../shared/time.js';
import { errorHandler } from './errors.js';
import { readCookie, requireCsrfHeader, requireWorkspace, SESSION_COOKIE, sign, verify } from './session.js';

export interface AppOptions {
  deps: Deps;
  sessionSecret: string;
  secureCookies: boolean;
  publicConfig: () => PublicConfig;
  staticDir: string | null;
  /** Optional runner for long jobs (Render Workflows). Defaults to in-process execution. */
  jobs?: { runSecuritySuite?: (missionId: string) => Promise<unknown> };
}

type Handler = (req: Request, res: Response) => Promise<unknown>;
const h = (fn: Handler) => (req: Request, res: Response, next: NextFunction) => fn(req, res).catch(next);
const param = (req: Request, name: string) => {
  const v = req.params[name];
  if (typeof v !== 'string' || !/^[0-9a-f-]{36}$/.test(v)) throw new DomainError('VALIDATION_FAILED', `Invalid ${name}`);
  return v;
};
const actorOf = (req: Request) => `workspace:${req.workspaceId!.slice(0, 8)}`;

export function createApp(opts: AppOptions) {
  const { deps } = opts;
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", 'https://www.paypal.com', 'https://www.sandbox.paypal.com', 'https://*.paypal.com', 'https://*.paypalobjects.com'],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
          connectSrc: ["'self'", 'https://*.paypal.com', 'https://*.paypalobjects.com'],
          frameSrc: ["'self'", 'https://*.paypal.com'],
          fontSrc: ["'self'", 'data:'],
          workerSrc: ["'self'", 'blob:'],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'", 'https://*.paypal.com'],
          frameAncestors: ["'none'"],
        },
      },
      crossOriginEmbedderPolicy: false,
      crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
    }),
  );
  app.use(express.json({ limit: '64kb' }));

  const started = Date.now();
  app.use((req, res, next) => {
    const t0 = Date.now();
    res.on('finish', () => {
      if (req.path.startsWith('/api/')) deps.log.info({ method: req.method, path: req.path, status: res.statusCode, ms: Date.now() - t0 }, 'request');
    });
    next();
  });

  // ---- health ------------------------------------------------------------------------
  app.get('/api/health', (_req, res) => res.json({ status: 'ok', uptimeSeconds: Math.round((Date.now() - started) / 1000) }));
  app.get(
    '/api/ready',
    h(async (_req, res) => {
      const dbOk = await deps.db.ping();
      const rows = dbOk ? await deps.db.query<{ id: string }>('SELECT id FROM schema_migrations') : [];
      const migrationsOk = MIGRATIONS.every((m) => rows.some((r) => r.id === m.id));
      res.status(dbOk && migrationsOk ? 200 : 503).json({ status: dbOk && migrationsOk ? 'ready' : 'not-ready', database: deps.db.kind, dbOk, migrationsOk });
    }),
  );
  app.get('/api/config', (_req, res) => res.json(opts.publicConfig()));

  const general = rateLimit({ windowMs: 60_000, limit: 600, standardHeaders: 'draft-8', legacyHeaders: false });
  const heavy = rateLimit({ windowMs: 60_000, limit: 20, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: { code: 'RATE_LIMITED', message: 'Too many planning or test runs; wait a minute.' } } });
  const pay = rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: { code: 'RATE_LIMITED', message: 'Too many payment requests; wait a minute.' } } });
  app.use('/api', general, requireCsrfHeader);

  // ---- session bootstrap ---------------------------------------------------------------
  app.get(
    '/api/session',
    h(async (req, res) => {
      const s = store(deps);
      let workspaceId = verify(readCookie(req, SESSION_COOKIE), opts.sessionSecret);
      if (workspaceId && !(await s.workspaceExists(workspaceId))) workspaceId = null;
      let created = false;
      if (!workspaceId) {
        workspaceId = newId();
        await s.createWorkspace(workspaceId, 'demo workspace');
        await createMission(deps, workspaceId, floodScenarioInput(deps.now()), { scenarioKey: FLOOD_SCENARIO_KEY, actor: 'system:seed' });
        created = true;
      }
      res.cookie(SESSION_COOKIE, sign(workspaceId, opts.sessionSecret), {
        httpOnly: true,
        sameSite: 'lax',
        secure: opts.secureCookies,
        maxAge: 30 * 24 * 3600 * 1000,
        path: '/',
      });
      res.json({ workspaceId, created });
    }),
  );

  const api = express.Router();
  api.use(requireWorkspace(opts.sessionSecret));

  // ---- missions -------------------------------------------------------------------------
  api.get('/missions', h(async (req, res) => res.json(await store(deps).listMissions(req.workspaceId!))));
  api.post(
    '/missions/interpret',
    heavy,
    h(async (req, res) => {
      const { narrative } = InterpretRequestSchema.parse(req.body);
      res.json(await interpretNarrative(deps, narrative, deps.claudeAgent ? 'claude' : 'deterministic'));
    }),
  );
  api.post('/missions', h(async (req, res) => res.status(201).json(await createMission(deps, req.workspaceId!, MissionInputSchema.parse(req.body), { actor: actorOf(req) }))));
  api.post(
    '/missions/scenario',
    h(async (req, res) => res.status(201).json(await createMission(deps, req.workspaceId!, floodScenarioInput(deps.now()), { scenarioKey: FLOOD_SCENARIO_KEY, actor: actorOf(req) }))),
  );
  api.get('/missions/:id', h(async (req, res) => res.json(await missionDetail(deps, req.workspaceId!, param(req, 'id')))));
  api.put(
    '/missions/:id',
    h(async (req, res) => {
      const body = MissionUpdateSchema.parse(req.body);
      res.json(await updateMission(deps, req.workspaceId!, param(req, 'id'), body.expectedVersion, body.mission, actorOf(req)));
    }),
  );
  api.get(
    '/missions/:id/input',
    h(async (req, res) => {
      const m = await store(deps).getMission(req.workspaceId!, param(req, 'id'));
      const start = utcToZonedParts(m.windowStart, m.timezone);
      res.json({
        version: m.version,
        input: {
          title: m.title,
          organization: m.organization,
          narrative: m.narrative,
          budgetUsd: m.budgetCents / 100,
          population: m.population,
          infants: m.infants,
          householdSize: m.householdSize,
          coverageDays: m.coverageDays,
          destination: m.destination,
          date: start.date,
          startTime: start.time,
          deadlineTime: utcToZonedParts(m.deadline, m.timezone).time,
          timezone: m.timezone,
          plannerMode: m.plannerMode,
        },
      });
    }),
  );

  // ---- planning & proposals ---------------------------------------------------------------
  api.post(
    '/missions/:id/plan',
    heavy,
    h(async (req, res) => {
      const body = PlanRequestSchema.parse(req.body ?? {});
      res.json(await planMission(deps, req.workspaceId!, param(req, 'id'), { actor: actorOf(req), refreshCatalog: body.refreshCatalog }));
    }),
  );
  api.post(
    '/missions/:id/proposals/:pid/recover',
    heavy,
    h(async (req, res) => res.json(await planMission(deps, req.workspaceId!, param(req, 'id'), { actor: actorOf(req), recoverFrom: param(req, 'pid') }))),
  );
  api.post(
    '/missions/:id/proposals/:pid/approve',
    h(async (req, res) => {
      const body = ApproveRequestSchema.parse(req.body);
      res.json(await approveProposal(deps, req.workspaceId!, param(req, 'id'), param(req, 'pid'), body));
    }),
  );
  api.post(
    '/missions/:id/proposals/:pid/reject',
    h(async (req, res) => {
      const { reason } = RejectRequestSchema.parse(req.body);
      await rejectProposal(deps, req.workspaceId!, param(req, 'id'), param(req, 'pid'), reason, actorOf(req));
      res.json({ ok: true });
    }),
  );

  // ---- payments --------------------------------------------------------------------------
  api.post(
    '/missions/:id/proposals/:pid/payments',
    pay,
    h(async (req, res) => {
      const { approvalId } = CreatePaymentRequestSchema.parse(req.body);
      res.status(201).json(await createPayment(deps, req.workspaceId!, param(req, 'id'), param(req, 'pid'), approvalId, actorOf(req)));
    }),
  );
  api.post(
    '/missions/:id/payments/:opId/capture',
    pay,
    h(async (req, res) => {
      const { orderId } = CaptureRequestSchema.parse(req.body);
      res.json(await capturePayment(deps, req.workspaceId!, param(req, 'id'), param(req, 'opId'), orderId));
    }),
  );
  api.post('/missions/:id/payments/:opId/reconcile', pay, h(async (req, res) => res.json(await reconcilePayment(deps, req.workspaceId!, param(req, 'id'), param(req, 'opId')))));
  api.post('/missions/:id/payments/:opId/cancel', pay, h(async (req, res) => res.json(await cancelPayment(deps, req.workspaceId!, param(req, 'id'), param(req, 'opId')))));

  // ---- drills & security lab ----------------------------------------------------------------
  api.post(
    '/missions/:id/events',
    heavy,
    h(async (req, res) => {
      const { kind } = MarketEventRequestSchema.parse(req.body);
      res.json(await runMarketEvent(deps, req.workspaceId!, param(req, 'id'), kind, actorOf(req)));
    }),
  );
  api.get('/security/scenarios', (_req, res) => res.json({ scenarios: SECURITY_SCENARIOS, checks: POLICY_CHECK_CATALOG }));
  api.get('/missions/:id/security-runs', h(async (req, res) => {
    const id = param(req, 'id');
    await store(deps).getMission(req.workspaceId!, id);
    res.json(await store(deps).listSecurityRuns(id));
  }));
  api.post(
    '/missions/:id/security-runs',
    heavy,
    h(async (req, res) => {
      const id = param(req, 'id');
      const mission = await store(deps).getMission(req.workspaceId!, id);
      const run = { id: newId(), missionId: id, ...(await runSecuritySuite(deps.now())) };
      await deps.db.tx(async (q) => {
        const s = new Store(q);
        await s.insertSecurityRun(run);
        await s.audit({
          workspaceId: req.workspaceId!,
          missionId: id,
          type: 'security.suite_run',
          actor: actorOf(req),
          summary: `DEADMAN suite ${run.suiteVersion}: ${run.passed}/${run.results.length} scenarios enforced`,
          data: { runId: run.id, failed: run.results.filter((r) => !r.passed).map((r) => r.scenarioId), missionTitle: mission.title },
        });
      });
      res.status(201).json(run);
    }),
  );

  // ---- read models -------------------------------------------------------------------------
  api.get('/missions/:id/candidates', h(async (req, res) => res.json(await candidateViews(deps, req.workspaceId!, param(req, 'id')))));
  api.get(
    '/missions/:id/schedule',
    h(async (req, res) => {
      const id = param(req, 'id');
      const m = await store(deps).getMission(req.workspaceId!, id);
      res.json({ windowStart: m.windowStart, deadline: m.deadline, timezone: m.timezone, destination: m.destination, tasks: await store(deps).listTasks(id) });
    }),
  );
  api.get(
    '/missions/:id/audit',
    h(async (req, res) => {
      const id = param(req, 'id');
      await store(deps).getMission(req.workspaceId!, id);
      const [events, chain] = await Promise.all([store(deps).listAudit(id), store(deps).verifyAuditChain(req.workspaceId!)]);
      res.json({ events, chain });
    }),
  );
  api.get('/missions/:id/decisions', h(async (req, res) => {
    const id = param(req, 'id');
    await store(deps).getMission(req.workspaceId!, id);
    res.json(await store(deps).listDecisions(id));
  }));
  api.get('/missions/:id/agent-runs', h(async (req, res) => {
    const id = param(req, 'id');
    await store(deps).getMission(req.workspaceId!, id);
    res.json(await store(deps).listAgentRuns(id));
  }));
  api.get('/missions/:id/analytics', h(async (req, res) => res.json(await analytics(deps, req.workspaceId!, param(req, 'id')))));
  api.get('/missions/:id/report', h(async (req, res) => res.json(await missionReport(deps, req.workspaceId!, param(req, 'id')))));

  app.use('/api', api);
  app.use('/api', (_req, res) => res.status(404).json({ error: { code: 'NOT_FOUND', message: 'No such API route' } }));

  // ---- static client ------------------------------------------------------------------------
  if (opts.staticDir && existsSync(opts.staticDir)) {
    app.use(express.static(opts.staticDir, { index: false, maxAge: '1h', setHeaders: (res, p) => p.endsWith('.html') && res.setHeader('Cache-Control', 'no-cache') }));
    app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(opts.staticDir!, 'index.html')));
  }

  app.use(errorHandler(deps.log as unknown as { error: (o: object, m: string) => void }));
  return app;
}
