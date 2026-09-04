## ADDED Requirements

### Requirement: The callback controller MUST preserve Provider request facts

The application MUST register `POST /callbacks/human-input/v2/im/<webhook_id>` only when deployment transport mode is `WEBHOOK`。The route MUST have no Console session、CSRF、Workspace or Account authentication。The controller MUST capture the UTC receive time，validate `webhook_id` and read the exact request body through the existing `WEBHOOK_REQUEST_BODY_MAX_SIZE` bound。The controller MUST populate `WebhookRequest.headers` with `tuple(request.headers.items())`。The controller MUST NOT read deployment transport mode or parse the Provider payload。

#### Scenario: Deployment selects STREAM
- **WHEN** deployment transport mode is `STREAM`
- **THEN** the application MUST NOT register the callback blueprint
- **AND** Flask MUST return its normal `404` for the callback path

#### Scenario: A valid callback reaches the Service
- **WHEN** the route identity and body size are valid
- **THEN** the controller MUST pass the uppercase method、Flask header pairs、exact body bytes and captured receive time to `IMWebhookIngressService`

#### Scenario: The callback body is oversized
- **WHEN** the request body exceeds `WEBHOOK_REQUEST_BODY_MAX_SIZE`
- **THEN** the controller MUST return `413` before Channel lookup or Provider handler construction

#### Scenario: The route identity is malformed
- **WHEN** `webhook_id` has an invalid length or character
- **THEN** the controller MUST return the same empty `404` used for an unknown route

### Requirement: Reverse lookup MUST return a detached current Channel route

`IMWebhookChannelRepository.find_by_webhook_id(webhook_id)` MUST query the current `HumanInputIMChannel` row by its globally unique `webhook_id`。It MUST return `None` when no current row exists。Otherwise it MUST return `IMWebhookChannelRoute(channel, credential_scope)` with an owner-free `IMChannel` and a validated `WorkspaceScope | DeploymentScope`。It MUST close the lookup transaction before credential、Provider or inbox work starts。

#### Scenario: A current route exists
- **WHEN** one current Channel owns `webhook_id`
- **THEN** the repository MUST return that Channel and its validated credential scope

#### Scenario: No current route exists
- **WHEN** no current Channel owns `webhook_id`
- **THEN** the Service MUST return `404` without credential or inbox work

#### Scenario: Lookup cannot produce a valid route
- **WHEN** the database query fails or persisted owner scope is invalid
- **THEN** the Service MUST return `503` rather than treat the failure as route absence

#### Scenario: An old Webhook ID is called after replacement
- **WHEN** Channel replacement or deletion commits before reverse lookup starts
- **THEN** `find_by_webhook_id()` MUST return `None` for the old `webhook_id`

### Requirement: IMProviderBuilder MUST construct an adapter from IMChannel

`IMProviderBuilder` MUST be constructed with one already-bound `BoundCredentialCipher`。Its `build(channel: IMChannel)` operation MUST call `IMCredentialCodec.load(channel.provider, channel.encrypted_credentials)` and MUST pass the recovered credentials to `build_im_provider_adapter()`。It MUST NOT accept `IMWebhookChannelRoute`、credential scope or owner identity。It MUST NOT cache the Channel、recovered credentials or returned adapter。The caller MUST own and close the returned `IMProviderAdapter`。

#### Scenario: A Channel is materialized as a Provider adapter
- **WHEN** `build()` receives an `IMChannel` whose credential envelope is valid for the Builder's bound cipher and whose Provider matches the recovered credentials
- **THEN** it MUST return the `IMProviderAdapter` constructed from those credentials

#### Scenario: The credential envelope does not match the Channel
- **WHEN** credential recovery fails or the recovered Provider differs from `channel.provider`
- **THEN** the Builder MUST fail without calling `build_im_provider_adapter()`

#### Scenario: The same Channel is built twice
- **WHEN** callers invoke `build()` twice for the same Channel snapshot
- **THEN** the Builder MUST recover credentials and construct an independent adapter for each call

### Requirement: Ingress MUST construct a request-scoped Provider handler

`IMWebhookIngressService` MUST resolve an owner-bound `IMProviderBuilder` using the `credential_scope` returned by reverse lookup，call `builder.build(route.channel)` and pass a Channel-bound `IMMessageInboxSink` to `adapter.create_webhook_handler()`。The Service MUST NOT read deployment transport mode。Blueprint registration owns that policy。The returned handler is the runtime Webhook capability authority。Ingress MUST NOT cache adapters or handlers。

#### Scenario: A Workspace Channel receives a callback
- **WHEN** the route contains `WorkspaceScope`
- **THEN** ingress MUST use an `IMProviderBuilder` whose `TenantBoundCredentialCipher` is bound to that scope

#### Scenario: Deployment cipher is unavailable
- **WHEN** the route contains `DeploymentScope` and the independent deployment credential capability cannot supply a bound cipher
- **THEN** ingress MUST return `503` without calling `IMProviderBuilder.build()`

#### Scenario: Credentials do not provide a Webhook handler
- **WHEN** `adapter.create_webhook_handler()` returns `None`
- **THEN** ingress MUST return the same `404` used for an unknown route

#### Scenario: Handler invocation completes
- **WHEN** ingress has constructed a Provider adapter
- **THEN** ingress MUST close that adapter after handler invocation or failure

### Requirement: Ingress MUST pass through the Provider response

The Service MUST return the `WebhookResponse` produced by the Provider handler without changing its status，headers or body。The controller MUST map those values to the Flask response without interpreting Provider semantics。

#### Scenario: A Provider handler returns a response
- **WHEN** the Provider handler returns a `WebhookResponse`
- **THEN** the HTTP response MUST preserve its status，headers and body

### Requirement: Ingress failures MUST not expose credentials

Ingress MUST return an empty `503` when route lookup、`IMProviderBuilder` resolution or `build()`、or Provider handler construction fails。Ingress logs、traces and exceptions MUST NOT contain credential plaintext or credential ciphertext。`webhook_id` MUST be treated as an observable routing identifier rather than a credential and MAY appear in diagnostics。

#### Scenario: Credential recovery fails
- **WHEN** the stored credential envelope cannot be opened
- **THEN** ingress MUST return an empty `503`
- **AND** diagnostics MUST contain no credential plaintext or credential ciphertext
