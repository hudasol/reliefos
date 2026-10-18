# Verified requirements and constraints

Research date: **2026-10-18**. Devpost pages returned HTTP 403 to automated fetches, so they were read
in a browser. Facts below come from the pages named; anything not verified is marked.

## Hackathon (paypalaihackathon.devpost.com: overview, rules, resources)

- **Core requirement.** The project must meaningfully use both PayPal (any developer-platform
  product, using the free sandbox) and AI. No specific PayPal product is mandated. Agentic commerce is
  a prize category, not a requirement.
- **Submission window.** 1 October 2026 09:15 PT to **12 November 2026 12:00 PT**. Judging runs 1–15
  December 2026, and winners are announced around 21 December.
- **Required in the submission.**
  - Description of features.
  - A *Tools* section naming the AI models and services used and how.
  - A public repo with all source and run instructions, plus an open-source licence that GitHub
    detects.
  - A YouTube video under 3 minutes that shows the project running.
  - Free testing access for judges until judging ends; credentials needed go in the README.
- **Judging.**
  - Stage 1 is pass/fail on theme and API use.
  - Stage 2 scores five equally weighted criteria: Technological implementation, Design, Potential
    impact, Innovation, Presentation. Ties break in that order.
- **Prize limit.** A project can win at most one grand prize plus one sponsor prize.

## Sponsors

| Sponsor | Eligibility as published | Resources |
| --- | --- | --- |
| AG Grid | Polish with AG Studio (custom widgets, theming, layout), "not just AG Grid or AG Charts on their own"; Studio Agent Framework encouraged | 45-day Studio trial key; `paypaldev/hackathon-paypal-ag-grid-boilerplate` |
| APIMatic | Use of the Context Plugin for the PayPal integration | `npx context-plugins install https://github.com/paypaldev/server-sdk-context-plugin-preview` |
| Bryntum | Best use of Gantt, Scheduler and/or Calendar | Public npm trial: `@bryntum/scheduler@npm:@bryntum/scheduler-trial` |
| Channel3 | Channel3 API or MCP as a meaningful part of the product; mere references do not qualify | Developer sign-up; promo code for 20k credits published on the sponsor page |
| Render | Deploy on Render; use Render Workflows to coordinate jobs | $50 credit claim link on the sponsor page |

## Platform facts used in the design

- **PayPal Orders v2.**
  - Order statuses are CREATED, SAVED, APPROVED, VOIDED, COMPLETED and PAYER_ACTION_REQUIRED. A
    COMPLETED order is not proof of payment; check `captures[].status`.
  - `PayPal-Request-Id` gives idempotency. The SDK docs say keys are stored for 6 hours; the exact
    retention window was not otherwise verified.
  - Capture errors include ORDER_ALREADY_CAPTURED, ORDER_NOT_APPROVED and INSTRUMENT_DECLINED.
- **PayPal Server SDK 2.5.0 (APIMatic).**
  - The default timeout is 0, which means no timeout.
  - The default retry configuration only retries GET and PUT.
  - Error classes are in `src/errors`.
  - Read from the package source and the context-plugin skills.
- **Agentic Commerce Services (Agent Ready, Store Sync).** Access is through a request form and
  onboarding, so it is not self-serve. Sandbox availability is undocumented. RELIEFOS does not depend
  on it.
- **Channel3.**
  - `POST /v1/search` via `@channel3/sdk` 4.3.0.
  - Price, availability and buy URL live on each offer.
  - No stock or delivery data is returned.
  - Auth uses the `x-api-key` header.
- **Render.**
  - The free Postgres expires after 30 days, with a 14-day grace period.
  - Free web services sleep after 15 minutes and have 512 MB of RAM.
  - Workflows (`@renderinc/sdk` 1.2.0) is billed per run with no free tier, and is declared in a
    Blueprint as `type: workflow`.
- **AG Studio 3.0 + AG Grid 36.2.** Without a licence key everything works with a watermark. The Studio
  AI module requires an AI-enabled licence.
- **Claude.** RELIEFOS uses `claude-opus-5-5` with structured outputs and server-side refusal fallbacks.
  Forced `tool_choice` returns 400 on this model, so structured outputs are used instead.

## Access issues at build time

- The APIMatic installer could not detect a `claude` CLI on PATH from the desktop app. The plugin's
  TypeScript skills were read directly from its GitHub repository and applied.
- No PayPal, Channel3, Anthropic or AG Studio credentials were available in the build environment. Each
  integration has a labelled fallback, and live paths are covered by SDK-level tests or skipped live
  tests.
- The Render Postgres connection string is not exposed to tooling, so `DATABASE_URL` must be linked in
  the Render dashboard.
