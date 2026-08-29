# human-input-channel-management-console-api Specification

## Purpose
TBD - created by archiving change implement-human-input-channel-management-api. Update Purpose after archive.
## Requirements
### Requirement: The Console API MUST expose one canonical Channels resource

The system MUST expose collection and item operations for the supported complete channel references through `/console/api/workspaces/current/human-input/channels`. The supported references MUST be `email/resend`, `im/slack`, `im/feishu` and `im/ding_talk`.

#### Scenario: Channels collection is read

- **WHEN** an authorized caller reads the Channels collection
- **THEN** the response MUST contain one safe persisted-state view for each successfully read supported reference
- **AND** Resend MUST appear in `channels`
- **AND** the unimplemented Slack, Feishu and DingTalk references MUST appear in `failures` in product order

#### Scenario: Resend channel is read

- **WHEN** an authorized caller reads the `email/resend` path
- **THEN** the response MUST contain the current safe persisted-state view for Resend
- **AND** an unconfigured Resend reference MUST return a successful not-configured view

#### Scenario: Unsupported reference is read

- **WHEN** the path kind/provider combination is not one of the supported complete references
- **THEN** the API MUST return the stable unsupported-channel error
- **AND** it MUST NOT perform provider or persistence work

### Requirement: Channel routes MUST be restricted to trusted Workspace administrators

Every Community and Cloud Channels route MUST require an authenticated, initialized Workspace Owner or Admin. The management scope and actor facts MUST come from server state.

#### Scenario: Owner manages a channel

- **WHEN** a Workspace Owner calls a Channels route
- **THEN** the operation MUST use the current Workspace, authenticated account ID and authenticated account Email

#### Scenario: Non-admin member accesses Channels

- **WHEN** a member who is neither Owner nor Admin calls a Channels route
- **THEN** the API MUST reject the request before facade, repository or provider work

#### Scenario: Payload attempts to select ownership

- **WHEN** a request includes an unknown tenant, Organization or deployment ownership field
- **THEN** strict request validation MUST reject the payload
- **AND** the caller MUST NOT be able to redirect the operation to another scope

#### Scenario: Unimplemented IM reference is requested

- **WHEN** an authenticated caller requests Slack, Feishu or DingTalk management
- **THEN** the API MUST return `unsupported_operation` with code `im_channel_management_not_implemented`
- **AND** it MUST NOT perform IM provider, credential-protection or persistence work

#### Scenario: Resend management operation is requested

- **WHEN** an authenticated caller reads, saves, tests or deletes a Resend candidate
- **THEN** the API MUST dispatch the operation through the common facade and Email manager
- **AND** provider I/O MUST remain behind the Resend adapter

### Requirement: Community and Cloud support MUST NOT alter Enterprise IM behavior

Functional support in this change MUST target Community and Cloud. One pre-dispatch edition gate MUST return HTTP `501` for the canonical Channels paths on Enterprise. The channel-management composition MUST leave shared Organization and deployment ownership fields unset and MUST NOT resolve or access Enterprise deployment-wide IM state.

#### Scenario: Workspace management context is built

- **WHEN** a Community or Cloud request enters the canonical Channels API
- **THEN** the context MUST contain only the current Workspace and authenticated actor facts required by Resend
- **AND** it MUST NOT perform edition-specific Organization or deployment identity resolution

#### Scenario: The change is present in an Enterprise deployment

- **WHEN** any request targets a canonical Channels collection, item or test path on Enterprise
- **THEN** the API MUST return HTTP `501` before authentication decorators, DTO mapping, composition or facade dispatch
- **AND** it MUST NOT resolve, read, write or reinterpret deployment-wide IM ownership, configuration, credentials or provider state
- **AND** existing Enterprise IM behavior MUST remain unchanged

### Requirement: Save and test requests MUST use provider-discriminated DTOs

The API MUST define separate Resend, Slack, Feishu and DingTalk candidate variants. The request discriminator and payload MUST match the complete reference in the route.

#### Scenario: Resend candidate is submitted

- **WHEN** the route is `email/resend` and the payload contains a valid Resend candidate
- **THEN** the API MUST construct the corresponding Email management command

#### Scenario: IM candidate is submitted

- **WHEN** the route is one supported IM provider and the payload contains that provider's complete candidate
- **THEN** the API MAY validate and construct the reserved provider-specific command shape
- **AND** facade dispatch MUST return the stable unimplemented response before IM infrastructure work

#### Scenario: Route and payload disagree

- **WHEN** route kind/provider and candidate discriminator do not match
- **THEN** the API MUST return a validation failure before facade, provider or persistence work

#### Scenario: Extra credential field is submitted

- **WHEN** a request contains a credential or configuration field outside its selected candidate schema
- **THEN** strict DTO validation MUST reject it

### Requirement: Email credential directives MUST have unambiguous transport semantics

The Resend DTO MUST distinguish a non-blank new API key from an omitted or blank retain-existing directive. Production save and test MUST execute that explicit directive through the Email manager without returning credential material.

#### Scenario: Email is configured for the first time

- **WHEN** a Resend request submits a non-blank API key
- **THEN** the API MUST map it to a new-secret candidate
- **AND** the submitted value MUST NOT appear in any response

#### Scenario: Existing Email key is retained

- **WHEN** a Resend request omits the API key or submits a blank value
- **THEN** the API MUST map that input to explicit existing-key retention
- **AND** the current Workspace credential MUST be revealed only for transient provider validation
- **AND** the protected credential MUST remain unchanged after a successful retained-key update

### Requirement: Resend save and test MUST be functional and safely separated

Resend save MUST validate the complete candidate without sending Email before persisting it. Resend test MUST validate the complete candidate and send exactly one test Email to the authenticated operator without persisting it.

#### Scenario: Resend candidate is saved

- **WHEN** a Full access API key can list domains and the exact sender domain is verified with sending enabled
- **THEN** save MUST persist the protected candidate through the existing Email repository
- **AND** it MUST return the resulting credential-free configured view
- **AND** it MUST NOT send an Email

#### Scenario: Sending-only key is submitted

- **WHEN** Resend reports that the candidate key is restricted to sending and cannot inspect domains
- **THEN** save or test MUST return a validation failure with code `provider_full_access_required`
- **AND** no configuration MUST be created or replaced

#### Scenario: Sender domain is unusable

- **WHEN** the exact sender domain is absent, not verified or has sending disabled
- **THEN** save or test MUST return the corresponding stable sender-domain failure
- **AND** no configuration MUST be created or replaced

#### Scenario: Resend candidate is tested

- **WHEN** the candidate validates and Resend accepts the test message
- **THEN** test MUST send exactly one Email to the authenticated operator Email
- **AND** the provider request MUST carry a unique idempotency key
- **AND** the response MUST be a credential-free candidate-test result
- **AND** no part of the candidate MUST be persisted

#### Scenario: Resend provider or transport fails

- **WHEN** Resend rejects the candidate, exhausts quota, rate limits, returns a malformed response or cannot be reached
- **THEN** the API MUST return a stable validation or provider failure
- **AND** no provider body, request header, exception text or credential material MUST appear in the response or logs

### Requirement: Non-Resend channel operations MUST remain explicit placeholders

Slack, Feishu and DingTalk MUST remain unimplemented in this change. Their registered complete references MUST return one stable unsupported-operation result and MUST NOT call existing IM managers, repositories, credential protectors or providers.

#### Scenario: IM channel is read

- **WHEN** a caller reads one Slack, Feishu or DingTalk item
- **THEN** the API MUST return `unsupported_operation` with code `im_channel_management_not_implemented`

#### Scenario: IM secret retention marker is submitted

- **WHEN** an IM candidate contains a preserve-existing, masked or omitted required secret
- **THEN** strict placeholder DTO validation MUST reject it

#### Scenario: IM mutation or test is requested

- **WHEN** a valid reserved IM candidate or delete request reaches facade dispatch
- **THEN** the API MUST return the stable unimplemented response
- **AND** it MUST NOT validate provider credentials, protect secrets, load IM state or write IM state

### Requirement: Persisted views MUST remain credential-free

Read, save and delete responses MUST contain only persisted-state views. Candidate-test response DTOs MUST remain structurally distinct from persisted views.

#### Scenario: Channel delete succeeds

- **WHEN** a configured channel is deleted
- **THEN** the response MUST contain the resulting not-configured view
- **AND** the client MUST NOT need an immediate follow-up read to replace that cache entry

#### Scenario: Credential-bearing response is attempted

- **WHEN** a response is serialized for any Channels route
- **THEN** it MUST NOT contain plaintext, encrypted or masked credential material

### Requirement: Collection reads MUST isolate safe channel failures

One handler read failure MUST NOT prevent other supported channel views from being returned.

#### Scenario: One channel read fails

- **WHEN** one registered handler fails while other handlers return safe views
- **THEN** the collection response MUST return the successful views
- **AND** it MUST include one credential-free failure associated with the failed complete reference

#### Scenario: Collection is read

- **WHEN** the collection endpoint builds persisted-state views
- **THEN** it MUST NOT call any external provider

### Requirement: Failure responses MUST be stable and credential-free

The API MUST map management categories to stable HTTP statuses and safe bodies without exposing provider or persistence internals.

#### Scenario: Request validation fails

- **WHEN** request DTO or route/candidate validation fails
- **THEN** the API MUST return a client error with a stable category and optional safe code or field

#### Scenario: JSON transport is invalid

- **WHEN** a save or test request contains malformed JSON or uses an unsupported non-JSON content type
- **THEN** the API MUST return HTTP `400` with `validation_failure` and code `invalid_request`
- **AND** it MUST NOT construct the channel-management service or perform provider or persistence work

#### Scenario: Configuration conflict occurs

- **WHEN** a create conflicts or a write/delete is stale
- **THEN** the API MUST return an HTTP conflict with the corresponding stable category

#### Scenario: Unexpected channel failure occurs

- **WHEN** an unexpected management failure cannot be classified
- **THEN** the API MUST return a generic channel failure
- **AND** logs and responses MUST remain credential-free

### Requirement: The obsolete Email provider stub MUST not remain an alternative authority

The non-functional Email provider route MUST be removed or made unavailable when the canonical Resend route lands. Existing IM integration routes MAY remain 501-only stubs and MUST NOT gain implementation in this change.

#### Scenario: Canonical API is enabled

- **WHEN** the unified Channels controllers are registered
- **THEN** Resend reads, validated saves, deletes and operator-targeted tests MUST dispatch through the common management facade
- **AND** no controller MUST call Email persistence directly

#### Scenario: Legacy stub path is requested

- **WHEN** a caller requests the removed Email provider path
- **THEN** the route MUST NOT expose an independently implemented Email lifecycle

#### Scenario: Existing IM stub path is requested

- **WHEN** a caller requests an existing IM integration stub path
- **THEN** it MUST remain unimplemented
