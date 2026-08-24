# Calculation specification

GoalPilot calculations are pure functions of normalized goal input, an immutable illustrative
assumption version, and an explicit application date. Stored money is integer cents. Rate arithmetic
uses 40-digit Decimal precision and half-even rounding only at posting boundaries.

The no-interest baseline divides remaining target cents by the number of contribution occurrences and
rounds upward to a cent. A same-day deadline with a shortfall is impossible. An already-funded goal
requires zero contributions.

Deposit models accrue daily using `(1 + APY)^(1/365) - 1`, after any contribution due that day, and
post at month-end and the target date. Merely crossing the goal amount is not an interest-posting
boundary. Maturity models create lots, compound from each cent-rounded prior maturity, and credit
only complete fixed terms ending no later than the target date. Already-funded fixed-term principal
remains locked until the target boundary, schedules no additional contributions, and still earns
complete modeled maturity postings. A delayed scheduled contribution retains its original due date
as audit context but posts on the actual retry date, so it cannot be backdated across already-processed
interest days. See ADR 0002 for policy decisions.

For the reviewed `validGoalFixture` at 2026-08-23, the exact regression vector is:

| Vehicle         | Required installment | Principal | Posted interest | Ending balance | Completion |
| --------------- | -------------------: | --------: | --------------: | -------------: | ---------- |
| Cash            |               41,667 |   640,000 |               0 |        640,000 | 2027-08-23 |
| HYSA            |               41,667 |   595,000 |          10,443 |        605,443 | 2027-07-23 |
| CD ladder       |               40,849 |   640,000 |          10,359 |        650,359 | 2027-08-23 |
| Treasury ladder |               40,708 |   640,000 |          12,266 |        652,266 | 2027-08-23 |

All monetary values in this table are cents.
