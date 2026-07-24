## ADDED Requirements

### Requirement: IM control-plane domain MUST remain independent from provider and ORM adapters
IM configuration, synchronization and binding decisions MUST use domain values and immutable snapshots without importing provider clients, SQLAlchemy sessions, ORM records or controller DTOs.

#### Scenario: Sync reconciliation is tested
- **WHEN** provider entries and current identity snapshots are reconciled in a unit test
- **THEN** the test MUST run without network access, Flask or a database engine

#### Scenario: IM record is loaded
- **WHEN** an IM repository loads Integration, identity, binding or sync records
- **THEN** it MUST map them to domain objects before returning control to the application layer

### Requirement: IM Integration writes MUST use complete compare-and-swap tokens
Updates and deletion of an existing IM Integration MUST require a token containing both integration ID and configuration version.

#### Scenario: Current revision is updated
- **WHEN** a configuration write provides the current integration ID and version
- **THEN** the write MUST apply atomically and MUST advance the configuration version exactly once

#### Scenario: Stale revision is used
- **WHEN** a configuration write or reconciliation apply uses a stale integration ID or version
- **THEN** current-state mutation MUST be rejected with a stable stale-revision result

#### Scenario: Integration identity is replaced
- **WHEN** an Integration is replaced and a later Integration reuses the same numeric configuration version
- **THEN** a token for the previous integration ID MUST remain stale and MUST NOT pass CAS validation

### Requirement: Provider replacement and credential rotation MUST have distinct effects
The Integration aggregate MUST distinguish confirmed credential rotation from provider or provider-tenant replacement.

#### Scenario: Credentials are rotated
- **WHEN** credentials change while provider and provider-tenant identity remain confirmed unchanged
- **THEN** current identities and bindings MUST be preserved while configuration revision advances

#### Scenario: Provider tenant is replaced
- **WHEN** provider or provider-tenant identity changes
- **THEN** current identities and bindings for the old Integration MUST be invalidated in the same configuration transaction

#### Scenario: Connectivity diagnostic changes
- **WHEN** connection status or diagnostic details change without a configuration mutation
- **THEN** the Integration configuration version MUST NOT advance

### Requirement: Each IM Integration MUST have at most one active sync run
The persistence contract MUST prevent concurrent triggers from creating more than one active synchronization run for the same Integration.

#### Scenario: Concurrent sync triggers
- **WHEN** two requests trigger synchronization concurrently with no existing active run
- **THEN** at most one new active run MUST be created

#### Scenario: Sync is already active
- **WHEN** a trigger arrives while the Integration has an active run
- **THEN** the operation MUST return the existing active state without creating another run

#### Scenario: Worker retries one run
- **WHEN** reconciliation for the same `sync_run_id` is applied repeatedly
- **THEN** the operation MUST be idempotent and MUST NOT duplicate current-state mutation or result facts

### Requirement: Sync reconciliation MUST be revision-guarded and side-effect free until apply
The pure reconciler MUST match provider entries against current snapshots and produce an immutable plan. Persistence apply MUST compare the captured Integration revision again before mutating current identities or bindings.

#### Scenario: Provider user ID matches
- **WHEN** a provider entry matches an existing identity by provider user ID
- **THEN** reconciliation MUST select that identity before considering normalized Email fallback

#### Scenario: Email fallback matches a Contact
- **WHEN** no provider user ID matches and normalized Email matches an eligible current Contact
- **THEN** reconciliation MUST plan the appropriate identity/binding update without creating a new External Contact

#### Scenario: Reconciliation is stale
- **WHEN** current Integration revision differs from the run's captured revision
- **THEN** apply MUST append a stale diagnostic result and MUST NOT mutate current identities or bindings

### Requirement: Effective IM binding resolution MUST hide control-plane details
Consumers MUST receive one effective binding result using priority `workspace override > organization binding > Email fallback` without access to encrypted credentials, provider raw payloads or ORM identity records.

#### Scenario: Workspace override exists
- **WHEN** a valid workspace binding and a valid organization binding both exist
- **THEN** resolution MUST select the workspace binding

#### Scenario: Workspace binding is reset
- **WHEN** the workspace override is removed or reset to global
- **THEN** resolution MUST expose the valid organization binding without copying it into workspace state

#### Scenario: Binding provider mismatches Integration
- **WHEN** a binding or identity belongs to a different Integration/provider than the requested channel
- **THEN** resolution MUST return a stable invalid-binding result and MUST NOT expose the binding to consumers

### Requirement: IM persistence ports MUST expose transaction-oriented operations
IM persistence ports MUST provide configuration CAS, Integration-locked run creation, snapshot loading, revision-guarded plan apply and append-only results rather than generic CRUD per table.

#### Scenario: Provider replacement is persisted
- **WHEN** the aggregate decides to replace provider tenant identity
- **THEN** one atomic persistence operation MUST update configuration and invalidate old current identities/bindings

#### Scenario: Reconciliation apply fails
- **WHEN** any current-state write in a valid reconciliation plan fails
- **THEN** the current-state transaction MUST roll back while preserving only explicitly committed diagnostic facts

#### Scenario: IM aggregate relationships are loaded
- **WHEN** an application operation requires Integration children
- **THEN** the adapter MUST use explicit eager loading and MUST NOT issue hidden lazy-load queries
