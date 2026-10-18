import { describe, expect, it } from 'vitest';
import { checkSpec, parseAttributes, parsePack } from '../../server/catalog/evidence.js';
import { makeRequirements } from '../helpers/factories.js';

const req = Object.fromEntries(makeRequirements().map((r) => [r.category, r]));

describe('pack size evidence', () => {
  it('computes liters for a case of bottles and quotes the evidence', () => {
    const p = parsePack('water', 'Purified Drinking Water, 16.9 fl oz Bottles, Pack of 24', null);
    expect(p.unitsPerPack).toBeCloseTo(11.99, 1);
    expect(p.evidence).toContain('Pack of 24');
    expect(p.basis).toBe('parsed-title');
  });
  it('handles gallon jugs and metric bottles', () => {
    expect(parsePack('water', 'Spring Water 1 Gallon Jugs, Case of 6', null).unitsPerPack).toBeCloseTo(22.71, 1);
    expect(parsePack('water', 'Drinking Water 500 mL, 35 Pack', null).unitsPerPack).toBe(17.5);
  });
  it('reads diaper counts', () => {
    expect(parsePack('baby', 'Disposable Baby Diapers Size 3, 136 Count', null).unitsPerPack).toBe(136);
  });
  it('returns null rather than guessing when no pack size is stated', () => {
    const p = parsePack('baby', 'Premium Baby Diapers Size 3', null);
    expect(p.unitsPerPack).toBeNull();
    expect(p.basis).toBe('unknown');
  });
  it('recognises single-item listings explicitly', () => {
    expect(parsePack('blankets', 'Wool-Blend Emergency Blanket 62x80', null).unitsPerPack).toBe(1);
  });
});

describe('specification checks', () => {
  it('rejects prohibited characteristics', () => {
    const res = checkSpec(req.water!.spec, { title: 'Sparkling Mineral Water, 12 fl oz, 24 Pack', description: null }, {});
    expect(res.passed).toBe(false);
    expect(res.reasons.join(' ')).toMatch(/sparkling/i);
  });
  it('rejects empty containers that only mention water', () => {
    expect(checkSpec(req.water!.spec, { title: 'Insulated Stainless Steel Water Bottle, 32 oz', description: null }, {}).passed).toBe(false);
  });
  it('fails a numeric requirement when the attribute is unknown', () => {
    const res = checkSpec(req.power!.spec, { title: 'Portable Power Bank Fast Charging', description: null }, {});
    expect(res.passed).toBe(false);
    expect(res.reasons.join(' ')).toMatch(/not stated/);
  });
  it('enforces numeric minimums from parsed attributes', () => {
    const title = 'Mini Power Bank 5000mAh Keychain';
    expect(checkSpec(req.power!.spec, { title, description: null }, parseAttributes(title, null)).passed).toBe(false);
    const ok = 'Portable Power Bank 10,000 mAh USB-C';
    expect(checkSpec(req.power!.spec, { title: ok, description: null }, parseAttributes(ok, null)).passed).toBe(true);
  });
});
