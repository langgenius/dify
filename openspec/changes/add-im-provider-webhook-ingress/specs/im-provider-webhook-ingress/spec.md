## ADDED Requirements

### Requirement: Ingress MUST reuse Channel Management routing contracts

Webhook ingress MUST reuse existing `WebhookId`、typed `dify_config.HUMAN_INPUT_IM_EVENT_TRANSPORT_MODE`、`IMProvider.supports_webhook()` and Human Input callback URL path。It MUST NOT redefine Channel ID、Webhook ID lifecycle、Provider capability、mode configuration or management URL projection。Concrete `adapter.create_webhook_handler()` remains the credential-bound authority after ingress recovers credentials。

#### Scenario: Deployment selects STREAM
- **WHEN** shared deployment configuration is `STREAM`
- **THEN** callback ingress MUST return the unknown-route `404` without querying Channel persistence、recovering credentials or calling a Provider handler

#### Scenario: Provider has no Webhook capability
- **WHEN** current Channel Provider returns `False` from `IMProvider.supports_webhook()`
- **THEN** ingress MUST return the same `404` without recovering credentials

### Requirement: Public controller MUST perform only bounded HTTP adaptation

The system MUST expose `POST /callbacks/human-input/v2/im/<webhook_id>` through a dedicated blueprint without Console session。Controller MUST capture trusted UTC receive time before body read or I/O，read exact body bytes through a configured bound，construct adapters-package `WebhookRequest` and map Service `WebhookResponse` to Flask response。Controller MUST NOT parse Provider JSON、select Provider or owner、recover credentials or process business events。

#### Scenario: Valid callback reaches controller
- **WHEN** callback path、method and body size are valid
- **THEN** controller MUST pass uppercase method、`tuple(request.headers.items())`、exact body bytes and entry receive time to `IMWebhookIngressService`

#### Scenario: Callback body exceeds the limit
- **WHEN** request body exceeds `HUMAN_INPUT_IM_WEBHOOK_MAX_BODY_BYTES`
- **THEN** controller MUST return `413` before Channel lookup、adapter construction or inbox work

#### Scenario: Browser sends preflight
- **WHEN** client sends CORS preflight to the callback route
- **THEN** callback blueprint MUST NOT provide application CORS policy or authenticated Web API fallback

#### Scenario: Callback carries Console state
- **WHEN** callback includes Console session cookie or CSRF header
- **THEN** controller MUST NOT use that state for authentication、owner selection or authorization

### Requirement: Reverse lookup MUST return authoritative current Channel routing

`IMWebhookChannelRepository.load_by_webhook_id(webhook_id)` MUST load the current `HumanInputIMChannel` row by globally unique `webhook_id` and return immutable `IMWebhookChannelRoute(channel, scope)`。`channel` MUST be the canonical owner-free `IMChannel`。`scope` MUST be validated `WorkspaceScope` or `DeploymentScope` derived from persisted owner key。Repository MUST NOT return raw owner key、ORM record or configuring actor，and MUST NOT resolve ciphers、recover credentials or perform Provider I/O。

#### Scenario: Current Channel route is loaded
- **WHEN** `webhook_id` identifies a current Channel in `WEBHOOK` mode
- **THEN** route snapshot MUST contain Channel ID、Provider、Provider tenant、config version、opaque credentials and validated credential scope

#### Scenario: Route is absent after replacement or deletion
- **WHEN** no current Channel row owns `webhook_id`
- **THEN** repository MUST return not found and Service MUST return `404` without credential or inbox work

#### Scenario: Persisted owner key is invalid
- **WHEN** a row cannot be mapped to `WorkspaceScope` or `DeploymentScope`
- **THEN** repository MUST report lookup failure rather than expose raw owner state or treat the route as missing

#### Scenario: Route lookup fails
- **WHEN** database query or mapping cannot complete
- **THEN** Service MUST return payload-free `503` and MUST NOT map the failure to route not found

### Requirement: Service MUST construct one request-scoped Channel handler

`IMWebhookIngressService.handle(webhook_id, request)` MUST perform authoritative Channel lookup for every admitted callback。For a supported Provider，Service MUST select a bound cipher from route scope、call `IMCredentialCodec.load(channel.provider, channel.encrypted_credentials)` exactly once、call `build_im_provider_adapter(credentials)` exactly once and create one handler bound to a Channel-scoped `IMMessageInboxSink`。Service MUST NOT retain adapter、handler or recovered credentials between requests。

#### Scenario: Workspace Channel receives callback
- **WHEN** route scope is `WorkspaceScope`
- **THEN** Service MUST construct `TenantBoundCredentialCipher` from trusted route Tenant ID and configured Key Provider

#### Scenario: Deployment Channel receives callback
- **WHEN** route scope is `DeploymentScope`
- **THEN** Service MUST use only explicitly injected deployment-bound cipher
- **AND** missing deployment cipher MUST return `503`

#### Scenario: Concurrent callbacks target the same Channel revision
- **WHEN** multiple requests resolve the same Channel ID and config version
- **THEN** each request MUST independently construct、invoke and close its own Provider adapter and handler

#### Scenario: Concrete credentials do not support Webhook
- **WHEN** static Provider capability is true but `create_webhook_handler()` returns `None`
- **THEN** Service MUST return the same `404` surface without invoking a Provider handler

#### Scenario: Caller forges Provider identity
- **WHEN** callback header or body claims another Provider or Provider tenant
- **THEN** Service MUST still construct from route Channel facts
- **AND** Provider handler or bound sink MUST reject conflicting authenticated identity

### Requirement: Inbox intake MUST bind current Channel identity

Ingress MUST construct `IMMessageInboxSink` with current `IMChannelId`、Provider and Provider tenant。Sink and inbox repository MUST persist Channel ID as local routing metadata without adding it to `AuthenticatedIMEvent`。Provider event deduplication MUST remain independent of Channel ID。

#### Scenario: Matching event is accepted
- **WHEN** handler emits an event matching bound Channel Provider and Provider tenant
- **THEN** sink MUST persist `channel_id` with event facts before returning `ACCEPTED`

#### Scenario: Event conflicts with Channel identity
- **WHEN** authenticated event Provider or Provider tenant differs from the bound Channel
- **THEN** sink MUST create no record and MUST NOT return `ACCEPTED`

#### Scenario: Same Provider event is redelivered after Channel replacement
- **WHEN** real Provider event ID already exists for the same Provider tenant under an earlier Channel
- **THEN** deduplication MUST resolve the existing event without adding Channel ID to the deduplication key or overwriting immutable routing facts

### Requirement: Provider response and durable acceptance semantics MUST remain unchanged

Service MUST return Provider handler status、headers and body without rewriting challenge、authentication failure、validation failure or ACK。A business event success ACK MUST continue to require `IMMessageInboxSink` durable acceptance or real-ID duplicate resolution。

#### Scenario: Provider challenge succeeds
- **WHEN** handler validates and processes challenge request
- **THEN** controller MUST return handler challenge response and inbox MUST add no record

#### Scenario: Provider authentication fails
- **WHEN** handler rejects signature、token、JWT or encryption material
- **THEN** controller MUST return handler non-success response and inbox MUST add no record

#### Scenario: New business event commits
- **WHEN** bound sink durably accepts authenticated event
- **THEN** controller MUST return handler success ACK

#### Scenario: Inbox persistence fails
- **WHEN** bound sink cannot durably accept event
- **THEN** controller MUST return handler retry-compatible response and Service MUST NOT fabricate success

### Requirement: Failure and observability MUST protect sensitive content

Malformed or unknown `webhook_id`、`STREAM` mode、unsupported Provider and unavailable credential-bound handler MUST use one `404` surface。Database、scope mapping、cipher、credential recovery、adapter construction and unclassified internal failures MUST return payload-free `503`。After successful lookup，Service MUST emit one `im_webhook_channel_resolved` structured log containing Provider and Channel ID before capability、cipher or credential work。Logs、metrics、traces and exceptions MUST NOT contain request body、headers、Provider response body、credential plaintext、credential ciphertext、tenant ID or complete `webhook_id`。

#### Scenario: Malformed route identity is probed
- **WHEN** path identity has invalid length or character set
- **THEN** controller MUST return the same `404` as unknown well-formed route

#### Scenario: Channel lookup succeeds
- **WHEN** repository returns `IMWebhookChannelRoute`
- **THEN** Service MUST immediately log `provider` and `channel_id`
- **AND** log MUST precede Provider capability、cipher、credential and adapter work

#### Scenario: Credential envelope cannot be opened
- **WHEN** codec raises `IMCredentialError`
- **THEN** Service MUST return `503` and diagnostics MUST contain only safe failure code、Channel ID and Provider

#### Scenario: Ingress metric is recorded
- **WHEN** controller or Service records request outcome
- **THEN** dimensions MUST contain only low-cardinality Provider、outcome and HTTP status class

### Requirement: Channel configuration commits MUST define in-flight boundaries

Ingress MUST NOT hold Channel transaction during cipher work、Provider authentication or inbox commit。Request MUST use Channel snapshot captured by reverse lookup。Rotation、replacement or delete commit followed by a new lookup MUST expose new configuration or route absence。Downstream authorization MUST continue to use current Channel and Binding state rather than only ingress snapshot。

#### Scenario: Credential rotation overlaps request
- **WHEN** request resolves Channel before rotation commit
- **THEN** in-flight request MAY finish with old envelope
- **AND** lookup started after commit MUST recover new envelope and config version

#### Scenario: Replacement overlaps old callback
- **WHEN** replacement commits and Provider calls old `webhook_id`
- **THEN** ingress MUST return `404` and MUST NOT route callback to replacement Channel
