# Legacy hosted credits migration

This is an opt-in paid-tenant migration. Existing App, Workflow, Conversation and
default-model identities are not rewritten. Only a server-resolved SYSTEM
shared-credit-pool invocation redirects; BYOK, provider-owned FREE and unmetered
invocations retain their previous execution and settlement owners.

## Rollout prerequisites

1. Deploy a daemon advertising `model-redirect/v1` on every serving node. The
   versioned redirect endpoint fails closed on older daemons.
2. Apply Core migrations. `tenant_model_billing_migrations` is a new control-state
   table; there is no data backfill or existing-table column change. The merge
   revisions contain no schema/data operations.
3. Deploy Core API/workers/beat and matching SaaS Billing server/cron/async images.
   Configure authenticated Core↔Billing URLs and secrets on all required roles.
4. Load an approved `TOKENER_LEGACY_MODEL_MAPPING_JSON` registry. Each record
   follows `ModelMapping` in `core/model_invocation_routing.py`: exact canonical
   provider/type/model and source schema digest, catalog-bound target, adapter
   revision, supported operations and conformance fixture references. Never
   guess aliases or replace an unavailable model with a newer/different one.
   The registry must cover the tenant's hosted source inventory. An empty
   provider allowlist means unrestricted models, not an empty inventory.
5. Use the same mapping revision on Core API and workers. Enable
   `ENABLE_TOKENER_MIGRATION_RECOVERY_TASK` independently of admission. Start with
   both Core and Billing migration admission disabled and empty tenant allowlists.

Core admission: `TOKENER_LEGACY_MIGRATION_ENABLED` and
`TOKENER_LEGACY_MIGRATION_ALLOWLIST`. Billing has its matching migration-enabled
and tenant-allowlist settings; see the SaaS Billing runbook for exact variables.
Never turn off Core connection credentials to pause new admissions. Existing
claimed/active tenants must remain fenced and recoverable while admission is off.

## Operator commands

Commands run in the Core application environment, with credentials from its
normal configuration. They do not accept tokens on the command line or operate
Stripe. Choose a dedicated test tenant before expanding a batch.

```sh
# Read-only: validates source inventory/registry and prints a deterministic intent.
flask tokener-migration prepare --tenant-id TENANT_UUID --batch-id BATCH_ID --mapping-version MAPPING_VERSION

# Explicit write: queues preparation through Billing, without trial/signup money.
flask tokener-migration prepare --tenant-id TENANT_UUID --batch-id BATCH_ID --mapping-version MAPPING_VERSION --apply

flask tokener-migration status --tenant-id TENANT_UUID
flask tokener-migration resume --tenant-id TENANT_UUID
# Explicit manual recovery; retains original IDs, payloads and claimed_at.
flask tokener-migration resume --tenant-id TENANT_UUID --manual
# Only when the immutable journal proves the expired-start grant was NEVER dispatched.
# Reuse the operation UUID on a transport retry. This is not proof from a GET 404.
flask tokener-migration resume --tenant-id TENANT_UUID --manual --replan-unsent-operation-id OPERATION_UUID
```

Re-running the same batch uses the same migration and preparation operation IDs.
Do not choose a new ID to hide an unknown outcome or payload conflict. A changed
registry/inventory is a new semantic intent, not a transport retry.

Preparation installs the target, stores its managed credential by explicit
tenant/provider/id, validates the routing adapter and persists non-financial
credential provenance. It never changes an existing BYOK selection or default
model and never grants the new-user trial.

## Cutover and recovery

- The next eligible legacy reset competes on one Core `decide-cycle` CAS. A
  committed `legacy_deferred` decision remains legacy for that cycle. A committed
  Tokener decision can never fall back to another legacy grant.
- Claimed/granting/activating calls show **processing**, not zero balance. Core
  validates versioned funding receipts and atomically publishes the Tokener
  profile and routing epoch only after readiness. An existing Tokener BYOK
  credential is not replaced by the managed credential during publication.
- Operations replay before CAS, with identical operation ID and payload hash.
  Window/correction command payloads are frozen before dispatch. Timeout/404 is
  not proof a late financial command cannot succeed.
- A schema prepared before cutover but not yet admitted must be re-prepared;
  it cannot invoke with an old key after claim. A successfully reserved legacy
  invocation finishes on its original reservation. One invocation cannot charge
  both backends. Streaming target errors do not trigger legacy fallback.
- Cloud Classic Chat/Agent uses one capped reservation per message, not per LLM
  iteration. This preserves the legacy amount and tail-credit cap while freezing
  the settlement owner across a later cutover. An active remote hold renews every
  20 seconds using the same request/amount. A lost or expired hold is not replaced
  by another billing backend. BYOK, provider FREE and non-Cloud rules are unchanged.
- The API exposes `model_billing_migration_status` on authenticated `/features`
  and model-provider credits responses. It is not an anonymous system feature.
- Initial claim age >5 minutes alerts. >30 minutes requires manual handling and
  pauses new claims in that batch. Retry/lease takeover never reset that clock.
  Later contract-event recovery for an already activated tenant is not timed
  from its historical initial claim.

## Calendar and contract changes

Annual mid-contract migration retains its existing monthly legacy reset dates
until the paid term ends. Each eligible reset receives the approved full amount.
Windows are half-open UTC-midnight ranges; the final end is floored to midnight,
with no 24-hour grace. Renewal adopts the normal new calendar.

A re-anchor does not extend the current window or issue another current-cycle
grant. Old future windows are cancelled before new formal funded slots are
created. A date gap before the next formal reset is **not** a financial gift:
only other legitimate organization balance can be used in the gap. No invented
proration or extra monthly allowance is added. Paid-to-free grants neither a new
trial nor legacy trial credits.

Refund/cancellation handling resolves the original contract and its recorded
windows, including annual invoices paid before migration. It fences prior
intent, converges unknown commands and then applies frozen corrections/cancels;
an unrelated historical refund must not alter the current contract.

An initial late invoice clips the delivery start of the still-valid current
window to today's UTC midnight before claim; its original cycle identity, end
and full amount remain fixed. Once claimed, retries do not recompute dates.
If midnight passes before a grant is ever dispatched, explicit manual replan can
fence that intent and retain the original amount/end/cycle in a new window ID.
Dispatched or unknown-outcome commands require Tokener-side outcome resolution;
a missing lookup is not enough to safely create replacement money.

## Verification boundaries

Required release evidence includes Core/SaaS/daemon source SHA + image digest,
plugin unique identifier and mapping revision; isolated test-tenant preparation,
cycle/replay/failure tests; original App configuration equality; real model
schema/token/invoke and streaming; BYOK/FREE controls; UI processing/usage and
new-user signup regression. Stripe UI actions remain a separate manual test.
Do not claim live transparent-migration E2E from a fixture that maps two different
models, or from unit/contract tests alone.
