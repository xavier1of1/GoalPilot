# Calculation specification

GoalPilot calculations are pure functions of normalized goal input, an immutable illustrative
assumption version, and an explicit application date. Stored money is integer cents. Rate arithmetic
uses 40-digit Decimal precision and half-even rounding only at posting boundaries.

The zero-interest safe baseline divides remaining target cents by the number of contribution
occurrences and rounds upward to a cent. A same-day deadline with a shortfall is impossible. An
already-funded goal requires zero contributions. This value is independent of vehicle and APY and
is the only primary recommended commitment. A model may retain an interest-adjusted installment in
an advanced trace, but that number never drives commitment, fit ranking, or recovery.

Deposit models accrue daily using `(1 + APY)^(1/365) - 1`, after any contribution due that day, and
post at month-end and the target date. Merely crossing the goal amount is not an interest-posting
boundary. Maturity models create lots, compound from each cent-rounded prior maturity, and credit
only complete fixed terms ending no later than the target date. Already-funded fixed-term principal
remains locked until the target boundary, schedules no additional contributions, and still earns
complete modeled maturity postings. A delayed scheduled contribution retains its original due date
as audit context but posts on the actual retry date, so it cannot be backdated across already-processed
interest days. See ADR 0002 for policy decisions.

For the reviewed `validGoalFixture` at 2026-08-23, the exact regression vector is:

| Vehicle         | Safe installment | Principal | Posted interest | Ending balance | Readiness   |
| --------------- | ---------------: | --------: | --------------: | -------------: | ----------- |
| Cash            |           41,667 |   640,000 |               0 |        640,000 | 2027-08-23  |
| HYSA            |           41,667 |   595,000 |          10,443 |        605,443 | 2027-07-23  |
| CD ladder       |           41,667 |   640,000 |          10,359 |        650,359 | policy date |
| Treasury ladder |           41,667 |   640,000 |          12,266 |        652,266 | policy date |

All monetary values in this table are cents. The safe installment is the zero-interest commitment;
the principal and interest columns model the fixture's chosen 45,000-cent monthly contribution and
therefore may stop earlier when the plan becomes purchase-ready. Values are locked by engine tests
and may not be copied into the UI. Purchase readiness for fixed-term rows additionally requires the
relevant access/maturity policy to be satisfied, even when total value meets the target.

Plan health is calculated after projection using ADR 0003 precedence. `AHEAD` means the
purchase-ready date precedes the target by at least one full contribution interval. A total balance
at target without accessible funds is `FUNDED_BUT_LOCKED`, never `PURCHASE_READY`. A projection
after the target or with no feasible readiness date is `ATTENTION_NEEDED`.

A What-If run changes exactly one normalized dimension and returns a comparison without persistence.
Applying the same proposal re-runs the calculation against the named active-plan version and
creates a new immutable version; historical calculations and assumption snapshots are never
rewritten.
