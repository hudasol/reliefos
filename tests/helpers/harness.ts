import { openDatabase } from '../../server/db/database.js';
import { migrate } from '../../server/db/migrations.js';
import { DeterministicAgent } from '../../server/ai/deterministic.js';
import { FixtureSource } from '../../server/catalog/fixtures.js';
import { ScriptedGateway } from '../../server/payments/scriptedGateway.js';
import type { Deps } from '../../server/services/core.js';
import { Store } from '../../server/repo/store.js';
import { createMission, floodScenarioInput, FLOOD_SCENARIO_KEY } from '../../server/services/missions.js';
import type { MissionAgent } from '../../server/ai/types.js';
import type { ProductSource } from '../../server/catalog/source.js';

export const silentLog = { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined };

/** A fully wired service graph on an in-memory PostgreSQL (PGlite) with a scripted PayPal. */
export async function makeHarness(opts: { now?: Date; catalog?: ProductSource | null; claudeAgent?: MissionAgent | null; gateway?: ScriptedGateway | null } = {}) {
  const db = await openDatabase({ databaseUrl: null, pgliteDataDir: null });
  await migrate(db);
  const gateway = opts.gateway === undefined ? new ScriptedGateway() : opts.gateway;
  let clock = opts.now ?? new Date('2026-10-20T15:30:00.000Z');
  const deps: Deps = {
    db,
    catalog: opts.catalog ?? null,
    fixtures: new FixtureSource(),
    claudeAgent: opts.claudeAgent ?? null,
    deterministicAgent: new DeterministicAgent(),
    gateway,
    publicBaseUrl: 'http://localhost:5173',
    now: () => clock,
    log: silentLog,
  };
  const workspaceId = '11111111-1111-4111-8111-111111111111';
  await new Store(db).createWorkspace(workspaceId, 'test');
  const input = { ...floodScenarioInput(clock), date: '2026-10-20', plannerMode: 'deterministic' as const };
  const mission = await createMission(deps, workspaceId, input, { scenarioKey: FLOOD_SCENARIO_KEY, actor: 'test' });
  return {
    db,
    deps,
    gateway: gateway as ScriptedGateway,
    workspaceId,
    mission,
    input,
    store: new Store(db),
    advance: (ms: number) => {
      clock = new Date(clock.getTime() + ms);
    },
    close: () => db.close(),
  };
}
