## MODIFIED Requirements

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

#### Scenario: Tenant submits Integration-level event transport

- **WHEN** IM credentials include `event_transport_mode`
- **THEN** strict DTO validation MUST reject the field
- **AND** the request MUST NOT shadow or mutate effective deployment runtime configuration

### Requirement: HTTP configuration versions MUST be client-opaque

`ConfigVersion` MUST be an opaque string in Console v2 responses and mutation inputs。A client MUST store and return it exactly as received and MUST NOT parse、decode、modify、interpret or synthesize it。The server MUST translate the path `channel_id` and opaque `ConfigVersion` to the complete owner-native CAS input。

#### Scenario: IM configuration is mutated

- **WHEN** an IM update、replacement or delete supplies the current opaque `expected_config_version`
- **THEN** the server MUST validate the path identity and the underlying numeric configuration version together
- **AND** the IM owner MUST retain its complete `integration_id + numeric config_version` CAS invariant

#### Scenario: Configuration version is stale

- **WHEN** the expected configuration version does not identify the current configuration revision
- **THEN** the API MUST return `409` with conflict code `provider_configuration_updated`
- **AND** it MUST leave current state unchanged

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
- **AND** it MUST NOT serialize a retained controller `IMIntegration` or `IMChannelSummaryResponse`

#### Scenario: IM display identifier is built

- **WHEN** an IM `ChannelSummary` is returned
- **THEN** `display_identifier` MUST contain a safe app/client identifier or equivalent non-secret application identifier
- **AND** it MAY append a provider tenant display name when available
- **AND** it MUST NOT contain an API key、secret、token、encrypt key or masked credential

#### Scenario: Email display identifier is built

- **WHEN** an Email `ChannelSummary` is returned
- **THEN** `display_identifier` MUST include a safe client/app identifier when the provider has one and `${sender_name} ${sender_email}` when sender fields are available
- **AND** a Resend summary MUST use `${sender_name} ${sender_email}` without any API-key material

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

### Requirement: Canonical v2 routes MUST be the only configuration authority

The v2 Channel controllers MUST be the only public configuration lifecycle for Human Input Email and IM。The obsolete Email provider stub and legacy `/im-integration` management resources MUST NOT remain registered、proxied or implemented as aliases。

#### Scenario: Legacy IM integration path is requested

- **WHEN** a caller requests `/console/api/workspaces/current/human-input/im-integration` or `/console/api/workspaces/current/human-input/im-integration/test`
- **THEN** HTTP routing MUST return `404`
- **AND** the request MUST NOT invoke Channel Management or IM Integration application services

## ADDED Requirements

### Requirement: Channel create, update and replacement MUST express distinct resource transitions

`POST /channels/<kind>` MUST create a resource。`PUT /channels/<kind>/<channel_id>` MUST update exactly the addressed resource。IM provider or provider-tenant replacement MUST use `POST /channels/im/<channel_id>/replacement`。The API MUST NOT infer replacement from a provider-addressed URL or ordinary create。Stable conflict codes MUST correspond to distinct client recovery behavior。This change defines only `replacement_required` and `provider_configuration_updated`；the API MUST NOT introduce another stable conflict code without a concrete client recovery requirement。

#### Scenario: New IM Channel is created

- **WHEN** no active IM Channel exists and an administrator submits `POST /channels/im` with complete credentials
- **THEN** the API MUST create the resource and return `200` with its summary

#### Scenario: Ordinary IM create reaches current cardinality

- **WHEN** an active IM Channel exists and an administrator submits another ordinary `POST /channels/im`
- **THEN** the API MUST return `409` before provider I/O
- **AND** it MUST NOT create a second Integration or clear existing identities or bindings

#### Scenario: IM credentials rotate

- **WHEN** an administrator calls `PUT /channels/im/<channel_id>` with complete credentials、the current expected version、the same provider and the same provider tenant
- **THEN** the API MUST update that resource and return `200` with its summary
- **AND** the IM owner MUST preserve the existing `integration_id`, IM identity records, and Contact bindings

#### Scenario: IM update requires replacement

- **WHEN** update credentials select another provider or resolve another provider tenant
- **THEN** the API MUST return `409` with conflict code `replacement_required` without mutation
- **AND** the caller MUST use `/channels/im/<channel_id>/replacement`

#### Scenario: Current IM Channel is atomically replaced

- **WHEN** an administrator posts complete credentials and the current `expected_config_version` to `/channels/im/<channel_id>/replacement`
- **THEN** the IM owner MUST atomically replace the addressed Channel
- **AND** it MUST clear only identities and bindings owned by that Channel
- **AND** the API MUST return `200` with the replacement summary

## REMOVED Requirements

### Requirement: Non-Resend channel operations MUST remain explicit placeholders

**Reason**: This change completes self-managed management behavior for every current IM provider through the existing IM Integration owner。Placeholder Channel handlers would preserve the duplicated authority being removed。

**Migration**: Remove unimplemented provider-specific Channel handlers。Route supported IM credentials through the canonical Console v2 DTOs and IM application owner。
