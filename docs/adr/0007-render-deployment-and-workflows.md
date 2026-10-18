# ADR 0007 — Render web service and Postgres; Render Workflows for durable background jobs

**Status:** accepted

**Decision.** Deploy through `render.yaml`: a Node web service with an `/api/ready` health check, and
Postgres linked via `fromDatabase`.

Two jobs benefit from durable, retried execution:

- **Payment reconciliation.** It resolves `UNKNOWN` and `PENDING` payments from PayPal's authoritative
  state, reusing the original request IDs.
- **The DEADMAN suite.**

Both are plain functions in `server/jobs`.

- **With `RENDER_API_KEY` and `RENDER_WORKFLOW_SLUG` set,** they run as `@renderinc/sdk` tasks in an
  optional workflow service (`render-workflows.yaml`).
- **Otherwise,** they run in-process.

All state lives in PostgreSQL, so retries resume work instead of repeating side effects.

**Consequences.**

- Workflows is billed per run and has no free tier, so it is opt-in.
- The web service also runs a periodic reconciler whenever PayPal is configured.
