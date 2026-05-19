# ENG-1: Architecture Sign-off — Metering & Credit Foundation

**Date:** 2026-05-19
**Author:** Narayana Chavva
**Linear issue:** ENG-1 (Pre-work, blocks ENG-4/5/6/7)
**Status:** Approved — ready for implementation planning

---

## What This Delivers

ENG-1 is the pre-work architecture sign-off that unlocks Week 1 implementation. It produces three artefacts committed to the repo:

1. **Four Architecture Decision Records** (`docs/credits/adr/`) — the technical invariants that every engineer must respect when writing Credits Platform code
2. **Open Decisions Log** (`docs/credits/DECISION_LOG.md`) — all 14 business/product decisions from Engineering Spec v2.0, with locked defaults
3. **Infrastructure Checklist** (`docs/credits/INFRA_CHECKLIST.md`) — AWS resource names and settings that downstream tickets hardcode

---

## Design Decisions Made Here

### Document Structure: Approach B (MADR + credits namespace)

All Credits Platform architecture documentation lives under `docs/credits/`. ADRs follow MADR format (Status / Context / Decision / Consequences) as individually numbered files. This gives:
- Git-diffable, independently-versioned decisions
- Linkable from code comments (e.g. `// See docs/credits/adr/0003-append-only-ledger.md`)
- Clean separation between technical ADRs (owned by Engineering) and the business decisions log (owned by Product/Finance)

Rejected alternatives:
- **Single document**: all knowledge in one place, but ADRs buried and not individually referenceable
- **Flat `docs/credits/` without ADR subfolder**: no room to grow as Phases 2–3 add more architectural decisions

### The Four ADRs

| ADR | Decision | Key constraint |
|---|---|---|
| 0001 | UUID v7 for all PKs | Application-layer generation; time-ordered for insert locality |
| 0002 | `NUMERIC(18,6)` for money, `BIGINT` for credits | Never mix types; no floats anywhere in monetary arithmetic |
| 0003 | Append-only ledger | DB-level triggers block UPDATE/DELETE; corrections via adjustment entries only |
| 0004 | Pure-function rating engine | Zero I/O inside `rate()`; same inputs always produce identical output |

### The 14 Open Decisions

All 14 decisions from Engineering Spec v2.0 default to recommended values as of Monday sync (May 19, 2026). The three critical decisions affecting Week 1 are:

- **#1** (pricing exposure) → Option B: outcomes on invoice, credits internal only
- **#6** (failure-charging) → charge steps completed; 60-second free retry window
- **#14** (margin warning) → `cost_per_credit > $0.0012`

Decisions #10 (right-to-be-forgotten) and #11 (billing provider) are deferred to Phases 2–3.

### Infrastructure

AWS infrastructure names are placeholders in `docs/credits/INFRA_CHECKLIST.md`. The checklist must be fully completed and signed off by Engineering Lead + Infrastructure before ENG-4 migrations are written. Primary region is confirmed as `ap-south-1` from existing CI configuration.

---

## What This Unblocks

Once ENG-1 is merged:
- **ENG-4** (core DB tables): schema conventions confirmed — UUID v7 PKs, `NUMERIC(18,6)` money, append-only ledger triggers, RLS pattern
- **ENG-5** (`cost_model_versions`): seed data prices confirmed from Decision #2/#3
- **ENG-6** (usage event schema): `billable` flag semantics confirmed from Decision #9
- **ENG-7** (tenant/subscription service): enforcement mode transitions confirmed from Decision #13

---

## Files Created

```
docs/
  credits/
    adr/
      0001-uuid-v7-primary-keys.md
      0002-numeric-18-6-monetary-fields.md
      0003-append-only-ledger.md
      0004-pure-function-rating-engine.md
    DECISION_LOG.md
    INFRA_CHECKLIST.md
  superpowers/specs/
    2026-05-19-metering-credit-foundation-design.md  ← this file
```
