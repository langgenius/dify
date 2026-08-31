# human-input-channel-management Specification

## Purpose

Defines the Console transport boundary for Human Input Email and IM channels while preserving each application owner's lifecycle and persistence invariants.
## Requirements
### Requirement: Console collections MUST aggregate independent Email and IM owners
The Console controller MUST call the Email Management owner and `IMChannelService` for listing、reading、testing、creating、updating、replacing and deleting Channels。The unified HTTP collection and Provider catalog MUST remain transport-level aggregation and MUST NOT introduce a cross-kind application service、service bundle or persistence owner。Controllers MUST NOT read owner persistence directly。

#### Scenario: Configured Channels are listed
- **WHEN** an authenticated caller requests configured Channels
- **THEN** controller MUST aggregate current Email and IM Channel views
- **AND** it MUST NOT construct a not-configured Channel for each Provider

#### Scenario: Available providers are listed
- **WHEN** an authenticated caller requests available Channel Providers
- **THEN** controller MUST aggregate only Providers returned by Email owner and `IMChannelService`
- **AND** Provider availability MUST remain separate from persisted Channel state

#### Scenario: One configured Channel is requested
- **WHEN** caller supplies kind and `channel_id`
- **THEN** controller MUST delegate to the corresponding application owner
- **AND** it MUST NOT select a Provider implementation from persistence

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
The confirmed Console Channel routes are CE/SaaS Workspace APIs。Channel composition MUST derive trusted Workspace context from the authenticated Console route。Every IM Provider、collection、read、test and mutation handler MUST bind current `TenantId`、Dify `AccountId`、Session factory and Key Provider before constructing one request-scoped `WorkspaceIMChannelService`。The Service MUST initialize its Workspace Reader、Writer and tenant credential codec internally。Provider payloads and Service operation methods MUST NOT select or override owner。EE management MUST use a later deployment-bound Dify inner API rather than edition branches in this controller。

#### Scenario: Email command is delegated
- **WHEN** an Email command is handled
- **THEN** the Console controller MUST scope the Email owner call to the trusted current Workspace

#### Scenario: IM command is delegated
- **WHEN** a Workspace owner or administrator manages an IM Channel
- **THEN** composition MUST construct an owner-bound Service before invoking the operation
- **AND** operation arguments MUST NOT contain scope、Tenant or actor

#### Scenario: Workspace Channel request reaches the controller
- **WHEN** an authenticated CE/SaaS caller invokes any confirmed IM Channel route
- **THEN** the controller MUST validate transport parameters and construct the owner-bound Workspace Service from trusted current context
- **AND** it MUST delegate resource existence and Channel decisions to the Service without reading persistence or performing Provider I/O

#### Scenario: Cross-scope record is encountered
- **WHEN** an Email or IM Channel ID is not current for the trusted Workspace owner
- **THEN** the owner-bound application owner MUST return not found or stale according to operation state
- **AND** it MUST NOT inspect、expose or mutate another owner's Channel

#### Scenario: EE management is exposed
- **WHEN** a later EE integration manages a deployment-owned Channel
- **THEN** it MUST call a separate Dify inner API and deployment-bound Service construction path
- **AND** the Workspace Console controller MUST NOT branch on edition

### Requirement: Email and one active IM channel MUST coexist independently
Channel Management MUST allow one Workspace Email Channel and at most one current IM Channel in the effective trusted owner context to coexist。Email and IM application owners MUST enforce their cardinality independently。The collection MUST represent persisted resources rather than one slot per Provider。

#### Scenario: Email and IM are configured
- **WHEN** one Resend configuration and one current IM Channel exist
- **THEN** both MUST appear in the configured Channels collection

#### Scenario: Email changes
- **WHEN** Email Channel is created、updated or deleted
- **THEN** management MUST NOT modify IM Channel or dependent IM state

#### Scenario: IM changes
- **WHEN** IM Channel is created、updated、replaced or deleted
- **THEN** management MUST NOT modify Email configuration

#### Scenario: A second IM Channel is created
- **WHEN** bound owner already has a Channel and ordinary create is requested
- **THEN** `IMChannelService` MUST reject before avoidable Provider I/O
- **AND** concurrent conflict MUST still be decided by Repository

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
Every IM create、ordinary update or replacement MUST validate complete credentials、required Provider permissions and Provider tenant identity before opening the write transaction。Credential protection MUST produce canonical `IMEncryptedCredentials` before persistence。Candidate test MUST validate only the submitted candidate and MUST NOT access Channel persistence。

#### Scenario: IM configuration validates successfully
- **WHEN** Provider accepts credentials and required checks pass
- **THEN** `IMChannelService` MUST construct a complete Channel value
- **AND** it MUST persist that value in a later short transaction

#### Scenario: Provider validation fails
- **WHEN** credential authentication、permission or Provider tenant resolution fails
- **THEN** no Channel transaction or mutation MUST begin

#### Scenario: Connection test succeeds
- **WHEN** submitted candidate passes Provider validation
- **THEN** management MUST return credential-free success
- **AND** it MUST NOT read persisted credentials or persist state

### Requirement: Edition and Channel API ownership mismatch MUST return HTTP 501
Workspace Console Channel APIs and deployment-bound EE inner APIs MUST fail closed when invoked in the wrong deployment edition。The edition gate MUST run at transport admission before setup、authentication、DTO parsing、trusted owner resolution or Service construction。It MUST return HTTP `501 Not Implemented` and MUST NOT pass edition into application or persistence operations。

#### Scenario: Enterprise calls the Workspace Console API
- **WHEN** any canonical Workspace Channel collection、item、test or replacement path is requested on Enterprise
- **THEN** transport admission MUST return HTTP `501` before authentication or application dispatch
- **AND** it MUST NOT resolve Workspace ownership or access deployment-owned Channel state

#### Scenario: Community or Cloud calls the EE inner API
- **WHEN** a future deployment-bound EE Channel inner path is requested on Community or Cloud
- **THEN** transport admission MUST return HTTP `501` before inner authentication or application dispatch
- **AND** it MUST NOT resolve deployment ownership or access Workspace-owned Channel state

#### Scenario: API and edition match
- **WHEN** a Workspace Channel path is requested on Community or Cloud，or an EE Channel inner path is requested on Enterprise
- **THEN** the edition gate MUST continue into that API's own authentication and owner-bound composition
- **AND** Service operations MUST remain edition-agnostic

#### Scenario: Cross-owner Channel ID is supplied
- **WHEN** item operation supplies a Channel ID not current in the bound Repository
- **THEN** management MUST return not found or stale according to operation state
- **AND** it MUST NOT inspect another owner

### Requirement: IM Channel Webhook projection MUST remain credential-free
`IMChannelService` MUST derive `IMChannelView.webhook_url` from effective deployment transport mode、`IMProvider.supports_webhook()`、current `TRIGGER_URL` and persisted `webhook_id`。The Console controller MUST only map that field into canonical `ChannelSummary`。Projection MUST NOT decrypt credentials、construct an adapter or call a Provider。

#### Scenario: Webhook-capable Channel is projected
- **WHEN** effective mode is `WEBHOOK` and `IMProvider.supports_webhook()` returns `True`
- **THEN** list、detail、create、update and replacement summaries MUST return the derived `webhook_url`
- **AND** each path MUST use the same `_to_view()` projection

#### Scenario: Channel does not expose a Webhook URL
- **WHEN** effective mode is `STREAM` or `IMProvider.supports_webhook()` returns `False`
- **THEN** `ChannelSummary.webhook_url` MUST be `None`
- **AND** the configured Channel MUST remain visible

#### Scenario: Deployment origin changes
- **WHEN** operator changes `TRIGGER_URL`
- **THEN** the next summary MUST contain the new origin
- **AND** management MUST NOT update the Channel row、configuration version or credential envelope

### Requirement: IM Channel commands MUST use IMChannelService
Console controller MUST delegate IM candidate test、create、ordinary update、explicit replacement and delete to `IMChannelService`。Controller MUST NOT construct Repository values、call Repository、perform Provider I/O、choose update versus replacement or own database transaction。

#### Scenario: IM credentials rotate within one Provider tenant
- **WHEN** update preparation confirms same Provider and Provider tenant
- **THEN** Service MUST preserve Channel ID and `webhook_id`
- **AND** it MUST advance numeric version exactly once

#### Scenario: IM item update requires replacement
- **WHEN** update preparation resolves different Provider or Provider tenant
- **THEN** Service MUST return `replacement_required` without Repository mutation

#### Scenario: IM installation is explicitly replaced
- **WHEN** replacement receives current ID/version and complete credentials
- **THEN** Service MUST generate new Channel ID and `webhook_id` at initial version
- **AND** it MUST invoke Repository replacement only

#### Scenario: IM Channel is deleted
- **WHEN** delete receives current ID/version
- **THEN** Service MUST invoke Repository delete without Provider I/O
- **AND** it MUST not orchestrate another domain's cleanup

#### Scenario: IM write is stale
- **WHEN** Repository raises stale write
- **THEN** Service MUST return `provider_configuration_updated`
- **AND** it MUST not retry against newer state

#### Scenario: HTTP version is mapped to Service input
- **WHEN** controller receives opaque `ConfigVersion` with path `channel_id`
- **THEN** codec MUST pass decoded numeric version and Channel ID separately to Service
- **AND** wire format MUST remain unchanged
