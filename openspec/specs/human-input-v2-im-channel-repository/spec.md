# human-input-v2-im-channel-repository Specification

## Purpose

Defines the persistence contract, owner-slot isolation, and repository boundaries for Human Input V2 IM Channels.

## Requirements

### Requirement: IM Channel persistence MUST use one owner-free Repository value

`IMChannelReader` and `IMChannelWriter` MUST map persisted `HumanInputIMChannel` rows to immutable `IMChannel` values。`IMChannel` MUST contain Channel ID、timestamps、Provider、Provider tenant ID、canonical `IMEncryptedCredentials`、safe app identifier、`webhook_id`、numeric configuration version and credential-safe status。It MUST NOT contain raw `owner_key`、Dify owner、configuring actor、callback URL、ORM record or another domain's records。

#### Scenario: Workspace Channel is loaded

- **WHEN** `WorkspaceIMChannelReader.get()` loads its current row
- **THEN** it MUST return an owner-free `IMChannel`
- **AND** it MUST NOT expose `TenantId` or raw `owner_key`

#### Scenario: Deployment Channel is loaded

- **WHEN** `DeploymentIMChannelReader.get()` loads its current row
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
- **AND** no Reader or Writer MUST read or mutate the other owner slot

### Requirement: IM Channel readers and writers MUST bind persistence context at construction

`WorkspaceIMChannelReader` MUST receive a caller-owned `Session` and trusted `TenantId` without an actor。`WorkspaceIMChannelWriter` MUST additionally receive the configuring `AccountId`。Both MUST derive `workspace:<tenant_id>` internally。`DeploymentIMChannelReader` and `DeploymentIMChannelWriter` MUST receive only a caller-owned `Session` and derive `deployment` internally。Workspace writes MUST persist the constructor-bound Account ID；Deployment writes MUST persist `configured_by_account_id = NULL`。Reader and Writer methods MUST NOT accept owner、scope、edition、actor or raw `owner_key`。

#### Scenario: Workspace Reader reads

- **WHEN** a Workspace Reader loads the current Channel
- **THEN** its constructor MUST require `Session` and `TenantId` only
- **AND** the caller MUST NOT supply or fabricate a configuring Account ID

#### Scenario: Workspace Writer writes

- **WHEN** a Workspace Writer creates、updates or replaces a Channel
- **THEN** the row MUST use its constructor-derived owner key
- **AND** `configured_by_account_id` MUST equal its constructor-bound Account ID

#### Scenario: Deployment Writer writes

- **WHEN** a Deployment Writer creates、updates or replaces a Channel
- **THEN** the row MUST use `owner_key = deployment`
- **AND** `configured_by_account_id` MUST be null

#### Scenario: Deployment Reader reads

- **WHEN** a Deployment Reader loads the current Channel
- **THEN** its constructor MUST require only the caller-owned Session
- **AND** it MUST NOT accept an actor

#### Scenario: Cross-owner Channel ID is supplied

- **WHEN** a Writer receives a Channel ID that exists under another owner key
- **THEN** it MUST return the same missing or stale outcome as an unknown Channel ID
- **AND** it MUST NOT read、return or mutate the foreign-owner row

### Requirement: IM Channel read and write ports MUST remain separate

`IMChannelReader` MUST expose exactly `get`。`IMChannelWriter` MUST expose exactly `create`、`update`、`replace` and `delete`。The Writer MUST receive already constructed `IMChannel` values。Neither Protocol MUST define candidate tests、Provider preparation、management services、business transition decisions、Webhook reverse lookup or runtime composition。

#### Scenario: Persistence ports do not absorb application responsibilities

- **WHEN** contract tests inspect `IMChannelReader` and `IMChannelWriter`
- **THEN** `IMChannelReader` MUST expose exactly `get`
- **AND** `IMChannelWriter` MUST expose exactly `create`、`update`、`replace` and `delete`
- **AND** their method signatures MUST use only IM Channel persistence values
- **AND** they MUST NOT accept Provider clients、Provider credential DTOs、transport versions or another domain's values

#### Scenario: Caller selects a write operation

- **WHEN** caller invokes `update` or `replace`
- **THEN** Writer MUST execute that persistence operation
- **AND** it MUST NOT decide whether the caller should have selected the other operation

### Requirement: Create MUST classify only owner-slot conflict as already configured

Create MUST insert the supplied Channel with the constructor-bound owner key and configuring actor。It MUST require the initial positive configuration version。Only a violation of `human_input_im_channels_owner_key_uq` MUST raise `IMChannelAlreadyConfiguredError`。Writer MUST let every other SQLAlchemy、mapping、validation and integrity exception propagate unchanged。

#### Scenario: First Channel is created

- **WHEN** the bound owner has no row and the supplied Channel has the initial version
- **THEN** Repository MUST insert and flush the Channel row
- **AND** it MUST return the mapped persisted value without committing

#### Scenario: Owner slot is occupied

- **WHEN** create violates the owner-key unique constraint
- **THEN** Repository MUST raise `IMChannelAlreadyConfiguredError`

#### Scenario: Webhook ID collides

- **WHEN** create violates the global `webhook_id` unique constraint
- **THEN** Repository MUST propagate the original integrity exception
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

Workspace and Deployment Readers and Writers MUST receive a caller-provided SQLAlchemy `Session`。Readers MAY query；Writers MAY execute conditional DML and flush。They MUST NOT create a Session、commit、rollback、begin nested transaction、construct a lock、perform external I/O or dispatch a task。

#### Scenario: Caller rolls back a create

- **WHEN** create flushes successfully and the caller rolls back
- **THEN** the Channel row MUST not remain persisted

#### Scenario: Replacement insertion fails

- **WHEN** replacement conditionally removes the current row but replacement insertion fails
- **THEN** the original exception MUST propagate to the caller
- **AND** caller rollback MUST restore the previous row

### Requirement: IMChannelWriter MUST persist only HumanInputIMChannel

Reader and Writer implementations MUST query、insert、update or delete only `HumanInputIMChannel`。They MUST NOT import、query、mutate or delete Identity、Binding、Sync/Reconciliation、Contact、Inbox、Provider SDK、controller、service or task modules。

#### Scenario: Replacement is executed

- **WHEN** Repository replaces a Channel
- **THEN** only `human_input_im_channels` rows MUST change

#### Scenario: Delete is executed

- **WHEN** Repository deletes a Channel
- **THEN** it MUST NOT determine cleanup、retention、archive or tombstone behavior for another domain's records

### Requirement: Credentials MUST remain opaque to Channel persistence

`IMChannel` and `HumanInputIMChannel` MUST reuse the canonical `IMEncryptedCredentials` model and `FrozenPydanticModelColumn` contract unchanged。Reader、Writer and private mapping code MUST pass that value without decrypting it、parsing provider-specific fields or performing Provider I/O。

#### Scenario: Credentials are mapped

- **WHEN** Repository maps between `IMChannel` and `HumanInputIMChannel`
- **THEN** it MUST preserve the canonical encrypted envelope
- **AND** it MUST NOT reconstruct plaintext or provider-specific credentials

### Requirement: Webhook ID MUST remain persistence data in this change

`HumanInputIMChannel.webhook_id` MUST be non-null and globally unique。`IMChannel` MUST expose the persisted `WebhookId`。This change MUST NOT define an unbound `webhook_id` lookup port、owner-recovery value or Webhook runtime contract。

#### Scenario: Channel webhook ID is persisted

- **WHEN** a Writer persists an `IMChannel`
- **THEN** `HumanInputIMChannel.webhook_id` MUST equal the Channel's non-null `WebhookId`
- **AND** persistence MUST reject another Channel row with the same `webhook_id`

### Requirement: Channel persistence types MUST remain with the Repository contract

Existing shared `IMProvider`、`TenantId` and `AccountId` definitions MUST remain under `core/human_input_v2/`。Channel-owned `IMChannelStatus`、`IMChannelId`、`WebhookId`、`IMChannel`、stable write conflicts、`IMChannelReader` and `IMChannelWriter` MUST reside in `repositories/human_input_v2/im_channel_repository.py`。Workspace and Deployment SQLAlchemy readers、writers and their private mapping helpers MUST reside in `repositories/human_input_v2/sqlalchemy_im_channel_repository.py`。A separate mapper module MUST NOT be introduced。Controller and service modules MUST NOT define duplicate or pass-through copies。

#### Scenario: Shared Provider enum is used

- **WHEN** Channel Repository code needs `IMProvider`
- **THEN** it MUST import the existing shared core definition
- **AND** it MUST NOT declare another Provider enum
