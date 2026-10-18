# ADR 0008 — Anonymous, signed, isolated workspaces instead of accounts

**Status:** accepted

**Context.** Judges must be able to use the hosted demo without credentials. They also must not
interfere with each other's missions.

**Decision.** Each visitor gets an anonymous workspace.

- **First request.** The server creates a workspace, seeds it with the flood scenario, and sets an
  HMAC-signed, HttpOnly, SameSite=Lax cookie.
- **Scoping.** Every query is scoped to the workspace. A mission from another workspace is
  indistinguishable from a missing one: both return 404.
- **CSRF.** Mutations require the `x-reliefos-request` header.

**Consequences.**

- The approver name is recorded but not authenticated. This is documented as a limitation.
- A real deployment would put identity and role-based approval limits in front of the same gate.
