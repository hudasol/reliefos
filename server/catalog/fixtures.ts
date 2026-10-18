import type { RequirementCategory } from '../../shared/types.js';
import type { CatalogSearch, ProductSource, RawListing } from './source.js';

// Offline fixture catalog, used only when no Channel3 key is configured or Channel3 is unavailable.
// Every listing is fictional: merchants use the reserved `.example` TLD and the UI labels each one
// FIXTURE. Some listings deliberately fail the requirement specs to exercise the evaluator.

type Fixture = Omit<RawListing, 'provenance' | 'raw' | 'currency' | 'availability' | 'imageUrl' | 'buyUrl'>;

const F: Record<RequirementCategory, Fixture[]> = {
  water: [
    { sourceProductId: 'fx-water-01', title: 'Purified Drinking Water, 16.9 fl oz Bottles, Pack of 24', brand: 'Harborline', description: 'Sealed single-serve bottles of purified drinking water.', merchantDomain: 'harborline-supply.example', price: 5.49 },
    { sourceProductId: 'fx-water-02', title: 'Spring Water 1 Gallon Jugs, Case of 6', brand: 'Metro Relief', description: 'Six sealed one-gallon jugs of natural spring water.', merchantDomain: 'metro-relief-wholesale.example', price: 11.49 },
    { sourceProductId: 'fx-water-03', title: 'Drinking Water 500 mL, 35 Pack', brand: 'QuickShip', description: 'Case of 35 sealed 500 mL bottles.', merchantDomain: 'quickship-goods.example', price: 7.95 },
    { sourceProductId: 'fx-water-04', title: 'Sparkling Mineral Water, 12 fl oz Cans, 24 Pack', brand: 'Harborline', description: 'Carbonated mineral water.', merchantDomain: 'harborline-supply.example', price: 14.99 },
    { sourceProductId: 'fx-water-05', title: 'Insulated Stainless Steel Water Bottle, 32 oz', brand: 'QuickShip', description: 'Reusable empty bottle.', merchantDomain: 'quickship-goods.example', price: 18.0 },
  ],
  blankets: [
    { sourceProductId: 'fx-blanket-01', title: 'Polar Fleece Throw Blankets 50x60, Pack of 12', brand: 'Harborline', description: 'Bulk fleece blankets, individually folded.', merchantDomain: 'harborline-supply.example', price: 94.0 },
    { sourceProductId: 'fx-blanket-02', title: 'Bulk Fleece Blankets for Shelters, Set of 10', brand: 'Metro Relief', description: 'Lightweight adult fleece blankets, 60x80.', merchantDomain: 'metro-relief-wholesale.example', price: 82.5 },
    { sourceProductId: 'fx-blanket-03', title: 'Wool-Blend Emergency Blanket 62x80', brand: 'QuickShip', description: 'Single heavy wool-blend blanket.', merchantDomain: 'quickship-goods.example', price: 21.99 },
    { sourceProductId: 'fx-blanket-04', title: 'Electric Heated Throw Blanket with Controller', brand: 'Metro Relief', description: 'Requires mains power.', merchantDomain: 'metro-relief-wholesale.example', price: 44.99 },
  ],
  hygiene: [
    { sourceProductId: 'fx-hygiene-01', title: 'Individually Packed Hygiene Kits, 10 Pack', brand: 'Eastside', description: 'Each kit: toothbrush, toothpaste, soap, shampoo, comb, wipes.', merchantDomain: 'eastside-pharmacy.example', price: 139.0 },
    { sourceProductId: 'fx-hygiene-02', title: 'Personal Care Hygiene Kits for Shelters, Set of 24', brand: 'Metro Relief', description: 'Bulk hygiene kits in resealable bags.', merchantDomain: 'metro-relief-wholesale.example', price: 309.0 },
    { sourceProductId: 'fx-hygiene-03', title: 'Travel Toiletry Bag Organizer, Empty', brand: 'QuickShip', description: 'Empty organizer bag.', merchantDomain: 'quickship-goods.example', price: 12.99 },
  ],
  power: [
    { sourceProductId: 'fx-power-01', title: 'Portable Power Bank 10000mAh USB-C, 2 Pack', brand: 'QuickShip', description: 'Two 10,000 mAh banks with USB-C and USB-A.', merchantDomain: 'quickship-goods.example', price: 41.98 },
    { sourceProductId: 'fx-power-02', title: 'Power Bank 20000mAh Fast Charging', brand: 'Harborline', description: 'Single high-capacity bank.', merchantDomain: 'harborline-supply.example', price: 32.99 },
    { sourceProductId: 'fx-power-03', title: 'Mini Power Bank 5000mAh Keychain', brand: 'Metro Relief', description: 'Compact 5,000 mAh bank.', merchantDomain: 'metro-relief-wholesale.example', price: 9.99 },
  ],
  baby: [
    { sourceProductId: 'fx-baby-01', title: 'Disposable Baby Diapers Size 3, 136 Count', brand: 'Eastside', description: 'Hypoallergenic disposable diapers.', merchantDomain: 'eastside-pharmacy.example', price: 39.99 },
    { sourceProductId: 'fx-baby-02', title: 'Baby Diapers Size 4, 92 Count', brand: 'Metro Relief', description: 'Disposable diapers, size 4.', merchantDomain: 'metro-relief-wholesale.example', price: 29.49 },
    { sourceProductId: 'fx-baby-03', title: 'Cloth Diaper Covers, 6 Pack', brand: 'QuickShip', description: 'Reusable cloth covers.', merchantDomain: 'quickship-goods.example', price: 24.99 },
  ],
};

export class FixtureSource implements ProductSource {
  readonly provenance = 'fixture' as const;

  async search(input: CatalogSearch): Promise<RawListing[]> {
    return F[input.category].slice(0, input.limit).map((f) => ({
      ...f,
      provenance: 'fixture' as const,
      currency: 'USD',
      availability: 'InStock',
      imageUrl: null,
      buyUrl: null,
      raw: { fixture: true },
    }));
  }
}
