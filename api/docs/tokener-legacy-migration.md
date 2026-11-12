# Legacy hosted credits migration

This is an opt-in migration for paid and eligible legacy-free tenants. Existing App, Workflow, Conversation and
default-model identities are not rewritten. Only a server-resolved SYSTEM
shared-credit-pool invocation redirects; BYOK, provider-owned FREE and unmetered
invocations retain their previous execution and settlement owners.

## Versioned saved-model access policy

A new reviewed mapping revision may declare `inventory_policy:
"saved_system_dependencies_v3"` in the existing schema-version1 dependency
inventory configuration. This is opt-in only: historical revisions, v1/v2
resolution, payloads and hashes remain unchanged. Adding support does not
configure/deploy a revision, migrate a paid cycle or grant money.

V3 retains saved references, including dormant AppModelConfig rows. For a trusted
SYSTEM intent it requires only finite shared-credit pools whose normal
ModelManager access policy permits the exact model name. Empty restrictions
remain unrestricted; comparison remains name-only across model types. A model
permitted in a later finite pool remains required even when the current pool
denies it or is exhausted. Denial by every possible finite shared-credit pool is
reported as `not_in_enabled_finite_credit_pools`, never BYOK, retirement or a
successful free request. Unknown/dynamic ownership remains a blocker; allowed
models still require exact immutable source/schema/mapping proof.

The v3 evidence pass rechecks existing stable selection digests against a fresh
normal snapshot, including providers referenced only by exclusions. Digests bind
pool restrictions, source UID and preference, not changing usage/balances. Mixed
snapshot policy/UID changes fail closed. Explicit exclusions participate only in
the new inventory hash. No App, historical config row, credential or runtime
access owner is changed. Publish only with a new reviewed mapping revision;
never relabel a prepared/active revision.

## Rollout prerequisites

1. Deploy a daemon advertising `model-redirect/v1` on every serving node. The
   versioned redirect endpoint fails closed on older daemons.
2. Apply Core migrations. `tenant_model_billing_migrations` is a new control-state
   table; there is no data backfill or existing-table column change. The merge
   revisions contain no schema/data operations.
3. Deploy Core API/workers/beat and matching SaaS Billing server/cron/async images.
   Configure authenticated Core↔Billing URLs and secrets on all required roles.
4. Load an approved `TOKENER_LEGACY_MODEL_MAPPING_JSON` registry. Each record
   follows `ModelMapping` in `services/entities/model_billing_mapping.py`: exact canonical
   provider/type/model and source schema digest, catalog-bound target, adapter
   revision, supported operations and conformance fixture references. Never
   guess aliases or replace an unavailable model with a newer/different one.
   The registry must cover the tenant's hosted source inventory. An empty
   provider allowlist means unrestricted models, not an empty inventory.
   Source model types come from installed provider schemas, not the legacy
   environment parser's LLM placeholder. Missing or ambiguous schemas fail
   closed. Explicit deployment/base-model bindings retain their declared type.
   Source schema digest, LLM mode, original paid/trial provenance, type-specific
   operations and embedding dimensions remain mandatory compatibility gates.
5. Use the same mapping registry on Core API and workers. Multiple revisions may
   coexist in the existing JSON array: uniqueness is scoped to
   `(mapping_revision, canonical provider, model_type, model)`. The prepare
   command, readiness checks and active tenant routing select the exact recorded
   revision. There is no latest-revision fallback, even with a single revision.
   Retain every revision referenced by prepared/claimed/active migrations; adding
   a new revision must not edit or delete old records. A request already prepared
   with a frozen route retains that target and credential binding. Upgrading a
   plugin or publishing a new registry revision does not migrate existing tenants.
   Existing single-revision arrays require no format changes. Enable
   `ENABLE_TOKENER_MIGRATION_RECOVERY_TASK` independently of admission. Start with
   both Core and Billing migration admission disabled and empty tenant allowlists.

### Large mapping registries

For registries approaching Linux's per-environment-string limit, optionally set
`TOKENER_LEGACY_MODEL_MAPPING_FILE=/app/config/tokener-mappings.json` and mount
that file read-only at the same absolute path on **every** Core API/worker/beat
role. It must be a regular, non-symlink UTF-8 JSON array of objects; directories,
FIFOs, invalid JSON/duplicate JSON keys, files changing during the read, and
inputs/effective output larger than 4 MiB fail startup with a content-free error.
Use a stable deployment-owned directory and a normal bind-mounted file, not a
symlink-backed projection. No remote URL or file interpolation is supported.

The effective in-memory registry is inline `TOKENER_LEGACY_MODEL_MAPPING_JSON`
followed by file records. There is no override or deduplication: preserve old
records in exactly one source and add new revisions in the other. Existing
`mappings_for_revision` still validates all records and rejects duplicate source
identities within any revision; no latest-revision fallback is added. With an
empty file setting, the original inline bytes and behavior are unchanged.

Files are loaded only during configuration construction, never per request, and
are not copied to `os.environ`. Restart all consuming roles to load a new file;
update the mounted file atomically **before** restarting, not during a running
configuration read. An existing config retains its startup snapshot when
revalidated. `model_dump()`/`model_dump_json()` intentionally serialize the
original inline input plus file path, so reconstruction reads the current file
once rather than appending a previously merged registry again. Runtime
consumers continue reading `dify_config.TOKENER_LEGACY_MODEL_MAPPING_JSON`.
For a complete configuration input dump, exclude derived/computed fields with
`model_dump(exclude_computed_fields=True)`; unrelated legacy configuration
serialization contracts are not changed by this file loader.

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

# Legacy-free batch: both commands are dry-run unless --apply is supplied.
flask tokener-migration prepare-free --tenant-id TENANT_UUID --batch-id BATCH_ID --mapping-version MAPPING_VERSION
flask tokener-migration prepare-free --tenant-id TENANT_UUID --batch-id BATCH_ID --mapping-version MAPPING_VERSION --apply
flask tokener-migration claim-free --tenant-id TENANT_UUID
flask tokener-migration claim-free --tenant-id TENANT_UUID --apply

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

Legacy-free migration uses explicit `free-legacy-v1` eligibility; paid migration
uses `paid-legacy-v1` and retains the existing periodic cutover. Free preparation
uses the same normal resource provisioning without a grant. Only `claim-free`
claims the one-time signup-equivalent amount from Billing, using the original
account creation time (`accountCreatedAt`) and the same tenant's `trial.v1.TENANT_UUID`
grant identity. The workspace becomes active only after the grant's exact
readback is verified. Replays must reuse that identity, not mint a second free
grant or a new organization. The old legacy balance, source App/provider,
default-model and explicit BYOK configuration are not rewritten or converted.

A genuinely empty source inventory/ownership snapshot is allowed only under
the admitted and persisted `free-legacy-v1` policy, including a legacy-free
workspace with no hosted provider. Omitted, paid and unknown policies retain
strict empty-inventory behavior. This does not exempt a present source from
schema/mapping completeness or skip the managed-key and daemon readiness checks.

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

### Providers installed after cutover

The preparation snapshot describes installed providers at preparation time; it
is not permission to use only that installation set forever. A later provider
installation must not rewrite `source_ownership`, an existing App, the funding
manifest, or the tenant's frozen mapping revision.

The Billing preparation contracts separately authorize unexpired paid tenants
under `paid-legacy-v1` and eligible legacy-free tenants under `free-legacy-v1`.
After route publication, both cohorts use the same Tokener balance model policy:
the union of enabled finite server HOSTED PAID/TRIAL models intersected with the
tenant's frozen reviewed mappings and verified source schemas. Historical
`current_quota_type` and mapping `pool_types` remain source/settlement provenance,
not post-migration plan/model ACLs. Logical quota labels and zero-value metadata
do not grant money. A subscription upgrade/downgrade does not rewrite the frozen
mapping revision, source ownership or manifest. Insufficient balance is a Tokener
error; never fall back to old credits or an unrelated key.

This union requires an active route (or previously activated cancelled route)
and the actual persisted Tokener profile in one tenant-scoped projection.
Claimed/preparing/blocked states do not gain a new model entry, and existing
processing/in-flight fences remain. Independent provider FREE and originally
unlimited owners, explicit BYOK and unmigrated tenants retain their prior rules.
The same source schema/digest/mode/type/operations and installed-target-version
gates apply to prepared existing providers and providers added later.

For an additional provider, the server admits SYSTEM shared-credit models only
after checking enabled hosting policy, a verified Marketplace installation, the
actual source schema, and an exact mapping in the tenant's pinned revision. The
intersection is availability metadata, not new legacy credits. BYOK continues
to use its own credential. Unmapped SYSTEM models fail closed without reopening
the legacy wallet or automatically selecting a custom credential; their absence
must not break unrelated providers or explicit BYOK configurations.

Publish a complete reviewed revision **before** selecting it for a migration,
including supported providers that may be installed later. Retain historical
revisions unchanged. A new registry revision does not silently expand an already
migrated tenant's contract. A source schema is mandatory but need not come from
a static catalog: for a provider advertising customizable models, only exact
frozen mapped candidates admitted by server hosting policy may perform a real
UID-bound source schema lookup. Verified results are retained in private
per-configuration evidence shared by availability, UI listing and invocation;
the original provider catalog and user configuration are never rewritten.
One failed candidate remains unavailable without removing verified static or
other models, affecting BYOK, or creating negative capability evidence. No
mapping means no dynamic lookup. A schema alone still does not establish media,
tool-call, parameter, or embedding compatibility.

Acceptance must distinguish these scenarios for every production credits model:

- An existing App retains its source provider/model across cutover.
- A new App after cutover selects an already installed source provider.
- A provider first installed after cutover supplies the source SYSTEM model.
- An explicitly selected custom credential remains a direct BYOK invocation.

For each forwarding case record the original SYSTEM credential provenance,
logical provider/model, actual daemon redirect target and plugin UID, result,
Tokener usage, unchanged legacy consumption, and unchanged original App/provider
configuration. Native Tokener calls, catalog presence, and unit tests do not
substitute for these runtime observations. Missing source schemas, target
models, reviewed parameter contracts, or independent BYOK credentials remain
explicit blockers in the full production-model matrix.

Required release evidence includes Core/SaaS/daemon source SHA + image digest,
plugin unique identifier and mapping revision; isolated test-tenant preparation,
cycle/replay/failure tests; original App configuration equality; real model
schema/token/invoke and streaming; BYOK/FREE controls; UI processing/usage and
new-user signup regression. Stripe UI actions remain a separate manual test.
Do not claim live transparent-migration E2E from a fixture that maps two different
models, or from unit/contract tests alone.

## Explicit retired sources in new migration revisions

`TOKENER_LEGACY_RETIRED_MODELS_JSON` defaults to `[]`. Each declaration contains
`schema_version: 1`, `mapping_revision`, canonical `provider_id`, exact
`model_type` and exact `model`. There are no wildcard names, implicit latest
revisions, model aliases or automatic retirements inferred from a missing schema.
For example, a reviewed new revision may declare:

```json
[{"schema_version":1,"mapping_revision":"reviewed-new-revision","provider_id":"langgenius/openai/openai","model_type":"llm","model":"gpt-3.5-turbo"}]
```

Publish this policy only alongside a new reviewed mapping revision. Never edit
the policy of an already prepared, claimed or active migration. A declaration
cannot coexist with a route for the same source identity in that revision.
Preparation partitions only the finite PAID/TRIAL shared-credit inventory:
declared retired identities need no source/target schema completeness check;
all other missing or ambiguous sources still fail closed. Independent provider
FREE, unlimited pools, original provider preferences and ownership are unchanged.
An empty post-partition restriction list is removed from preparation, never
interpreted as an unrestricted pool. An unknown empty unrestricted inventory
remains an error; a known all-retired inventory can migrate without active models.

When a revision has retirements, its selected policy digest and actual retired
source identities/pools participate in `inventory_hash`, so changing policy
between preparation and activation fails the existing readiness comparison.
An empty policy, or a policy scoped only to another revision, preserves the
previous inventory shape and hash. No existing table is changed.

This policy is not consulted by runtime routing and introduces no special
retirement error handling. An old App still names its original provider/model;
the existing schema/mapping/invocation error propagates normally. Missing routes
do not fall back to legacy billing or an unrelated BYOK credential. Retirement
therefore does not mean a successful model call, an alias substitution, or
certified upstream availability. Regression reports must keep these expected
error cases separate from successfully forwarded active models.

## Operator-reviewed negative source capability evidence

`TOKENER_LEGACY_SOURCE_CAPABILITIES_JSON` defaults to `[]` and is separate from
retirement. A declaration attests that one immutable source package cannot
resolve particular typed identities; it neither retires a supported model nor
authorizes a target. Each record contains `schema_version: 1`, exact
`mapping_revision`, canonical `provider_id`, full `plugin_unique_identifier`,
`catalog_digest`, original `original_configurate_methods`, all
`supported_model_types`, and an `unavailable` array of exact `model_type`,
`model`, `reason: source_schema_unsupported`, and content-hash `proof_id`.

Generate the catalog digest with `source_catalog_digest` from the complete,
nonempty installed provider schema, before hosting restrictions or retirement
partitioning. The digest includes all typed schemas, original configuration
methods and supported types. Use the original methods captured by provider
configuration, not synthetic PREDEFINED metadata added for a dynamic provider.
Evidence must be reviewed against the immutable archive and its exact SDK pin;
the runtime does not fetch proof URLs, infer semantics from an error message,
or treat RPC failures as proof of absence. Unknown/mismatching package, catalog
or policy continues through ordinary strict discovery. Contradictory negative
claims for declared source schemas, empty/duplicate/invalid catalogs and
malformed policies fail closed.

When this revision has source capability evidence, preparation also reads the
daemon's fresh model-provider bindings once. The matching source must have one
local, non-remote-debug binding with the same UID as its catalog and evidence.
Missing/changed bindings preserve strict lookup; duplicate bindings and binding
RPC failures stop preparation. The empty default adds no binding RPC.

A historical LLM placeholder probes every supported type, so omission requires
negative evidence for every possible type, not only LLM. Explicit non-LLM
restrictions need their exact typed negative. Fine-tuned (`ft:`), deployment or
base-model restrictions, explicit custom-model records and model-setting
identities always retain strict lookup. Pure CUSTOMIZABLE providers never use
this exclusion. Actual source schema resolution and target mapping/digest/mode/
operation checks are unchanged for all remaining sources. A missing target
cannot be excused with a negative-source declaration.

Only finite shared PAID/TRIAL inventory is partitioned. Provider preferences,
credentials, original quotas and ownership remain untouched. Removing all
restricted unavailable identities removes the inventory-only quota instead
of creating unrestricted access. Selected evidence digest and actual excluded
typed identities/pools/proof IDs participate in `inventory_hash`; `[]` and
other-revision evidence preserve old hashes. Publish only with a new reviewed
revision; never rewrite a prepared/active revision. Runtime routing does not
consult this evidence and retains its original errors and no-fallback behavior.

Negative evidence is never positive authorization. The separate published-route
dynamic discovery path above requires an exact reviewed mapping and successful
real source schema verification; it does not use negative declarations as a
reason to admit a model. Offline tests of either mechanism are not runtime E2E.

## Opt-in source TTS voice semantics

New reviewed mappings may opt into `tts_source_voice_v1` revision `1` for the
exact audited OpenAI source package/model. Preparation and invocation both
verify the real source UID, schema digest, complete voices/default and rules
digest. The source rules digest is frozen into the preparation inventory and
the immutable invocation plan; target catalog defaults are not rewritten.
Only this opt-in contract normalizes an empty/invalid voice to the source's
default (or first source voice), preserving valid explicit voices. The actual
source runtime dispatch UID must match the contract. Legacy `identity_v1`,
native Tokener and explicit BYOK retain their existing behavior. No daemon
business rule or automatic model alias is added.

## Closed Gemini 0.9.12 source profiles (V6)

`schema_version: 6` is an additive declaration family for the exact signed
`langgenius/gemini:0.9.12` source archive. It does not reinterpret V1–V5 records
or change their digest algorithms. The family `gemini_credit_source_v1`, revision
`1`, has one reviewed source profile per typed model:

- LLM: `gemini-2.5-flash`, `gemini-3.1-flash-lite`,
  `gemini-3.1-pro-preview`, `gemini-3.5-flash`, `gemini-3.5-flash-lite`,
  `gemini-3.7-flash`, and `gemini-3-flash-preview`.
- Text embedding: `gemini-embedding-001` and `gemini-embedding-2-preview`.

The target model must have the same exact identity and type. In particular,
`gemini-3.1-flash-lite-preview` is not an alias of the reviewed GA model. Catalog
and source-runtime hashes are independently pinned Core-normalized schemas;
an SDK raw-schema hash is not interchangeable with either. The existing private
marker remains version 1 with its six non-secret fields. It contains no original
credential, endpoint or attachment URL.

Before replacing SYSTEM credentials, the normal provider owner captures a
request-local typed fact from the actual source dictionary and immutable plugin
binding. LLM profiles accept only an absent/None base or the exact Google root,
absent/None or `disabled` request metadata, and absent/None or empty `file_url`.
Other values fail closed rather than being normalized. The exact source
embedding implementation does not consume these three settings, so its profile
records them as `not_used`; it does not assert that the original values are
false. These facts are not serialized. Invocation admission checks fresh SYSTEM
facts again, including for previously frozen credentials. CUSTOM/BYOK selection
continues through its original credential owner without forwarding.

Preparation verifies actual selected source schemas and all prospective target
profiles. Every LLM requires `model/schema`, `llm/invoke` and `llm/num_tokens`;
each embedding requires its schema, invocation and token-count operations.
`gemini-embedding-2-preview` additionally requires the daemon's explicit
`multimodal_embedding/invoke` capability. A missing operation, changed source
setting/schema/binding, unknown target, or incomplete receipt is not a reason to
fall back to the old billing path or another model.

These declarations prove reviewed source compatibility, not deployment or
backend readiness. Activation still requires the existing independent readiness
publication and immutable target-package binding. A release must append a newly
reviewed registry revision containing the actual packaged target UID; synthetic
unit-test UIDs are never release inputs. Installing this Core code alone neither
enables native Gemini endpoints/Files/continuation support nor supplies the
daemon's multimodal operation. Those components and real forwarded regressions
must pass their separate release gates before publishing a Gemini revision.

## Closed Tongyi 0.2.26 local source profiles (V7)

The additive V7 family `tongyi_credit_source_v1`, revision1, accepts only the
exact signed Tongyi0.2.26 source:11 LLM identities, text-embedding-v3/v4 and
qwen3-rerank. It does not mean14 models support all three types. The reviewed
LLMs are qwen-flash/max/plus/plus-latest, qwen3-vl-plus, qwen3.5-flash/plus,
qwen3.6-flash/plus and qwen3.7-max/plus. No qwen-long, preview alias, other
source UID or same-name substitution is added. V1–V6 serialization/digest
owners and all already published registry revisions retain their bytes.

The actual SYSTEM dictionary is classified before shared credentials are
cleared. Only exact string `true` plus absent/None/blank `api_host` selects
the reviewed shared international policy; false, bool True, uppercase values,
missing selector, custom hosts and unknown types cannot authorize this family.
LLMs additionally require absent/None or exact `disabled` request metadata.
Embedding/rerank do not use that metadata setting and record `not_used` rather
than pretending the original value was false. Private facts retain no key,
URL or source dictionary, and are rechecked from current protected hosting
configuration before reservation. BYOK/CUSTOM and independent FREE owners
remain on their original source credential path.

Catalog and runtime pins come from actual ee396→Core projections, not SDK raw
hashes. The marker remains the original six-field version1. LLMs require schema,
invoke and num_tokens; embeddings require their schema/invoke/num_tokens;
rerank requires only schema/invoke. The existing generic daemon operations
already cover these types. Target unknown identities cannot be normalized into
an apparently matching schema. No vector width is invented from the v3/v4
names: existing selected-source dimensions checks and real KB parity gates remain.

These14 pins bind the frozen0.4.3-dev15 `STAGING_PACKAGE_CANDIDATE` complete rows,
not a released or installed plugin. Fresh actual public SDK schemas passed the
pinned ee396 DTO and current Core hash owner; these source catalog/runtime pins
are not raw SDK hashes. Gemini9 complete rows and V1–V6 pins remain unchanged.
Any implementation/release_status change invalidates this derivation and requires
independent review again. Actual dev15 package UID and native catalog revision
remain unknown until normal P2 packaging/metadata capture; never reuse an old
catalog annotation or a synthetic999 unit UID as a release fact. Staging may use
the existing truthful unsigned-development policy without weakening validation;
production signing remains its normal release owner's responsibility. This Core-only change neither
publishes a target package nor establishes live model/parameter/media/vector/
billing parity. Before/after original SYSTEM App and newly installed provider
regressions, org-key isolation, normal ledger/legacy-usage checks and richer
LLM/rerank/KB behavior remain separate release gates.
