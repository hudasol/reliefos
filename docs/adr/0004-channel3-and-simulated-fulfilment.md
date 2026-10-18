# ADR 0004 — Channel3 for product discovery; supplier fulfilment is simulated and labelled

**Status:** accepted

**Context.** Channel3 returns products and offers: price, availability, merchant domain and buy URL. It
does not return stock levels or same-day delivery commitments to a shelter, and no public API provides
those.

**Decision.** Keep product suitability and delivery feasibility apart.

- **Suitability** comes from Channel3. When Channel3 is unavailable, it comes from a labelled fixture
  catalog of fictional `.example` merchants.
- **Evidence:** pack sizes and attributes are extracted from the listing text with quoted evidence.
  Unknown values count as non-compliant.
- **Feasibility:** stock, ETA and courier fees come from a seeded, deterministic simulation
  (`server/catalog/quotes.ts`).
  - It is persisted as quotes that are superseded, never edited.
  - It is labelled *simulated* everywhere in the UI.
  - Scenario missions share a seed, so the demonstration can be rehearsed.

**Rejected.**

- Scraping retailer sites.
- Presenting simulated delivery as merchant commitments.

**Consequences.**

- Delivery feasibility and suitability are evaluated separately.
- Drills change only the simulated quotes.
