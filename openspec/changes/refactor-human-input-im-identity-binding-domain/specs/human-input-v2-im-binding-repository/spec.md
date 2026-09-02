## ADDED Requirements

### Requirement: Default IM Bindings and workspace overrides MUST use separate tables

The system MUST store default Contact-to-Identity bindings in `human_input_im_bindings` and workspace overrides in `human_input_im_workspace_binding_overrides`. Neither table MUST contain `scope`, `scope_id`, Provider, Channel owner, workspace/deployment discriminator, raw owner key, or Organization identifier.

#### Scenario: Default Binding is persisted
- **WHEN** a caller creates a default Binding for one bound Channel
- **THEN** `HumanInputIMBinding` MUST store Channel ID, Contact ID, Identity ID, optional Dify actor, and standard row timestamps
- **AND** it MUST NOT require a tenant selector

#### Scenario: Workspace override is persisted
- **WHEN** a caller sets an override for one target workspace
- **THEN** `HumanInputIMBindingWorkspaceOverride` MUST store Channel ID, target tenant ID, Contact ID, Identity ID, optional Dify actor, and standard row timestamps
- **AND** target tenant ID MUST NOT redefine the Channel owner

### Requirement: Binding tables MUST enforce independent portable uniqueness

Default Bindings MUST enforce uniqueness for `(channel_id, contact_id)` and `(channel_id, im_identity_id)`. Workspace overrides MUST enforce uniqueness for `(channel_id, tenant_id, contact_id)` and `(channel_id, tenant_id, im_identity_id)`. Correctness MUST NOT depend on nullable uniqueness, partial indexes, sentinel tenant IDs, Redis, or a polymorphic scope key.

#### Scenario: Default Contact is assigned twice
- **WHEN** concurrent writes assign one Contact to different Identities in the same Channel
- **THEN** at most one default Binding MAY commit

#### Scenario: Default Identity is assigned twice
- **WHEN** concurrent writes assign one Identity to different Contacts in the same Channel
- **THEN** at most one default Binding MAY commit

#### Scenario: Workspace Contact is overridden twice
- **WHEN** concurrent writes assign one Contact to different Identities in the same Channel and target workspace
- **THEN** at most one workspace override MAY commit

#### Scenario: Identity is reused across Binding kinds
- **WHEN** one Identity is a default Binding and a workspace override for another Contact
- **THEN** both rows MAY exist
- **AND** neither table's uniqueness constraint MUST reject the other row

#### Scenario: Identity is reused across workspaces
- **WHEN** different target workspaces override different Contacts with the same Identity
- **THEN** each workspace MAY store its own override

### Requirement: Current IM Binding values MUST hide persistence context

`IMBinding` MUST contain Binding ID, `IMBindingKind`, Contact ID, Identity ID, creation timestamp, and update timestamp. `IMBindingKind` MUST define `DEFAULT` and `WORKSPACE_OVERRIDE`. The value MUST NOT contain Channel ID, target tenant ID, Provider, owner key, configuring actor, workspace/deployment discriminator, ORM row, `scope`, or `scope_id`.

#### Scenario: Default Binding is mapped
- **WHEN** Repository mapping reads `HumanInputIMBinding`
- **THEN** it MUST return `IMBindingKind.DEFAULT`
- **AND** it MUST omit persistence context

#### Scenario: Workspace override is mapped
- **WHEN** Repository mapping reads `HumanInputIMBindingWorkspaceOverride`
- **THEN** it MUST return `IMBindingKind.WORKSPACE_OVERRIDE`
- **AND** the value MUST not reveal whether the Channel itself is workspace-owned or deployment-owned

### Requirement: Binding assignments MUST separate requested state from persisted state

`IMBindingAssignment` MUST carry a candidate new Binding ID, Contact ID, Identity ID, and assignment timestamp. Default Binding create MUST use the candidate ID when inserting. Workspace override set MUST use the candidate ID only when inserting; updating an existing override for the Contact MUST preserve persisted Binding ID and creation timestamp.

#### Scenario: Workspace override is replaced
- **WHEN** the target Contact already has an override and the caller assigns another current Identity
- **THEN** the Writer MUST preserve the existing Binding ID and creation timestamp
- **AND** it MUST update Identity ID, configuring actor, and update timestamp

#### Scenario: Workspace override is first created
- **WHEN** the target Contact has no override
- **THEN** the Writer MUST persist `assignment.new_binding_id` and assignment timestamp

### Requirement: IM Binding Repository MUST be Channel-bound

`IMBindingRepository` MUST expose `get`, `list_all`, exact default `create/replace/delete`, workspace override `set_workspace_override/reset_workspace_override`, and `get_effective/get_effective_many`. It MUST NOT expose a default-only Contact lookup; locating a default row by Contact for idempotent create or effective fallback remains a Repository implementation detail. Its methods MUST NOT accept Channel ID, owner, scope, workspace/deployment discriminator, Provider, raw owner key, Session, or ORM row. Methods MAY accept target `tenant_id` only when selecting a workspace override or effective workspace result. Default create/replace and workspace override set MUST accept optional `bound_by_account_id` as keyword-only metadata for that mutation.

#### Scenario: Default Binding belongs to another Channel
- **WHEN** the Repository receives a Binding ID that exists only under another Channel
- **THEN** it MUST return the same missing or stale outcome as an unknown Binding ID
- **AND** it MUST not return or mutate the foreign row

#### Scenario: Default Binding create is retried
- **WHEN** the same Contact and Identity assignment already exists in the bound Channel
- **THEN** create MUST return the existing Binding
- **AND** it MUST NOT insert a duplicate row

#### Scenario: Default Binding conflicts
- **WHEN** the Contact or Identity is already assigned to a different endpoint in the bound Channel
- **THEN** create MUST raise `IMBindingConflictError`

### Requirement: Workspace override operations MUST receive their target tenant

`IMBindingRepository.set_workspace_override` and idempotent `reset_workspace_override` MUST receive target `TenantId` as a method argument. `set_workspace_override` MUST also receive optional `bound_by_account_id` as keyword-only mutation metadata. Neither value is Repository constructor state, and neither may select or redefine the Channel owner.

#### Scenario: Override Identity is already used in the target workspace
- **WHEN** `set_workspace_override` assigns an Identity already overridden to a different Contact under the bound Channel and target tenant
- **THEN** it MUST raise `IMBindingConflictError`

#### Scenario: Missing override is reset
- **WHEN** `reset_workspace_override` addresses a Contact without an override in the bound Channel and target tenant
- **THEN** it MUST return the missing outcome without modifying a default Binding

### Requirement: Effective Binding operations MUST apply override-first precedence

`IMBindingRepository.get_effective` and `get_effective_many` MUST receive target Tenant ID as a method argument. For each requested Contact they MUST return the current workspace override when present; otherwise they MUST return the default Binding when present; otherwise they MUST return no Binding. They MUST return at most one Binding per requested Contact.

#### Scenario: Workspace or runtime caller resolves one Contact
- **WHEN** a caller needs the current Binding for one Contact in a target workspace
- **THEN** it MUST use `get_effective` rather than query the default Binding directly
- **AND** the Repository MUST hide whether fallback required a default-by-Contact persistence query

#### Scenario: Contact has both Binding kinds
- **WHEN** one Contact has a default Binding and an override for the bound target workspace
- **THEN** effective read MUST return only the workspace override

#### Scenario: Override is absent
- **WHEN** one Contact has a default Binding and no override for the bound target workspace
- **THEN** effective read MUST return the default Binding

#### Scenario: Override is reset
- **WHEN** a workspace override is removed and a default Binding still exists
- **THEN** the next effective read MUST return the default Binding without copying it into override persistence

### Requirement: Binding writes MUST validate current Identity ownership

Every default Binding and workspace override write MUST require an Identity current in the same constructor-bound Channel. Identity ID alone MUST NOT authorize a Binding. Missing and cross-Channel Identities MUST produce the same `IMBindingIdentityNotFoundError`.

#### Scenario: Binding receives a cross-Channel Identity
- **WHEN** a Binding write receives an Identity ID current only in another Channel
- **THEN** it MUST raise `IMBindingIdentityNotFoundError`
- **AND** it MUST not read or expose foreign Identity facts

#### Scenario: Identity is removed after validation
- **WHEN** a conditional Binding write no longer observes the validated current Identity
- **THEN** the complete write transaction MUST fail without a partial Binding row

### Requirement: Binding writes MUST expose narrow stable conflicts

Expected Binding persistence failures MUST derive from one `IMBindingRepositoryError` root that derives directly from `Exception`. Endpoint uniqueness conflicts MUST produce `IMBindingConflictError`; missing or foreign Identity endpoints MUST produce `IMBindingIdentityNotFoundError`; exact replacement or deletion that no longer matches expected current state MUST produce `StaleIMBindingWriteError`. Unclassified SQLAlchemy, mapping, validation, and integrity failures MUST propagate unchanged.

#### Scenario: Default Binding replacement is stale
- **WHEN** replace no longer finds constructor-bound Channel ID, Binding ID, and expected Identity ID together
- **THEN** it MUST raise `StaleIMBindingWriteError`

#### Scenario: Unrelated integrity failure occurs
- **WHEN** persistence encounters an integrity failure unrelated to a classified endpoint uniqueness conflict
- **THEN** it MUST preserve the original failure

### Requirement: Binding SQLAlchemy stubs MUST use caller-owned Sessions

The SQLAlchemy Binding adapter stub MUST bind only caller-provided `Session` and trusted `IMChannelId` in its constructor. Target Tenant ID and optional Dify actor MUST remain method arguments for operations that use them. Methods MAY query, perform DML, and flush when implemented. They MUST NOT create a Session, commit, rollback, begin a nested transaction, acquire an external lock, perform Provider I/O, or dispatch work.

#### Scenario: Binding capabilities share one transaction
- **WHEN** a caller constructs Identity and Binding repositories with the same Session
- **THEN** all flushed mutations MUST participate in the caller's one transaction

#### Scenario: Binding transaction rolls back
- **WHEN** a later mutation fails after an earlier Binding flush
- **THEN** caller rollback MUST remove the complete write set
