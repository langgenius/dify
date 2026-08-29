# human-input-v2-im-control-plane-core Specification

## Purpose
TBD - created by archiving change implement-human-input-v2-im-control-plane. Update Purpose after archive.
## Requirements
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

#### Scenario: Deployment-wide Integration is created concurrently
- **WHEN** two EE requests create a deployment-wide Integration while no current configuration exists
- **THEN** creation MUST serialize on a stable deployment owner and exactly one request MUST create the singleton

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
- **WHEN** no provider user ID matches and normalized Email matches an eligible current Organization Contact
- **THEN** reconciliation MUST plan the appropriate identity/binding update without creating a new External Contact

#### Scenario: Email fallback matches only an External Contact
- **WHEN** no provider user ID matches and normalized Email matches an External Contact
- **THEN** reconciliation MUST leave the provider entry unmatched

#### Scenario: Reconciliation plan differs from its persisted run capture
- **WHEN** a plan changes the captured Integration version or provider for an existing sync run
- **THEN** apply MUST reject the plan before checking or mutating current state

#### Scenario: Reconciliation is stale
- **WHEN** current Integration revision differs from the run's captured revision
- **THEN** apply MUST append a stale diagnostic result and MUST NOT mutate current identities or bindings

#### Scenario: Reconciliation removes an identity with scoped overrides
- **WHEN** an absent provider identity has organization and workspace bindings
- **THEN** apply MUST delete every binding and append one removal fact for each removed scope binding

### Requirement: Effective IM binding resolution MUST hide control-plane details
Consumers MUST receive one effective binding result using priority `workspace override > organization binding > no valid IM binding` without access to encrypted credentials, provider raw payloads or ORM identity records. Effective binding resolution MUST be scoped by current workspace, current Integration, and current authorization context. It MUST answer only which IM binding is currently effective, if any, and MUST NOT itself choose Email fallback or other delivery-channel behavior. The same provider identity MAY be reused by an organization binding and one or more workspace overrides for different Contacts; resolution MUST NOT assume that one provider identity globally maps to exactly one Contact.

#### Scenario: Workspace override exists
- **WHEN** a valid workspace binding and a valid organization binding both exist
- **THEN** resolution MUST select the workspace binding

#### Scenario: Same provider identity is reused inside one workspace override
- **WHEN** one provider identity is the organization binding for one Contact and is also configured as the workspace override for another Contact in the same workspace
- **THEN** resolution MUST use the requested workspace and target Contact context to choose the effective binding and MUST NOT reject the state merely because the provider identity is reused

#### Scenario: Same provider identity is reused across workspaces
- **WHEN** two workspaces configure overrides that reuse the same provider identity for different Contacts
- **THEN** a resolution request in one workspace MUST evaluate only that workspace-scoped override and MUST NOT invalidate the other workspace's override

#### Scenario: Workspace binding is reset
- **WHEN** the workspace override is removed or reset to global
- **THEN** resolution MUST expose the valid organization binding without copying it into workspace state

#### Scenario: No valid IM binding exists
- **WHEN** no valid workspace binding and no valid organization binding exist for the requested workspace and channel
- **THEN** resolution MUST return a stable no-valid-im-binding result and MUST NOT reinterpret that result as Email fallback inside the IM control-plane

#### Scenario: Binding provider mismatches Integration
- **WHEN** a binding or identity belongs to a different Integration/provider than the requested channel
- **THEN** resolution MUST return a stable invalid-binding result and MUST NOT expose the binding to consumers

#### Scenario: Tenant-owned Integration is requested from another workspace
- **WHEN** an Integration owner does not match the requested workspace
- **THEN** resolution MUST reject the request before loading identities, bindings, and integration-scoped resolution context

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

### Requirement: IM Integration credentials MUST use one versioned opaque persistence envelope
The IM credential owner MUST serialize the complete validated resolved credential payload, including its provider discriminator, and encrypt it once with an owner-bounded cipher before persistence. Workspace Integrations MUST bind that cipher to the owning tenant and its existing provisioned key. Deployment cipher provisioning is deferred; production MUST reject deployment configuration when no deployment-bounded cipher is explicitly injected. `IMEncryptedCredentials` MUST inherit `BaseModel` directly and declare `ConfigDict(extra="forbid", frozen=True, strict=True, validate_default=True)`. It MUST contain exactly `version: Literal[1]` and a non-empty `ciphertext`. `HumanInputIMIntegration.encrypted_credentials` MUST use `FrozenPydanticModelColumn(IMEncryptedCredentials)`. The column MUST NOT use a provider-specific model, `TypeAdapter`, discriminated union or `model_types`. The Integration provider, provider tenant identity and safe `app_identifier` metadata MUST remain separately persisted.

#### Scenario: A new workspace IM Integration is configured
- **WHEN** a workspace create, credential rotation or replacement accepts complete credentials for any supported IM provider
- **THEN** the resulting Integration MUST contain one recognized envelope version and one ciphertext
- **AND** every submitted provider configuration field MUST be recoverable only from that ciphertext
- **AND** the Integration MUST persist the provider and a safe `app_identifier` outside the ciphertext

#### Scenario: Deployment cipher wiring is unavailable
- **WHEN** deployment-scoped configuration is prepared without an explicitly injected deployment-bounded cipher
- **THEN** configuration MUST fail before credential testing, provider I/O or persistence
- **AND** production MUST NOT derive a deployment cipher from `DifySetup.instance_id`, `SECRET_KEY` or a synthetic Tenant

#### Scenario: An envelope row is loaded
- **WHEN** SQLAlchemy loads `HumanInputIMIntegration.encrypted_credentials`
- **THEN** `FrozenPydanticModelColumn` MUST return `IMEncryptedCredentials`
- **AND** a missing ciphertext, an empty ciphertext, an extra field or a version other than `1` MUST fail strict Pydantic validation

#### Scenario: A malformed or unsupported envelope is read
- **WHEN** an Integration contains an unknown envelope version, undecryptable ciphertext or a decrypted value that is not a valid credential object
- **THEN** the credential loader MUST reject the configuration before constructing an adapter or calling a provider
- **AND** the failure MUST NOT expose plaintext credentials, ciphertext or provider raw errors

### Requirement: Recovered IM credentials MUST match the configured provider
The credential loader MUST decrypt an envelope with an owner-bounded cipher and validate the recovered payload with the resolved credential discriminated union. Workspace runtime MUST bind the cipher to the persisted Integration tenant. Deployment runtime requires an explicitly injected deployment-bounded cipher. The provider discriminator inside the recovered payload MUST equal the persisted Integration provider.

#### Scenario: Envelope credentials are recovered for runtime work
- **WHEN** IM synchronization, delivery or event runtime needs an adapter for an Integration with a recognized envelope
- **THEN** the loader MUST decrypt the envelope once and return only the matching provider-specific resolved credential model
- **AND** the caller MUST construct the adapter from that model

#### Scenario: Deployment runtime has no bounded cipher
- **WHEN** runtime composes a tenant-less Integration without an explicitly injected deployment-bounded cipher
- **THEN** composition MUST fail before decryption, adapter construction or provider I/O

#### Scenario: Encrypted provider discriminator does not match the Integration
- **WHEN** decrypted payload provider differs from the persisted Integration provider
- **THEN** the loader MUST reject the configuration before provider I/O
- **AND** it MUST NOT reinterpret the payload as another provider's credentials

### Requirement: IM Channel projection MUST not decrypt credentials
The credential owner MUST derive `app_identifier` from validated non-secret provider configuration during a successful configuration write. IM Channel summary projection MUST use separately persisted safe metadata and MUST NOT inspect or decrypt the credential envelope.

#### Scenario: Configured IM Channels are listed
- **WHEN** a configured IM Channel is projected for collection or item read
- **THEN** its `display_identifier` MUST use `app_identifier` or the existing safe fallback
- **AND** the read MUST NOT invoke credential envelope decryption

#### Scenario: A submitted identifier is secret material
- **WHEN** a provider configuration field selected for display is an API key, secret, token, verification token or encrypt key
- **THEN** the credential owner MUST reject that field as `app_identifier`
- **AND** ChannelSummary MUST NOT expose it
