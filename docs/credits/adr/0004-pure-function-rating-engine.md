# ADR-0004: Pure-Function Rating Engine

**Status:** Accepted
**Date:** 2026-05-19
**Author:** Narayana Chavva
**Applies to:** `rate()` function (ENG-14); settlement service (ENG-15); golden test fixtures in `tests/rating/fixtures/`

---

## Context

The rating engine computes how many credits to charge for a completed workflow run. It is the most financially sensitive code in the platform: every billing dispute, every margin warning, and every invoice line item traces back to `rate()`.

Two implementation approaches:

| Approach | How it works | Testability | Reproducibility |
|---|---|---|---|
| Stateful / DB-reading | `rate()` reads current cost model from DB, calls clock for timestamps | Hard — requires DB fixture setup per test; non-deterministic over time | Impossible — re-running against a historical run may produce different results if cost model has changed |
| **Pure function** | All inputs passed explicitly; zero side effects | Trivial — golden JSON fixtures; no mocks needed | Guaranteed — same inputs always produce identical output |

Billing disputes require being able to reproduce the exact rating result for any historical run. If `rate()` reads the current cost model from the database, re-running it a month later (after a cost model update) will produce a different result — making dispute resolution impossible without restoring DB state.

The settlement service (ENG-15) is triggered by `workflow.completed` events and is responsible for loading all inputs from the database before calling `rate()`. The rating engine itself sees no I/O boundary.

---

## Decision

**`rate(events, rating_rule, cost_model, overrides, catalog_snapshot) → RatingDecision` is a stateless pure function.**

Invariants enforced in code review and CI:

1. **Zero database reads inside `rate()`** — all data is passed as arguments
2. **Zero network calls inside `rate()`** — no external service calls
3. **Zero clock reads inside `rate()`** — `occurred_at` comes from event payloads; `rated_at` is set by the caller after `rate()` returns
4. **No randomness** — same inputs always produce identical output
5. **`RatingDecision` is not persisted by `rate()`** — the settlement service persists it after the function returns

The `catalog_snapshot` passed to `rate()` is the frozen JSON captured at reservation time (ENG-18) — not a live lookup. Cost model data comes from the `cost_model_version` row loaded by the settlement service before the call.

Golden test fixtures in `tests/rating/fixtures/` are JSON files with exact input/output pairs. CI asserts byte-for-byte equality. Any change to `rate()` that alters existing fixture output is a breaking change requiring explicit fixture update and Finance sign-off.

**Minimum required fixtures (ENG-14):**
- `fixed_rate_workflow.json`
- `per_unit_workflow.json`
- `discount_override.json`
- `margin_warning_triggered.json`
- `zero_event_cancelled_workflow.json`

---

## Consequences

**Enables:**
- Golden test fixtures with exact equality assertions — no mocking, no DB setup, runs in milliseconds.
- Historical dispute reproduction: load the original `usage_events`, `rating_rule`, `cost_model`, `overrides`, and `catalog_snapshot` from the DB and call `rate()` — you get the exact original result regardless of when you run it.
- Parallel test execution: pure functions have no shared state; all rating tests can run concurrently.
- Future pricing model additions (Phase 2: `hybrid`, `value_based`) are self-contained — each model is a new pure dispatch branch with its own fixture set.

**Forecloses:**
- "Look up current pricing inside `rate()`" — pricing is always the snapshot passed by the caller. A live lookup would make the function non-deterministic and break historical reproduction.
- Time-based pricing logic inside `rate()` (e.g., "charge more on weekdays") — if time-sensitivity is ever needed, it must be computed by the caller and passed as an explicit input field, not read from a clock inside the function.
- Using `rate()` as an entrypoint for DB writes — the function returns a value; all persistence is the caller's responsibility.

**Caller contract (settlement service, ENG-15):**
1. Load all inputs from DB
2. Call `rate(events, rating_rule, cost_model, overrides, catalog_snapshot)`
3. Persist the returned `RatingDecision`
4. Write ledger entries in a single transaction
The settlement service owns the I/O; `rate()` owns the math.
