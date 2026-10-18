# RELIEFOS architecture

## 1. Shape of the system

RELIEFOS is **one deployable**: an Express API that also serves the built React client, backed by
PostgreSQL. A second, optional deployable runs the same code as Render Workflows tasks. There are no
message brokers, vector stores or microservices. The modules are separated by responsibility rather
than by network boundaries.

| Layer | Code | Responsibility |
| --- | --- | --- |
| Experience | `web/src` | Mission workspace, evidence, approvals, payments, Security lab, AG Studio / AG Grid decision center, Bryntum schedule, audit, report. No business logic: it renders server-computed state. |
| API & orchestration | `server/api`, `server/services` | Sessions, CSRF, Zod validation, rate limits, error mapping; workflow orchestration in application services. |
| Domain | `shared/*`, `server/domain` | Types, integer-cent money, lifecycle state machines, requirement derivation. |
| AI planning | `server/ai` | Bounded agent roles with structured outputs; deterministic fallback. |
| Procurement engine | `server/planning`, `server/catalog/evidence.ts` | Eligibility, optimisation, material-terms hashing, evidence extraction. |
| DEADMAN | `server/policy`, `server/catalog/contentSecurity.ts`, `server/services/securityLab.ts` | Independent policy gate, untrusted-content scanning, adversarial suite. |
| Payments | `server/payments`, `server/services/payments.ts` | PayPal Orders v2 through the APIMatic-generated SDK; lifecycle, verification, reconciliation. |
| Product intelligence | `server/catalog/channel3.ts`, `fixtures.ts`, `quotes.ts` | Channel3 search and normalisation; labelled fixtures; simulated fulfilment. |
| Scheduling | `server/schedule`, `web/src/pages/SchedulePage.tsx` | Delivery tasks, dependencies, conflicts → Bryntum. |
| Analytics | `server/services/readModels.ts`, `web/src/features/studio` | Flat analytics tables → AG Studio and AG Grid. |
| Persistence & audit | `server/db`, `server/repo` | PostgreSQL/PGlite adapter, migrations, repository, hash-chained audit log. |
| Jobs | `server/jobs`, `server/workflows` | Payment reconciliation sweep and Security Lab job, in-process or as Render Workflows tasks. |

## 2. Domain model

```
Workspace ─┬─ Mission (versioned terms: budget, population, infants, window, deadline, destination)
           │    ├─ Requirement (derived per mission version; category, quantity, unit, priority, spec)
           │    │    └─ ProductCandidate (provenance, pack evidence, spec check, content flags)
           │    │         └─ FulfillmentQuote (SIMULATED; superseded, never edited)
           │    ├─ Proposal (version, status, lines, shipping, totals, contentHash, missionVersion)
           │    │    ├─ ProposalLine (requirement, candidate, quote, packs, units, price)
           │    │    ├─ PolicyDecision (stage, outcome, checks, violations, warnings)
           │    │    ├─ Approval (bound to contentHash + missionVersion + amount)
           │    │    ├─ PaymentOperation (PayPal ids, idempotency keys, verified state)
           │    │    └─ DeliveryTask (delivery / intake / distribution, dependencies, status)
           │    ├─ AgentRun (role, mode, model, output, accepted?, error)
           │    └─ SecurityTestRun (eight scenario results)
           └─ AuditEvent (append-only, hash chain per workspace)
```

Invariants enforced in code **and** in the schema:

- Money is integer cents with a currency (`CHECK (currency = 'USD')`), and totals are recomputed, never
  trusted.
- A proposal belongs to one mission version. Editing a mission bumps its version and invalidates every
  approval and open proposal.
- An approval binds a hash of every material term. It is unique per proposal while active (unique
  partial index).
- At most one live or completed payment operation exists per proposal (unique partial index), so the
  database refuses a duplicate purchase.
- A quote is superseded, never edited (one `current` row per candidate). Price drift is therefore always
  detectable.
- The audit log rejects `UPDATE` and `DELETE` through a trigger, and each event hashes its predecessor.

## 3. Lifecycles

Every status change is a compare-and-set on the expected current status, validated against the
transition tables in `shared/states.ts`. Illegal transitions throw.

**Mission:** `DRAFT → PLANNING → NEEDS_REVIEW | READY_FOR_APPROVAL | BLOCKED → EXECUTING → PARTIALLY_FULFILLED | COMPLETED`
(`NEEDS_REVIEW` on any rejection or invalidation; edits return a planned mission to `NEEDS_REVIEW`).

**Proposal:** `DRAFT → VALIDATED → AWAITING_APPROVAL → APPROVED → EXECUTION_PENDING → EXECUTED`. The
other outcomes are `REJECTED`, `INVALIDATED`, `FAILED` and `UNKNOWN`. A cancelled checkout returns
`EXECUTION_PENDING → APPROVED`.

**Payment** (adapted to Orders v2):

```
NOT_CREATED ─create ok─► CREATED ─► APPROVAL_PENDING ─GET=APPROVED─► CAPTURE_PENDING ─capture+GET─► COMPLETED
     │                                   │                                 │ PENDING ─► PROVIDER_PENDING
     └─timeout/5xx─► UNKNOWN ◄───────────┴──────────timeout/5xx───────────┘ DECLINED ─► FAILED
                       │ reconcile only (authoritative GET; retries reuse request ids)
```

The four stages stay distinct: a created order, payer approval, an in-flight capture and a verified
capture.

## 4. Key flows

**Planning** (`services/planning.ts`). It moves the mission to `PLANNING` and derives requirements for
the current version. Then it retrieves listings (Channel3, or fixtures on failure, with a
`catalog.fallback` audit event), evaluates each one, and attaches simulated quotes. The agent ranks only
eligible listings. Next, the optimizer builds lines in cents, shedding the lowest-priority coverage
first when the budget binds, and computes the content hash. DEADMAN evaluates the `validation` stage;
the proposal becomes `AWAITING_APPROVAL` or `REJECTED`. Finally the schedule is rebuilt and the
explanation recorded. External calls happen outside database transactions; state changes happen inside
them.

**Recovery** is the same pipeline with `recoverFrom`. It re-plans against current commitments, the
quarantine stays sticky, and it diffs against the parent.

**Approval** (`services/approvals.ts`) requires that the reviewed hash and total match. DEADMAN runs at
the `approval` stage, and the approval is then inserted, bound to the hash, mission version and amount.

**Payment** (`services/payments.ts`). Creating the order first runs the `execution`-stage revalidation,
which includes approval binding, duplicate and unresolved-payment checks. It records the operation with
two stored UUIDs (create and capture request IDs) before calling PayPal, then validates the returned
order's amount, currency, `custom_id` and `reference_id`. Capture revalidates at the `capture` stage,
verifies payer approval with GET, persists `CAPTURE_PENDING`, captures, and verifies again with GET.
Reconciliation is the only path out of `UNKNOWN`: it re-sends the create with the same request ID,
reads the order, or retries the capture with the same request ID.

## 5. DEADMAN policy gate

`server/policy/engine.ts` is a pure function over a context loaded from the database at evaluation time.
It never consults a model and never trusts planner-computed values.

| Rule | Stages | Enforces |
| --- | --- | --- |
| MISSION_STATE | all | mission status permits the action |
| MISSION_VERSION_CURRENT | all | proposal planned against current terms |
| CURRENCY_MATCH | all | one currency |
| REQUIREMENT_LINKAGE | all | each line serves a mission requirement with a candidate retrieved for it (no substitution) |
| SPEC_COMPLIANCE | all | independent re-check of the requirement spec |
| CONTENT_QUARANTINE | all | independent re-scan for injection |
| EVIDENCE_PRESENT | all | source id, price and pack-size evidence; coverage follows from packs × units |
| PRICE_INTEGRITY | all | price and quote equal the supplier's current commitment |
| ARITHMETIC_INTEGRITY | all | declared totals equal recomputed totals |
| BUDGET_CAP | all | total incl. shipping at current prices ≤ budget − committed |
| QUANTITY_BOUNDS | all | ≤ need + one pack of rounding, counting earlier purchases |
| STOCK_AVAILABLE | all | ≤ committed stock |
| DELIVERY_DEADLINE | all | ETA before deadline − 30 min intake buffer |
| APPROVAL_BINDING | execution, capture | active approval bound to these terms and mission version |
| NO_DUPLICATE_EXECUTION | execution, capture | no other live payment for the proposal |
| NO_UNRESOLVED_PAYMENTS | execution | no UNKNOWN/PENDING payment in the mission |

Warnings, which inform but do not block, are: delivery at risk, non-live data, and a single source for
a critical item.

## 6. AI boundary

`server/ai/claude.ts` calls `claude-opus-5-5` using structured outputs (`betaZodOutputFormat`), explicit
`effort`, server-side refusal fallbacks, and no tools. Its roles are:

- **interpret:** narrative → parameters. Every value must quote its evidence from the request; an
  invented quote rejects the output. The coordinator confirms every value, and the budget is never set
  by AI.
- **select:** ranks listings that already passed the deterministic checks. IDs outside the offered set
  reject the output. Ranking nudges the optimizer's cost score by at most 5% per rank. It may report
  suspicious listings, which only adds quarantines.
- **explain:** writes prose from structured facts. The gate never reads it.

Untrusted listing text is sanitised (hidden characters stripped, markup neutralised) and wrapped in
`<untrusted_listing>` elements. On any failure the deterministic agent's output is used, and the
`AgentRun` records `valid=false` with the reason.

## 7. Integrations and contracts

- **PayPal:** `server/payments/paypal.ts` implements `PaymentGateway`, which has three outcomes (`ok`,
  `rejected`, `ambiguous`), on top of `@paypal/paypal-server-sdk`. It sets an explicit timeout (the SDK
  default is none) and an overall deadline (the per-request timeout does not cover the OAuth exchange).
  It retries only GET and treats a 5xx or transport failure on POST as ambiguous. Error payloads are
  read with their wire names. Approval happens through the `payer-action` link with `return_url` /
  `cancel_url`.
- **Channel3:** `@channel3/sdk` `products.search` with `availability: InStock`, `conditions: new`,
  `country: US` and `currency: USD`. A product is normalised to its cheapest qualifying offer. Results
  are cached for 30 minutes per requirement (fresh results can be forced). Typed errors map to clear
  reasons (401/403 key, 402 credits, 429 rate limit).
- **Simulated fulfilment:** `server/catalog/quotes.ts` is a deterministic PRNG. It is seeded per
  scenario for rehearsable demos and per mission otherwise.
- **AG Studio / AG Grid:** `GET /api/missions/:id/analytics` returns typed flat tables, which
  `features/studio/data.ts` declares as Studio sources with relationships.
- **Bryntum:** `GET /api/missions/:id/schedule` returns delivery tasks; the client maps them to
  resources, events, dependencies and time ranges.
- **Render Workflows:** `server/workflows/index.ts` registers `reconcile-payments` and
  `run-security-suite`.

## 8. Deployment

`render.yaml` defines the web service (`npm ci --include=dev && npm run build`, `npm start`, health
check `/api/ready`) and Postgres, wired with `fromDatabase`. Migrations run at startup. Secrets are
dashboard-only (`sync: false`). `render-workflows.yaml` adds the optional workflow service. Embedded
PGlite reserves about 600 MB, so production requires `DATABASE_URL`.

## 9. Testing strategy

| Level | What | Where |
| --- | --- | --- |
| Unit | money, transitions, evidence, scanner, optimizer, every policy rule, schedule | `tests/unit` |
| Integration | real PayPal SDK through its axios adapter seam; real Anthropic SDK with scripted fetch; service flows on PGlite with a scripted PayPal; HTTP API (sessions, CSRF, isolation, validation); jobs | `tests/integration` |
| Adversarial | eight DEADMAN scenarios asserted on persisted state; sandbox cleanup | `tests/adversarial` |
| End to end | the demo sequence in a real browser against the built server | `tests/e2e` |
| Live | PayPal Sandbox order + idempotency + unapproved capture refusal (credential-gated) | `tests/sandbox` |

## 10. Risks and limitations

See the README's *Known limitations* and *Deployment status*. The main residual risks are:

- The free Render Postgres expires 2026-11-17.
- Live Channel3, Claude and PayPal paths need credentials and have only been exercised through
  SDK-level doubles in this environment.
- The AG Studio and Bryntum builds are trial or evaluation builds (watermarked).
