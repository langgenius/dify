# Nexoraa Credits Platform — Execution Checklist

> **Purpose:** Ordered list of every ticket to complete, irrespective of assignee.
> Work top-to-bottom. A ticket can start only when every ticket it depends on is ✅ Done.
> Source of truth for daily stand-up progress and sprint reviews.

---

## Legend

- **Blocks →** tickets that cannot start until this one is done
- **Needs ←** tickets that must be done before this one starts
- **[ ]** checkbox for tracking completion

---

## Pre-Work (Before Week 1)

These three tickets have no code dependencies. They set up the shared working foundation for the whole team.

---

### [ ] ENG-1 — Architecture sign-off + open decisions log

**Needs ←** Nothing. Start here.

**Deliver:**
- Confirm all 14 open decisions from the spec are logged with owners and deadlines
- Decisions #1 (pricing exposure), #6 (failure-charging default), and #14 (margin warning threshold) must be resolved before Week 1 ends — they affect Rating Engine golden tests
- Publish architecture decision record (ADR) for: UUID v7 strategy, NUMERIC(18,6) for money, append-only ledger, pure-function rating engine
- Confirm AWS account, Aurora instance class, EventBridge bus names, S3 bucket naming for the environment

**Blocks →** ENG-4, ENG-5, ENG-6, ENG-7

---

### [ ] ENG-2 — CI/CD pipeline + repo scaffolding

**Needs ←** Nothing. Can run in parallel with ENG-1.

**Deliver:**
- Mono-repo or multi-repo layout decided and scaffolded
- GitHub Actions (or equivalent) pipeline: lint → unit tests → integration tests → build → deploy to staging
- Environment variables sourced from AWS Secrets Manager (never from `.env` committed to repo)
- Branch protection: PRs require passing CI + one reviewer before merge to `main`
- Staging environment accessible and stable

**Blocks →** ENG-4, ENG-6

---

### [ ] ENG-3 — Database migration framework + baseline migration

**Needs ←** ENG-1 (schema conventions agreed)

**Deliver:**
- Migration tool selected and configured (e.g., golang-migrate, Flyway, Alembic)
- Baseline migration `V001__init.sql` creates empty schema with the shared conventions:
  - All PKs are UUID v7
  - All timestamps `TIMESTAMPTZ` stored UTC
  - All monetary fields `NUMERIC(18,6)`
  - All credit fields `BIGINT`
  - Standard audit columns: `created_at`, `updated_at`, `created_by`, `updated_by`, `deleted_at`
- Migration runs cleanly in CI from scratch on every PR
- Rollback path documented for every migration

**Blocks →** ENG-4, ENG-5

---

## Phase 1 — Metering and Credit Foundation (Weeks 1–5)

**Goal:** Meter one enterprise workflow end-to-end. Full ledger correctness. First tenant live in `observe_only` mode.

---

### Week 1 — Schema & Services Foundation

---

### [ ] ENG-4 — Core database tables, RLS, indexes

**Needs ←** ENG-1, ENG-3

**Deliver:**
- Migrations for all core tables: `tenants`, `tenant_subscriptions`, `credit_wallets`, `credit_ledger`, `usage_events`, `rating_decisions`, `workflow_runs`, `approval_requests`, `audit_log`, `reconciliation_runs`
- Row-Level Security enabled on every tenant-scoped table:
  ```sql
  ALTER TABLE credit_wallets ENABLE ROW LEVEL SECURITY;
  CREATE POLICY p_wallets_tenant ON credit_wallets
    USING (tenant_id = current_setting('app.current_tenant_id')::uuid);
  ```
  Apply the same pattern to: `credit_ledger`, `usage_events`, `rating_decisions`, `workflow_runs`, `approval_requests`
- Ledger immutability triggers:
  ```sql
  CREATE TRIGGER trg_ledger_no_update BEFORE UPDATE ON credit_ledger
    FOR EACH ROW EXECUTE FUNCTION ledger_immutable();
  CREATE TRIGGER trg_ledger_no_delete BEFORE DELETE ON credit_ledger
    FOR EACH ROW EXECUTE FUNCTION ledger_immutable();
  ```
- Indexes: composite index on `(tenant_id, billing_period)` for wallets; `(tenant_id, workflow_run_id)` for events; `(tenant_id, occurred_at)` for event time-range scans; `(workflow_run_id)` on ledger for trace lookups
- RLS verified by automated test: query without `app.current_tenant_id` returns zero rows

**Blocks →** ENG-9, ENG-10

---

### [ ] ENG-5 — `cost_model_versions` table + seed data

**Needs ←** ENG-3

**Deliver:**
- `cost_model_versions` table: `cost_model_version` (PK, text), `effective_from` (date), `payload` (JSONB — immutable once published), `published_at`, `published_by`
- Seed migration for `cmv_2026_q1` with real current vendor pricing:
  - Claude Sonnet 4.6: input $3.00/M tokens, output $15.00/M, cached input $0.30/M
  - GPT-4o: input $2.50/M, output $10.00/M
  - Tool and integration cost placeholders as agreed in open decision #2
  - `infra_cost_per_run`: $0.005 (open decision #3 default)
- Published versions are immutable: trigger blocks UPDATE/DELETE on `payload` and `effective_from`
- API endpoint `GET /v1/cost-model-versions` returns all versions ordered by `effective_from` desc

**Blocks →** ENG-14

---

### [ ] ENG-6 — Usage event schema v1.0 + single-event ingest API

**Needs ←** ENG-1, ENG-2

**Deliver:**
- Event envelope schema v1.0 (JSON Schema document checked into repo):
  - Required fields: `event_id` (UUID v7), `schema_version`, `event_type`, `event_type_version`, `tenant_id`, `workflow_run_id`, `workflow_id`, `workflow_version`, `environment`, `billable` (bool), `occurred_at`
  - Payload fields: `tokens_in`, `tokens_out`, `tool_calls`, `records_processed`, `raw_cost_usd`, `cost_model_version`, `vendor`, `model`
- `POST /v1/usage/events` — single event ingest:
  - Validate against schema; reject unknown `event_type` with 400
  - Validate `billable=false` events are stored but flagged — they must never touch wallets
  - Reject any event payload containing PII fields (prompt text, transcripts, record content); validate hashes/references only
  - Duplicate `event_id` returns 200 with the existing record (idempotent)
- Unit tests covering: valid event, duplicate event, missing field, PII field rejected, `billable=false` stored not billed

**Blocks →** ENG-11, ENG-39

---

### [ ] ENG-7 — Tenant service + subscription service

**Needs ←** ENG-1, ENG-4

**Deliver:**
- Tenant service CRUD:
  - `POST /v1/tenants` — create tenant (requires `tenant.cap.update` permission)
  - `PATCH /v1/tenants/{id}` — update name, status, `enforcement_mode`
  - `GET /v1/tenants/{id}` — read
  - Valid `enforcement_mode` transitions: `observe_only → warn_only → approval_required → enforce_block`
- Subscription service:
  - `POST /v1/subscriptions` — create subscription for a tenant; captures full `package_version_snapshot` JSON at signing time
  - `GET /v1/subscriptions/{id}` — read; `package_version_snapshot` is always the contract truth, never the live template
  - Subscription holds: `included_credits`, `hard_cap_credits`, `overage_enabled` (bool), `rollover_policy` (`expire` | `rollover` | `rollover_capped`), `rating_rule_version`, `billing_period_start`
- Every create/update writes an `audit_log` entry with before/after state

**Blocks →** ENG-8, ENG-12, ENG-36

---

### [ ] ENG-8 — Entitlement service + cache

**Needs ←** ENG-7

**Deliver:**
- Entitlement check endpoint: `POST /v1/entitlements/check`
  - Input: `tenant_id`, `user_id`, `workflow_id`, estimated credits
  - Output: `allow` | `allow_with_approval` (+ `approval_id`) | `deny` (+ structured reason code)
  - Seven checks in order: tenant active, user authenticated + mapped to tenant, user role grants access, workflow in allowed list, no active blocks from entitlement overrides, within velocity limits (per-run, per-hour, per-day), estimate below approval threshold
- Per-tenant in-memory cache with 30-second TTL
  - Cache warmed on first check; evicted immediately on EventBridge `tenant.updated` or `entitlement.override.changed` events
- Latency SLO: p99 < 50ms (including cache hit path)
- Unit tests: each of the seven check scenarios; cache invalidation; TTL expiry

**Blocks →** ENG-12

---

### Week 2 — Wallet, Ledger & Execution Gateway

---

### [ ] ENG-9 — Wallet service + optimistic locking

**Needs ←** ENG-4

**Deliver:**
- `credit_wallets` service wrapping the wallet table:
  - `GET /v1/wallets/{tenant_id}/{billing_period}` — read current balances
  - Wallet fields: `included_credits`, `topup_credits`, `promo_credits`, `reserved_credits`, `used_credits`, `overage_credits`, `available_credits` (computed), `hard_cap_credits`, `version` (optimistic lock column)
- Optimistic locking on every write:
  - `SELECT ... FOR UPDATE` within transaction, read `version`
  - Increment `version` on commit
  - On version mismatch: retry up to 3 times with 50ms/100ms/200ms backoff
  - After 3 failures: return 409 Conflict
- Hard cap check is inside the wallet transaction — cannot be bypassed by application logic
- Wallet is NOT the source of truth; daily reconciliation verifies it against the ledger

**Blocks →** ENG-10, ENG-12, ENG-19, ENG-40

---

### [ ] ENG-10 — Ledger service + immutability triggers

**Needs ←** ENG-4, ENG-9

**Deliver:**
- Ledger write endpoint: `POST /v1/ledger/entries` (internal use only; not customer-facing)
  - Entry types: `grant`, `reserve`, `release`, `debit`, `overage`, `adjustment`, `expiry`
  - Required fields: `tenant_id`, `entry_type`, `credits`, `balance_before`, `balance_after`, `idempotency_key`, `workflow_run_id` (nullable for grants/expiry)
  - `debit` entries must carry `rating_decision_id`
  - `adjustment` entries must carry `related_entry_id` and a non-empty `reason`
  - Duplicate `idempotency_key` returns the existing entry (idempotent, never double-posts)
- Confirm immutability triggers from ENG-4 are firing: integration test that attempts UPDATE and DELETE and asserts both raise an exception
- Ledger query endpoint: `GET /v1/ledger?tenant_id=&from=&to=` — paginated, ordered by `created_at`

**Blocks →** ENG-12, ENG-19, ENG-20

---

### [ ] ENG-11 — Batch event ingest + dedup + DLQ

**Needs ←** ENG-6

**Deliver:**
- `POST /v1/usage/events:batch` — accepts up to 1,000 events per request
  - Validates each event individually; partially valid batches: persist valid events, return 207 Multi-Status with per-event result
  - Deduplication by `event_id`: idempotent — duplicate events in same batch silently skipped
  - `billable=false` events stored but never touch wallets (double-checked at ingest and at rating)
  - Invalid events (schema violation, unknown `event_type`, PII detected) written to SQS DLQ with original payload + error reason
- SQS DLQ configured with 14-day retention; CloudWatch alarm triggers at DLQ depth > 0
- Throughput target: 200 events/sec sustained, 1,000 burst; validate in load test (ENG-24)
- Integration test: batch with valid + duplicate + invalid events; assert correct 207 response, assert DLQ received the invalid event

**Blocks →** ENG-16, ENG-21

---

### [ ] ENG-12 — Estimate / Reserve / Finalize APIs + 6-check sequence

**Needs ←** ENG-7, ENG-8, ENG-9, ENG-10

**Deliver:**
- `POST /v1/credits/estimate`:
  - If ≥50 historical runs for this workflow under this rating rule: return (p50_credits, p95_credits × 1.5)
  - If cold start (< 50 runs): return (baseline_credits, baseline_credits × 3.0)
  - Cap max at `hard_cap_credits` minus already-reserved; if exceeded: `can_run=false`, reason `hard_cap_exceeded`
  - Response: `estimated_min_credits`, `estimated_max_credits`, `available_credits`, `can_run`, `requires_approval`, `enforcement_mode`
- `POST /v1/credits/reserve` — atomic, inside a single transaction:
  1. `SELECT ... FOR UPDATE` on wallet
  2. Check `available_credits >= credits_to_reserve`
  3. Check `used + reserved + credits_to_reserve <= hard_cap_credits`
  4. INSERT ledger entry (`entry_type=reserve`, with `idempotency_key`)
  5. UPDATE wallet: `reserved += amount`, `available -= amount`, `version += 1`
  6. INSERT `workflow_runs` row with `catalog_snapshot`
  - On idempotency key collision: return existing ledger entry (safe retry)
  - On 3× optimistic-lock failure: return 409
- `POST /v1/credits/finalize` — triggered after workflow terminal state:
  1. Load usage events for the run (billable=true only)
  2. Load `rating_rule`, `cost_model_version`, `overrides`, `catalog_snapshot` from `workflow_runs`
  3. Call `rate()` pure function → `RatingDecision`
  4. Persist `RatingDecision` to `rating_decisions`
  5. Single transaction: INSERT release entry (full reservation), INSERT debit entry (FK to rating_decision), UPDATE wallet (reserved -= original, used += final, available += released surplus)
  6. UPDATE `workflow_runs.status = completed`, set `rating_decision_id`
  - If final > reserved: draw from `available_credits`; if insufficient: draw from overage if enabled; else flag `overrun_blocked` and page on-call
- Execution Gateway wires all 6 checks in order: AuthN → Entitlement → Estimate → Velocity → Approval → Reserve
- Acceptance criteria: full round-trip test with a fixture workflow (estimate → reserve → emit events → finalize → assert ledger entries + wallet balance)

**Blocks →** ENG-13, ENG-17, ENG-18, ENG-38

---

### [ ] ENG-13 — Enforcement modes (4 modes)

**Needs ←** ENG-12

**Deliver:**
- All 4 enforcement modes applied consistently at every check in the Gateway:
  - `observe_only`: log failure, allow run, no customer-visible effect
  - `warn_only`: log failure, allow run, emit warning to tenant notification channel
  - `approval_required`: log failure, create `approval_request`, block run until approved/denied/timed-out
  - `enforce_block`: log failure, return 422 to caller, do not start workflow
- AuthN check always behaves as `enforce_block` regardless of tenant mode
- `PATCH /v1/admin/tenants/{id}/enforcement-mode` requires `tenant.cap.update` permission; writes `audit_log` entry
- Unit tests for each mode against each of the 5 non-AuthN checks (25 scenarios)

**Blocks →** ENG-29

---

### Week 3 — Rating Engine & Approval

---

### [ ] ENG-14 — Rating Engine pure function

**Needs ←** ENG-5

**Deliver:**
- Implement `rate(events, rating_rule, cost_model, overrides, catalog_snapshot) → RatingDecision` as a stateless pure function:
  - Zero database reads inside the function
  - Zero network calls inside the function
  - Zero clock reads (`occurred_at` comes from event payload)
  - Same inputs must always produce identical output — no randomness
- Phase 1 pricing models:
  - `fixed`: flat credits per workflow run
  - `per_unit`: base credits + credits per unit (records, documents, etc.)
- Rating algorithm steps:
  1. Filter events to `billable=true` (defense-in-depth; ingest already filtered)
  2. Group events by `event_type`
  3. Dispatch to pricing model
  4. Compute `raw_cost_usd` breakdown using cost model rates
  5. Compute `rated_credits` using rating rule logic
  6. Apply overrides (discounts, surcharges)
  7. Compute `margin_warning` flag: `cost_per_credit > 0.0012` (open decision #14 default)
  8. Return `RatingDecision` (NOT persisted by this function)
- Golden test fixtures stored in `tests/rating/fixtures/` — exact equality assertions, one JSON file per scenario
- Minimum fixtures required: fixed-rate workflow, per-unit workflow, discount override, margin warning triggered, zero-event run (cancelled workflow)

**Blocks →** ENG-15

---

### [ ] ENG-15 — `rating_decisions` persistence + settlement service

**Needs ←** ENG-14

**Deliver:**
- Settlement service orchestrates the post-completion path:
  1. Triggered by `workflow.completed` EventBridge event
  2. Load usage events for `workflow_run_id`
  3. Load `rating_rule`, `cost_model`, `overrides`, `catalog_snapshot` from `workflow_runs`
  4. Call `rate()` — receive `RatingDecision` in memory
  5. INSERT `rating_decisions` row: `workflow_run_id`, `rating_rule_version`, `cost_model_version`, `rated_credits`, `raw_cost_usd`, `margin_warning`, `catalog_snapshot` (frozen JSON), `breakdown` (JSONB)
  6. Invoke ledger finalization (release + debit entries in single transaction)
- `rating_decisions.catalog_snapshot` stores the frozen JSON — no foreign keys to upstream Studio catalogs
- SLO: p99 < 30 seconds from `workflow.completed` event to ledger debit entry committed
- Emit `workflow.rated` on EventBridge on completion
- On failure: write to DLQ; do not leave reservation open; Reaper handles TTL expiry

**Blocks →** ENG-20, ENG-23, ENG-41

---

### [ ] ENG-16 — Nexoraa Studio instrumentation + LLM call wrapping

**Needs ←** ENG-11

**Deliver:**
- Instrument the Nexoraa Studio (Dify fork) runtime to emit usage events:
  - Lifecycle hooks: `workflow.started`, `workflow.completed`, `workflow.failed`
  - LLM call wrapper: emit `llm.call.completed` event after every model inference with `tokens_in`, `tokens_out`, `model`, `vendor`, `raw_cost_usd` (computed using current `cost_model_version`), `cost_model_version`
  - `workflow_run_id` is the trace key set at workflow start and threaded through all events
- Events emitted via `POST /v1/usage/events:batch` at workflow terminal state (not per-call — batch at end)
- `billable` flag set by environment: `production=true`, `sandbox=false`, `internal_test=false`
- PII must NOT appear in event payload: prompts and transcripts stay in the workflow runtime; credits platform receives token counts, hashes, and references only

**Blocks →** ENG-21

---

### [ ] ENG-17 — Approval service state machine

**Needs ←** ENG-12, ENG-18

**Deliver:**
- `approval_requests` table with status machine: `requested → pending → approved | denied | timed_out → closed`
- `POST /v1/approvals` — create approval request (called by Gateway):
  - Required fields: `tenant_id`, `workflow_run_id`, `request_type` (`run_approval` | `overage_approval` | `adjustment_approval` | `rule_publication`), `requestor_id`, `reason`, `estimated_credits`
  - TTL: 30 minutes for run-level; 4 hours for billing-level
  - Emit `approval.requested` on EventBridge
- `POST /v1/approvals/{id}/decide` — requires `approval.decide` permission:
  - Sets status to `approved` or `denied`; writes `audit_log` entry with `reason` and `decided_by`
  - Emit `approval.decided` on EventBridge
- Background job processes TTL expiry: sets `timed_out`, treats as denied, emits `approval.timed_out`
- Unit tests: all state transitions; timeout expiry; missing permission returns 403

**Blocks →** ENG-22

---

### [ ] ENG-18 — Catalog snapshot capture + RBAC foundation

**Needs ←** ENG-12

**Deliver:**
- Catalog snapshot captured at reservation time:
  - At `POST /v1/credits/reserve`, the Gateway reads from Studio's workflow/agent/tool catalog and captures:
    ```json
    {
      "snapshot_version": "1.0",
      "workflow": { "id": "...", "version": "..." },
      "agents": [ { "id": "...", "version": "...", "default_model": "..." } ],
      "tools": [ { "id": "...", "version": "...", "provider": "..." } ],
      "cost_model_version": "cmv_2026_q1"
    }
    ```
  - Stored in `workflow_runs.catalog_snapshot` (JSONB); never updated after capture
- Financial RBAC framework:
  - Six named permissions defined as constants in code: `rating_rule.publish`, `ledger.adjust`, `credits.reverse`, `tenant.cap.update`, `approval.decide`, `billing.export`
  - Middleware reads `X-Actor-Permissions` from the mTLS-verified service token and enforces on every gated endpoint
  - Missing permission: 403 with `{ "error": "permission_required", "required_permission": "..." }`
  - No generic admin override; every money-touching endpoint requires a specific named permission
  - V1 role grants: `nexoraa_engineer` → none; `nexoraa_finance` → `billing.export`; `nexoraa_csm` → `ledger.adjust` (≤$5k/quarter), `approval.decide`; `nexoraa_admin` → all six

**Blocks →** ENG-21, ENG-22, ENG-17

---

### Week 4 — Reaper, Reconciliation & Admin

---

### [ ] ENG-19 — Reaper job (orphaned reservations)

**Needs ←** ENG-9, ENG-10

**Deliver:**
- Scheduled job running every 5 minutes:
  - Query: `workflow_runs WHERE status IN ('pending', 'running') AND reservation_expires_at < NOW()`
  - For each orphaned run:
    1. UPDATE `workflow_runs.status = reaped`
    2. INSERT release ledger entry for full reservation
    3. Decrement `wallet.reserved_credits`, increment `wallet.available_credits`
    4. Emit `reaper.released` on EventBridge with `workflow_run_id`, `credits_released`, `tenant_id`
- Reaper only releases reservations — it never debits credits
- Default TTL at reservation: 60 minutes for synchronous workflows; long-running batch may declare up to 24 hours at reservation time
- Metric emitted: `reaper.released.count` per run; alarm if count > 100/day (signals a systemic workflow failure)

**Blocks →** ENG-23

---

### [ ] ENG-20 — Daily reconciliation + monthly close CSV

**Needs ←** ENG-10, ENG-15

**Deliver:**
- Daily reconciliation job (06:00 UTC), per tenant:
  1. Every completed `workflow_run` has exactly one `rating_decision` and one debit `credit_ledger` row
  2. Wallet `balance_after` on most recent ledger entry = `available_credits + reserved_credits + used_credits`
  3. Every `usage_event` from the prior day is attributable to a `workflow_run`; orphan events flagged
  4. Every `rating_decision.catalog_snapshot` is valid JSON with required keys
  - Any mismatch: write `reconciliation_runs` row + P1 alert (page on-call)
- Monthly close skeleton (1st of month, 02:00 UTC):
  1. Lock all wallets for closing period
  2. Apply rollover policy per subscription: `expire` → insert expiry entries; `rollover` → carry full balance; `rollover_capped` → carry up to cap
  3. Create new-period wallet; grant included credits per active subscription
  4. Generate per-tenant invoice line items from `rating_decisions`
  5. Export `invoice_{tenant_id}_{period}.csv` to S3
  6. Mark closed-period wallets `permanently_closed`

**Blocks →** ENG-24, ENG-26, ENG-31, ENG-40

---

### [ ] ENG-21 — Tool call wrapping + catalog snapshot integration

**Needs ←** ENG-11, ENG-16, ENG-18

**Deliver:**
- Extend Studio instrumentation to wrap tool calls:
  - Emit `tool.call.completed` event after every third-party tool execution: `tool_id`, `tool_version`, `vendor`, `call_count`, `records_processed`, `raw_cost_usd`, `cost_model_version`
  - Emit `integration.call.completed` for Salesforce, SharePoint, email, calendar calls: `integration_id`, `provider`, `call_type`, `record_count`, `raw_cost_usd`
- Confirm `catalog_snapshot` captured at reservation (ENG-18) matches what Studio actually ran:
  - At `workflow.completed`, verify `workflow_runs.catalog_snapshot.workflow.version` matches executed workflow version
  - Log a warning (not an error) if drift detected; flag in reconciliation
- Integration test: emit a fixture workflow with LLM + tool call events → assert all event types reach the DB and rating produces a correct multi-component breakdown

**Blocks →** ENG-23

---

### [ ] ENG-22 — Admin endpoints + Financial RBAC enforcement

**Needs ←** ENG-17, ENG-18

**Deliver:**
- All five admin endpoints wired and enforced:
  - `POST /v1/admin/tenants/{id}/adjustments` — requires `ledger.adjust`; writes adjustment ledger entry; `X-Reason` header required; writes `audit_log`
  - `POST /v1/admin/tenants/{id}/reversal` — requires `credits.reverse`; writes reversal entry with `related_entry_id`; above-threshold reversals require `approval_request`
  - `PATCH /v1/admin/tenants/{id}/enforcement-mode` — requires `tenant.cap.update`; valid transitions only; `audit_log` entry
  - `POST /v1/admin/rating-rules` — requires `rating_rule.publish`; publishes new rule version; immutable after publish; `audit_log` entry
  - `GET /v1/admin/billing/export` — requires `billing.export`; streams invoice CSV/PDF from S3
- Every admin call:
  - Verifies permission against actor's token
  - Records in `audit_log`: actor, permission used, IP address, before/after state, timestamp
  - Returns permission name in 403 error body when missing
- API key scrubbing middleware: strip the `Authorization` header value before any log write

**Blocks →** ENG-25

---

### Week 5 — Integration & Hardening

---

### [ ] ENG-23 — ⭐ E2E test: `observe_only` on a real tenant

**Needs ←** ENG-12, ENG-15, ENG-19, ENG-21

**Deliver:**
- Full end-to-end test against a staging environment with a real (test) tenant in `observe_only` mode:
  1. Create tenant + subscription via API
  2. Call Estimate → assert sensible credit band
  3. Call Reserve → assert wallet shows reserved credits
  4. Emit usage events (LLM + tool calls) via batch ingest
  5. Call Finalize → assert `rating_decision` written, `credit_ledger` has release + debit entries
  6. Run daily reconciliation → assert 0 discrepancies
  7. Trigger Reaper manually → assert orphaned reservation (injected) is released
- All 6 Gateway checks verified (pass and fail paths)
- Enforcement mode `observe_only`: all check failures logged but run not blocked
- Zero DLQ messages after test run

**Blocks →** Phase 1 Gate

---

### [ ] ENG-24 — Load test 200 evt/s + DR drill

**Needs ←** ENG-20

**Deliver:**
- Load test:
  - Sustain 200 usage events/sec for 30 minutes against staging
  - Assert: ingest p99 < 500ms; rating settlement p99 < 30s; reconciliation finds 0 discrepancies at end
  - Assert: 0 DLQ messages during sustained load
  - Measure and record max wallet reservation throughput (target: 50 concurrent reservations without 409s)
- DR drill:
  - Simulate primary Aurora failure; failover to replica; measure time to recovery
  - Restore from most recent backup to a clean environment; run daily reconciliation; assert ledger integrity
  - Document failover runbook in `docs/DR_RUNBOOK.md`
- Load test report committed to repo under `tests/load/results/`

**Blocks →** Phase 1 Gate

---

### [ ] ENG-25 — Admin dashboard (internal)

**Needs ←** ENG-22

**Deliver:**
- Internal web dashboard (read-mostly; no customer access in V1):
  - Tenant list view: name, status, enforcement mode, current-period used/available/reserved credits, projected period-end, margin warning count
  - Per-tenant drill-down: workflow runs table, rated credits, raw cost, cost-per-credit, margin warning flag, approval queue
  - Approval queue: pending requests with age, requestor, workflow, estimated credits; approve/deny buttons (calls `/v1/approvals/{id}/decide`)
  - Reconciliation status panel: last run timestamp, tenant count, discrepancy count; link to `reconciliation_runs` detail
- Financial RBAC enforced: dashboard users must hold `billing.export` to see raw cost and margin data
- No customer PII exposed in the dashboard (tenant name + IDs only)

**Blocks →** Phase 1 Gate

---

### [ ] ENG-26 — Invoice CSV + PDF generation + CloudWatch alarms

**Needs ←** ENG-20

**Deliver:**
- Monthly invoice generation (called by monthly close job):
  - Per-tenant `invoice_{tenant_id}_{period}.csv`:
    - Columns: `line_item_type`, `description`, `quantity`, `unit_price_usd`, `amount_usd`
    - Line items: platform fee, included outcomes (by type), overage outcomes (by type), topup purchases, promo adjustments
    - Outcome counts derived from `rated_credits / credits_per_outcome` per the subscription's rating rule
  - Per-tenant `invoice_{tenant_id}_{period}.pdf` — human-readable version of the CSV
  - Both uploaded to S3 under `invoices/{year}/{month}/{tenant_id}/`
- CloudWatch alarms:
  - DLQ depth > 0 (any dead-letter queue)
  - Reconciliation discrepancy count > 0
  - Reaper released > 100 reservations/day
  - Rating settlement p99 > 30 seconds
  - Wallet optimistic-lock conflict rate > 1%
  - `margin_warning` count per tenant > 5/day

**Blocks →** Phase 1 Gate, ENG-33

---

## 🚦 Phase 1 Gate — Go / No-Go

**Must all be true before Phase 2 starts:**

- [ ] ENG-23 (E2E test on real tenant) passes with zero discrepancies and zero DLQ messages
- [ ] ENG-24 (load test 200 evt/s + DR drill) passes with all SLOs met
- [ ] ENG-25 (admin dashboard) is live and accessible to the Nexoraa ops team
- [ ] ENG-26 (invoice + alarms) is live and has produced at least one test invoice cycle

If any gate item fails: diagnose root cause, fix, re-run. Do not proceed to Phase 2.

---

## Phase 2 — Advanced Rating & Controls (Weeks 6–9)

**Goal:** Move first tenant from `observe_only` to `enforce_block`. All pricing models live. Manual intervention eliminated from the runtime path.

---

### [ ] ENG-27 — Hybrid + value_based pricing models + new fixtures

**Needs ←** Phase 1 Gate

**Deliver:**
- Extend `rate()` pure function with two new pricing models:
  - `hybrid`: base credits + per-agent credits + per-token credits + per-tool credits; reads `catalog_snapshot` for agent/tool breakdown
  - `value_based`: base credits × completion-status multiplier; `partial_success` costs less than `full_success`; failure policy from open decision #6
- New golden test fixtures in `tests/rating/fixtures/`:
  - Hybrid workflow with 3 agents + 2 tools
  - Value-based: full success, partial success, full failure
  - Hybrid with discount override
  - Hybrid triggering margin warning
- All existing fixtures still pass (no regression)

**Blocks →** ENG-29, Phase 2 Gate

---

### [ ] ENG-28 — Anomaly detection + velocity caps

**Needs ←** Phase 1 Gate

**Deliver:**
- Velocity anomaly detection:
  - If a tenant's hourly credit consumption exceeds 10× their trailing 7-day average: page on-call via CloudWatch alarm + SNS
  - Configurable auto-suspend on anomaly detection: if `auto_suspend=true` for the tenant, suspend immediately (enforcement mode → `observe_only` does not auto-suspend)
- Per-run threshold enforcement:
  - If estimated credits > 10% of tenant's monthly hard cap: gateway routes to Approval Service (`approval_required`) regardless of tenant's `enforcement_mode`
  - Threshold configurable per tenant via `entitlement_overrides`
- Velocity caps:
  - 60 workflow starts per minute per tenant; 1,000 per hour (configurable per `entitlement_overrides`)
  - 429 response with `retry-after` header when tripped

**Blocks →** ENG-29, ENG-34, Phase 2 Gate

---

### [ ] ENG-29 — Enforcement mode ramp + margin dashboard

**Needs ←** ENG-13, ENG-27, ENG-28

**Deliver:**
- First tenant ramped from `observe_only` to `enforce_block`:
  - Week 1 of ramp: `observe_only` — monitor for unexpected check failures; confirm zero workflow impacts
  - Week 2 of ramp: `warn_only` — monitor for customer complaints; fix any integration issues
  - Week 3 of ramp: `enforce_block` — confirm customers are briefed; on-call ready
  - Each transition requires explicit sign-off in `audit_log` with actor and reason
- Margin dashboard in admin UI:
  - Per-workflow, per-week chart: raw cost vs rated credits vs customer price
  - Margin warning count trend per workflow
  - Highlight any workflow where `cost_per_credit > $0.0012` consistently (open decision #14)

**Blocks →** Phase 2 Gate

---

### [ ] ENG-30 — Free-retry + failure charging + late event handling

**Needs ←** Phase 1 Gate

**Deliver:**
- Free-retry policy (open decision #6 default):
  - Workflow fails; retry starts within 60 seconds: full reversal via adjustment entries; retry rated normally
  - Retry started after 60 seconds: charged for steps completed up to failure
  - `failure_reason` matching known vendor outage codes: automatically fully reversed; tracked for vendor SLA credit
- Partial failure charging:
  - Rating Engine receives `workflow_status=partial_success | failed` from finalize call
  - `value_based` model applies completion multiplier; `fixed` and `per_unit` charge for completed steps
- Late event handling:
  - Usage event arrives after monthly close: accept and store; rate against the rule active at `workflow_run_id`'s start time
  - Create adjustment entry in current open period referencing the closed period's `billing_period`
  - Finance reconciliation monthly close report includes late-event adjustments as a separate line

**Blocks →** ENG-33, Phase 2 Gate

---

### [ ] ENG-31 — Vendor cost reconciliation + drift alarms

**Needs ←** ENG-20

**Deliver:**
- Monthly vendor cost reconciliation (5th of each month):
  1. Finance uploads each vendor's invoice CSV to `s3://nexoraa-billing/vendor-invoices/{vendor}/{year}/{month}/`
  2. Job parses and aggregates by `(vendor, model, date)`
  3. Sum `raw_cost_usd` from `usage_events` for same tuples
  4. Compute `drift_pct = (event_sum - invoice_sum) / invoice_sum`
  5. Write `reconciliation_runs` row with `drift_pct`, detailed breakdown by vendor/model
  6. CloudWatch alarm if `|drift_pct| > 2%`
- Report exported to `s3://nexoraa-billing/reconciliation-reports/{year}/{month}/` as CSV
- Common drift causes documented: stale `cost_model_version`, missed prompt cache discount, missed events

**Blocks →** ENG-35, Phase 2 Gate

---

## 🚦 Phase 2 Gate — Go / No-Go

**Must all be true before Phase 3 starts:**

- [ ] ENG-29: At least one production tenant is live on `enforce_block` with zero reported incidents for ≥5 business days
- [ ] ENG-27: Hybrid and value_based pricing models pass all golden test fixtures
- [ ] ENG-28: Anomaly detection has fired at least once (in a controlled test) and alerted correctly
- [ ] ENG-30: Free-retry and partial-failure charging verified end-to-end
- [ ] ENG-31: Vendor cost reconciliation has run against at least one real vendor invoice with drift < 2%

---

## Phase 3 — Customer Billing & Compliance (Weeks 10–13)

**Goal:** Customer self-service. Automated billing. Production-ready for 50+ tenants. SOC 2 Type I readiness.

---

### [ ] ENG-32 — Customer-facing dashboard

**Needs ←** Phase 2 Gate

**Deliver:**
- Customer dashboard (accessible to tenant users with `analyst` role and above):
  - Real-time usage: current-period credits used vs included, projected period-end spend
  - Usage breakdown by workflow, by day, by user
  - Downloadable monthly usage CSV (does not show internal credit amounts — shows outcome counts and amounts per contract)
  - Hard cap progress bar: color-coded at 70%, 85%, 95%, 100%
  - Historical invoices list with PDF download
- No raw credit amounts, vendor costs, or margin data exposed to customers
- Customer sees outcomes and dollar amounts per their contract — not internal credit accounting

**Blocks →** ENG-34

---

### [ ] ENG-33 — Stripe/Chargebee Billing Adapter

**Needs ←** ENG-26, ENG-30, ENG-36

**Deliver:**
- Billing adapter integrating with Stripe (Finance default per open decision #11):
  - Monthly close triggers invoice creation in Stripe via `stripe.invoices.create` + `stripe.invoiceItems.create`
  - Line items mapped from `invoice_{tenant_id}_{period}.csv`: platform fee, overage, topup purchases
  - Invoice finalized and sent to the billing contact on the tenant record
  - Stripe webhook endpoint `POST /v1/billing/stripe-webhook`:
    - Verified with `stripe.webhooks.constructEvent()` — never trust unverified webhook payloads
    - Handles: `invoice.paid`, `invoice.payment_failed`, `customer.subscription.deleted`
    - On `invoice.payment_failed` for Net 30+: trigger suspension workflow per open decision #7

**Blocks →** ENG-35, ENG-37

---

### [ ] ENG-34 — Auto-overage + top-up + notifications

**Needs ←** ENG-28, ENG-32

**Deliver:**
- Auto-overage: when `available_credits` reaches 0 and subscription has `overage_enabled=true`:
  - Auto-issue overage credits up to `hard_cap_credits`
  - Each overage block written as `overage` ledger entries
  - Overage billed on next invoice close
- Top-up credit purchase via Stripe Checkout:
  - `POST /v1/billing/topup` — creates Stripe Checkout session for customer to purchase a credit top-up
  - On `checkout.session.completed` webhook: INSERT `grant` ledger entry (entry_type=topup), UPDATE wallet, email confirmation
- Usage notifications at 70%, 85%, 95%, 100% of hard cap:
  - EventBridge event → SNS → email to tenant billing contact
  - In-dashboard toast notification
  - At 100%: `enforce_block` kicks in regardless of tenant's base enforcement mode

**Blocks →** ENG-35

---

### [ ] ENG-35 — SOC 2 Type I + DR runbook

**Needs ←** ENG-31, ENG-33, ENG-34, ENG-41

**Deliver:**
- SOC 2 Type I readiness package:
  - Control evidence automated and committed to `docs/soc2/`:
    - Immutable audit log: automated test verifies S3 Object Lock COMPLIANCE mode on the bucket, 7-year retention policy
    - Ledger immutability: automated test verifies UPDATE/DELETE raise an exception
    - Tenant isolation: automated test verifies RLS prevents cross-tenant reads
    - Encryption at rest: screenshot of KMS CMK configuration per environment
    - Backup verification: automated restore drill runs monthly and logs result to `reconciliation_runs`
    - Access review: quarterly export of all `nexoraa_admin` role grants and financial-permission assignments
    - Financial permission audit: query that counts `audit_log` entries per permission per actor per quarter
  - `docs/DR_RUNBOOK.md` (from ENG-24) reviewed and signed off by at least two team members
  - All critical CloudWatch alarms (from ENG-26) have documented response procedures

**Blocks →** ✅ Done

---

## Cross-Cutting — Security & Compliance Hardening

These tickets are not phase-gated. They can be worked in parallel with the main timeline during Phases 1–2. They must be complete before Phase 3 tickets that depend on them (ENG-33, ENG-35).

---

### [ ] ENG-36 — mTLS service mesh + certificate rotation

**Needs ←** ENG-7

**Deliver:**
- All service-to-service calls authenticated via mTLS:
  - Short-lived certificates (1-hour TTL) issued by AWS Private CA at service startup
  - Certificates fetched at runtime — **never committed to the repo**
  - Certificate rotation: services request renewal when cert has < 15 minutes remaining
- Every inbound request to Credits Platform services verifies the client certificate against the Private CA trust chain
- `X-Actor-Permissions` header populated from the mTLS-verified service identity (not from request body or query params)
- Integration test: assert a request with an expired or self-signed cert is rejected with 401

**Blocks →** ENG-33

---

### [ ] ENG-37 — Stripe webhook signature verification

**Needs ←** ENG-33

**Deliver:**
- Stripe webhook endpoint strictly verifies every payload:
  ```python
  stripe.webhooks.constructEvent(payload, sig_header, webhook_secret)
  ```
  - Webhook secret fetched from AWS Secrets Manager at startup — not from environment
  - Any request that fails signature verification is rejected with 400 and logged (not processed)
  - No business logic (ledger writes, wallet updates) executes on unverified webhook payloads
- Replay attack protection: Stripe's 5-minute timestamp tolerance enforced
- Integration test: assert endpoint rejects payload with missing signature; assert endpoint rejects payload with tampered signature

---

### [ ] ENG-38 — `billing=false` guard + sandbox event filtering

**Needs ←** ENG-12

**Deliver:**
- Defense-in-depth guard at every wallet-touching code path:
  - Rating Engine: step 1 of `rate()` filters to `billable=true` events (already specified in ENG-14; this ticket adds an integration test)
  - Wallet reservation: reject any `POST /v1/credits/reserve` where the associated `workflow_run.environment != 'production'`
  - Finalization: assert `billable=false` events are excluded from the `rated_credits` total
- Integration tests with `environment=sandbox` and `environment=internal_test`:
  - Events are stored ✅
  - Events are counted in usage reporting ✅
  - Events never affect wallet balances ✅
  - Events never appear in `rating_decisions.rated_credits` ✅
- This guard must survive any future code change: add a linting rule or code comment that flags any new wallet-write path missing the `billable` check

**Blocks →** ENG-23

---

### [ ] ENG-39 — PII scrubbing middleware (log sanitization)

**Needs ←** ENG-6

**Deliver:**
- Request/response logging middleware scrubs sensitive values before any log write:
  - `Authorization` header value replaced with `[REDACTED]` in all logs
  - `X-Api-Key` header value replaced with `[REDACTED]`
  - API key patterns (`sk_live_tnt_*`) detected and redacted anywhere in log output
  - Stripe webhook secret value never logged
- `usage_events.payload` validated at ingest to reject PII patterns:
  - Reject if payload contains fields named: `prompt`, `transcript`, `record_content`, `customer_name`, `ssn`, `dob`, `account_number`
  - Reject if any string field value exceeds 500 characters (hashes and references are short)
- Integration test: submit event with a `prompt` field; assert 400 returned and event not stored
- Log scrubbing test: submit a request with a real-looking API key in the header; assert the logged output contains only `[REDACTED]`

**Blocks →** ENG-26

---

### [ ] ENG-40 — Rollover policy engine

**Needs ←** ENG-9, ENG-20

**Deliver:**
- Rollover policy applied at monthly close (extending ENG-20):
  - `expire`: at period end, unused `included_credits` and `promo_credits` are expired → INSERT `expiry` ledger entries for each credit class; Finance reports as breakage revenue per open decision #5
  - `rollover`: carry full unused included balance into new period wallet → INSERT `grant` ledger entry in new period referencing the prior period's wallet
  - `rollover_capped`: carry up to `rollover_cap_credits` per subscription; excess expires
- Credit consumption order enforced in the rating engine:
  1. `included` credits consumed first
  2. `topup` credits second
  3. `promo` credits third
  4. `overage` last
  - Wrong order leaks margin and misstates ASC 606 revenue recognition

**Blocks →** ENG-20 (extends it)

---

### [ ] ENG-41 — ASC 606 revenue recognition flags + deferred revenue ledger

**Needs ←** ENG-15

**Deliver:**
- Revenue recognition classification at every credit-grant and credit-consume boundary:
  - `grant` entry (included or topup credits): mark `revenue_recognition_status = deferred`
  - `debit` entry consuming included or topup credits: mark `revenue_recognition_status = recognized`
  - `grant` entry (promo credits): mark `revenue_recognition_status = none`
  - `overage` debit: mark `revenue_recognition_status = recognized_immediate`
  - `expiry` entry: mark `revenue_recognition_status = breakage` (Finance applies breakage policy)
- Monthly close report (from ENG-20) includes:
  - Total recognized revenue (USD equivalent at contract rates)
  - Total deferred revenue (pre-paid credits not yet consumed)
  - Total breakage revenue
  - Total promo grants (no revenue impact — balance sheet neutral)
- This classification feeds the Finance reconciliation report and Stripe integration (ENG-33) for correct revenue statement treatment

**Blocks →** ENG-35

---

## Completion Summary

| Phase | Tickets | Gate Condition |
|-------|---------|----------------|
| Pre-Work | ENG-1, 2, 3 | Done before Week 1 |
| Phase 1 (Wks 1–5) | ENG-4 through ENG-26 | ENG-23 + ENG-24 pass |
| Phase 2 (Wks 6–9) | ENG-27 through ENG-31 | `enforce_block` live on ≥1 tenant |
| Phase 3 (Wks 10–13) | ENG-32 through ENG-35 | ENG-35 → ✅ Done |
| Cross-Cutting | ENG-36 through ENG-41 | Complete before ENG-33 and ENG-35 |

**Total: 41 tickets**

**Critical path (longest dependency chain):**
```
ENG-3 → ENG-4 → ENG-9 → ENG-10 → ENG-20 → ENG-26 → ENG-33 → ENG-35 → DONE
```
Delay ENG-10 (Ledger) and every downstream ticket slips. It is the most important ticket in the build.

---

*Nexoraa Credits Platform — Execution Checklist*
*Generated from Engineering Specification v2.0 (2026-05-14) and Linear issues ENG-1 through ENG-41*
*Confidential — Nexoraa AI*
