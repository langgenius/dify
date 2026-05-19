# ADR-0002: NUMERIC(18,6) for Monetary Fields, BIGINT for Credit Quantities

**Status:** Accepted
**Date:** 2026-05-19
**Author:** Narayana Chavva
**Applies to:** All monetary (`_usd`, `_cost`, `_price`, `_amount`) and credit quantity columns

---

## Context

The Credits Platform handles two distinct numeric domains:

1. **Monetary values** (USD): vendor costs per token, per-call fees, infrastructure costs, invoice totals. These must be exact — floating-point rounding errors in financial records are unacceptable for ASC 606 revenue recognition and Finance reconciliation.

2. **Credit quantities**: integer units of the Nexoraa internal credit currency. Credits are always whole numbers — there is no such thing as a fractional credit.

IEEE 754 double-precision floats (`FLOAT8` / `DOUBLE PRECISION`) cannot represent most decimal fractions exactly:

```
0.1 + 0.2 = 0.30000000000000004   # float arithmetic
```

A `raw_cost_usd` stored as a float may accumulate rounding errors across the 30-day reconciliation window. When Finance sums `raw_cost_usd` across 10,000 workflow runs, the float error compounds. This will trigger the vendor drift alarm (|drift_pct| > 2%) with false positives.

Individual per-token costs (`$0.0000003` for a cached Claude Sonnet input token) are never stored raw — they would require 7 decimal places and exceed `NUMERIC(18,6)`. Instead, the system stores batch-level totals: `raw_cost_usd` on a usage event represents the cost for all tokens in that LLM call (e.g. 1,000 tokens × $0.0000003 = `$0.000300`, which fits in 6 decimal places). `NUMERIC(18,6)` is sufficient for all stored values in the system.

---

## Decision

**All monetary columns use `NUMERIC(18,6)`.** This gives:
- 12 digits before the decimal point: handles invoice totals up to $999,999,999,999 (no foreseeable tenant will exceed this)
- 6 digits after the decimal point: sufficient for per-call and per-record cost granularity

**All credit quantity columns use `BIGINT`.** Credits are integers; `BIGINT` provides a range of ±9.2 × 10¹⁸, effectively unbounded.

**Type mixing is forbidden.** A monetary column must never be compared against or assigned from a credit column without explicit conversion via the rating rule's `credits_per_usd` rate. This conversion happens only in `rate()` — never in SQL or application arithmetic.

---

## Consequences

**Enables:**
- Exact decimal arithmetic throughout the reconciliation pipeline. `SUM(raw_cost_usd)` across all runs in a billing period is exact — no float accumulation error.
- Clean ASC 606 revenue recognition: `recognized_revenue_usd` computed from ledger entries always matches the sum of individual `rated_credits × contract_rate`.
- Finance can reproduce any invoice total to the cent from the raw `rating_decisions` table.

**Forecloses:**
- `FLOAT` or `DOUBLE PRECISION` for any money column — even "just for estimates." Estimates feed into approval thresholds; rounding errors here could cause incorrect approval routing.
- Storing credit quantities as decimals — credits are a discrete internal unit; fractional credits would require a new pricing model revision, which is a spec amendment, not a code change.

**Column naming convention enforced in code review:**
- `*_usd` → `NUMERIC(18,6)`
- `*_credits` → `BIGINT`
- Any deviation requires an explicit ADR amendment.
