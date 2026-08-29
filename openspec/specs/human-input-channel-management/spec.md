# human-input-channel-management Specification

## Purpose

Defines the Console transport boundary for Human Input Email and IM channels while preserving each application owner's lifecycle and persistence invariants.
## Requirements
### Requirement: Console collections MUST aggregate independent Email and IM owners

The Console controller MUST call the Email Management owner or IM Integration owner directly for listing、reading、testing、creating、updating、replacing and deleting Channels。The unified HTTP collection and provider catalog MUST be transport-level response aggregation and MUST NOT introduce a cross-kind application service or service bundle。Controllers MUST NOT read owner persistence directly。The system MUST support Resend Email and Slack、Feishu、Lark、DingTalk、Microsoft Teams and WeCom IM。

#### Scenario: Configured Channels are listed

- **WHEN** an authenticated caller requests configured Channels
- **THEN** the Console controller MUST aggregate the current persisted Email and IM owner snapshots
- **AND** it MUST NOT construct a `not_configured` Channel for an unconfigured provider

#### Scenario: Available providers are listed

- **WHEN** an authenticated caller requests available Channel providers
- **THEN** the Console controller MUST aggregate only providers reported available by the Email and IM owners
- **AND** each provider MUST remain separate from persisted Channel state

#### Scenario: One configured Channel is requested

- **WHEN** a caller supplies a kind and `channel_id`
- **THEN** the Console controller MUST delegate the read directly to that kind's application owner
- **AND** it MUST NOT select a provider implementation from a Channel registry

### Requirement: Common channel views MUST be credential-free persisted-state snapshots

`ChannelSummary` MUST be the canonical configured-channel transport projection。The Console controller MUST use the canonical projection functions for Email and IM owner snapshots。It MUST NOT expose per-kind summary DTOs、provider credentials、aggregate objects or persistence records。Candidate test outcomes and provider catalog entries MUST NOT be represented as configured Channels。

#### Scenario: Configured Email is viewed

- **WHEN** a configured Resend Email Channel is read
- **THEN** its summary MUST include Email kind、Resend provider、safe sender identity、timestamps、status and opaque configuration version
- **AND** it MUST NOT expose plaintext、encrypted or masked API-key material

#### Scenario: Configured IM is viewed

- **WHEN** a configured IM Channel is read
- **THEN** its summary MUST include IM kind、provider、safe display identity、timestamps、status、applicable webhook URL and opaque configuration version
- **AND** it MUST NOT expose credentials、provider raw payloads、identities、bindings or ORM records

#### Scenario: Channel status is projected

- **WHEN** an Email or IM owner state is converted to `ChannelSummary`
- **THEN** status MUST be `connected`、`invalid_credentials` or `connection_failure`
- **AND** `status_description` MUST be empty for `connected` and contain only a safe explanation for an error
- **AND** the summary MUST NOT contain `last_checked_at` or an asynchronous creation state

#### Scenario: Display identity is projected

- **WHEN** an owner snapshot is projected to `ChannelSummary`
- **THEN** it MUST use only a safe app/client identifier、an optional provider tenant display name or Email sender name/address
- **AND** it MUST NOT use an API key、secret、token、encrypt key or masked credential

#### Scenario: Channel state is read

- **WHEN** a Channel is listed or read
- **THEN** management MUST treat its status as a stored snapshot
- **AND** it MUST NOT perform provider I/O to refresh that snapshot

### Requirement: Owner commands MUST preserve provider-specific configuration types

Email and IM owners MUST receive strict provider-discriminated inputs mapped from the canonical Console v2 DTOs。Channel transport MUST NOT define command services、a second provider-specific credential union or an untyped configuration map。

#### Scenario: Resend candidate is submitted

- **WHEN** Email create、update or test receives a Resend candidate
- **THEN** the candidate MUST contain required `sender_email`、`sender_name` and `api_key`
- **AND** the Console controller MUST delegate the complete candidate directly to the Email owner

#### Scenario: IM candidate is submitted

- **WHEN** IM create、update、replacement or test receives provider credentials
- **THEN** the selected provider variant MUST be validated through its `provider` discriminator
- **AND** the Console controller MUST delegate the mapped input directly to the IM owner

#### Scenario: Required configuration is not newly submitted

- **WHEN** a candidate omits a required field or supplies `null` or a retention marker for a required secret
- **THEN** validation MUST reject the candidate before provider or persistence work
- **AND** management MUST NOT read persisted credentials to complete it

#### Scenario: A nullable provider field is omitted

- **WHEN** a complete candidate omits a nullable field or explicitly supplies `null`
- **THEN** the final candidate value MUST be `null`
- **AND** management MUST NOT retain the persisted field value

### Requirement: Authenticated request scope MUST determine channel ownership

Channel controllers MUST derive the existing owner-native `WorkspaceScope` or `DirectoryScope` from authenticated route state。They MUST NOT add a `*ManagementContext` transport/domain type or accept arbitrary tenant ownership from provider payloads。Each application owner MUST verify that the addressed aggregate belongs to the derived scope。

#### Scenario: Email command is delegated

- **WHEN** an Email command is handled
- **THEN** the Console controller MUST scope the owner call to the trusted current Workspace

#### Scenario: IM command is delegated

- **WHEN** an IM command is handled
- **THEN** the Console controller MUST pass the effective existing `DirectoryScope` directly to the IM owner

#### Scenario: Cross-scope record is encountered

- **WHEN** an Email or IM owner resolves a configuration belonging to another scope
- **THEN** it MUST NOT expose or mutate that configuration

### Requirement: Email and one active IM channel MUST coexist independently

Channel Management MUST allow one Workspace Email Channel and at most one active IM Channel in the effective `DirectoryScope` to coexist。The application owners MUST enforce this cardinality。The unified collection MUST represent both kinds without creating one provider slot per supported provider。

#### Scenario: Email and IM are configured

- **WHEN** one Resend configuration and one active IM Integration exist
- **THEN** both MUST appear in the configured Channels collection

#### Scenario: Email changes

- **WHEN** the Email Channel is created、updated or deleted
- **THEN** management MUST NOT modify any IM Integration、identity、binding or sync state

#### Scenario: IM changes

- **WHEN** the IM Channel is created、updated、replaced or deleted
- **THEN** management MUST NOT modify the Email configuration

#### Scenario: A second IM Channel is created

- **WHEN** one active IM Integration exists and ordinary create is requested
- **THEN** the IM owner MUST reject create before provider I/O
- **AND** it MUST NOT create a second active Integration

### Requirement: IM Channel commands MUST use the existing IM Control Plane owner

The Console controller MUST call the existing IM Integration application owner for configuration revision、credential rotation、provider installation replacement and deletion。The controller MUST NOT reimplement identity invalidation、binding、synchronization or persistence transitions。

#### Scenario: IM credentials rotate within one provider tenant

- **WHEN** item update validates the same provider and provider tenant as the addressed IM Channel
- **THEN** the IM owner MUST preserve the existing `integration_id`, IM identity records, and Contact bindings
- **AND** it MUST advance its numeric configuration version exactly once

#### Scenario: IM item update requires replacement

- **WHEN** item update credentials select a different provider or provider tenant
- **THEN** management MUST return `replacement_required` without persistence
- **AND** it MUST preserve the current Channel、identities and bindings

#### Scenario: One IM provider installation is explicitly replaced

- **WHEN** replacement supplies the addressed `channel_id`、current expected configuration version and complete credentials
- **THEN** the IM owner MUST atomically replace that resource
- **AND** it MUST clear only identities and bindings owned by the replaced Channel

#### Scenario: One IM Channel is deleted

- **WHEN** a caller deletes one IM Channel with the matching identity and configuration version
- **THEN** the IM owner MUST delete that Channel and clear only identities and bindings owned by it
- **AND** it MUST preserve Email and unrelated IM state

#### Scenario: IM write is stale

- **WHEN** the IM owner rejects update、replacement or delete through its complete CAS token
- **THEN** Channel Management MUST return `provider_configuration_updated`
- **AND** it MUST not retry without a current `ChannelSummary`

#### Scenario: HTTP version is mapped to domain CAS

- **WHEN** Channel Management receives an opaque HTTP `ConfigVersion` with an IM `channel_id`
- **THEN** it MUST map them to the owner-native integration identity and numeric version
- **AND** it MUST NOT weaken the domain's complete `integration_id + numeric config_version` comparison

### Requirement: Channel failures MUST be safe and attributable

Management MUST expose only the failure categories required by clients。Configured status and candidate-test failures MUST use `invalid_credentials` for invalid credentials and `connection_failure` for other expected provider failures。Stable conflict codes MUST correspond to distinct client recovery behavior。This change defines only `replacement_required` and `provider_configuration_updated`；management MUST NOT introduce another stable conflict code without a concrete client recovery requirement。

#### Scenario: Candidate credentials are rejected

- **WHEN** an Email or IM provider classifies submitted credentials as invalid
- **THEN** management MUST return `invalid_credentials`

#### Scenario: Another expected provider failure occurs

- **WHEN** an Email or IM provider returns another classified connection failure
- **THEN** management MUST return `connection_failure`

#### Scenario: Application owner raises an unexpected failure

- **WHEN** an Email or IM owner cannot classify an unexpected failure
- **THEN** management MUST return a generic internal failure
- **AND** it MUST NOT expose credentials、provider raw responses、exceptions or persistence diagnostics

#### Scenario: Channel operation is logged

- **WHEN** management writes logs or metrics for a Channel operation
- **THEN** records MAY contain safe scope、`channel_id`、kind、provider and operation identifiers
- **AND** they MUST NOT contain credential values or provider payloads

### Requirement: Provider catalog MUST remain separate from persisted Channel state

The Console controller MUST build one provider catalog response from the Email and IM owners' available providers。The catalog MUST return only available providers and MUST use collection membership as its only availability expression。It MUST NOT query provider configuration persistence to manufacture one Channel per provider or treat a provider value as a persisted resource identifier。Provider catalog DTOs MUST remain transport-owned and MUST NOT be introduced as core application contracts。

#### Scenario: Provider catalog is requested

- **WHEN** a caller requests the provider catalog
- **THEN** the result MUST group available Email and IM providers separately
- **AND** an unavailable provider MUST be omitted
- **AND** no entry MUST claim to be configured or not configured

#### Scenario: Configured Channel collection is requested

- **WHEN** a caller requests configured Channels
- **THEN** management MUST read Email and IM owner state without external provider I/O
- **AND** it MUST NOT infer provider availability from configured state

### Requirement: IM configuration validation MUST precede atomic persistence

Every IM create、credential rotation or replacement MUST validate complete credentials、required directory scopes and provider tenant identity before opening the persistence transaction。A candidate test MUST validate only submitted complete credentials and MUST NOT persist state。

#### Scenario: IM configuration validates successfully

- **WHEN** the provider accepts submitted credentials and required scope or tenant checks pass
- **THEN** the IM owner MUST persist the accepted configuration transition atomically
- **AND** the returned `ChannelSummary` MUST describe the committed revision

#### Scenario: Provider validation fails

- **WHEN** credential authentication、scope validation or tenant resolution fails
- **THEN** no configuration、diagnostic、identity or binding state MUST change

#### Scenario: Connection test succeeds

- **WHEN** a submitted complete candidate passes provider validation
- **THEN** management MUST return a credential-free test success
- **AND** it MUST NOT read persisted credentials or persist configuration、diagnostics or revision
