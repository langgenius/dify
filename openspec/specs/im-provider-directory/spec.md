# im-provider-directory Specification

## Purpose
TBD - created by archiving change define-im-provider-adapter-contracts. Update Purpose after archive.
## Requirements
### Requirement: Directory MUST be bound to one adapter namespace
Every initial `IMProviderAdapter` MUST expose an `IMDirectory` bound to the adapter's immutable Provider credentials and namespace. `read_directory()` MUST accept no credentials, Provider clients, cursors or Channel context and MUST follow the adapter's thread-safety and lifecycle contract.

#### Scenario: Directory is invoked
- **WHEN** a caller invokes `read_directory()` through one adapter
- **THEN** the operation MUST use that adapter's Provider namespace without requiring transport-specific input from the caller

### Requirement: Directory MUST return identity facts without business side effects
Directory MUST expose Provider identity facts only. A Directory read MUST NOT send messages, claim recipient reachability or perform caller-owned matching, reconciliation, persistence or business processing.

#### Scenario: A consumer requests the Provider directory
- **WHEN** Directory reads the current Provider tenant
- **THEN** it MUST return Provider identity facts without Messaging or consumer-owned business side effects

### Requirement: Directory MUST return one complete snapshot or one failure
A successful Directory read MUST return one immutable `Directory` containing all ordered entries in the configured directory scope observed by that operation. If any required portion of the scope cannot be obtained, Directory MUST return one `DirectoryReadFailure` and MUST NOT return partial entries. Directory presence MUST NOT imply message reachability.

#### Scenario: Complete configured scope is read
- **WHEN** Directory obtains every identity required by the configured scope
- **THEN** it MUST return one complete immutable snapshot

#### Scenario: Directory read is incomplete
- **WHEN** Directory cannot obtain any required portion of the configured scope
- **THEN** it MUST return a failure without partial entries

### Requirement: Initial directory coverage MUST include all five IM Providers
Slack, Feishu/Lark, DingTalk, WeCom and Microsoft Teams adapters MUST each expose Directory with the same snapshot and failure semantics. Provider-specific directory protocol values MUST NOT appear in the shared Directory operation or result.

#### Scenario: Any initial Provider directory succeeds
- **WHEN** Directory succeeds for any initial Provider
- **THEN** its result MUST use the same shared snapshot contract

### Requirement: Shared directory entries MUST contain only shared identity facts
A `DirectoryEntry` MUST contain `ProviderUserId` and MAY contain display name and Email. `ProviderUserId` MUST be stable and comparable only within the verified `(provider, provider_tenant_id)` namespace and MUST be accepted by Messaging bound to that namespace. Missing display name or Email MUST remain valid. Provider-specific cursors, topology, raw responses and administrative status MUST NOT appear in a shared entry. A shared entry MUST NOT expose normalized availability or imply guaranteed message delivery.

For Feishu/Lark, Directory MUST expose `union_id`, not application-scoped `open_id`, as `ProviderUserId`.

#### Scenario: Provider user has no readable Email
- **WHEN** a Provider omits Email because of data or permission constraints
- **THEN** the snapshot MUST retain the identity by `ProviderUserId` without inventing or requiring Email

#### Scenario: Feishu or Lark identity is exposed
- **WHEN** Feishu or Lark Directory returns one shared entry
- **THEN** its `ProviderUserId` MUST be the user's `union_id`
