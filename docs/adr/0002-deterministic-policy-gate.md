# ADR 0002 — A deterministic policy gate separate from the AI agent

**Status:** accepted

**Context.** An AI agent proposes purchases. Product listings are untrusted and may contain prompt
injection. A model's statement that it "rejected an attack" proves nothing.

**Decision.** DEADMAN (`server/policy/engine.ts`) is a pure function over state loaded from the database
at evaluation time. It is the only component that can permit an approval, an order or a capture.

- **Independent re-derivation.** It recomputes totals, shipping, quantities, spec compliance and content
  flags itself, without trusting the planner.
- **Approval binding.** It binds each approval to a hash of the material terms.
- **Four stages.** It runs at validation, approval, execution and capture.

The agent can only make plans stricter. Listings it reports as suspicious are quarantined, and it can
never remove a quarantine.

**Rejected.**

- LLM-as-judge for policy: it is non-deterministic and can itself be injected.
- Trusting totals computed by the planner.

**Consequences.**

- Every rejection carries rule IDs and machine-readable evidence.
- The Security Lab can assert enforcement against persisted state.
