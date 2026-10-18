# ADR 0001 — One TypeScript deployable with shared contracts

**Status:** accepted (2026-10-18)

**Context.** The repository was empty. The product needs:

- a typed API;
- a rich client with three commercial grid and scheduler components;
- PostgreSQL;
- a workflow runner.

The hackathon rewards a complete, working product over distributed infrastructure.

**Decision.** Use a single Node/TypeScript package.

- Express 5 serves the API and the Vite-built React 19 client.
- `shared/` holds the domain types, state machines and Zod request contracts that both sides use.
- TypeScript is pinned to 6.0, because typescript-eslint does not yet support 7.0.
- Every dependency is pinned to an exact version.

**Rejected.**

- **Next.js:** it mixes server and client concerns around payment code.
- **Separate frontend and backend repositories, or microservices:** they add deployment surface with no
  requirement behind it.
- **Tailwind or template UI kits:** the product needs its own operations-console identity.

**Consequences.**

- One build, one health check, one Render service.
- The workflow service reuses the same build (`server/workflows`).
