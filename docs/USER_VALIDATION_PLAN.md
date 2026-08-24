# GoalPilot local user-validation plan

**Status:** approved plan; no validation sessions or results are claimed by this document.

## Objective

Test whether representative users can understand the safe contribution, distinguish personal
savings from modeled interest, select an access-compatible simulated plan, recognize plan health,
recover from a missed contribution, and interpret historical demo-price context without mistaking
it for a prediction or purchase instruction.

## Participants and ethics

Recruit 3–5 adults who resemble the primary product audience and are not part of the implementation
team. Participation is voluntary. Use only synthetic demo data and tell participants not to enter
real financial, identity, account, or purchase information. Collect no credentials, bank details,
recordings, or identifying notes without separate explicit consent and an approved retention plan.

This is product-usability research, not financial guidance. Do not ask participants to act on a real
purchase or disclose sensitive finances.

## Environment

Use the exact verified commit in `demo:local` mode, an explicitly reset seeded fixture, stable Chrome
or the recorded supported browser, and the local loopback URL. Record application/fixture/policy
versions and feature flags. Confirm `local:smoke` immediately before the first session and after any
environment change.

## Session protocol

Use neutral prompts and do not teach the interface unless the participant is blocked.

1. “You want to save for a Japan trip in about 18 months. Show me what GoalPilot says you need.”
2. “Assume the first amount is a little more than you can afford. What does the plan now mean?”
3. “Choose a simulated approach that fits when you might need the money. Explain your choice.”
4. “Tell me which amount comes from you and which amount is modeled.”
5. “A contribution was missed. Explain the plan status and try one recovery.”
6. “Show me what changed and whether the old plan still exists.”
7. “Advance the story and explain funded-but-locked versus purchase-ready.”
8. “Look at the Purchase Timing Lab. What can and cannot be concluded from this screen?”
9. “Find completed/archived work and return to the active plan.”

After each task, ask the participant to describe the result in their own words. Do not correct them
until their interpretation has been captured.

Post-task questions are: “What did you expect?”, “What was most confusing?”, “What would you do
next?”, “Which amount or status would you trust, and why?”, and “What, if anything, does GoalPilot
say will happen in the future?”

## Measures

Record task completion without help, completion with one prompt, or blocked; time on task; observed
navigation/errors; confidence on a 1–5 scale; and short verbatim feedback only with consent. Mark
the following comprehension checks true/false/unclear:

- safe contribution does not depend on modeled interest;
- illustrative interest is not guaranteed;
- Simulated Goal Plan is not a real account and moves no money;
- locked total value is not purchase-ready cash;
- What-If preview does not change the plan until apply;
- an applied change preserves old plan history;
- historically favorable is descriptive, not predictive;
- favorable price does not override financial readiness.

## Safety stop conditions

Stop and clarify immediately if a participant attempts to enter real credentials/account data,
believes real money moved, treats a fixture rate/price as live, interprets the product as a buy/debt
recommendation, or encounters a privacy/security defect. Do not continue merely to finish a script.

## Analysis and decision rules

Aggregate task counts and comprehension outcomes without amounts or identifying content. Classify
issues by severity:

- **Critical:** real-money/live-data misunderstanding, ownership/privacy/security failure.
- **High:** safe amount, readiness, lock, or historical/non-predictive meaning is misunderstood.
- **Medium:** primary flow requires help, important error recovery fails, or history is unclear.
- **Low:** copy, polish, or non-blocking navigation friction.

Any critical/high issue blocks the product-experience gate until corrected and retested. Medium
issues require a disposition and targeted regression/user follow-up. Automated product events may
inform funnel counts but never substitute for observed sessions.

The study is successful only if every participant understands the no-money/no-account boundary, at
least 80% complete the baseline/plan and disruption/recovery tasks with no more than one neutral
prompt, at least 80% correctly distinguish safe contribution from modeled interest and locked from
ready, and every participant describes Timing Lab history as non-predictive. These are study decision
rules, not results.

## Artifacts and reporting

Create one copy of `USER_VALIDATION_RESULTS_TEMPLATE.md` per study round. Store only the minimum
consented, de-identified evidence. Record the exact commit and mode. Separate observation from
interpretation, link product changes to findings, and never convert a plan or blank template into a
claim that validation passed.
