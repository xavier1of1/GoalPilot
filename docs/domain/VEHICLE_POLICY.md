# Vehicle policy

All four models remain visible. Cash is the zero-rate comparator. HYSA is liquid within one modeled
business day. CD and Treasury models are eligible only when the user needs access at the goal date,
the term fits, and the modeled minimum is met.

The fixed-term minimum is an opening-eligibility rule over existing savings plus the first planned
contribution. Later scheduled lots belong to the same simulated ladder and do not each need to meet
the opening minimum. Fixed principal remains unavailable until the goal date; reaching the numeric
target early stops additional contributions but does not create purchase-ready status.

The same zero-interest safe contribution is the primary user commitment for every model. Modeled
interest can add cushion or make purchase readiness earlier, but it never authorizes a smaller
commitment. Any interest-adjusted contribution is an advanced analytical value, not a
recommendation.

Ranking considers models in this exact order:

1. eligible under access, maturity, preservation, and policy rules;
2. purchase-ready by the target date using the safe contribution;
3. satisfies the user's declared access requirement;
4. lower liquidity or lockup conflict;
5. higher modeled target-date cushion;
6. deterministic vehicle code for an exact tie.

Cash remains visible as the baseline. Ineligible models receive no rank and show the exact policy
reason, the conflicting user constraint, and what would need to change. A higher modeled return can
never override access or maturity.

Every assumption has a version, effective and reviewed date, reviewed demo source, and
`isLive=false`. The UI must say “Illustrative rate, not a live offer.” Recovery suggestions may
change contribution, deadline, or target but never escalate product risk.
