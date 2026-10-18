# ADR 0006 — AG Studio dashboard and AG Grid Enterprise grids; Bryntum Scheduler for deliveries

**Status:** accepted

**Decision.** The server exposes flat, typed analytics tables (`/analytics`). They are computed by the
same code the policy gate uses.

**AG Studio** presents a three-page mission dashboard: Mission, Sourcing and Assurance. It uses the
RELIEFOS theme, page filters, and two custom widgets:

- *Budget authority* reads its measure through Studio's data engine, and reads the mission's
  authoritative summary through `context`.
- *Policy gate verdict* shows the gate's latest decision.

**AG Grid Enterprise** provides the operational grids, with row grouping, aggregation, set filters, the
side bar and integrated charts.

**Bryntum Scheduler** shows a timeline of lanes: supplier shipments, then shelter intake, then
distribution.

- Dependencies link each delivery to intake.
- Time ranges mark the mission window, the intake cutoff and the deadline.
- The schedule is read-only, because ETAs are supplier commitments, not coordinator choices.

**Rejected.**

- Bryntum Gantt: there is no task hierarchy and no editing need.
- A plain AG Grid without Studio: the sponsor judges Studio usage.

**Consequences.**

- Without licence keys, both components show evaluation watermarks.
- No Studio AI harness is wired up. It needs an AI-enabled licence, and RELIEFOS's own agent already
  covers explanations.
