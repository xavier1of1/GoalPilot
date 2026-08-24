# Decision queue

No unresolved product-policy conflicts currently block PX implementation. The following choices are
closed by the product mandate and ADR 0003:

- zero-interest safe contribution is primary and modeled interest is cushion only;
- vehicle-fit ranking uses eligibility, purchase readiness with the safe amount, access, liquidity
  conflict, cushion, then vehicle code;
- lifecycle and the six plan-health states are separate;
- What-If changes one dimension and apply creates immutable history;
- recovery offers contribution, deadline, or target only and never escalates risk;
- consumer Autopilot uses per-user time and seeded-only reset;
- product events are separate, allowlisted, and contain no financial or entered content;
- Purchase Timing Lab policy `purchase-timing-v1` is fixture-only, descriptive, and readiness-gated;
- user-validation evidence cannot be inferred from telemetry or a results template.

The PRD's Cognito and AWS release requirements are intentionally deferred by the active local-first
request and ADR 0001. They are not deleted; they become M19-M22 acceptance criteria after the local
hard gate.

Implementation discoveries that require changing one of these policies must be recorded as a new
ADR and escalated; they are not routine code-level choices.
