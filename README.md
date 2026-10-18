# RELIEFOS

**Secure, auditable emergency procurement missions, executed through PayPal.**

RELIEFOS turns an urgent supply request ("120 flood evacuees, 8 infants, East Shelter, before 5 PM,
$4,000") into a purchasing mission. It derives the requirements, finds products through Channel3, and
has an AI buyer agent rank them. A deterministic policy gate (**DEADMAN**) validates every proposal.
When conditions change it recovers with a revised plan, requires a human approval bound to the exact
terms, and only then executes and verifies a PayPal Sandbox payment. Every step lands in a hash-chained
audit trail.

Its defining capability is **secure mission recovery**. When a plan becomes infeasible or exceeds the
coordinator's authority, RELIEFOS explains why with evidence, re-plans, re-validates, asks for fresh
approval and executes only what was authorised.

> Built for the PayPal AI Hackathon ("Build What's Next with PayPal and AI"). RELIEFOS is not affiliated
> with PayPal. All amounts move in **PayPal Sandbox** only; the server refuses `PAYPAL_ENVIRONMENT=live`.
> The flood scenario and its organisation are fictional.

**Live deployment:** https://reliefos-c034.onrender.com (Render free tier: the first request after
idle can take about a minute). See [Deployment status](#deployment-status).

---

## What a coordinator sees

| Question | Where it is answered |
| --- | --- |
| What does the mission need? | **Overview**: requirements derived from population, infants, household size and coverage days, each with its rationale |
| What is planned, and what is still unmet? | **Overview / Procurement**: proposal lines, gaps and trade-offs, budget meter |
| Why was a product selected or rejected? | **Product evidence**: every listing with quoted pack-size evidence, spec checks, injection flags and exclusion reasons |
| What is over budget or at risk? | **Policy gate** verdict with per-rule evidence; **Delivery schedule** conflicts |
| What needs human approval? | **Procurement → Review & approve**: approval bound to the proposal's terms hash |
| Has a payment actually completed? | **Approvals & payments**: the PayPal Orders v2 lifecycle; *completed* only after a server-side GET verifies the capture |
| What happens next? | The top bar always shows the next action |

## Demonstration sequence

1. A coordinator submits the fictional flood mission (pre-loaded in every new workspace).
2. RELIEFOS retrieves products (Channel3, or a labelled fixture catalog) and attaches **simulated**
   supplier commitments (stock, ETA, courier fees).
3. The buyer agent (Claude, or a labelled deterministic fallback) ranks eligible listings. The optimizer
   builds proposal v1 in integer cents.
4. A **drill** exposes a policy violation: a supplier reprices, a courier slips past the deadline, a
   surge fee appears, or a prompt-injected listing produces a compromised agent proposal.
5. DEADMAN rejects the proposal with evidence.
6. The explanation names the failed rules.
7. **Generate recovery plan** produces v2 against the current commitments, with a diff against v1.
8. The AG Studio dashboard, AG Grid decision grids and Bryntum schedule update from persisted state.
9. The coordinator approves v2. The approval is bound to its content hash and the mission version.
10. RELIEFOS re-validates, creates the PayPal order on the server, and the payer approves in PayPal Sandbox.
11. The server verifies payer approval, captures with a stored `PayPal-Request-Id`, re-reads the order and
    marks the mission *partially fulfilled* or *completed*.
12. The **Mission report** shows verified spend, unmet gaps, what the gate stopped, and audit integrity.

A three-minute script is in [docs/DEMO.md](docs/DEMO.md).

## Architecture in one picture

```
 Browser (React 19 · AG Studio · AG Grid Enterprise · Bryntum Scheduler)
   │  typed JSON API, signed workspace cookie, CSRF header
   ▼
 Express API ──► application services (missions · planning · approvals · payments · drills · jobs)
                   │            │                │                     │
                   │            │                │                     └─► Render Workflows tasks (optional)
                   ▼            ▼                ▼
          AI agent (Claude,   Optimizer      DEADMAN policy gate  ◄── the only component that can
          bounded roles,      (integer        (deterministic,          permit a payment operation
          structured output)  cents)          re-derives everything)
                   │            │                │
                   ▼            ▼                ▼
          Channel3 catalog   Simulated       PayPal Orders v2 via the APIMatic-generated
          (+ labelled        fulfilment      @paypal/paypal-server-sdk (Sandbox)
          fixtures)          model
                   └────────────┴────────────────┴──► PostgreSQL (Render) / PGlite (local)
                                                       append-only, hash-chained audit log
```

Full details: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Decisions: [docs/adr](docs/adr).
Verified hackathon and sponsor requirements: [docs/RESEARCH.md](docs/RESEARCH.md).

## Security model (summary)

- **AI proposes, code decides.** Models interpret, rank pre-validated listings and explain. They cannot
  set budgets, quantities or totals, approve purchases, or declare payments. Their outputs are
  schema-validated and re-checked against the IDs and text they were given; failures fall back to the
  labelled deterministic agent, and the reason is recorded.
- **Listings are untrusted.** A scanner quarantines instruction-like content. The gate re-scans
  independently, and the agent may add quarantines but never remove one.
- **Hard constraints are never traded away.** These are: budget including shipping, priced at the
  supplier's *current* commitment; currency; quantity bounds; requirement linkage (no substitutions);
  spec compliance; pack-size evidence; price and quote integrity; stock; and the delivery deadline with
  an intake buffer.
- **Approvals are non-transferable.** They are bound to a SHA-256 hash of every material term and the
  mission version. Any change, including a mission edit, invalidates them.
- **Payments are verified, never assumed.** A timeout or 5xx yields `UNKNOWN`. Only reconciliation (an
  authoritative GET) moves it on, and retries reuse the original idempotency keys. The database refuses a
  second live payment per proposal. An amount mismatch is never marked complete.
- **Isolation and integrity.** Every visitor gets a signed, isolated workspace. Mutations require a
  custom header (CSRF), validation happens at the boundary, there are rate limits and a strict CSP, and
  the audit log is append-only, enforced by a database trigger, with a verifiable hash chain.

The **Security lab** replays eight attack scenarios through the real services and passes only on
observed enforcement: injection, reprice, shipping over budget, quantity/substitution, duplicate after
timeout, ambiguous response, deadline slip, and mission change after approval.

## Sponsor integrations

| Sponsor | How RELIEFOS uses it | Status |
| --- | --- | --- |
| **PayPal** | Orders v2 (create → payer approval → server-side verification → capture → verification) bound to approvals; idempotency keys, reconciliation | Implemented and tested against an SDK-level double; live Sandbox runs need credentials (see below) |
| **APIMatic** | The PayPal integration uses the APIMatic-generated **PayPal Server SDK** (`@paypal/paypal-server-sdk` 2.5.0), written against the hackathon's **APIMatic context plugin** skills. The plugin flagged the SDK's no-timeout default, POST retry rules, the token-exchange deadline gap, wire-named error payloads and the adapter test seam; each is handled in `server/payments/paypal.ts` | Implemented |
| **Channel3** | Live product discovery (`@channel3/sdk`, `products.search`), normalised to cheapest new in-stock USD offer, with evidence extraction; labelled fixture fallback on error | Implemented; needs `CHANNEL3_API_KEY` to go live |
| **AG Grid / AG Studio** | AG Studio mission dashboard (3 pages, RELIEFOS theme, page filters) with two custom widgets: *Budget authority* (Studio data engine + mission context) and *Policy gate verdict*. AG Grid Enterprise sourcing and proposal-line grids with grouping, aggregation, set filters, side bar, status bar and integrated charts | Implemented; watermark without a licence key |
| **Bryntum** | Scheduler of supplier shipments → shelter intake → distribution with dependencies, mission-window, cutoff and deadline ranges, conflict colouring, superseded-plan overlay; recomputed when an ETA changes | Implemented (trial build, watermarked) |
| **Render** | Web service + PostgreSQL via `render.yaml` Blueprint, `/api/ready` health check. Render Workflows tasks (`@renderinc/sdk`) for payment reconciliation and the security suite, with retries; in-process fallback | Web service deployed; Workflows code ready, not deployed (billed product) |

## Running locally

Requirements: Node.js 22.12+ (24 recommended). No database server is needed; local development uses
embedded PGlite in `.data/pglite`.

```bash
npm install
cp .env.example .env    # optional: add PayPal Sandbox, Channel3, Anthropic, AG Studio keys
npm run build
npm start               # http://localhost:8080
```

For development with hot reload, run `npm run dev` (API on :8080, Vite on http://localhost:5173).

Every integration is optional. Without credentials RELIEFOS runs labelled fallbacks: fixture catalog,
deterministic planner, watermarked AG and Bryntum components. Checkout is **disabled**, never simulated.

### Enabling PayPal Sandbox

1. In https://developer.paypal.com/dashboard/applications/sandbox create (or open) a REST app. Copy its
   **Client ID** and **Secret** into `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET`.
2. Under **Testing Tools → Sandbox Accounts**, use the default *Personal* account to log in at PayPal
   checkout. Its password is under *View/Edit account*.
3. Set `PUBLIC_BASE_URL` to the URL users reach the app on, so PayPal returns the payer to it.

### Environment variables

See [.env.example](.env.example) for the full list with explanations. In production `DATABASE_URL` and
`SESSION_SECRET` are required; the server refuses to start without them.

## Quality gates

```bash
npm run typecheck        # server + client
npm run lint
npm run format:check
npm test                 # 84 unit, integration and adversarial tests (+2 live-sandbox tests, skipped without credentials)
npm run build && npm run test:e2e   # Playwright: full demo path in a real browser (uses installed Edge on Windows)
```

The tests cover:

- **Unit:** money, state machines, evidence parsing, the injection scanner, the optimizer, the policy
  gate and the schedule.
- **Integration:** the PayPal gateway through the SDK's adapter seam, the Claude agent through the
  Anthropic SDK with a scripted fetch, service-level mission flows on PGlite, the HTTP API, and jobs.
- **Adversarial:** all eight DEADMAN scenarios.
- **Live:** PayPal Sandbox order creation and idempotency, when credentials are present.

## Deployment status

- **Render web service** `reliefos` (Virginia, free) auto-deploys from `main`. The service needs
  `DATABASE_URL` linked to the `reliefos-db` Render Postgres, because embedded PGlite needs about 600 MB
  RAM and does not fit the 512 MB free instance. The Blueprint (`render.yaml`) wires this automatically
  for new deployments.
- **Render Postgres** `reliefos-db` (free) **expires 2026-11-17**. Judging runs 1–15 December 2026, so
  upgrade it (for example with the hackathon's Render credits) or recreate it before then.
- **Render Workflows** is optional (`render-workflows.yaml`); it is billed per task run.

## Known limitations

- **Simulated:** supplier stock, delivery ETAs and courier fees. No merchant fulfilment API exists for
  this use, so they are labelled *simulated* everywhere. Drills and the adversarial listing are simulated
  by design.
- **No user accounts.** Workspaces are anonymous and isolated per browser. The approver name is recorded
  but not authenticated.
- **One merchant of record.** Payment goes to the PayPal Sandbox merchant account that owns the REST app.
  Splitting funds across many real suppliers would need PayPal multiparty onboarding, which is out of scope.
- **Agentic commerce gated.** PayPal Agent Ready / Store Sync need partner onboarding, so RELIEFOS uses
  the self-serve Orders v2 API.
- **Not production-certified.** This is a hackathon build, not a certified procurement system.

## Repository layout

```
shared/        domain types, integer-cent money, state machines, request contracts (Zod)
server/
  ai/          Claude agent (structured outputs) + deterministic agent
  catalog/     Channel3 + fixture sources, evidence extraction, injection scanner, simulated quotes
  domain/      requirement derivation, domain errors
  planning/    optimizer, material-terms hash
  policy/      DEADMAN policy engine
  payments/    PayPal gateway (APIMatic Server SDK), scripted double for the Security Lab
  services/    missions, planning, approvals, payments, drills, Security Lab, read models
  jobs/ workflows/   background jobs and Render Workflows tasks
  repo/ db/    repository, PostgreSQL/PGlite adapter, migrations
  api/         Express app, sessions, error mapping
web/src/       React client (pages, features/studio for AG Studio, Bryntum schedule)
tests/         unit · integration · adversarial · e2e · sandbox
docs/          architecture, decisions, research, demo script, submission text
```

## License

[MIT](LICENSE)
