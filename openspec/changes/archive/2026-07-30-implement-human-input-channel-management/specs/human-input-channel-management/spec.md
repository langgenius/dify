## Purpose

Defines one safe management boundary for Human Input Email and IM channels while preserving each channel's own lifecycle and persistence invariants.

## ADDED Requirements

### Requirement: Channel management MUST expose Email and IM through one facade

The system MUST provide one management boundary for discovering, reading, testing, saving and deleting Resend Email plus Slack, Feishu and DingTalk IM channels. Other provider values MUST NOT be part of the management provider or candidate unions until a later capability explicitly adds them.

#### Scenario: Channels are listed

- **WHEN** a trusted management context requests the current Channels collection
- **THEN** the result MUST include supported Email and IM channel definitions and their current safe configuration states
- **AND** callers MUST NOT need to query Email or IM persistence directly

#### Scenario: One channel is requested

- **WHEN** a supported channel kind and provider are requested
- **THEN** management MUST dispatch the request to the matching channel handler

#### Scenario: Unsupported channel is requested

- **WHEN** no registered handler supports the requested channel kind and provider
- **THEN** management MUST return a stable unsupported-channel result
- **AND** it MUST NOT perform provider or persistence work

#### Scenario: A lower-level provider is not part of Channels management

- **WHEN** an IM provider exists in a lower-level persistence or transport enum but is not Slack, Feishu or DingTalk
- **THEN** management MUST NOT define a channel reference or candidate command for that provider
- **AND** it MUST NOT register a handler for that provider

### Requirement: The handler registry MUST route complete channel references directly

`ChannelHandlerRegistry` MUST register exactly one handler for each supported complete channel kind/provider reference. A handler MUST own exactly one reference; the registry MUST NOT group several provider references through an Email-family or IM-family handler or deduplicate handlers by object identity.

#### Scenario: Supported handlers are registered

- **WHEN** Resend, Slack, Feishu and DingTalk management handlers are composed
- **THEN** the registry MUST contain four independently addressable entries
- **AND** each entry MUST expose exactly the complete reference used as its registry key

#### Scenario: IM handlers share lifecycle dependencies

- **WHEN** Slack, Feishu and DingTalk handlers use the same IM Control Plane repository or application dependencies
- **THEN** each handler MUST still be registered under only its own provider reference
- **AND** shared dependencies MUST preserve the single-active integration and provider-replacement invariants behind the handlers

### Requirement: Common channel views MUST be credential-free persisted-state snapshots

Every configured or available channel MUST be represented by a common safe view of its persisted configuration state while provider-specific secrets and persistence records remain behind its handler. A candidate test outcome MUST NOT be represented as a `ChannelView` or mix candidate fields with current persisted fields.

#### Scenario: Configured Email is viewed

- **WHEN** the Resend Email channel is configured
- **THEN** the common view MUST expose Email kind, Resend provider, Workspace scope, configured state, safe sender summary and supported capabilities
- **AND** it MUST NOT expose plaintext, encrypted or masked API key material

#### Scenario: Configured IM is viewed

- **WHEN** an IM integration is configured
- **THEN** the common view MUST expose IM kind, provider, effective ownership scope, safe connection status and supported capabilities
- **AND** it MUST NOT expose credentials, provider raw payloads, identities, bindings or ORM records

#### Scenario: Channel status is read

- **WHEN** a channel is listed or read
- **THEN** its status and last-check metadata MUST be treated as a non-live snapshot
- **AND** management MUST NOT perform provider I/O to refresh that snapshot
- **AND** a future capability MAY refresh it from delivery/send logs or a concrete provider credential and capability probe

#### Scenario: A candidate connection is tested

- **WHEN** a provider accepts or evaluates candidate settings
- **THEN** management MUST return a credential-free `ChannelTestResult` describing only that candidate test
- **AND** it MUST NOT copy configured state, persisted integration identity or configuration revision into the test result
- **AND** it MUST NOT present candidate fields as the current persisted channel view

### Requirement: Management commands MUST preserve provider-specific configuration types

Save and test operations MUST use discriminated channel/provider commands rather than untyped configuration maps.

#### Scenario: Resend candidate is submitted

- **WHEN** a command carries an Email/Resend discriminator
- **THEN** management MUST validate it as a complete Resend candidate before invoking the Email handler

#### Scenario: IM candidate is submitted

- **WHEN** a command carries an IM/provider discriminator
- **THEN** management MUST validate the matching provider-specific integration command before invoking the IM handler
- **AND** IM secret fields MUST accept only explicit new secret values in this change
- **AND** management MUST NOT define an existing-secret retention directive for IM candidates

#### Scenario: Discriminator and payload disagree

- **WHEN** the channel/provider discriminator does not match the candidate payload
- **THEN** management MUST reject the command before handler, provider or persistence work

#### Scenario: A test command succeeds

- **WHEN** a discriminated Email or IM candidate test succeeds
- **THEN** the operation envelope MUST contain exactly one test result
- **AND** it MUST contain neither a persisted-state view nor a failure

### Requirement: Channel capabilities MUST define valid management operations

Each channel view MUST advertise the management operations implemented for its provider. Capabilities are static provider-level declarations in this change; credential validity and current provider health belong to the separate status snapshot. Management MUST reject operations that the selected channel does not support.

#### Scenario: Email capabilities are returned

- **WHEN** the Resend Email channel is listed
- **THEN** its capabilities MUST describe configuration, test, delete and secret-retention support

#### Scenario: IM capabilities are returned

- **WHEN** an IM provider is listed
- **THEN** its capabilities MUST describe configuration, test, delete and provider-replacement support
- **AND** it MUST NOT advertise secret retention until its concrete provider port implements existing-secret resolution and protected credential merging

#### Scenario: Unsupported operation is requested

- **WHEN** a caller requests an operation absent from the channel capabilities
- **THEN** management MUST return a stable unsupported-operation result before side effects

### Requirement: Trusted management context MUST determine channel scope

Channel handlers MUST derive ownership from the server-provided management context rather than accepting arbitrary tenant ownership in provider payloads.

#### Scenario: Email command is dispatched

- **WHEN** an Email command is handled
- **THEN** the handler MUST scope it to the trusted current Workspace

#### Scenario: IM command is dispatched

- **WHEN** an IM command is handled
- **THEN** the handler MUST map the trusted Workspace, Organization and deployment facts to the ownership required by the IM Control Plane

#### Scenario: Cross-scope record is encountered

- **WHEN** a handler resolves a configuration or integration owned by another scope
- **THEN** it MUST NOT expose or mutate that record

### Requirement: Email and one active IM channel MUST coexist independently

Channel management MUST allow one Workspace Email configuration to coexist with the active IM integration and MUST preserve channel-specific replacement rules.

#### Scenario: Email and IM are configured

- **WHEN** one Resend configuration and one active IM integration exist
- **THEN** both MUST appear as configured channels

#### Scenario: Email changes

- **WHEN** Email is saved or deleted
- **THEN** management MUST NOT modify the active IM integration, identities, bindings or sync state

#### Scenario: IM changes

- **WHEN** an IM provider is saved, replaced or deleted
- **THEN** management MUST NOT modify the Email configuration

#### Scenario: Another IM provider is selected

- **WHEN** one active IM integration exists and a different IM provider is selected
- **THEN** management MUST delegate to the existing explicit IM replacement semantics
- **AND** it MUST NOT create an unconfirmed second active IM integration

### Requirement: IM management MUST delegate to the existing IM Control Plane

The IM channel handler MUST preserve the current IM aggregate's configuration revision, credential rotation, provider replacement, identity invalidation, binding and synchronization rules.

#### Scenario: IM credentials rotate

- **WHEN** the IM Control Plane classifies a command as credential rotation
- **THEN** the channel handler MUST return the resulting safe state without invalidating identities or bindings itself

#### Scenario: IM provider identity is replaced

- **WHEN** the IM Control Plane classifies a command as provider or provider-tenant replacement
- **THEN** the channel handler MUST preserve the aggregate decision and its atomic invalidation effects

#### Scenario: IM write is stale

- **WHEN** the IM Control Plane rejects a command through its complete CAS token
- **THEN** channel management MUST return a safe stale-configuration result
- **AND** it MUST NOT retry the write without a new authoritative state

### Requirement: Channel failures MUST be safe and attributable

Management MUST expose stable common failure categories and MAY include a safe provider-specific code required for user recovery.

#### Scenario: Provider validation fails

- **WHEN** an Email or IM handler returns a classified provider failure
- **THEN** management MUST preserve the common failure category and safe channel-specific code

#### Scenario: Handler raises an unexpected failure

- **WHEN** a channel handler cannot classify an unexpected failure
- **THEN** management MUST return a generic safe channel failure
- **AND** it MUST not expose credentials, provider raw responses or persistence diagnostics

#### Scenario: Channel operation is logged

- **WHEN** management writes logs or metrics for a channel operation
- **THEN** records MAY contain safe scope, channel, provider and operation identifiers
- **AND** they MUST NOT contain credential values or provider payloads
