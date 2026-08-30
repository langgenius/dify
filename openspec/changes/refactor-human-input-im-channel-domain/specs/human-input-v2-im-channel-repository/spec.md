## ADDED Requirements

### Requirement: IM Channel persistence MUST use one owner-free Repository value

`IMChannelRepository` MUST map each current `HumanInputIMChannel` row to an immutable `IMChannel`。`IMChannel` MUST contain Channel ID、timestamps、Provider、Provider tenant ID、canonical `IMEncryptedCredentials`、safe app identifier、`webhook_id`、numeric configuration version and credential-safe status。It MUST NOT contain raw `owner_key`、Dify owner、configuring actor、callback URL、ORM record or another domain's records。

#### Scenario: Workspace Channel is loaded

- **WHEN** `WorkspaceIMChannelRepository.get()` loads its current row
- **THEN** it MUST return an owner-free `IMChannel`
- **AND** it MUST NOT expose `TenantId` or raw `owner_key`

#### Scenario: Deployment Channel is loaded

- **WHEN** `DeploymentIMChannelRepository.get()` loads its current row
- **THEN** it MUST return the same `IMChannel` shape as the Workspace implementation
- **AND** it MUST NOT expose deployment persistence metadata

### Requirement: HumanInputIMChannel MUST use one portable owner slot

`HumanInputIMChannel.owner_key` MUST be non-null and globally unique。Workspace rows MUST use `workspace:<tenant_id>`。The deployment row MUST use `deployment`。`owner_key` MUST NOT be a foreign key、`IMChannel` field or Repository operation argument。

#### Scenario: Workspace Channels are created concurrently

- **WHEN** concurrent transactions insert Channels for the same Workspace
- **THEN** exactly one row MAY commit for `workspace:<tenant_id>`
- **AND** the losing create MUST raise `IMChannelAlreadyConfiguredError`

#### Scenario: Deployment Channels are created concurrently

- **WHEN** concurrent transactions insert Channels for the deployment
- **THEN** exactly one row MAY commit for `deployment`
- **AND** correctness MUST NOT depend on nullable-column uniqueness、Redis or a `DifySetup` lock

#### Scenario: Different owners create Channels

- **WHEN** two transactions create Channels for different owner keys
- **THEN** both rows MAY commit
- **AND** neither Repository MUST read or mutate the other owner slot

### Requirement: IMChannelRepository MUST bind owner and actor at construction

`WorkspaceIMChannelRepository` MUST receive a caller-owned `Session`、trusted `TenantId` and configuring `AccountId`。It MUST derive `workspace:<tenant_id>` internally and write the constructor-bound Account ID on create、update and replacement。`DeploymentIMChannelRepository` MUST receive only a caller-owned `Session`，derive `deployment` internally and write `configured_by_account_id = NULL`。Operation methods MUST NOT accept owner、scope、edition、actor or raw `owner_key`。

#### Scenario: Workspace Repository writes

- **WHEN** a Workspace Repository creates、updates or replaces a Channel
- **THEN** the row MUST use its constructor-derived owner key
- **AND** `configured_by_account_id` MUST equal its constructor-bound Account ID

#### Scenario: Deployment Repository writes

- **WHEN** a Deployment Repository creates、updates or replaces a Channel
- **THEN** the row MUST use `owner_key = deployment`
- **AND** `configured_by_account_id` MUST be null

#### Scenario: Cross-owner Channel ID is supplied

- **WHEN** a Repository receives a Channel ID that exists under another owner key
- **THEN** it MUST return the same missing or stale outcome as an unknown Channel ID
- **AND** it MUST NOT read、return or mutate the foreign-owner row

### Requirement: IMChannelRepository MUST expose persistence operations only

`IMChannelRepository` MUST expose exactly `get`、`create`、`update`、`replace` and `delete`。It MUST receive already constructed `IMChannel` values。It MUST NOT define candidate tests、Provider preparation、management services、business transition decisions、Webhook reverse lookup or runtime composition。

#### Scenario: Repository Protocol is inspected

- **WHEN** contract tests inspect `IMChannelRepository`
- **THEN** its methods MUST match the Repository reference contract
- **AND** no method MUST accept Provider credentials DTOs、Provider clients、transport versions or another domain's value

#### Scenario: Caller selects a write operation

- **WHEN** caller invokes `update` or `replace`
- **THEN** Repository MUST execute that persistence operation
- **AND** it MUST NOT decide whether the caller should have selected the other operation

### Requirement: Create MUST classify only owner-slot conflict as already configured

Create MUST insert the supplied Channel with the constructor-bound owner key and configuring actor。It MUST require the initial positive configuration version。Only a violation of `human_input_im_channels_owner_key_uq` MUST raise `IMChannelAlreadyConfiguredError`。A `webhook_id` collision or another integrity failure MUST raise `IMChannelPersistenceError`。

#### Scenario: First Channel is created

- **WHEN** the bound owner has no row and the supplied Channel has the initial version
- **THEN** Repository MUST insert and flush the Channel row
- **AND** it MUST return the mapped persisted value without committing

#### Scenario: Owner slot is occupied

- **WHEN** create violates the owner-key unique constraint
- **THEN** Repository MUST raise `IMChannelAlreadyConfiguredError`
- **AND** it MUST NOT report the failure as a generic persistence error

#### Scenario: Webhook ID collides

- **WHEN** create violates the global `webhook_id` unique constraint
- **THEN** Repository MUST raise `IMChannelPersistenceError`
- **AND** it MUST NOT report that the owner is already configured

### Requirement: Existing-resource writes MUST use owner, Channel ID and scalar version CAS

Update、replacement and delete MUST compare the constructor-bound owner key、current Channel ID and numeric expected configuration version。A conditional mutation that affects zero rows MUST raise `StaleIMChannelWriteError` and MUST leave every Channel row unchanged。

#### Scenario: Current Channel is updated

- **WHEN** update receives the current Channel ID、current expected version and a next Channel whose version is expected version plus one
- **THEN** Repository MUST update that owner row
- **AND** it MUST preserve the Channel ID and owner key

#### Scenario: Update supplies an invalid next version

- **WHEN** update receives a next Channel whose version is not expected version plus one
- **THEN** Repository MUST reject the value before executing mutation SQL

#### Scenario: Replacement succeeds

- **WHEN** replacement receives the current Channel ID and version plus a replacement with a different ID and initial version
- **THEN** Repository MUST remove the current row and insert the replacement under the same owner key in the caller transaction

#### Scenario: Replacement prevents ABA

- **WHEN** an old and replacement Channel use the same numeric version but different IDs
- **THEN** a later write using the old Channel ID MUST raise `StaleIMChannelWriteError`

#### Scenario: Current Channel is deleted

- **WHEN** delete receives the current Channel ID and version
- **THEN** Repository MUST delete and flush only that owner row
- **AND** the owner-key slot MUST become reusable if the caller transaction commits

### Requirement: SQLAlchemy Session MUST remain caller-owned

Workspace and Deployment Repositories MUST receive a caller-provided SQLAlchemy `Session`。Methods MAY query、execute conditional DML and flush。They MUST NOT create a Session、commit、rollback、begin nested transaction、construct a lock、perform external I/O or dispatch a task。

#### Scenario: Caller rolls back a create

- **WHEN** create flushes successfully and the caller rolls back
- **THEN** the Channel row MUST not remain persisted

#### Scenario: Replacement insertion fails

- **WHEN** replacement conditionally removes the current row but replacement insertion fails
- **THEN** `IMChannelPersistenceError` MUST propagate to the caller
- **AND** caller rollback MUST restore the previous row

### Requirement: IMChannelRepository MUST persist only HumanInputIMChannel

Repository implementations MUST query、insert、update or delete only `HumanInputIMChannel`。They MUST NOT import、query、mutate or delete Identity、Binding、Sync/Reconciliation、Contact、Inbox、Provider SDK、controller、service or task modules。

#### Scenario: Replacement is executed

- **WHEN** Repository replaces a Channel
- **THEN** only `human_input_im_channels` rows MUST change

#### Scenario: Delete is executed

- **WHEN** Repository deletes a Channel
- **THEN** it MUST NOT determine cleanup、retention、archive or tombstone behavior for another domain's records

### Requirement: Credentials MUST remain opaque to Channel persistence

`IMChannel` and `HumanInputIMChannel` MUST reuse the canonical `IMEncryptedCredentials` model and `FrozenPydanticModelColumn` contract unchanged。Repository and mapper code MUST pass that value without decrypting it、parsing provider-specific fields or performing Provider I/O。

#### Scenario: Credentials are mapped

- **WHEN** Repository maps between `IMChannel` and `HumanInputIMChannel`
- **THEN** it MUST preserve the canonical encrypted envelope
- **AND** it MUST NOT reconstruct plaintext or provider-specific credentials

### Requirement: Webhook ID MUST remain persistence data in this change

`HumanInputIMChannel.webhook_id` MUST be non-null and globally unique。`IMChannel` MUST expose the persisted `WebhookId`。This change MUST NOT define an unbound `webhook_id` lookup port、owner-recovery value or Webhook runtime contract。

#### Scenario: Repository package is inspected

- **WHEN** architecture tests inspect the IM Channel Repository package
- **THEN** it MUST NOT define `IMWebhookChannelRepository` or `LocatedIMChannel`
- **AND** owner-key parsing MUST remain absent from owner-bound Repository methods

### Requirement: Channel persistence types MUST remain with the Repository contract

Existing shared `IMProvider`、`TenantId` and `AccountId` definitions MUST remain under `core/human_input_v2/`。Channel-owned `IMChannelStatus`、`IMChannelId`、`WebhookId`、`IMChannel` and persistence errors MUST reside under `repositories/human_input_v2/im_channel/` with `IMChannelRepository`、mappers and concrete adapters。Controller and service modules MUST NOT define duplicate or pass-through copies。

#### Scenario: Shared Provider enum is used

- **WHEN** Channel Repository code needs `IMProvider`
- **THEN** it MUST import the existing shared core definition
- **AND** it MUST NOT declare another Provider enum
