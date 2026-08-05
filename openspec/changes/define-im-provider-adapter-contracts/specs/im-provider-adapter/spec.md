## ADDED Requirements

### Requirement: IMProviderAdapter MUST bind one immutable Provider-specific configuration
An `IMProviderAdapter` MUST be constructed from one concrete Provider's typed configuration and MUST bind that configuration for its lifetime. Construction MUST perform only local shape validation so that an adapter can still be created for candidate credentials that later fail remote testing. The adapter MAY own a Provider-specific API client context shared by credential testing, Directory, Messaging and Dynamic Card Messaging. Capability-specific logical state MAY remain private to its view and MUST NOT require root-level coordination. Any retained closeable resource used by those root-context capabilities MUST be owned by the root adapter rather than by a capability view. Webhook Events MUST depend only on immutable configuration, MUST NOT borrow root-owned resources and MUST remain outside the root close lifecycle.

#### Scenario: Two capabilities are used from one adapter
- **WHEN** a caller obtains Messaging and Directory capabilities from the same adapter
- **THEN** both capabilities MUST use the adapter-bound configuration and Provider namespace without accepting credentials again
- **AND** when the concrete adapter provides a shared API client context, both capability views MUST borrow it without closing or replacing it

#### Scenario: One Provider requires multiple SDK client types
- **WHEN** a concrete Provider requires distinct API and event clients
- **THEN** the root adapter MAY own a Provider-specific bundle containing API client roles required by credential testing, Directory and Messaging capabilities
- **AND** Webhook execution state and STREAM client roles MUST remain outside that bundle

#### Scenario: Provider configuration changes
- **WHEN** a caller needs to use changed credentials or transport material
- **THEN** it MUST construct a new adapter rather than replacing configuration inside the existing adapter
- **AND** construction of the new adapter MUST NOT implicitly mutate, invalidate or close the existing adapter
- **AND** the existing adapter MUST remain usable under its original bound configuration and lifecycle contract
- **AND** each adapter's owner MUST independently decide whether to invoke `close()` when that instance's own lifecycle ends

### Requirement: IMProviderAdapter MUST expose narrow capability views
The adapter MUST expose required `directory` and `messaging` capability views. It MUST expose `dynamic_card_messaging` and `webhook_events` only when the concrete Provider supports them in this release. It MUST expose `create_stream_events()` as a factory returning a new independent `IMStreamEvents` instance when STREAM is supported and `None` otherwise. Capability presence or factory result MUST be the authoritative support signal; the adapter MUST NOT expose a separate support flag that can disagree with the capability view or factory result.

#### Scenario: Initial Provider capabilities and STREAM factory are inspected
- **WHEN** callers inspect the five initial adapters
- **THEN** all five MUST expose Directory and Basic Messaging, while Slack, Feishu/Lark and Microsoft Teams MUST expose Dynamic Card Messaging and Webhook Events
- **AND** `create_stream_events()` MUST return a new `IMStreamEvents` for Slack and Feishu/Lark and `None` for DingTalk, WeCom and Microsoft Teams

#### Scenario: Unsupported capability is requested
- **WHEN** a caller inspects Dynamic Card Messaging or Webhook Events on an unsupported Provider, or calls `create_stream_events()` on DingTalk, WeCom or Microsoft Teams
- **THEN** Dynamic Card Messaging and Webhook Events MUST be absent, and `create_stream_events()` MUST return `None`, rather than returning a dummy capability that fails with an unsupported result

### Requirement: IMProviderAdapter MUST expose credential testing over its bound configuration
The adapter MUST expose `test_credentials()` without credential or event transport arguments. The operation MUST use the adapter-bound API credentials to authenticate, identify the stable Provider tenant and validate baseline permissions. It MUST remain independent from message-recipient reachability and event transport capability presence.

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

### Requirement: Root-context operations MUST be externally serialized
Every root operation other than `create_stream_events()`, every capability accessor, and every Directory, Messaging or Dynamic Card Messaging operation MUST be invoked serially and non-reentrantly. Calls in this root-context set on the same adapter MUST NOT overlap, including through interleaved tasks on one thread. They MAY execute sequentially on different threads after the preceding call has returned and the caller has performed a safe cross-thread handoff. The caller MUST provide serialization and handoff; implementations MUST NOT be required to add locks, active-operation tracking, waiting, cancellation or misuse detection for these APIs. `IMWebhookEvents.handle()` and `IMEventSink.accept()` are not part of this set and MUST follow their independent thread-safe contracts.

#### Scenario: Directory and Messaging are invoked from one adapter
- **WHEN** a caller invokes Directory and Messaging operations from one adapter instance
- **THEN** every invocation MUST be externally serialized and MUST NOT overlap another root-context invocation on that adapter
- **AND** a later invocation MAY run on a different thread after a safe handoff
- **AND** the implementation MUST NOT be required to make their shared root context safe for overlapping calls

#### Scenario: A callback re-enters the adapter
- **WHEN** a root-context operation would invoke another root or root-context capability operation before the first invocation returns
- **THEN** that re-entrant use MUST be outside the adapter contract

### Requirement: STREAM factory MUST be the only thread-safe root operation
`create_stream_events()` MUST be safe to invoke concurrently with calls on the same adapter, including other factory calls, externally serialized root-context operations and Webhook handling. It MUST depend only on immutable Provider configuration, MUST NOT borrow closeable resources owned by the root adapter and MUST return a new independently owned `IMStreamEvents` instance on every supported invocation. The root adapter MUST NOT retain, enumerate or close returned STREAM instances. A returned instance MAY outlive the root adapter.

#### Scenario: Multiple STREAM instances are created
- **WHEN** callers invoke `create_stream_events()` more than once on a STREAM-capable adapter
- **THEN** each call MUST return a distinct lifecycle owner whose resources are closed independently

### Requirement: IMProviderAdapter close MUST be a serialized lifecycle boundary
The adapter MUST expose one idempotent close operation. `close()` MAY execute on any thread, but the caller MUST invoke it only after every root-context operation has returned and MUST safely hand off the adapter when changing threads. It MUST release every closeable resource directly owned by the root adapter; when the adapter owns no such resource, cleanup MUST be a no-op. Concurrent or re-entrant close with another root-context operation, including another `close()`, MUST be outside the contract, so implementations MUST NOT wait for, cancel or synchronize with such an invocation. Concurrent `IMWebhookEvents.handle()` and `create_stream_events()` calls MUST remain independent because neither accesses root-owned resources. After close returns, the caller MUST NOT invoke any root or borrowed root-context capability operation other than a serialized repeated close; implementations MUST NOT be required to detect other post-close misuse. Root close MUST NOT affect an already obtained `IMWebhookEvents` view or an independently created `IMStreamEvents` instance.

#### Scenario: Adapter is closed after serial use
- **WHEN** every root-context operation has returned and a caller closes the adapter, possibly after a safe handoff to another thread
- **THEN** close MUST idempotently release every directly owned closeable root-context resource without coordinating with another root-context invocation

#### Scenario: Adapter owns no closeable resource
- **WHEN** an adapter with no directly owned closeable resource is closed after its root-context calls have been serialized
- **THEN** close MUST perform no cleanup

### Requirement: Feishu and Lark MUST share one verification evidence unit
Feishu and Lark MUST remain distinct concrete adapters with separate typed credentials, Provider discriminators and API host configuration. Their shared SDK and protocol implementation MUST be verified as one Provider-family evidence unit rather than requiring duplicate real-execution and sanitized-fixture evidence for equivalent production paths. Real-execution and sanitized-fixture evidence for this shared unit MUST come from an authorized Feishu non-production environment. Configuration and composition tests MUST still cover both concrete adapters independently.

#### Scenario: A shared Feishu or Lark path is verified
- **WHEN** an operation or event path uses the same production implementation and protocol semantics for Feishu and Lark
- **THEN** real execution against the authorized Feishu non-production environment and its sanitized fixture MUST close the shared Feishu/Lark evidence cell
- **AND** tests MUST independently verify each adapter's credential type, Provider discriminator and API host selection

#### Scenario: Feishu and Lark paths diverge
- **WHEN** Feishu and Lark use different production code paths or Provider protocol semantics for an operation or event entry
- **THEN** the shared evidence-unit assumption MUST be treated as invalid and the capability MUST remain incomplete pending spec review
