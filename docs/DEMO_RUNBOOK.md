# GoalPilot local demo runbook

**Status — 2026-08-24:** the PX07/PX10 implementation is present, but the corrected frozen-tree
automated release procedure is **pending**. Final command evidence belongs in
[LOCAL_PRODUCT_RELEASE.md](LOCAL_PRODUCT_RELEASE.md). Human validation remains open; this runbook is
not a claim that any participant session occurred.

## Safety boundary

The demonstration uses synthetic users, illustrative rates, deterministic price fixtures, local
PostgreSQL, and a controlled per-user application date. It opens no account, moves no money, calls
no retailer or financial API, and never changes the operating-system clock. Demo mutation and reset
must bind to loopback and reject users not explicitly marked as seeded fixtures.

Use repository-pinned tooling on every host:

```bash
corepack pnpm <command>
```

## Prepare

1. Start Docker Desktop.
2. Confirm `.env.local` points to the intended loopback development database.
3. Run:

```bash
corepack pnpm run setup
corepack pnpm run doctor
corepack pnpm demo:reset
corepack pnpm demo:local
```

`demo:reset` is intentionally destructive only to explicitly marked seeded fixtures. It must refuse
a non-loopback database, a non-demo mode, or an unmarked user and must preserve all non-fixture
records. `demo:local` must use production-built artifacts where practical and display persistent
simulation/demo disclosures.

The release target binds its production-built API/web previews to loopback ports 3200/5373 by
default. Stop it with the owning terminal when the guided story is complete. For a self-terminating
pre-session proof, use `corepack pnpm local:smoke` instead.

## Primary story: Japan trip (18-month horizon)

1. Sign in with the documented synthetic demo credential.
2. Open **Japan trip**.
3. Explain the safe contribution first: it reaches the target from planned personal savings without
   relying on modeled interest.
4. Show that the initial affordable amount is slightly lower and produces a visible shortfall.
5. Compare the illustrated fit with cash and the other models. Open one fixed-term rejection or
   subordinate rationale and its access/maturity consequence.
6. Activate or open the **Simulated Goal Plan**. Read the disclosure: no real account, no money
   movement, simulated activity, illustrative rates, fixed assumption version.
7. Use **Advance to next contribution** and inspect the run summary, current date, next event,
   activity, principal/interest split, and health.
8. Advance to the deterministic missed contribution. Confirm the product explains the failure and
   moves to `ATTENTION_NEEDED` without exposing an internal error.
9. Open Recovery Planner. Preview one bounded option, compare before/after, apply it, and open plan
   history to show both immutable versions.
10. Use **Advance six months**, then **Advance to next maturity** where applicable. Explain total
    funded value versus accessible purchase-ready funds.
11. Use **Advance to target date**, then distinguish purchase-ready, completed, and archived
    lifecycle behavior.

The consumer interface permits only next contribution, one month, six months, next maturity, target
date, and reset. It never exposes arbitrary-date mutation.

## Purchase Timing Lab story

1. Open **GoalPilot Plus: Purchase Timing Lab** for the synthetic 65-inch OLED television.
2. Point out the historical demo-data and no-prediction disclosures.
3. Compare current demo price, target price, historical min/median/max, empirical percentile,
   count/span/freshness, and the accessible text table.
4. Run the due price check through the UI or:

```bash
corepack pnpm price-watch:run
```

5. Explain the deterministic historical state separately from plan readiness. A favorable price
   must still say not ready when the plan is paused, short, or funded but locked.
6. Replay the same application date and confirm no duplicate observation or assessment.

## Product-event inspection

After a demonstration, run:

```bash
corepack pnpm product-events:summary
```

Only aggregate allowlisted event counts and funnel progression may appear. No amounts, entered
names, notes, emails, URLs, account/session/CSRF identifiers, or arbitrary metadata may be present.
Instrumentation is not evidence that user validation occurred.

## Expected explanations

- **Failed contribution:** simulated event did not post; principal and availability did not change.
- **Paused:** contributions stop while vehicle-policy interest/maturity behavior remains explicit.
- **Replay/already processed:** the same logical event was safely ignored.
- **Locked:** total modeled value may meet the target while funds remain unavailable.
- **No event due:** date changed but no eligible financial event occurred.
- **Retry:** the occurrence retains audit provenance and posts on the actual processing date.

## Recovery and reset

If a step fails, retain the visible request/error state, use the section retry, and never improvise a
database edit. After at most three automatic attempts, the UI must show “Needs attention,” attempt
count, last safe event, and a manual action. Mutations are not blindly retried; manual retry reuses
the same idempotency key.

To restore only the seeded story:

```bash
corepack pnpm demo:reset
```

Then rerun the story from step 1. Do not use `db:reset` to repair an ordinary demo failure.

## Release-gate proof

Before a formal demo or user session, the recorded release must show passing results for:

```bash
corepack pnpm verify
PLAYWRIGHT_CHANNEL=chrome corepack pnpm test:e2e
corepack pnpm local:smoke
```

Also record which browser/channel, release mode, feature flags, seed version, application version,
and commit were actually used. Never describe an unexecuted command or human session as passed.

The corrected frozen tree has not yet completed this release-gate record. Before a formal demo,
`LOCAL_PRODUCT_RELEASE.md` must contain the exact source checkpoint and current results for the
canonical verify gate, installed-Chrome Journeys A–E, production-built demo smoke and local-mode
probe, setup/doctor, and the Dev Container image/non-root runtime probe. Earlier results are
historical only and do not replace either this revalidation or the still-open human-validation study.
