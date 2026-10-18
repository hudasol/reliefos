# ADR 0005 — PostgreSQL in production; PGlite for local development and tests

**Status:** accepted (amended after deployment)

**Context.** RELIEFOS needs:

- durable, relational state with constraints and triggers;
- local development without a database server;
- fast, isolated tests.

**Decision.** A narrow `Database` interface sits over node-postgres and PGlite, so both run the same SQL
and migrations. Production uses Render Postgres (`DATABASE_URL`). Local development and tests use
PGlite.

The schema enforces the key invariants itself:

- at most one live payment per proposal;
- at most one active approval per proposal;
- at most one current quote per candidate;
- an append-only audit log, enforced by a trigger.

**Amendment.** On Render's 512 MB free instance, PGlite reserved about 600 MB and ran out of memory. Two
changes followed:

- production refuses to start without `DATABASE_URL`;
- the Security Lab runs in sandbox workspaces of the application database, instead of private PGlite
  instances.
