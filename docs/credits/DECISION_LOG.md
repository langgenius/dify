# Nexoraa Credits Platform — Open Decisions Log

**Owner:** Narayana Chavva
**Source:** Engineering Specification v2.0 (2026-05-14), Section 12
**Last updated:** 2026-05-19
**Rule:** Decisions not resolved at Monday sync (May 19) are locked to their recommended default. Engineering proceeds; later changes require spec amendment.

---

## Status Key

| Symbol | Meaning |
|---|---|
| ✅ DECIDED | Locked. Changing requires spec amendment + impact assessment. |
| ⚠️ DEFAULTED | Monday sync passed without explicit decision; recommended default is now the locked value. |
| 🔴 OPEN | Not yet resolved. Only valid before Monday sync closes. |
| 🔵 DEFERRED | Not required for Phase 1; revisit before the phase that needs it. |

---

## Critical — Must Be Resolved Before Week 1 Ends (May 27)

These three decisions affect the Rating Engine golden test fixtures and contract templates. Engineering cannot finalise ENG-14 fixture files without them.

---

### Decision #1 — Customer-Facing Pricing Exposure

**Owner:** Product + Sales
**Status:** ⚠️ DEFAULTED → **Option B: Outcomes on invoice**

**Locked default:**
Customers see platform fee + outcome counts + overage rate. Credits are internal only. The customer-facing invoice never shows credit amounts.

```
Monthly platform fee:    $25,000
Outcomes included:       100 deal packages
Overage rate:            $250 per additional deal package
Hard cap:                150 deal packages / month
```

**Engineering impact:**
- Billing Adapter (ENG-33) maps `rating_decisions.rated_credits` → outcome count via `credits_per_outcome` from the subscription's rating rule.
- Customer dashboard (ENG-32) displays outcome counts and dollar amounts — never raw credit totals.
- Internal admin dashboard (ENG-25) shows credits; customer dashboard never does.

**Decision:** *(fill in if explicitly overridden at sync)*
**Date:** *(fill in)*

---

### Decision #6 — Failure-Charging Default Per Workflow Class

**Owner:** Product
**Status:** ⚠️ DEFAULTED → **Charge steps completed; free retry within 60s**

**Locked default:**
- Charge for `usage_events` emitted before failure (steps completed).
- If the same workflow is retried within 60 seconds with the same input hash: full reversal via `adjustment` entries; retry rated normally.
- Failure policy is per-`rating_rule` configuration — not a global switch. Some workflows warrant full charge on failure; others warrant full reversal.

**Engineering impact:**
- ENG-14 golden fixtures must include a `partial_failure_workflow.json` scenario.
- ENG-30 implements the 60-second window check using `workflow_run.started_at` and the input hash.
- Settlement service (ENG-15) receives `workflow_status` from the finalize call.

**Decision:** *(fill in if explicitly overridden at sync)*
**Date:** *(fill in)*

---

### Decision #14 — Margin Warning Threshold Per Workflow Class

**Owner:** Finance + Product
**Status:** ⚠️ DEFAULTED → **`cost_per_credit > $0.0012`**

**Locked default:**
`margin_warning = true` on a `RatingDecision` when `raw_cost_usd / rated_credits > 0.0012`.

In plain English: if Nexoraa is paying more than $1.20 in vendor cost for every $1.00 of credits the customer consumed, the flag fires. Admin dashboard surfaces these; Finance reviews weekly.

**Engineering impact:**
- Step 7 of `rate()` computes this flag (ENG-14).
- ENG-14 golden fixture: `margin_warning_triggered.json` must use this threshold.
- Threshold is a named constant in the rating engine: `MARGIN_WARNING_THRESHOLD_USD_PER_CREDIT = Decimal("0.0012")`. Changing it requires a fixture update.

**Decision:** *(fill in if explicitly overridden at sync)*
**Date:** *(fill in)*

---

## High Priority — Affects Week 1–2 Implementation

---

### Decision #2 — Cost Model Snapshot Date

**Owner:** Product + Finance
**Status:** ⚠️ DEFAULTED → **January 1, 2026 Anthropic/vendor list prices**

**Locked default (cmv_2026_q1 seed values):**
```json
{
  "claude-sonnet-4.6": {
    "input_per_million_usd": 3.00,
    "output_per_million_usd": 15.00,
    "cached_input_per_million_usd": 0.30
  }
}
```
Tool and integration cost placeholders: TBD from open decision #2 sub-items.
`infra_cost_per_run`: see Decision #3.

**Engineering impact:** ENG-5 seeds the `cost_model_versions` table with these exact values.

**Decision:** *(fill in)*
**Date:** *(fill in)*

---

### Decision #3 — Allocated Infrastructure Cost Per Workflow Run

**Owner:** Finance
**Status:** ⚠️ DEFAULTED → **$0.005 per workflow run**

**Locked default:**
```
raw_cost_usd = llm_cost + tool_cost + integration_cost + 0.005
```
Baked into `cost_model_versions.payload`. Finance reviews quarterly and publishes a new version when it changes.

**Decision:** *(fill in)*
**Date:** *(fill in)*

---

### Decision #8 — Per-Run Approval Threshold

**Owner:** Product
**Status:** ⚠️ DEFAULTED → **10% of monthly hard cap**

**Locked default:**
A single run estimated at > 10% of `subscription.hard_cap_credits` is routed to the Approval Service (`allow_with_approval`) by the Entitlement check, regardless of tenant enforcement mode.

Configurable per tenant via `entitlement_overrides`.

**Engineering impact:** ENG-8 (Entitlement Service), check #7 in the seven-check sequence.

**Decision:** *(fill in)*
**Date:** *(fill in)*

---

### Decision #9 — Free-Trial and Proof-of-Concept Handling

**Owner:** Sales + Product
**Status:** ⚠️ DEFAULTED → **Sandbox credits, `billable=false`, no wallet impact**

**Locked default:**
- Time-boxed credit grant (e.g., 500 credits for 30 days).
- Tenant `environment = sandbox`; all events `billable = false`.
- Credits tracked for Nexoraa cost visibility; never touch wallet or generate revenue.
- Trial credits do not carry over to production subscription.

**Engineering impact:**
- ENG-38 (`billable=false` guard) is the enforcement boundary for this.
- ENG-6 event schema: `billable` flag is required on every event.

**Decision:** *(fill in)*
**Date:** *(fill in)*

---

### Decision #13 — Enforcement Mode Ramp Duration for New Tenants

**Owner:** Product + Engineering
**Status:** ⚠️ DEFAULTED → **2 weeks observe_only → 1 week warn_only → enforce_block**

**Locked default:**
```
Weeks 1–2:  observe_only    (metering on; no blocks; verify coverage)
Week 3:     warn_only       (emit warnings; still no blocks)
Week 4+:    enforce_block   (live enforcement)
```
Each transition requires explicit go/no-go written to `audit_log`. CloudWatch alarm fires if any tenant remains in `observe_only` after 14 days.

**Engineering impact:** ENG-13 (enforcement modes), ENG-29 (ramp orchestration).

**Decision:** *(fill in)*
**Date:** *(fill in)*

---

## Medium Priority — Can Default; Review Before Phase 2

---

### Decision #4 — Rollover Policy Default for New Contracts

**Owner:** Product
**Status:** ⚠️ DEFAULTED → **`expire`**

Unused `included_credits` expire at period end unless a customer's contract explicitly negotiates rollover. Recognised as breakage revenue (see Decision #5).

**Engineering impact:** ENG-40 (rollover policy engine).

---

### Decision #5 — Breakage Revenue Policy

**Owner:** Finance
**Status:** ⚠️ DEFAULTED → **Recognise on expiry date**

When prepaid credits expire unused, revenue is recognised on the expiry date. Reported as a separate `breakage` line in the monthly Finance reconciliation report.

Per ASC 606: conservative, auditor-friendly. Requires `revenue_recognition_status = breakage` on `expiry` ledger entries.

**Engineering impact:** ENG-41 (ASC 606 revenue recognition flags).

---

### Decision #7 — Tenant Suspension Grace Period on Non-Payment

**Owner:** Finance + Legal
**Status:** ⚠️ DEFAULTED

```
Day 0:   Invoice issued
Net 30:  Reminder email sent
Net 45:  Account suspended (workflows blocked; data preserved)
Net 90:  Account closure initiated (data retention per contract)
```

In-flight workflows at suspension time complete normally. New runs are blocked at the Execution Gateway within 30 seconds (Entitlement cache TTL).

**Engineering impact:** ENG-33 (Stripe Billing Adapter webhook handling).

---

### Decision #12 — Promo Credit Policy

**Owner:** Finance + CX
**Status:** ⚠️ DEFAULTED

- CSM role: up to $5,000 / tenant / quarter via `ledger.adjust` permission, no approval required.
- Above $5,000: requires `approval_request` with Finance approval.
- All promo issuances logged in `audit_log` with `X-Reason` header.
- Promo credits: `revenue_recognition_status = none` (balance sheet neutral).

**Engineering impact:** ENG-22 (admin endpoints), ENG-41 (ASC 606 flags).

---

## Low Priority / Deferred

---

### Decision #10 — Customer Right-to-Be-Forgotten

**Owner:** Legal + Security
**Status:** 🔵 DEFERRED → Phase 2

Redact `tenant_name` and `billing_email` on GDPR Article 17 / CCPA request. All other financial records retained with `tenant_id` as the only identifier. Implement after Phase 1.

---

### Decision #11 — Billing Provider for Phase 3

**Owner:** Finance
**Status:** 🔵 DEFERRED → Phase 3 (not blocking Week 1)

**Recommended default: Stripe** — with Stripe Tax and Stripe Checkout for self-serve top-up purchases.

**Engineering impact:** ENG-33 (Stripe Billing Adapter).

---

## Decision Summary

| # | Decision | Owner | Default | Status |
|---|---|---|---|---|
| 1 | Customer pricing exposure | Product + Sales | Option B: Outcomes | ⚠️ DEFAULTED |
| 2 | Cost model snapshot date | Product + Finance | Jan 1, 2026 prices | ⚠️ DEFAULTED |
| 3 | Infra cost per run | Finance | $0.005 | ⚠️ DEFAULTED |
| 4 | Rollover policy default | Product | `expire` | ⚠️ DEFAULTED |
| 5 | Breakage revenue policy | Finance | Recognise on expiry | ⚠️ DEFAULTED |
| 6 | Failure-charging default | Product | Charge steps completed; 60s free retry | ⚠️ DEFAULTED |
| 7 | Suspension grace period | Finance + Legal | Net 30/45/90 | ⚠️ DEFAULTED |
| 8 | Per-run approval threshold | Product | 10% of monthly hard cap | ⚠️ DEFAULTED |
| 9 | Trial / PoC handling | Sales + Product | Sandbox credits, `billable=false` | ⚠️ DEFAULTED |
| 10 | Right-to-be-forgotten | Legal + Security | Redact PII; Phase 2 | 🔵 DEFERRED |
| 11 | Billing provider (Phase 3) | Finance | Stripe | 🔵 DEFERRED |
| 12 | Promo credit policy | Finance + CX | CSM up to $5K/tenant/quarter | ⚠️ DEFAULTED |
| 13 | Enforcement ramp duration | Product + Eng | 2w observe → 1w warn → enforce | ⚠️ DEFAULTED |
| 14 | Margin warning threshold | Finance + Product | `cost_per_credit > $0.0012` | ⚠️ DEFAULTED |

---

*Generated from Engineering Specification v2.0 (2026-05-14). Locked defaults applied 2026-05-19.*
*To amend a DECIDED or DEFAULTED entry: open a PR updating this file with the new value, tag Finance and Product owners for review, and update any affected golden test fixtures.*
