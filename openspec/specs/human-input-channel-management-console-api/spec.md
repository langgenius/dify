# human-input-channel-management-console-api Specification

## Purpose

Defines the authenticated Workspace Console v2 transport that projects independent Email and IM management owners through one safe, discriminated API.
## Requirements
### Requirement: The Console API MUST expose one canonical Channels resource

The Console API MUST expose the canonical prefix `/console/api/workspace/current/human-input/v2`。It MUST expose one configured Channel collection at `GET /channels` and one available-provider catalog at `GET /channel-providers`。Email and IM create、test and ID-addressed item routes MUST remain separated by kind。Every route MUST require a workspace owner or administrator。

#### Scenario: Configured Channels are listed

- **WHEN** an authorized caller requests `GET /console/api/workspace/current/human-input/v2/channels`
- **THEN** the response MUST contain every configured Email and IM Channel
- **AND** an unconfigured provider MUST NOT appear as a `not_configured` Channel

#### Scenario: Available providers are listed

- **WHEN** an authorized caller requests `GET /console/api/workspace/current/human-input/v2/channel-providers`
- **THEN** the response MUST contain `email_providers` and `im_providers`
- **AND** each entry MUST contain only `provider` and `connection_mode`
- **AND** this change MUST return only `custom_app` as `connection_mode`
- **AND** an unavailable provider MUST be omitted instead of being returned with availability state or a reason

#### Scenario: Kind-specific discovery path is requested

- **WHEN** a caller sends `GET /channels/email`、`GET /channels/im`、`GET /channel-providers/email` or `GET /channel-providers/im`
- **THEN** the v2 controller MUST NOT register that method/path as another collection or catalog authority

#### Scenario: One configured Channel is read

- **WHEN** an authorized caller requests `GET /channels/<kind>/<channel_id>`
- **THEN** the response MUST describe exactly the persisted Channel identified by `<kind>` and `<channel_id>`
- **AND** it MUST NOT describe a provider slot or another current Channel

#### Scenario: Channel item does not exist

- **WHEN** `<channel_id>` is absent、belongs to another scope or does not match the route kind
- **THEN** item GET、PUT and DELETE MUST return `404`
- **AND** they MUST NOT read or mutate another Channel

### Requirement: Channel routes MUST be restricted to trusted Workspace administrators

Every Community and Cloud Channels route MUST require an authenticated, initialized Workspace Owner or Admin. The management scope and actor facts MUST come from server state.

#### Scenario: Owner manages a channel

- **WHEN** a Workspace Owner calls a Channels route
- **THEN** the operation MUST use the current Workspace, authenticated account ID and authenticated account Email

#### Scenario: Non-admin member accesses Channels

- **WHEN** a member who is neither Owner nor Admin calls a Channels route
- **THEN** the API MUST reject the request before application-owner or provider work

#### Scenario: Payload attempts to select ownership

- **WHEN** a request includes an unknown tenant, Organization or deployment ownership field
- **THEN** strict request validation MUST reject the payload
- **AND** the caller MUST NOT be able to redirect the operation to another scope

#### Scenario: Resend management operation is requested

- **WHEN** an authenticated caller reads, saves, tests or deletes a Resend candidate
- **THEN** the API MUST dispatch the operation directly to the Email Management owner
- **AND** provider I/O MUST remain behind the Resend adapter

### Requirement: Community and Cloud support MUST NOT alter Enterprise IM behavior

Functional support in this change MUST target Community and Cloud. One pre-dispatch edition gate MUST return HTTP `501` for the canonical Channels paths on Enterprise. The Console v2 transport MUST NOT resolve or access Enterprise deployment-wide IM state.

#### Scenario: Workspace management context is built

- **WHEN** a Community or Cloud request enters the canonical Channels API
- **THEN** the context MUST contain only the current Workspace and authenticated actor facts required by Resend
- **AND** it MUST NOT perform edition-specific Organization or deployment identity resolution

#### Scenario: The change is present in an Enterprise deployment

- **WHEN** any request targets a canonical Channels collection, item or test path on Enterprise
- **THEN** the API MUST return HTTP `501` before authentication decorators, DTO mapping or application-owner dispatch
- **AND** it MUST NOT resolve, read, write or reinterpret deployment-wide IM ownership, configuration, credentials or provider state
- **AND** existing Enterprise IM behavior MUST remain unchanged

### Requirement: Console v2 MUST own provider credential DTOs

`api/controllers/console/human_input_v2/providers.py` MUST be the canonical Console owner of `IMProviderCredentials`、`EmailProviderCredentials` and their provider-specific variants。Old controller transport DTOs that repeat these fields MUST be deleted or migrated。The Email and IM application owners MAY keep internal domain credential types, but those types MUST NOT register or define a second HTTP contract。

#### Scenario: Provider credentials are submitted

- **WHEN** a create、update、replacement or test request supplies `credentials`
- **THEN** strict Pydantic validation MUST select exactly one provider-specific variant through its `provider` discriminator
- **AND** the controller MUST map that DTO to the corresponding Email or IM application input and call that owner directly

#### Scenario: Secret fields are defined

- **WHEN** a provider DTO declares an API key、client secret、app secret、signing secret、bot token、app token、verification token、encrypt key or equivalent secret
- **THEN** the field MUST use Pydantic `SecretStr`
- **AND** its value MUST NOT enter DTO repr、logs or validation diagnostics

#### Scenario: Complete credentials are required

- **WHEN** create、update、replacement or test omits a required credential field or supplies a retention marker
- **THEN** strict DTO validation MUST reject the request
- **AND** the controller MUST NOT load persisted credentials to complete it

#### Scenario: Resend credentials are submitted

- **WHEN** a caller creates、updates or tests a Resend Channel
- **THEN** `sender_email`、`sender_name` and `api_key` MUST all be present and valid
- **AND** update MUST require the complete configuration instead of supporting partial update or API-key retention

#### Scenario: Extra provider field is submitted

- **WHEN** credentials contain a field outside the selected provider DTO
- **THEN** strict DTO validation MUST reject it before application、provider or persistence work

#### Scenario: Tenant submits Channel-level event transport

- **WHEN** IM credentials include `event_transport_mode`
- **THEN** strict DTO validation MUST reject the field
- **AND** the request MUST NOT shadow or mutate effective deployment runtime configuration

### Requirement: Resend save and test MUST be functional and safely separated

Resend save MUST validate the complete candidate without sending Email before persisting it. Resend test MUST validate the complete candidate and send exactly one test Email to the authenticated operator without persisting it.

#### Scenario: Resend candidate is saved

- **WHEN** a Full access API key can list domains and the exact sender domain is verified with sending enabled
- **THEN** save MUST persist the protected candidate through the existing Email repository
- **AND** it MUST return the resulting credential-free `ChannelSummary`
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

### Requirement: ChannelSummary MUST be the canonical configured-channel projection

`ChannelSummary` MUST contain `id`、`created_at`、`updated_at`、`kind`、`provider`、`status`、`status_description`、`display_identifier`、`webhook_url` and `config_version`。It MUST NOT contain plaintext、encrypted or masked credentials。The controller MUST NOT expose a second per-kind configured summary DTO。

#### Scenario: Configured Channel is listed

- **WHEN** a configured Email or IM Channel appears in `ListChannelsResponse.channels`
- **THEN** the entry MUST be a `ChannelSummary`

#### Scenario: Email Channel detail is read

- **WHEN** an Email item GET succeeds
- **THEN** the response MUST contain `summary`、`sender_name` and `sender_email`
- **AND** it MUST NOT contain `api_key` or an API-key configured marker

#### Scenario: IM Channel detail is read

- **WHEN** an IM item GET succeeds
- **THEN** the response MUST contain exactly one `summary` configured-state projection

#### Scenario: IM display identifier is built

- **WHEN** an IM `ChannelSummary` is returned
- **THEN** `display_identifier` MUST contain a safe app/client identifier or equivalent non-secret application identifier
- **AND** it MAY append a provider tenant display name when available
- **AND** it MUST NOT contain an API key、secret、token、encrypt key or masked credential

#### Scenario: Email display identifier is built

- **WHEN** an Email `ChannelSummary` is returned
- **THEN** `display_identifier` MUST include a safe client/app identifier when the provider has one and `${sender_name} ${sender_email}` when sender fields are available
- **AND** a Resend summary MUST use `${sender_name} ${sender_email}` without any API-key material

### Requirement: HTTP configuration versions MUST be client-opaque

`ConfigVersion` MUST be an opaque string in Console v2 responses and mutation inputs。A client MUST store and return it exactly as received and MUST NOT parse、decode、modify、interpret or synthesize it。The server MUST translate the path `channel_id` and opaque `ConfigVersion` to the complete owner-native CAS input。

#### Scenario: IM configuration is mutated

- **WHEN** an IM update、replacement or delete supplies the current opaque `expected_config_version`
- **THEN** the server MUST validate the path identity and the underlying numeric configuration version together
- **AND** the IM owner MUST retain its complete `channel_id + numeric config_version` CAS invariant

#### Scenario: Configuration version is stale

- **WHEN** the expected configuration version does not identify the current configuration revision
- **THEN** the API MUST return `409` with conflict code `provider_configuration_updated`
- **AND** it MUST leave current state unchanged

### Requirement: Configured Channel status MUST use the synchronous three-state contract

`ChannelSummary.status` MUST be one of `connected`、`invalid_credentials` or `connection_failure`。`status_description` MUST be empty when status is `connected` and MUST contain only a safe human-readable explanation for an error status。The response MUST NOT expose `last_checked_at` or an asynchronous creation status。

#### Scenario: Configured Channel is healthy

- **WHEN** a Channel is connected and ready for use
- **THEN** its status MUST be `connected`
- **AND** `status_description` MUST be empty

#### Scenario: Stored credentials are rejected

- **WHEN** a configured Channel is known to have invalid credentials
- **THEN** its status MUST be `invalid_credentials`
- **AND** `status_description` MUST NOT expose a credential or raw provider response

#### Scenario: Other classified connection failure is stored

- **WHEN** a configured Channel has another expected provider connection failure
- **THEN** its status MUST be `connection_failure`
- **AND** `status_description` MUST contain only a safe explanation

### Requirement: Mutation responses MUST return their resulting Channel identity

Create、update and replacement MUST return HTTP `200` with a response whose `summary` is the resulting `ChannelSummary`。Delete MUST return HTTP `200` with the deleted `channel_id`。No successful mutation requires a follow-up collection read to discover its resulting identity or configuration version。

#### Scenario: Channel create succeeds

- **WHEN** a new Email or IM Channel is created
- **THEN** the API MUST return `200` with `summary`

#### Scenario: Channel update succeeds

- **WHEN** an existing Channel is updated through its ID-addressed item route
- **THEN** the API MUST return `200` with the updated `summary`

#### Scenario: IM replacement succeeds

- **WHEN** an IM Channel is replaced through `/channels/im/<channel_id>/replacement`
- **THEN** the API MUST return `200` with the replacement `summary`

#### Scenario: Channel delete succeeds

- **WHEN** an existing Channel is deleted through its ID-addressed item route
- **THEN** the API MUST return `200` with the deleted `channel_id`

### Requirement: Candidate tests MUST be non-persistent and safely classified

`POST /channels/email/test` and `POST /channels/im/test` MUST use only the submitted complete credentials and MUST NOT read or mutate configured Channel state。Success MUST return HTTP `200` with `ChannelTestResponse`。Expected failures MUST use only `invalid_credentials` or `connection_failure`；an unexpected failure MUST return HTTP `500` without provider or internal error information。

#### Scenario: Candidate test succeeds

- **WHEN** submitted credentials pass provider validation
- **THEN** the API MUST return `200`
- **AND** the response MUST NOT contain credentials、persisted resource identity、configured status or configuration revision

#### Scenario: Candidate credentials are invalid

- **WHEN** the provider rejects submitted credentials as invalid
- **THEN** the API MUST classify the failure as `invalid_credentials`

#### Scenario: Expected provider operation fails

- **WHEN** a classified provider failure is not invalid credentials
- **THEN** the API MUST classify it as `connection_failure`

#### Scenario: Candidate test fails unexpectedly

- **WHEN** the failure is not a classified provider error
- **THEN** the API MUST return `500`
- **AND** it MUST NOT expose the exception、raw provider response or internal diagnostic

### Requirement: Failure responses MUST be stable and credential-free

The API MUST map management categories to stable HTTP statuses and safe bodies without exposing provider or persistence internals.

#### Scenario: Request validation fails

- **WHEN** request DTO or route/candidate validation fails
- **THEN** the API MUST return a client error with a stable category and optional safe code or field

#### Scenario: JSON transport is invalid

- **WHEN** a save or test request contains malformed JSON or uses an unsupported non-JSON content type
- **THEN** the API MUST return HTTP `400` with `validation_failure` and code `invalid_request`
- **AND** it MUST NOT invoke an application owner or perform provider or persistence work

#### Scenario: Configuration conflict occurs

- **WHEN** a create conflicts or a write/delete is stale
- **THEN** the API MUST return an HTTP conflict with the corresponding stable category

#### Scenario: Unexpected channel failure occurs

- **WHEN** an unexpected management failure cannot be classified
- **THEN** the API MUST return a generic channel failure
- **AND** logs and responses MUST remain credential-free

### Requirement: Channel create, update and replacement MUST express distinct resource transitions

`POST /channels/<kind>` MUST create a resource。`PUT /channels/<kind>/<channel_id>` MUST update exactly the addressed resource。IM provider or provider-tenant replacement MUST use `POST /channels/im/<channel_id>/replacement`。The API MUST NOT infer replacement from a provider-addressed URL or ordinary create。Stable conflict codes MUST correspond to distinct client recovery behavior。This change defines only `replacement_required` and `provider_configuration_updated`；the API MUST NOT introduce another stable conflict code without a concrete client recovery requirement。

#### Scenario: New IM Channel is created

- **WHEN** no active IM Channel exists and an administrator submits `POST /channels/im` with complete credentials
- **THEN** the API MUST create the resource and return `200` with its summary

#### Scenario: Ordinary IM create reaches current cardinality

- **WHEN** an active IM Channel exists and an administrator submits another ordinary `POST /channels/im`
- **THEN** the API MUST return `409` before provider I/O
- **AND** it MUST NOT create a second IM Channel or clear existing identities or bindings

#### Scenario: IM credentials rotate

- **WHEN** an administrator calls `PUT /channels/im/<channel_id>` with complete credentials、the current expected version、the same provider and the same provider tenant
- **THEN** the API MUST update that resource and return `200` with its summary
- **AND** the IM owner MUST preserve the existing `channel_id`, IM identity records, and Contact bindings

#### Scenario: IM update requires replacement

- **WHEN** update credentials select another provider or resolve another provider tenant
- **THEN** the API MUST return `409` with conflict code `replacement_required` without mutation
- **AND** the caller MUST use `/channels/im/<channel_id>/replacement`

#### Scenario: Current IM Channel is atomically replaced

- **WHEN** an administrator posts complete credentials and the current `expected_config_version` to `/channels/im/<channel_id>/replacement`
- **THEN** the IM owner MUST atomically replace the addressed Channel
- **AND** it MUST clear only identities and bindings owned by that Channel
- **AND** the API MUST return `200` with the replacement summary
