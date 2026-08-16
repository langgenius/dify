## MODIFIED Requirements

### Requirement: Channel management MUST expose Email and IM through one facade

The system MUST provide one management boundary for discovering, reading, testing, saving and deleting the Resend Email channel plus the current five IM provider families: Slack, Feishu/Lark, DingTalk, Microsoft Teams and WeCom. `feishu` and `lark` MUST remain separately addressable canonical provider values backed by the same provider family. Callers MUST NOT query provider persistence directly.

#### Scenario: Channels are listed

- **WHEN** a trusted management context requests the current Channels collection
- **THEN** the result MUST include Resend and the safe current state for every IM provider named by this requirement
- **AND** none of the current IM providers MAY be represented by an unavailable placeholder handler

#### Scenario: One channel is requested

- **WHEN** a supported channel kind and provider are requested
- **THEN** management MUST dispatch the request to the matching concrete channel handler

#### Scenario: Unsupported channel is requested

- **WHEN** no registered handler supports the requested channel kind and provider
- **THEN** management MUST return a stable unsupported-channel result
- **AND** it MUST NOT perform provider or persistence work

### Requirement: The handler registry MUST route complete channel references directly

`ChannelHandlerRegistry` MUST register exactly one concrete handler for Resend and each canonical current IM provider value. A handler MUST own exactly one complete channel kind/provider reference; the registry MUST NOT group several references through an Email-family or IM-family registry key or deduplicate handlers by object identity.

#### Scenario: Supported handlers are registered

- **WHEN** the production management composition is built
- **THEN** the registry MUST contain seven independently addressable entries: one for Resend and one for each current canonical IM provider value
- **AND** each entry MUST expose exactly the complete reference used as its registry key

#### Scenario: IM handlers share lifecycle dependencies

- **WHEN** current IM handlers use the same IM Control Plane repository or application dependencies
- **THEN** each handler MUST still be registered under only its own provider reference
- **AND** shared dependencies MUST preserve the single-active Integration and provider-replacement invariants behind the handlers

### Requirement: Management commands MUST preserve provider-specific configuration types

Save and test operations MUST use discriminated channel/provider commands rather than untyped configuration maps. The command union MUST cover Resend plus every current canonical IM provider value and MUST validate the matching provider-specific candidate before invoking a handler. A provider MAY accept an explicit preserve-secret directive only when its concrete port implements protected current-secret resolution and merging.

#### Scenario: Resend candidate is submitted

- **WHEN** a command carries an Email/Resend discriminator
- **THEN** management MUST validate it as a complete Resend candidate before invoking the Email handler

#### Scenario: Current IM candidate is submitted

- **WHEN** a command carries an IM discriminator for a current supported IM provider
- **THEN** management MUST validate the corresponding provider-specific candidate before invoking its concrete IM handler
- **AND** a secret field without supported protected retention MUST require an explicit new secret value

#### Scenario: Discriminator and payload disagree

- **WHEN** the channel/provider discriminator does not match the candidate payload
- **THEN** management MUST reject the command before handler, provider or persistence work

#### Scenario: A test command succeeds

- **WHEN** a discriminated Email or IM candidate test succeeds
- **THEN** the operation envelope MUST contain exactly one credential-free test result
- **AND** it MUST contain neither a persisted-state view nor a failure

## ADDED Requirements

### Requirement: Successful IM configuration MUST persist verified connectivity

Every current IM save path MUST validate credentials, required directory scopes and provider tenant identity, then persist the resulting safe connectivity diagnostic together with the accepted configuration. A separate candidate test MUST remain non-persistent.

#### Scenario: New IM configuration validates successfully

- **WHEN** an IM provider accepts the candidate credentials, confirms required scopes, and returns the provider tenant identity during save
- **THEN** the persisted Integration MUST have connected status and a trusted `last_checked_at`
- **AND** the returned safe channel view MUST be immediately eligible for directory sync

#### Scenario: Existing IM credentials rotate successfully

- **WHEN** a complete-revision save validates and persists replacement credentials for the same provider tenant
- **THEN** the configuration transition MUST advance `config_version` exactly once
- **AND** the connected diagnostic MUST be persisted atomically with that transition
- **AND** persisting the diagnostic MUST NOT advance `config_version` separately
- **AND** existing identities and bindings MUST remain governed by the credential-rotation invariant

#### Scenario: Candidate validation fails

- **WHEN** provider authentication, required scope validation, or tenant identity resolution fails during save
- **THEN** no configuration or connectivity diagnostic MUST be created or replaced
- **AND** the response MUST contain only the stable safe provider failure

#### Scenario: Candidate is tested without save

- **WHEN** a candidate test succeeds for an unconfigured or configured IM channel
- **THEN** management MUST return a credential-free `ChannelTestResult`
- **AND** it MUST NOT persist credentials, status, `last_checked_at`, or a configuration revision
