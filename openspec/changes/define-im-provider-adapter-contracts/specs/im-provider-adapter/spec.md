## ADDED Requirements

### Requirement: IMProviderAdapter MUST bind one immutable Provider-specific configuration
An `IMProviderAdapter` MUST be constructed from one concrete Provider's typed configuration and MUST bind that configuration for its lifetime. Construction MUST perform only local shape validation so that an adapter can still be created for candidate credentials that later fail remote testing. The adapter MUST own creation, reuse and disposal of its Provider SDK clients, token caches and connection resources.

#### Scenario: Two capabilities are used from one adapter
- **WHEN** a caller obtains Messaging and Directory capabilities from the same adapter
- **THEN** both capabilities MUST use the adapter-owned client context without accepting credentials or constructing independent SDK clients

#### Scenario: One Provider requires multiple SDK client types
- **WHEN** a concrete Provider requires distinct API and event clients
- **THEN** the adapter MAY own a Provider-specific client bundle, but each client role MUST be created or lazily memoized by the adapter rather than reconstructed by each capability call

### Requirement: IMProviderAdapter MUST expose narrow capability views
The adapter MUST expose required `directory` and `messaging` capability views. It MUST expose `dynamic_card_messaging`, `webhook_events` and `stream_events` only when the concrete Provider supports them in this release. Capability presence MUST be the authoritative support signal; the adapter MUST NOT expose a separate support flag that can disagree with the capability view and MUST NOT provide dummy unsupported methods.

#### Scenario: Initial Provider capabilities are inspected
- **WHEN** callers inspect the five initial adapters
- **THEN** all five MUST expose Directory and Basic Messaging; Slack, Feishu/Lark and Microsoft Teams MUST expose Dynamic Card Messaging and Webhook Events; and only Slack and Feishu/Lark MUST expose STREAM Events

#### Scenario: Unsupported capability is requested
- **WHEN** a caller inspects Dynamic Card Messaging on DingTalk or WeCom, Webhook Events on DingTalk or WeCom, or STREAM Events on DingTalk, WeCom or Microsoft Teams
- **THEN** the capability MUST be absent rather than represented by a method that fails with an unsupported result

### Requirement: IMProviderAdapter MUST expose credential testing over its bound configuration
The adapter MUST expose `test_credentials()` without credential or event transport arguments. The operation MUST use the adapter-bound API credentials to authenticate, identify the stable Provider tenant and validate baseline permissions. It MUST remain independent from message-destination reachability and event transport capability presence.

#### Scenario: Bound credentials are valid
- **WHEN** `test_credentials()` authenticates and confirms the required permissions
- **THEN** it MUST return safe normalized facts containing the Provider, stable Provider tenant ID and permission result

#### Scenario: Bound credentials are rejected
- **WHEN** authentication fails, a stable Provider tenant cannot be identified or baseline permissions are missing
- **THEN** `test_credentials()` MUST return a typed safe failure without exposing raw credentials, SDK clients, raw Provider responses or Provider-specific exceptions

#### Scenario: Credential testing completes
- **WHEN** `test_credentials()` returns success or failure
- **THEN** it MUST NOT mutate remote Provider configuration or any caller-owned business state

### Requirement: Provider configuration shapes MUST remain Provider-specific
The shared adapter boundary MUST NOT flatten API credentials, Webhook verification material, encryption material or STREAM connection material into one generic key/value map. Each concrete adapter configuration MUST keep its typed Provider-specific shape while exposing the same shared capability interfaces.

#### Scenario: Slack and Feishu adapters are constructed
- **WHEN** Slack and Feishu/Lark require different API and event-transport configuration fields
- **THEN** each adapter MUST receive only its own typed configuration without forcing the other Provider to accept irrelevant fields

### Requirement: IMProviderAdapter lifecycle MUST close all owned resources
The adapter MUST expose one idempotent close operation that releases all adapter-owned SDK clients, sessions and active connection resources. After close, capability operations MUST return a stable closed-adapter failure and MUST NOT recreate resources implicitly. A changed Provider configuration MUST be represented by constructing a new adapter rather than mutating the configuration of an existing adapter.

#### Scenario: Adapter is closed after several capabilities were used
- **WHEN** Messaging, Directory and Event capabilities have initialized adapter-owned resources and the adapter is closed
- **THEN** one close operation MUST release all of those resources without requiring each capability consumer to close a separate SDK client

#### Scenario: Provider configuration changes
- **WHEN** a caller needs to use changed credentials or transport material
- **THEN** it MUST construct a new adapter and close the old adapter rather than replacing configuration inside the existing adapter
