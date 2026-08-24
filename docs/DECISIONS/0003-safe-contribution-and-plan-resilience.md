# ADR 0003: Safe contribution and plan resilience

- Status: accepted for the local product-experience release
- Date: 2026-08-23
- Supersedes: any ADR 0002 wording that permits a lower primary commitment because of modeled yield

## Context

GoalPilot previously compared interest-adjusted installments. That is useful analysis, but making
such a value the user's commitment would make success depend on an illustrative assumption. The
product phase also needs one deterministic definition of plan health and a history-preserving way
to recover from disruptions.

## Decisions

### Safe commitment

`safeContributionCents` is calculated from target, current savings, cadence, and target date with a
zero rate. It is independent of vehicle and assumption APY. It is revealed before budget fit is
asked and is the only primary recommended commitment.

Modeled interest may be displayed as target-date cushion, earlier projected readiness, or
resilience. It must not lower the primary commitment, win a rank on its own, or be described as
guaranteed. `expected` remains the only internal confidence value and is not exposed as a control.

### Vehicle fit

All four models remain visible and cash remains the baseline. Models are evaluated and ordered by:

1. eligibility under every access, maturity, preservation, and policy rule;
2. purchase readiness by the target using the safe contribution;
3. satisfaction of declared access needs;
4. lower liquidity and lockup conflict;
5. higher modeled cushion;
6. vehicle code.

Ineligible models receive no rank. Return cannot override eligibility, access, or maturity.

### Readiness and health

Lifecycle (`draft`, `active`, `completed`, `archived`) and `PlanHealth` are separate. Health uses
this precedence:

1. `PAUSED` when the active plan is paused;
2. `PURCHASE_READY` when available modeled funds meet the target and all access conditions hold;
3. `FUNDED_BUT_LOCKED` when total modeled value meets the target but available funds do not;
4. `ATTENTION_NEEDED` when projected purchase readiness is after the target or cannot be reached;
5. `AHEAD` when readiness precedes the target by at least one full contribution interval;
6. `ON_TRACK` otherwise when readiness is on or before the target.

No opaque score participates in this decision.

### What-If and recovery

A primary What-If preview changes exactly one of contribution, deadline, target, or one planned
missed contribution. It is stateless and does not change the active plan. Applying it revalidates
the expected active-plan version, rejects a stale concurrent change, creates a new immutable plan
version, preserves every prior version, records append-only activity, and returns the comparison.

An attention-needed plan receives at most three deterministic options: contribution increase,
deadline extension, and target reduction. Options use the smallest practical policy-valid change.
They never switch vehicles, raise product risk, suggest debt, or claim guaranteed recovery.

## Consequences

- The builder must request budget fit only after a baseline preview.
- API contracts must distinguish safe contribution, chosen contribution, personal contributions,
  modeled interest, cushion or shortfall, available funds, total value, readiness, and health.
- Active changes create versions; only unactivated drafts are edited in place.
- Financial and state decisions remain pure domain functions with golden, property, precedence,
  and immutability tests.
- Existing persistence names such as `simulated_accounts` may remain internal; customer copy uses
  **Simulated Goal Plan**.
