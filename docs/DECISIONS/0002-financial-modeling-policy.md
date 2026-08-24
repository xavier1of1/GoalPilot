# ADR 0002: Deterministic illustrative financial policy

- Status: accepted for the local MVP
- Date: 2026-08-23

## Decisions

- Money crosses boundaries and is stored as integer cents. Decimal arithmetic is used internally;
  posting rounds once to cents with half-even rounding.
- Deposit APY uses `(1 + APY)^(1/365) - 1`. Contributions post at the beginning of their effective
  date and earn that day's modeled interest. Accrued deposit interest posts at calendar month-end and
  at the target date.
- Monthly schedules preserve the chosen day; a month-end start remains month-end. Weekly and
  biweekly schedules preserve weekday.
- A contribution delayed by pause or retry keeps its original due-date occurrence for audit, but
  posts with the actual processing date and earns modeled interest only from that date. The ledger
  never backdates principal across days whose interest has already been processed.
- The zero-interest safe contribution is the only primary recommended commitment for every vehicle.
  Modeled yield may create cushion or earlier purchase readiness, but it never permits GoalPilot to
  tell the user to save less. An interest-adjusted amount may exist only in an advanced analytical
  trace with explicit labeling.
- CD lots use 180-day terms and Treasury lots use 91-day terms. Only whole modeled maturities ending
  by the goal date earn interest; no secondary-market sale or early withdrawal is assumed.
- Already-funded fixed-term goals schedule no further contributions, remain locked until the target
  boundary, and still receive every complete maturity credit ending by that boundary.
- Assumptions older than 365 days are stale and cannot produce a new recommendation. An already
  activated account retains its immutable assumption snapshot and displays a stale warning.
- `confidence=expected` is the only MVP value. Additional scenarios are deferred until policy is
  defined; the field remains version-compatible without fabricating behavior.
- Vehicle ranking follows eligibility, purchase readiness by the target using the safe
  contribution, the declared access requirement, lower lock/liquidity conflict, higher target-date
  cushion, and finally deterministic vehicle code. Yield cannot override access or maturity.
- Recovery can change contribution, deadline, or target, and may model one planned pause or missed
  contribution. It never automatically selects a riskier vehicle.
- Plan health distinguishes total funded value from accessible purchase-ready funds. The exact
  precedence and immutable scenario-version policy are recorded in ADR 0003.
- Initial saved money becomes an opening-principal ledger entry at activation. Pending and failed
  contributions do not affect available balance. Posted signed monetary entries alone affect it.
- Account deletion removes user financial records and sessions; retained security audit events are
  irreversibly pseudonymized and contain no goal name, note, email, or amount.

## Rationale

These rules choose conservative displayed installments, explicit maturity behavior, and replayable
calendar arithmetic while avoiding any implication that illustrative rates are guaranteed.
