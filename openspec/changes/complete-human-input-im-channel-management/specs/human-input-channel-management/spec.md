## MODIFIED Requirements

### Requirement: Channel management MUST expose Email and IM through one facade

The system MUST provide one management boundary for discovering, reading, testing, saving and deleting the Resend Email channel plus the current five IM provider families: Slack, Feishu/Lark, DingTalk, Microsoft Teams and WeCom. `feishu` and `lark` MUST remain separately addressable canonical provider values backed by the same provider family. Callers MUST NOT query provider persistence directly.

#### Scenario: Channels are listed

- **WHEN** an authorized workspace administrator requests the current Channels collection
- **THEN** the result MUST account for Resend and every current canonical IM provider in either `channels` or `failures`
- **AND** every item in `channels` MUST be a credential-free persisted-state view
- **AND** an unconfigured channel MUST appear in `channels` as a successful `not_configured` view
- **AND** none of the current IM providers MAY be represented by an unavailable placeholder implementation

#### Scenario: One channel is requested

- **WHEN** a request reaches a supported concrete channel route
- **THEN** that route MUST call its channel implementation directly
- **AND** it MUST NOT look up the implementation through a runtime registry

### Requirement: Each ChannelProvider MUST define one provider-specific request type

Resend and every current canonical IM provider MUST each define exactly one provider-specific request type. Create, update and connection-test operations for one provider MUST validate and pass that same request type to the bound provider manager rather than defining operation-specific request types or using untyped configuration maps. The request MUST contain the complete provider-specific configuration fields. Every non-nullable field, including every required secret, MUST contain a newly submitted value. If a nullable configuration field is omitted or explicitly set to `null`, the validated request MUST set that field to `None`. Management MUST NOT retain or merge persisted credentials into a create, update or connection-test request.

#### Scenario: Create request is submitted

- **WHEN** a create operation receives the request for a supported `ChannelProvider`
- **THEN** management MUST validate that provider's complete request type before calling its bound provider manager
- **AND** every required secret MUST be a new explicit value

#### Scenario: Update request is submitted

- **WHEN** an update operation receives the request for a supported `ChannelProvider`
- **THEN** management MUST validate the same provider-specific request type used by create
- **AND** every required secret MUST be a new explicit value
- **AND** management MUST NOT read current credentials to complete the request

#### Scenario: Connection test request is submitted

- **WHEN** a connection-test operation receives the request for a supported `ChannelProvider`
- **THEN** management MUST validate the same provider-specific request type used by create and update
- **AND** every required secret MUST be a new explicit value
- **AND** management MUST NOT reveal, merge or reuse persisted credentials

#### Scenario: A connection test succeeds

- **WHEN** a provider-specific connection test succeeds
- **THEN** the operation envelope MUST contain exactly one credential-free test result
- **AND** it MUST contain neither a persisted-state view nor a failure

### Requirement: Channel capabilities MUST define valid management operations

Each channel view MUST advertise the management operations implemented for its provider. Capabilities MUST remain static provider-level declarations; credential validity and current provider health belong to the separate status snapshot. Management MUST reject operations that the selected channel does not support.

#### Scenario: Email capabilities are returned

- **WHEN** the Resend Email channel is listed
- **THEN** its capabilities MUST describe configuration create/update, test and delete
- **AND** it MUST NOT advertise secret retention

#### Scenario: IM capabilities are returned

- **WHEN** a current IM provider is listed
- **THEN** its capabilities MUST describe configuration create/update, test, delete and provider-replacement authorization
- **AND** it MUST NOT advertise secret retention

#### Scenario: Unsupported operation is requested

- **WHEN** a caller requests an operation absent from the channel capabilities
- **THEN** management MUST return a stable unsupported-operation result before side effects

## ADDED Requirements

### Requirement: Production composition MUST bind concrete provider managers without a registry

Production composition MUST bind each concrete Workspace route directly to the `HumanInputEmailChannelManager` or `HumanInputIMChannelManager` configured for that route's complete channel reference. The implementation MUST remove `ChannelHandler`, `ChannelHandlerRegistry`, `DuplicateChannelHandlerError` and runtime register/resolve/handlers dispatch. Shared application logic MAY receive an already-bound provider manager, but MUST NOT select one from `ChannelRef` at runtime.

#### Scenario: A concrete item operation is composed

- **WHEN** production composition builds GET, POST, PUT, DELETE or connection-test behavior for one concrete route
- **THEN** it MUST supply that route's provider manager directly
- **AND** the operation MUST NOT perform registry registration or provider lookup

#### Scenario: The Channels collection is composed

- **WHEN** production composition builds the Channels collection reader
- **THEN** it MUST supply the seven provider managers in fixed product order
- **AND** the collection reader MUST isolate each manager's safe read result without discovering managers from a registry

#### Scenario: IM provider managers share dependencies

- **WHEN** multiple IM provider managers use the same IM Control Plane repository or application dependencies
- **THEN** direct composition MUST preserve the single-active Integration and provider-replacement invariants
- **AND** shared dependencies MUST NOT introduce runtime provider registration

### Requirement: Successful IM configuration MUST persist verified connectivity

Every current IM create or update path MUST validate credentials, required directory scopes and provider tenant identity, then persist the resulting safe connectivity diagnostic together with the accepted configuration. A connection test MUST validate only the complete credentials submitted in that request, MUST NOT read persisted credentials and MUST NOT persist configuration state.

#### Scenario: New IM configuration validates successfully

- **WHEN** an IM provider accepts the request credentials, confirms required scopes and returns the provider tenant identity during create
- **THEN** the persisted Integration MUST have connected status and a trusted `last_checked_at`
- **AND** the returned safe channel view MUST be immediately eligible for directory sync

#### Scenario: Existing IM credentials rotate successfully

- **WHEN** a complete-revision update validates and persists replacement credentials for the same provider tenant
- **THEN** the configuration transition MUST advance `config_version` exactly once
- **AND** the connected diagnostic MUST be persisted atomically with that transition
- **AND** persisting the diagnostic MUST NOT advance `config_version` separately
- **AND** existing identities and bindings MUST remain governed by the credential-rotation invariant

#### Scenario: Replacement is not explicitly authorized

- **WHEN** an update targets a different provider or validation resolves a different provider tenant identity while replacement authorization is false
- **THEN** management MUST return a stable replacement-confirmation-required failure
- **AND** it MUST NOT modify credentials, diagnostics, revisions, identities or bindings

#### Scenario: Replacement is explicitly authorized

- **WHEN** an update carries explicit replacement authorization, a complete current revision and a complete target-provider request
- **THEN** management MUST delegate the validated transition to the existing IM provider-replacement semantics
- **AND** replacement authorization MUST permit but MUST NOT force a replacement when the validated transition is only credential rotation

#### Scenario: Request validation fails

- **WHEN** provider authentication, required scope validation or tenant identity resolution fails during create or update
- **THEN** no configuration or connectivity diagnostic MUST be created or replaced
- **AND** the response MUST contain only the stable safe provider failure

#### Scenario: Connection test does not save configuration

- **WHEN** a connection test succeeds for an unconfigured or configured IM channel
- **THEN** management MUST return a credential-free `ChannelTestResult`
- **AND** it MUST NOT read or reuse persisted credentials
- **AND** it MUST NOT persist credentials, status, `last_checked_at` or a configuration revision

## REMOVED Requirements

### Requirement: The handler registry MUST route complete channel references directly

**Reason**: Concrete kind/provider routes already select the provider manager. Runtime registration and `ChannelRef` lookup add an unused dispatch layer.

**Migration**: Remove `ChannelHandler`, `ChannelHandlerRegistry`, `DuplicateChannelHandlerError` and their tests/exports. Bind item operations directly to their provider manager and pass the fixed product-ordered provider manager list to collection reads.
