# Calculation specification

GoalPilot calculations are pure functions of normalized goal input, an immutable illustrative
assumption version, and an explicit application date. Stored money is integer cents. Rate arithmetic
uses 40-digit Decimal precision and half-even rounding only at posting boundaries.

The no-interest baseline divides remaining target cents by the number of contribution occurrences and
rounds upward to a cent. A same-day deadline with a shortfall is impossible. An already-funded goal
requires zero contributions.

Deposit models accrue daily using `(1 + APY)^(1/365) - 1`, after any contribution due that day, and
post at month-end. Maturity models create lots and credit only complete fixed terms ending no later
than the target date. See ADR 0002 for policy decisions.
