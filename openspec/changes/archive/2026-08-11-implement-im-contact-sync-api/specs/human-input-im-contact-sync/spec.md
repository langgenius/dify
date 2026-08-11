## ADDED Requirements

### Requirement: IM Contact Sync application MUST own workspace orchestration and remain transport-neutral
Dify MUST provide one transport-neutral IM Contact Sync application service and worker and MUST connect the workspace console Flask transport to that boundary. The application service MUST remain reusable by a future EE trusted internal transport. Transport handlers MUST NOT implement their own reconciliation or persistence orchestration.

#### Scenario: Workspace caller triggers synchronization
- **WHEN** a CE or SaaS workspace administrator triggers a manual IM directory sync
- **THEN** the workspace transport MUST call the shared Dify IM Contact Sync application service with the current workspace-owned Integration

### Requirement: Provider Directory I/O MUST complete before reconciliation state mutation
The worker MUST read one complete immutable Provider Directory through the configured adapter before opening the current-state apply transaction. A `DirectoryReadFailure` MUST fail the sync run without generating an absent-identity deletion plan or mutating current IM identities or IM bindings. Provider credentials, clients, cursors and raw payloads MUST NOT enter the reconciliation input.

#### Scenario: Complete Provider Directory is read
- **WHEN** the configured Provider adapter returns a complete Directory
- **THEN** the coordinator MUST normalize its shared identity facts and continue to serialized input loading and plan generation

#### Scenario: Provider Directory read fails
- **WHEN** the configured Provider adapter returns `DirectoryReadFailure`
- **THEN** the coordinator MUST mark the run failed with an operator-safe diagnostic and MUST NOT load a partial snapshot, generate removals or mutate current state

### Requirement: Reconciliation input loading MUST own Organization scope and IM binding selection
Before invoking the planner, the input loader MUST load complete `current_identities` and map the current deployment model into `current_bindings`, `reconciled_binding_ids` and `contacts_for_email_matching`. `current_identities` MUST contain every current IM identity in the run's Integration namespace, including identities with and without an IM binding, and MUST NOT contain identities from another Integration, historical records or deleted records. It MUST NOT be paginated or filtered by binding or Contact-match state. `current_bindings` MUST contain every current IM binding that references an input IM identity. `reconciled_binding_ids` MUST be a subset of those binding IDs and MUST identify only bindings that this sync run may compare, preserve, replace or remove. In CE/SaaS the loader MUST use the current workspace as the Organization boundary. In EE the loader MUST use the deployment as the Organization boundary. External Contacts, unavailable Account-backed Contacts and cross-Organization Contacts MUST NOT enter `contacts_for_email_matching`. Membership in `contacts_for_email_matching` MUST govern only automatic binding creation or replacement and MUST NOT govern retention of an existing binding. The generated `ReconciliationInput` MUST NOT expose workspace, deployment, edition, membership, Contact source or binding-scope policy to the planner.

#### Scenario: Complete current identities are loaded
- **WHEN** the input loader constructs `current_identities` after the coordinator acquires the Organization-scoped Redis write lock
- **THEN** it MUST include every current IM identity in the run's Integration namespace, including unbound identities, so only absence from the complete Provider Directory can make one of those identities a deletion candidate

#### Scenario: CE or SaaS input is loaded
- **WHEN** reconciliation loads current state for a tenant-owned Integration
- **THEN** the loader MUST place active Account-backed Contacts from that workspace in `contacts_for_email_matching` and MUST omit other workspaces and External Contacts

#### Scenario: EE input is loaded
- **WHEN** reconciliation loads current state for a deployment-owned Integration
- **THEN** the loader MUST place active Organization Account Contacts from that deployment in `contacts_for_email_matching` and MUST omit workspace-relative Contact types from the planner input

#### Scenario: Contact email-match input uniqueness is violated
- **WHEN** `contacts_for_email_matching` contains the same non-null normalized email more than once, which MUST NOT occur in healthy current state
- **THEN** the planner MUST continue with the `ambiguous_contact_email` recovery rule and MUST return structured warning data containing affected IM identity references and all colliding Contact IDs without performing logging I/O

#### Scenario: Workspace override reuses an identity
- **WHEN** an IM identity has an Organization binding and one or more workspace overrides
- **THEN** `current_bindings` MUST contain all those IM bindings and `reconciled_binding_ids` MUST contain only the Organization binding ID

#### Scenario: Reconciled binding membership is interpreted
- **WHEN** the input loader places an IM binding ID in `reconciled_binding_ids`
- **THEN** that membership MUST mean only that the current sync uses the binding for automatic matching, Contact occupancy, preservation and replacement decisions; it MUST NOT create a persisted binding type or state, and bindings outside the subset MUST remain in `current_bindings` for referential cleanup

#### Scenario: Contact lifecycle already removed a binding
- **WHEN** Contact lifecycle hard-deletes a Contact and its current IM bindings before reconciliation input is loaded
- **THEN** the loader MUST observe those bindings as absent and the planner MUST NOT generate compensating binding deletion because the Contact is absent from `contacts_for_email_matching`

### Requirement: Reconciliation-protected writes MUST use one Organization-scoped Redis write lock
Reconciliation apply and every application write that can change `ReconciliationRunRef`, active sync-run state or any `ReconciliationInput` fact MUST acquire the same coarse-grained Redis write lock. This protected set includes Integration configuration/revision, current IM identities, current IM bindings, and Contact, Account or membership records used to derive Contact email-match admission. Its key MUST use the stable Organization ownership key: the workspace ownership key in CE/SaaS and the deployment ownership key in EE. The coordinator MUST acquire the lock after Provider Directory I/O and before current-state input loading, and MUST hold it until the database transaction commits or rolls back. While reconciliation holds the lock, another protected writer MUST wait before executing related SQL and MUST return a retryable result if bounded acquisition times out. Read-only operations MUST remain available without acquiring this lock. Redis lock details and deployment-shape key selection MUST NOT enter the pure planner input or plan. Protected repository mutations MUST only be available through a write unit of work created after successful lock acquisition. The database adapter MUST NOT explicitly lock the complete identity, binding or Contact row sets; it MUST use revision checks, exact conditional writes and constraints to reject stale state. Normal short-lived database locks on rows actually mutated by DML are allowed. Lock acquisition or ownership loss MUST fail closed and MUST NOT fall back to unlocked apply or bulk database row locking.

#### Scenario: Two sync workers target one Organization
- **WHEN** two workers attempt to reconcile the same Organization Integration concurrently
- **THEN** at most one worker MUST apply current-state mutations and the other MUST observe the active or already-applied run state

#### Scenario: Manual binding races with reconciliation
- **WHEN** a manual binding command and a reconciliation plan target the same Integration concurrently
- **THEN** both writes MUST serialize on the same Organization-scoped Redis write lock and neither executor MAY overwrite a decision based on a stale snapshot

#### Scenario: Reconciliation blocks a protected write
- **WHEN** reconciliation holds the Organization-scoped Redis write lock and another command attempts to change an Integration revision, current IM identity, current IM binding or Contact-match input record in that Organization
- **THEN** the command MUST wait before executing related SQL until the lock is released, or return a retryable timeout without changing database state

#### Scenario: Reconciliation does not block an unrelated read
- **WHEN** reconciliation holds the Organization-scoped Redis write lock and a caller performs a read-only query
- **THEN** the query MUST NOT require the write lock and MAY proceed under normal database isolation

#### Scenario: Redis write lock is unavailable or lost
- **WHEN** a writer cannot acquire the Organization-scoped Redis write lock within its bounded wait or can no longer prove ownership before commit
- **THEN** it MUST avoid or roll back current-state mutation, return a retryable lock diagnostic, and MUST NOT fall back to explicit row locking or unlocked execution

#### Scenario: Reconciliation loads a large current-state snapshot
- **WHEN** reconciliation reads many current IM identities, bindings and Contact match candidates while holding the Organization-scoped Redis write lock
- **THEN** the database adapter MUST read them without explicit per-row locks and MUST enforce apply safety through revision validation, conditional DML and database constraints

#### Scenario: Automatic binding target changes before apply
- **WHEN** a Contact selected by a planned binding create or replacement is deleted, disabled or no longer satisfies its captured precondition before the mutation is executed
- **THEN** apply MUST return a stable precondition failure and MUST NOT silently regenerate a different binding plan inside persistence code

### Requirement: Plan execution MUST atomically persist current state and both record types
For a `ReconciliationPlan`, the executor MUST apply IM identity upserts, IM binding mutations and IM identity deletions in dependency order. It MUST atomically persist current-state mutations, identity/binding reconciliation change-log records, product-facing sync result records and terminal sync-run counters. Any failure in those writes MUST roll back the complete apply transaction.

#### Scenario: Unmatched identity is synchronized
- **WHEN** a complete Directory entry cannot be safely matched to any Contact
- **THEN** apply MUST create or refresh its current `IMIdentity`, append its identity change-log record and append one `Not Matched` product result without creating an IM binding

#### Scenario: IM binding is created
- **WHEN** a plan contains one automatic IM binding create mutation
- **THEN** apply MUST persist the binding, append its create change-log record and append one `Added` product result in the same transaction

#### Scenario: Contact email collision warning is resolved
- **WHEN** a `ReconciliationPlan` contains `ambiguous_contact_email` warning data and the executor resolves every referenced identity during phase-one identity upsert
- **THEN** the apply result MUST carry the warning key, all resolved IM identity IDs and all colliding Contact IDs, and the coordinator MUST emit a structured warning correlated with the sync run and Integration without logging raw email or Contact profile values

#### Scenario: IM binding is replaced
- **WHEN** a plan replaces an IM binding from an identity absent from the complete Directory to one uniquely matched Directory entry
- **THEN** apply MUST append one replace change-log record, one `Removed` result with `binding_replaced` for the previous binding and one `Added` result for the replacement binding

#### Scenario: Unbound identity disappears
- **WHEN** an identity absent from the complete Directory is not referenced by any current IM binding
- **THEN** apply MUST append an identity delete change-log record and MUST NOT increment the product-facing `Removed` count

#### Scenario: Apply write fails
- **WHEN** any current identity, binding, change-log, result or sync-run update for a `ReconciliationPlan` fails
- **THEN** the transaction MUST roll back every current-state and log write from that apply attempt

### Requirement: Reconciliation change log MUST remain distinct from sync result buckets
The system MUST maintain an append-only reconciliation change log for IM identity and IM binding `create`, `update`, `refresh`, `replace` and `delete` operations. Each record MUST contain a deterministic run-local operation key, stable reason, resolved identifiers, minimal before/after snapshots and commit time, and MUST NOT contain credentials or Provider raw payload. `HumanInputIMSyncResult` MUST remain a product-facing IM binding result using `Added`, `Not Matched`, `Failed`, `Removed` and `Skipped`.

#### Scenario: Identity profile changes under an unchanged binding
- **WHEN** a Directory entry changes display name or email while its existing reconciled IM binding remains unchanged
- **THEN** the change log MUST record an identity update and the product sync result MUST record `Skipped` for the unchanged binding

#### Scenario: Worker retries an applied plan
- **WHEN** the same run-bound plan is applied after its first transaction has committed
- **THEN** deterministic operation keys and terminal run state MUST prevent duplicate change-log and sync result records

### Requirement: IM Contact Sync services MUST expose transport-neutral commands and queries
The application boundary MUST provide transport-neutral operations for create-or-get active sync run, worker execution, latest-run summary, latest-run result paging, synchronized identity search, manual Organization binding and workspace override mutation. It MUST return domain/application results rather than Flask responses, Protobuf messages or ORM records. Result paging MUST preserve the existing required single-bucket and latest-run-only contract. Workspace Flask handlers MUST consume these operations through the composition boundary and MUST reuse Pydantic request/response contracts for validation and projection.

#### Scenario: Latest sync results are queried
- **WHEN** a transport requests one required result bucket for the latest run
- **THEN** the query service MUST return page, limit, total and transport-neutral result items without returning ORM records or an unfiltered all-results mode

#### Scenario: Synchronized identities are searched
- **WHEN** an administrator searches synchronized identities by keyword
- **THEN** the query service MUST match display name, email and Provider user ID, including identities that do not have an IM binding

#### Scenario: Workspace Flask handler triggers synchronization
- **WHEN** a workspace owner or administrator calls the manual sync Flask endpoint
- **THEN** the handler MUST resolve the current workspace scope, call the shared `IMSyncService`, map its application result through the Pydantic response contract and MUST NOT construct a repository or execute reconciliation directly

#### Scenario: Workspace Flask handlers query reconciliation state
- **WHEN** a workspace owner or administrator requests the latest run, one latest-result bucket or synchronized identities
- **THEN** the handlers MUST call the shared query boundaries, preserve latest-only and required-bucket semantics, and return stable Pydantic responses without ORM records

#### Scenario: Workspace Flask handlers mutate bindings
- **WHEN** a workspace owner or administrator creates or deletes an Organization binding or sets or resets a workspace override
- **THEN** the handlers MUST call `ContactIMBindingService`, preserve workspace authorization and scope, and map stable application errors without implementing IM binding policy in the controller

### Requirement: IM Contact Sync test suites MUST enforce independent coverage and database-backend gates
The implementation MUST explicitly list every production module added or modified by this change as the project coverage scope. Unit and integration suites MUST measure that same scope independently with branch measurement enabled. Unit-test coverage MUST be at least 90%, and integration-test coverage MUST be at least 80%. Merged coverage MAY be reported for observability but MUST NOT satisfy either independent threshold. Pure planner tests MUST remain infrastructure-free. Any unit test that requires persistence MUST use the project's SQLite fixtures. The integration suite MUST start an isolated PostgreSQL instance through Testcontainers, every database-backed integration test MUST use that instance, and no integration test MAY substitute SQLite for PostgreSQL behavior.

#### Scenario: Unit coverage is measured
- **WHEN** the IM Contact Sync unit suite completes
- **THEN** its own coverage data MUST report at least 90% for the complete project coverage scope, and persistence-backed unit tests MUST have used SQLite without starting PostgreSQL or accessing a shared external database

#### Scenario: Integration coverage is measured
- **WHEN** the IM Contact Sync integration suite completes
- **THEN** its own coverage data MUST report at least 80% for the same project coverage scope, and the suite MUST have used PostgreSQL started by `testcontainers.postgres.PostgresContainer`

#### Scenario: Coverage data is combined for reporting
- **WHEN** CI combines unit and integration coverage data
- **THEN** the merged result MUST be informational and MUST NOT hide a unit result below 90% or an integration result below 80%
