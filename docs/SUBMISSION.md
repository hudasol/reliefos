# Devpost submission text (draft)

## Tagline

Secure, auditable emergency procurement: AI plans the mission, a deterministic gate guards the money,
and PayPal executes only what a human approved.

## Inspiration

In a disaster, procurement decisions interact. A cheaper product can arrive too late. A substitute can
break the spec. Shipping can push an order past its authority. A malicious listing can try to steer
the purchasing agent, and a network timeout can leave you unsure whether you paid. We wanted an AI
purchasing system where those failures are expected, detected and recovered from, not assumed away.

## What it does

RELIEFOS turns an urgent request ("120 evacuees, 8 infants, East Shelter, before 5 PM, $4,000") into a
mission:

- It derives quantities in code from published planning assumptions.
- It searches Channel3 for products and extracts pack-size evidence.
- An AI buyer agent (Claude) ranks only listings that already passed specification, evidence and
  deadline checks.
- An optimizer builds a proposal in integer cents.
- DEADMAN, an independent, deterministic policy gate, validates it. DEADMAN re-derives every total,
  quantity, price and quote and re-scans listings for prompt injection.

When something changes it recovers. Examples are a supplier repricing, a courier slipping past the
deadline, a surge fee, or a prompt-injected listing that would manipulate the agent into buying 500
blankets. RELIEFOS rejects the plan with evidence, explains it, re-plans and re-validates.

A coordinator approves the plan, and the approval is bound to a hash of its exact terms. RELIEFOS
re-validates once more and creates the PayPal order on the server. After the payer approves in PayPal
Sandbox, the server verifies the approval, captures with a stored idempotency key and re-reads the
order. Only then does the mission count the payment.

Timeouts become **UNKNOWN**, never "failed" or "paid". They are resolved only by reconciliation
against PayPal. Every step is written to a hash-chained, append-only audit log.

## How we built it

- **Stack:** TypeScript end to end. Express 5, PostgreSQL (Render) / PGlite (local), React 19.
- **PayPal:** Orders v2 through the APIMatic-generated PayPal Server SDK, implemented against the
  APIMatic context plugin's guidance (explicit timeouts, no POST retries, deadline around the OAuth
  exchange, wire-named errors, adapter-seam tests).
- **AI:** Claude (`claude-opus-5-5`) with structured outputs, server-side refusal fallbacks and no
  tools. Outputs are re-validated against offered IDs and quoted evidence. A labelled deterministic
  agent takes over on any failure.
- **Channel3** for product discovery.
- **AG Studio** for a mission dashboard with custom *Budget authority* and *Policy verdict* widgets,
  and **AG Grid Enterprise** for the sourcing and proposal grids.
- **Bryntum Scheduler** for the delivery plan, with deadline and conflict detection.
- **Render** for hosting, plus Render Workflows tasks for durable payment reconciliation and the
  security suite.

## Tools (AI models and services)

- **Claude Opus 5.5** (Anthropic API): interprets the mission brief (each value must quote the
  request), ranks pre-validated listings (unknown IDs rejected), and writes coordinator explanations.
  It never decides policy or payments.
- **Claude Code**, with the APIMatic PayPal context plugin skills: used to build the application.

## Challenges

- Making "unknown" a first-class payment state and proving that no path double-charges.
- Keeping AI useful while making sure the gate never depends on it.
- Running embedded Postgres was too heavy for a 512 MB host, so the Security Lab moved to sandbox
  workspaces.

## Accomplishments

- Eight adversarial scenarios are enforced and verified on persisted state.
- The end-to-end demo path is browser-tested.
- Approvals cannot be reused after any material change.

## What's next

- Authenticated roles and approval limits.
- Real supplier fulfilment APIs in place of the simulated commitments.
- PayPal multiparty payouts to multiple suppliers.
- PayPal agentic commerce once partner access is available.

## Testing instructions for judges

Open the deployment URL in the README. A private workspace with the flood scenario is created
automatically and no login is needed. Follow docs/DEMO.md. PayPal Sandbox buyer credentials (if
provided by the team) are listed in the README. All money is sandbox money.
