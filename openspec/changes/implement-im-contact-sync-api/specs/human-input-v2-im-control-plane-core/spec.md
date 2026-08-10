## MODIFIED Requirements

### Requirement: IM control-plane domain MUST remain independent from provider and ORM adapters
IM configuration, synchronization and binding decisions MUST use domain values and immutable snapshots without importing Provider clients, SQLAlchemy sessions, ORM records or controller DTOs. Pure reconciliation MUST accept the shared immutable `DirectoryEntry` contract directly together with `current_identities`, `current_bindings`, `reconciled_binding_ids`, `contacts_for_email_matching` and a `ReconciliationRunRef`; it MUST NOT introduce a field-for-field Directory-entry copy or interpret CE/SaaS/EE edition, workspace membership, deployment ownership, Contact lifecycle source, binding persistence scope, credentials or Provider raw payload. `current_identities` MUST be the complete unfiltered snapshot of current IM identities in the run's Integration namespace, including identities with and without an IM binding and excluding identities from other Integrations, historical records and deleted records. Each current identity ID and Provider user ID MUST be unique. `current_bindings` MUST contain all current IM bindings that reference the input identities. `reconciled_binding_ids` MUST identify the subset this sync run may compare, preserve, replace or remove. The planner MUST derive normalized email values without I/O and encode them in the resulting identity upserts before apply. The pure plan-generation module MUST maintain at least 95% statement coverage and at least 95% branch coverage using infrastructure-free unit tests.

#### Scenario: Sync reconciliation is tested
- **WHEN** Provider entries and current snapshots are reconciled in a unit test
- **THEN** the test MUST run without network access, Flask, a database engine, SQLAlchemy models or a fake repository

#### Scenario: Plan-generation coverage is measured
- **WHEN** the pure reconciliation unit-test suite is executed with branch coverage enabled
- **THEN** the plan-generation module MUST report at least 95% statement coverage and at least 95% branch coverage

#### Scenario: IM record is loaded
- **WHEN** an IM repository loads Integration, IM identity, IM binding or sync records
- **THEN** it MUST map them to immutable domain/input values before returning them to the planner or application layer

#### Scenario: Current identity snapshot is loaded
- **WHEN** the input loader constructs `current_identities` for a reconciliation run
- **THEN** it MUST load every current IM identity in the run's Integration namespace without pagination or filtering by binding or Contact-match state, because absence from the complete Directory makes a current identity a deletion candidate

#### Scenario: Deployment scope is resolved
- **WHEN** the input loader determines `current_bindings`, `reconciled_binding_ids` and `contacts_for_email_matching` for CE/SaaS or EE
- **THEN** it MUST hide that scope decision behind `ReconciliationInput` and MUST NOT add edition or workspace branches to the pure planner

### Requirement: Sync reconciliation MUST be revision-guarded and side-effect free until apply
The pure reconciler MUST accept one immutable `ReconciliationInput` and return either a complete immutable composite `ReconciliationPlan` or a deterministically ordered `BlockedReconciliation`. The plan MUST carry the exact `ReconciliationRunRef` and MUST fully decide IM identity upserts, IM binding creates/replacements/deletes, IM identity deletions, product sync result records and structured operational warning data before persistence apply. Plan generation MUST perform no database, network, clock, random-ID, logging or Provider I/O. Persistence apply MUST compare the persisted run capture and current Integration revision again, validate operation preconditions and execute only the decisions represented by the plan.

#### Scenario: Every Provider entry is planned as an identity upsert
- **WHEN** a Provider entry exists in the complete Directory regardless of email or Contact match
- **THEN** reconciliation MUST plan exactly one identity create, profile update or last-seen refresh for that entry

#### Scenario: Provider user ID matches a bound identity
- **WHEN** a Directory entry matches an existing identity by Provider user ID and that identity has an IM binding whose ID is in `reconciled_binding_ids`
- **THEN** reconciliation MUST preserve that binding before considering normalized email and MUST NOT rebind it because the Provider email changed or because its Contact is absent from `contacts_for_email_matching`

#### Scenario: Unique email fallback matches a Contact available for binding
- **WHEN** a Directory entry's IM identity has no binding in `reconciled_binding_ids` and its normalized email uniquely matches one Contact in `contacts_for_email_matching` that is not used by another reconciled binding
- **THEN** reconciliation MUST plan one IM binding create without creating or modifying any Contact

#### Scenario: Email fallback matches no Contact
- **WHEN** a Directory entry's IM identity has no binding in `reconciled_binding_ids` and its email is missing or matches no Contact in `contacts_for_email_matching`
- **THEN** reconciliation MUST retain its identity upsert, MUST omit binding mutation and MUST plan one `Not Matched` result

#### Scenario: Email fallback is ambiguous across Contacts
- **WHEN** one Directory entry email matches more than one Contact in `contacts_for_email_matching`, violating the email uniqueness invariant that healthy loaded input is expected to satisfy
- **THEN** reconciliation MUST create or refresh the IM identity without creating a binding, MUST plan `Not Matched` with `ambiguous_contact_email`, and MUST include one deterministically ordered warning value containing every affected IM identity reference and every colliding Contact ID

#### Scenario: Multiple identities compete for one Contact
- **WHEN** more than one Directory entry whose IM identity has no reconciled binding uses the same normalized email for one available Contact
- **THEN** reconciliation MUST create no binding for them and MUST plan `Not Matched` with `ambiguous_provider_email` for every competing entry

#### Scenario: Contact is already bound to an identity present in the Directory
- **WHEN** a Directory entry without a reconciled binding matches a Contact whose reconciled binding points to another identity still present in the Directory
- **THEN** reconciliation MUST NOT replace or steal the binding and MUST plan `Not Matched` with `contact_already_bound`

#### Scenario: Binding to an absent identity is uniquely replaced
- **WHEN** one Contact has a reconciled binding only to an identity absent from the complete Directory and exactly one Directory entry without a reconciled binding uniquely matches that Contact by normalized email
- **THEN** reconciliation MUST plan IM binding replacement before deleting the absent identity

#### Scenario: Existing binding Contact is absent from email-match input
- **WHEN** a Directory entry matches an IM identity with a reconciled binding whose Contact is absent from `contacts_for_email_matching`
- **THEN** reconciliation MUST preserve the binding because `contacts_for_email_matching` governs only automatic binding creation or replacement and MUST NOT infer Contact lifecycle state from that absence

#### Scenario: Absent identity is referenced by multiple bindings
- **WHEN** an identity absent from the complete Directory is referenced by an Organization binding and one or more workspace overrides in `current_bindings`
- **THEN** reconciliation MUST plan deletion or replacement of every referencing IM binding before planning identity deletion and MUST produce one `Removed` result per deleted or replaced binding

#### Scenario: Absent identity is unbound
- **WHEN** an identity absent from the complete Directory is not referenced by any `current_bindings` value
- **THEN** reconciliation MUST plan identity deletion without producing a product-facing `Removed` result

#### Scenario: Directory contains duplicate Provider user IDs
- **WHEN** the complete Directory contains the same Provider user ID more than once
- **THEN** reconciliation MUST return a whole-plan blocker and MUST NOT select one entry by tuple order

#### Scenario: Business email matching is ambiguous
- **WHEN** Contact or Provider email facts prevent a unique automatic IM binding but input invariants remain valid
- **THEN** reconciliation MUST return a `ReconciliationPlan` with `Not Matched` results rather than blocking unrelated identity synchronization; duplicate Contact emails in `contacts_for_email_matching` are excluded from this healthy-input scenario and follow their explicit recovery rule

#### Scenario: Reconciliation plan differs from its persisted run capture
- **WHEN** a plan changes the sync run ID, Integration ID, configuration version or Provider captured by the persisted `ReconciliationRunRef`
- **THEN** apply MUST reject the plan before checking or mutating current IM identities or IM bindings

#### Scenario: Reconciliation is stale
- **WHEN** current Integration revision differs from the run's captured revision
- **THEN** apply MUST append a stale diagnostic result and MUST NOT mutate current IM identities or IM bindings

#### Scenario: Reconciliation input is deterministic
- **WHEN** plan generation receives identical immutable input more than once
- **THEN** it MUST return an equal deterministically ordered plan or blocker set without random identifiers or clock-dependent values

### Requirement: IM persistence ports MUST expose transaction-oriented operations
IM persistence ports MUST provide configuration CAS, Organization-scoped Redis-lock serialization for run creation, serialized reconciliation input loading, revision-guarded conditional plan execution, append-only reconciliation change-log writes and product sync result queries rather than generic CRUD per table. Any mutation capable of changing a reconciliation run capture or input fact MUST only be exposed through a write unit of work created after successful acquisition of the Organization-scoped Redis write lock. Plan execution MUST use one transaction for IM identity upserts, IM binding mutations, IM identity deletions, change-log records, product result records and terminal run counters, and MUST NOT explicitly lock the complete identity, binding or Contact row sets. Normal database locks caused by DML on the rows actually mutated are allowed. The executor MAY allocate persistence IDs and commit timestamps but MUST NOT repeat matching policy or change a planned operation/result classification. New identity IDs MUST be resolved through one execution-local mapping from `NewIMIdentityRef` to `IMIdentityId`; this resolution detail MUST NOT introduce a second public or persisted materialized-plan contract.

#### Scenario: Provider replacement is persisted
- **WHEN** the aggregate decides to replace Provider tenant identity
- **THEN** one atomic persistence operation MUST update configuration and invalidate old current IM identities and IM bindings while holding the shared Organization-scoped Redis write lock

#### Scenario: Reconciliation plan is executed
- **WHEN** a `ReconciliationPlan`'s run capture, Integration revision and operation preconditions remain current
- **THEN** the adapter MUST execute the plan in dependency order and MUST atomically persist current state, change-log records, product results and terminal run counters

#### Scenario: New identity ID is assigned once
- **WHEN** phase-one execution creates the identity represented by a `NewIMIdentityRef`
- **THEN** the executor MUST allocate one UUIDv7 `IMIdentityId` and store it in an execution-local mapping keyed by that exact reference

#### Scenario: New identity ID is resolved
- **WHEN** a later binding mutation, sync result, change-log record or operational warning references an identity created earlier in the same plan
- **THEN** the executor MUST resolve the `NewIMIdentityRef` through the execution-local mapping and MUST NOT invoke email matching or generate another identity ID

#### Scenario: Reconciliation precondition changes
- **WHEN** a planned current identity, binding or Contact precondition no longer matches current state during conditional apply
- **THEN** apply MUST return a stable precondition failure and MUST NOT generate or execute a replacement plan inside the adapter

#### Scenario: Reconciliation apply fails
- **WHEN** any current-state, change-log, product-result or run-state write in a valid reconciliation plan fails
- **THEN** the complete current-state and log transaction MUST roll back while preserving only explicitly committed failure diagnostics

#### Scenario: Worker retry replays an applied run
- **WHEN** the same sync run is delivered after its `ReconciliationPlan` already committed
- **THEN** terminal run state and deterministic operation keys MUST return the already-applied outcome without duplicating mutations, change-log records or product results

#### Scenario: IM aggregate relationships are loaded
- **WHEN** an application operation requires Integration children
- **THEN** the adapter MUST use explicit eager loading and MUST NOT issue hidden lazy-load queries
