import { describe, expect, it } from 'vitest';
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
    const run = await runSecuritySuite(new Date('2026-10-20T15:30:00.000Z'));
    for (const r of run.results) {
      expect.soft(r.passed, `${r.scenarioId}: ${r.observed}`).toBe(true);
    }
    expect(run.failed).toBe(0);
    expect(run.passed).toBe(8);
  }, 120_000);
});
