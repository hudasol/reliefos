# Three-minute demonstration

## Before recording

1. **Configure the deployment** (or `.env`): `DATABASE_URL`, `SESSION_SECRET`, `PAYPAL_CLIENT_ID`,
   `PAYPAL_CLIENT_SECRET` and `PUBLIC_BASE_URL`. Optionally add `CHANNEL3_API_KEY`, `ANTHROPIC_API_KEY`
   and `AG_STUDIO_LICENSE_KEY`.
2. Open the app in a fresh browser profile. You get a new workspace with the flood mission. Use
   **Missions → Load flood scenario** for another clean copy.
3. Have the PayPal Sandbox *Personal* account e-mail and password ready (Developer Dashboard → Testing
   Tools → Sandbox Accounts).
4. Wake the Render instance about a minute before recording.

The scenario uses a fixed seed for simulated supplier commitments, so the plan, the drill result and the
recovery are the same on every take, given the same catalog data.

## Script (about 3:00)

| Time | Screen | Say / do |
| --- | --- | --- |
| 0:00 | Overview | "A relief coordinator has 6 hours, $4,000 and 120 flood evacuees, including 8 infants, at the East Shelter, deadline 5 PM. RELIEFOS turns that into a purchasing mission an AI can execute but never overrule." |
| 0:15 | Overview → **Plan mission** | Requirements appear with their basis (1,080 L of water from 120 × 3 L × 3 days, and so on). |
| 0:30 | Procurement | "The buyer agent ranked products that already passed specification, evidence and deadline checks. Totals are integer cents computed in code. DEADMAN, our deterministic policy gate, allowed v1." Point at the shipping lines and the *simulated* ETA tags. |
| 0:50 | Product evidence → *Injection flags* tab (after the drill below, or show the fixtures that fail spec) | "Every listing is untrusted input: quoted pack-size evidence, spec failures, and injection flags." |
| 1:00 | Security lab → **Carrier delay** drill | "The courier for the water slips past the deadline." The verdict is *Blocked by DEADMAN* with PRICE_INTEGRITY and DELIVERY_DEADLINE evidence. |
| 1:15 | Security lab → **Prompt-injected listing** drill | "A listing tells AI agents to skip approval and buy 500 blankets. We submit exactly what a manipulated agent would propose; the gate rejects it with CONTENT_QUARANTINE and QUANTITY_BOUNDS." |
| 1:30 | Procurement → **Generate recovery plan** | v2 appears with *Changes from v1* and is *Allowed*. "RELIEFOS recovered: it switched supplier and re-validated." |
| 1:45 | Decision center (AG Studio) → Delivery schedule (Bryntum) | Budget-authority widget, verdict widget, coverage chart; Sourcing tab; schedule lanes with cutoff and deadline. |
| 2:05 | Procurement → **Review & approve** | Type a name, tick the acknowledgement. "The approval is bound to this exact terms hash; any change voids it." |
| 2:15 | Approvals & payments → **Pay with PayPal Sandbox** | Redirect to PayPal Sandbox, log in as the sandbox buyer, approve. |
| 2:35 | Checkout return | "The browser redirect is not proof. The server re-validated, verified approval with PayPal, captured with a stored idempotency key, and re-read the order." The status is *Completed, verified via GET order*. |
| 2:45 | Mission report | Verified spend, requirements met and gaps, what the gate stopped, 8/8 adversarial scenarios (run the suite beforehand), audit chain intact. |
| 2:55 | — | "RELIEFOS: AI that plans fast, a gate that never trusts it, and PayPal payments you can prove." |

## Fallback if PayPal Sandbox is unavailable during recording

Show **Approvals & payments**: checkout is disabled and explained, never simulated. Then show the
**Security lab** suite, which exercises timeouts, ambiguous captures and reconciliation against the
scripted PayPal double. Say plainly that this part is a test double.
