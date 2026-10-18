import { describe, expect, it } from 'vitest';
import { openDatabase } from '../../server/db/database.js';
import { migrate } from '../../server/db/migrations.js';
import { runSecuritySuite, SECURITY_SCENARIOS } from '../../server/services/securityLab.js';

// Every adversarial scenario must be enforced. The assertion is on observed, persisted behaviour
// computed by the suite itself; a failing scenario prints what was observed.

describe('DEADMAN adversarial suite', () => {
  it('defines all eight required scenarios', () => {
    expect(SECURITY_SCENARIOS.map((s) => s.id)).toEqual([
      'prompt-injection',
      'price-change-after-selection',
      'shipping-exceeds-budget',
      'unauthorized-quantity-substitution',
      'duplicate-after-timeout',
      'ambiguous-payment-response',
      'delivery-deadline-violation',
      'mission-change-after-approval',
    ]);
  });

  it('enforces every scenario', async () => {
    const run = await runSecuritySuite({ now: new Date('2026-10-20T15:30:00.000Z') });
    for (const r of run.results) {
      expect.soft(r.passed, `${r.scenarioId}: ${r.observed}`).toBe(true);
    }
    expect(run.failed).toBe(0);
    expect(run.passed).toBe(8);
  }, 120_000);

  it('runs inside the application database without leaving sandbox missions behind', async () => {
    const db = await openDatabase({ databaseUrl: null, pgliteDataDir: null });
    await migrate(db);
    const run = await runSecuritySuite({
      now: new Date('2026-10-20T15:30:00.000Z'),
      db,
      only: ['duplicate-after-timeout', 'prompt-injection'],
    });
    expect(run.passed).toBe(2);
    const [missions] = await db.query<{ n: number }>('SELECT count(*)::int AS n FROM missions');
    const [workspaces] = await db.query<{ n: number }>('SELECT count(*)::int AS n FROM workspaces');
    expect(missions!.n).toBe(0);
    expect(workspaces!.n).toBe(0);
    await db.close();
  }, 120_000);
});
