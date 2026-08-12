# im-provider-adapter Specification

## Purpose
TBD - created by archiving change define-im-provider-adapter-contracts. Update Purpose after archive.
## Requirements
### Requirement: IMProviderAdapter MUST bind one immutable Provider-specific credential set
An `IMProviderAdapter` MUST be constructed from one concrete Provider's resolved typed credentials and MUST bind those credentials for its lifetime. Adapter credentials MUST contain resolved values rather than controller update instructions. Construction MUST perform only local validation and MUST NOT perform remote credential testing. The adapter's `provider` property MUST identify the Provider bound to the adapter.

#### Scenario: Candidate credentials are rejected remotely
- **WHEN** a caller constructs an adapter with locally valid credentials that the Provider will reject
- **THEN** construction MUST succeed so the caller can invoke `test_credentials()` and receive its typed result

#### Scenario: Provider credentials change
- **WHEN** a caller needs to use different credentials or event-transport material
- **THEN** it MUST construct a new adapter rather than modify the existing adapter
- **AND** constructing the new adapter MUST NOT mutate, invalidate or close the existing adapter

### Requirement: IMProviderAdapter MUST expose narrow capabilities
Every adapter MUST expose required `directory` and `messaging` capabilities. It MUST expose `dynamic_card_messaging`, `create_webhook_handler(consumer)` and `create_stream_handler(consumer)` only according to the concrete Provider's supported capabilities. Each event transport factory MUST receive the application-supplied `IMEventConsumer` to which authenticated events will be delivered. An unsupported optional capability or event transport factory MUST return `None`. Capability presence or factory result MUST be the authoritative support signal; the adapter MUST NOT expose a separate support flag or a dummy unsupported capability.

#### Scenario: Initial Provider capabilities are inspected
- **WHEN** callers inspect the five initial adapters
- **THEN** all five MUST expose Directory and Basic Messaging
- **AND** Slack, Feishu/Lark and Microsoft Teams MUST expose Dynamic Card Messaging and create Webhook handlers
- **AND** Slack and Feishu/Lark MUST create event streams
- **AND** DingTalk and WeCom MUST expose neither event transport type
- **AND** Microsoft Teams MUST return `None` from `create_stream_handler(consumer)`

#### Scenario: Capabilities are inspected without invocation
- **WHEN** a caller accesses a capability or creates a supported event transport with an `IMEventConsumer`
- **THEN** the adapter MUST NOT test credentials, perform a Provider operation or start a STREAM connection

### Requirement: IMProviderAdapter MUST test its bound credentials
The adapter MUST expose `test_credentials()` without credential or event-transport arguments. A successful result MUST identify the normalized Provider and stable Provider tenant ID after the applicable authentication, tenant-identification and baseline-permission checks succeed. A failure MUST distinguish authentication rejection, unavailable stable tenant identity and an unknown result. Diagnostic reasons MUST be operator-safe and MUST NOT be treated as stable decision codes.

#### Scenario: Bound credentials are valid
- **WHEN** authentication, tenant identification and baseline-permission checks succeed
- **THEN** `test_credentials()` MUST return the Provider and stable Provider tenant ID

#### Scenario: Credential testing has an unknown outcome
- **WHEN** Provider or transport availability prevents a conclusive result
- **THEN** `test_credentials()` MUST return an `UNKNOWN` failure rather than report success

#### Scenario: Credential testing completes
- **WHEN** `test_credentials()` returns success or failure
- **THEN** it MUST NOT mutate remote Provider configuration or caller-owned business state

### Requirement: Provider credential types MUST remain Provider-specific
The shared adapter boundary MUST NOT flatten API credentials, Webhook verification material, encryption material or STREAM connection material into a generic key/value map. Each concrete adapter MUST accept only its own resolved typed credential model while exposing the same shared capability interfaces.

#### Scenario: Providers require different credential fields
- **WHEN** two Providers require different API or event-transport credentials
- **THEN** each adapter MUST receive only the fields defined by its own credential type

### Requirement: IMProviderAdapter calls MUST be externally serialized
An `IMProviderAdapter` is not thread-safe. Capability accessors, `create_webhook_handler(consumer)`, `create_stream_handler(consumer)`, `test_credentials()`, Directory, Messaging, Dynamic Card Messaging and root `close()` calls on the same adapter MUST NOT overlap or re-enter one another. The caller MUST externally serialize these calls. The shared contract makes no guarantee that an adapter or its root-bound capabilities can be handed across threads. A created `IMWebhookHandler`, a created `IMEventStream` and the supplied `IMEventConsumer` follow their independent concurrency and lifecycle contracts.

#### Scenario: Directory and Messaging use one adapter
- **WHEN** one thread invokes Directory and Messaging operations on its adapter
- **THEN** each invocation MUST begin only after the preceding invocation returns

#### Scenario: Two threads invoke one adapter concurrently
- **WHEN** two threads invoke operations on the same adapter at the same time
- **THEN** that use MUST be outside the adapter contract

#### Scenario: Adapter operation re-enters the adapter
- **WHEN** one adapter operation invokes another before the first invocation returns
- **THEN** that use MUST be outside the adapter contract

### Requirement: STREAM creation MUST return independent event streams
Every supported invocation of `create_stream_handler(consumer)` MUST return a distinct `IMEventStream` bound to the adapter's immutable Provider configuration and the supplied `IMEventConsumer`. Creation MUST follow the root adapter's external-serialization contract. Each returned event stream MUST have an independent owner-managed lifecycle and MAY outlive the root adapter.

#### Scenario: Multiple event streams are created
- **WHEN** a caller invokes `create_stream_handler(consumer)` more than once on a STREAM-capable adapter without overlapping the calls
- **THEN** every call MUST return a distinct event stream whose `start()`/`stop()` lifecycle does not affect the other event streams

### Requirement: IMProviderAdapter close MUST define the root lifecycle boundary
The adapter MUST expose an idempotent `close()` operation. The caller MUST invoke it only after all adapter operations return. After close returns, the caller MUST NOT access capabilities, create new event transports or invoke root, Directory, Messaging or Dynamic Card Messaging operations other than repeated `close()`. Root close MUST NOT invalidate a previously created `IMWebhookHandler` or `IMEventStream`.

#### Scenario: Adapter is closed after serialized use
- **WHEN** all root-context operations have returned and the caller invokes `close()` one or more times
- **THEN** every invocation MUST complete without reopening the root lifecycle

#### Scenario: Root closes after event transports are created
- **WHEN** an `IMWebhookHandler` or `IMEventStream` was created before root close
- **THEN** that event transport MUST continue to follow its own documented lifecycle

### Requirement: Shared failures MUST remain safe and capability-scoped
Shared failures MUST expose only distinctions defined by their capability. They MUST NOT contain credentials, verification material, raw Provider responses, Provider client objects or Provider-specific exceptions. Human-readable reasons MUST be operator-safe and MUST NOT be parsed as stable decision codes.

#### Scenario: Provider operation returns a shared failure
- **WHEN** any shared capability returns a typed failure
- **THEN** the caller MUST receive only the capability's stable failure facts and operator-safe diagnostics
