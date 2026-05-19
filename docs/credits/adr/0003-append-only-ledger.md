# ADR-0003: Append-Only Credit Ledger

**Status:** Accepted
**Date:** 2026-05-19
**Author:** Narayana Chavva
**Applies to:** `credit_ledger` table; all services that write ledger entries (ENG-10, ENG-15, ENG-19, ENG-20)

---

## Context

`credit_ledger` is the financial source of truth for the Credits Platform. Every credit movement — grants, reservations, debits, adjustments, expirations — is recorded here. The wallet (`credit_wallets`) is a derived mutable cache that summarises the ledger for fast reads, but it is not trusted for auditability.

Two approaches exist for handling corrections to ledger entries:

| Approach | How corrections work | Auditability |
|---|---|---|
| Mutable ledger | UPDATE the incorrect row in-place | Impossible — prior state is gone; no audit trail |
| **Append-only ledger** | INSERT a new `adjustment` entry referencing the original | Full trail — every state is reconstructable |

SOC 2 Type I (ENG-35) requires demonstrable immutability of financial records. An auditor must be able to verify that no row in `credit_ledger` was silently altered after the fact. This is only possible with an append-only design enforced at the database layer — application-level discipline is insufficient.

The wallet is intentionally a derived view: the daily reconciliation job (ENG-20) recomputes expected wallet balances from the ledger and pages on-call if they diverge. This means a corrupt or miscalculated wallet can always be corrected by replaying the ledger — the ledger is never dependent on the wallet.

---

## Decision

**`credit_ledger` is append-only. `UPDATE` and `DELETE` are blocked by database-level triggers.**

The triggers are defined in ENG-4:

```sql
CREATE TRIGGER trg_ledger_no_update
  BEFORE UPDATE ON credit_ledger
  FOR EACH ROW EXECUTE FUNCTION ledger_immutable();

CREATE TRIGGER trg_ledger_no_delete
  BEFORE DELETE ON credit_ledger
  FOR EACH ROW EXECUTE FUNCTION ledger_immutable();
```

Corrections are made exclusively by inserting new entries:
- `adjustment` entries carry `related_entry_id` (FK to the original entry) and a non-empty `reason` field.
- `reversal` entries (admin-initiated, requires `credits.reverse` permission) also carry `related_entry_id`.

No application code path, migration script, or admin tool may issue `UPDATE` or `DELETE` against `credit_ledger`. The trigger is the enforcement boundary — not code review, not convention.

---

## Consequences

**Enables:**
- Complete, tamper-evident audit trail. Every credit state transition is recorded. Finance, auditors, and customers (via future reporting) can trace any balance back to its origin entries.
- Wallet recomputation from scratch: if a wallet balance is ever suspect, the reconciliation job can replay all ledger entries for a tenant and produce a ground-truth balance.
- SOC 2 control: ENG-35's automated test verifies that `UPDATE` and `DELETE` raise exceptions. This becomes a permanent CI gate.
- Billing dispute resolution: any historical `rating_decision` can be verified against its corresponding ledger entries without risk that the entries were altered.

**Forecloses:**
- "Fix the ledger row directly" as an operational shortcut. Any on-call runbook that suggests `UPDATE credit_ledger SET ...` is invalid by design. Runbooks must use the adjustment entry path.
- Soft-delete patterns on ledger rows. Cancelled or reversed entries remain visible in the ledger with their reversal entries; they are never hidden.

**Wallet vs ledger reconciliation:** The wallet is wrong sometimes (optimistic lock conflicts, network errors). The ledger is never wrong. Always trust the ledger.
