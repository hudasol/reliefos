# ADR 0003 — PayPal Orders v2 through the APIMatic Server SDK, approval by redirect

**Status:** accepted

**Context.**

- The hackathon requires PayPal at the centre of the product.
- PayPal's agentic-commerce services (Agent Ready, Store Sync) need partner onboarding, which is not
  self-serve.
- The JS SDK v6 initialisation docs were inconsistent about client tokens.
- The APIMatic sponsor provides a context plugin for the APIMatic-generated PayPal Server SDK.

**Decision.** Use Orders v2 (intent `CAPTURE`) through `@paypal/paypal-server-sdk` 2.5.0, following the
plugin's TypeScript skills:

- set an explicit timeout, because the generated default is 0, which means none;
- let the SDK retry only GET requests, and handle ambiguous POSTs in RELIEFOS;
- race every call against an overall deadline, because the OAuth exchange escapes the per-request
  timeout;
- read error payloads by their wire field names;
- test through the axios-adapter seam.

**How the order flow works.**

- Orders are created on the server. Each is bound to `reference_id` (the proposal), `custom_id` (the
  payment operation) and `invoice_id`.
- Each payment operation stores its create and capture `PayPal-Request-Id`s before PayPal is called.
- The payer approves through the `payer-action` link, which carries `return_url` and `cancel_url`.
- The return page only asks the server to verify the order (GET) and capture it. It never declares
  success itself.

**Rejected.**

- Capturing from the client.
- Treating the browser callback as proof of payment.
- Retrying POSTs blindly.
- The Agent Toolkit: it isn't needed for a coordinator-approved flow, and it has no capture-verification
  semantics of its own.

**Consequences.**

- A timeout yields `UNKNOWN`, which only reconciliation can resolve.
- The live sandbox needs credentials. `tests/sandbox` exercises the real API when they are present.
