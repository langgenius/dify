## ADDED Requirements

### Requirement: Event transport support MUST be expressed by adapter capabilities
Slack and Feishu/Lark adapters MUST expose Webhook Events and return new STREAM Events instances from `create_stream_events()`. Microsoft Teams MUST expose Webhook Events and return no STREAM instance. DingTalk and WeCom MUST expose neither Webhook Events nor a STREAM instance in this release. Capability presence and the STREAM factory result MUST be authoritative; no separate transport-support flag or dummy unsupported event capability may exist.

#### Scenario: Microsoft Teams event capabilities are inspected
- **WHEN** a caller inspects a Microsoft Teams adapter
- **THEN** Webhook Events MUST be present and `create_stream_events()` MUST return `None`

#### Scenario: DingTalk event capabilities are inspected
- **WHEN** a caller inspects a DingTalk adapter
- **THEN** Webhook Events MUST be absent and `create_stream_events()` MUST return `None`

#### Scenario: WeCom event capabilities are inspected
- **WHEN** a caller inspects a WeCom adapter
- **THEN** Webhook Events MUST be absent and `create_stream_events()` MUST return `None`

### Requirement: Webhook and STREAM authentication MUST converge at AuthenticatedIMEvent
Webhook and STREAM capabilities MUST keep their wire authentication and lifecycle differences before a shared immutable `AuthenticatedIMEvent`. A successful event MUST contain provider, stable Provider tenant ID, optional real Provider event ID, optional Provider event time, local receive time and decrypted Provider-native payload.

#### Scenario: Webhook delivery is authenticated
- **WHEN** a Webhook request passes its signature, timestamp, replay and decryption checks
- **THEN** Webhook Events MUST produce an `AuthenticatedIMEvent` without exposing raw verification material

#### Scenario: STREAM delivery is authenticated
- **WHEN** a delivery arrives through an authenticated Provider stream connection and passes envelope validation
- **THEN** STREAM Events MUST produce the same `AuthenticatedIMEvent` facts without inventing HTTP request semantics

#### Scenario: Transport authentication fails
- **WHEN** Webhook verification or STREAM connection or envelope authentication fails
- **THEN** the event capability MUST NOT call the event sink or produce an `AuthenticatedIMEvent`

### Requirement: IMEventSink MUST be the only downstream event dependency
Webhook and STREAM capabilities MUST deliver authenticated events through an application-supplied `IMEventSink`. The sink MUST return `ACCEPTED` when it has taken responsibility for the event and the Provider may receive a successful ACK, or `RETRY` when the adapter must not acknowledge success. The adapter MUST NOT depend on a persistence model, queue, router or business event handler.

#### Scenario: Sink accepts an event
- **WHEN** the sink returns `ACCEPTED` for one authenticated event
- **THEN** the concrete event capability MUST complete the Provider-specific successful ACK

#### Scenario: Sink cannot accept an event
- **WHEN** the sink returns `RETRY` or raises an unexpected failure
- **THEN** the concrete event capability MUST NOT send a successful ACK and MUST use the Provider-specific retry-compatible failure behavior

#### Scenario: Sink recognizes an identified duplicate
- **WHEN** the sink has already accepted an event with the same real Provider event ID
- **THEN** it MAY return `ACCEPTED` so the adapter acknowledges the redelivery without exposing deduplication state through the Provider contract

### Requirement: IMEventSink MUST be thread-safe
The same `IMEventSink` MAY be shared by multiple Webhook adapters, multiple `IMStreamEvents` instances and Provider SDK callback threads. `accept(event)` MUST safely support concurrent invocations and MUST NOT rely on a root adapter or event capability to serialize calls globally. Each concrete event capability MUST still invoke the sink at most once for one authenticated delivery.

#### Scenario: Multiple authenticated deliveries reach one sink concurrently
- **WHEN** different Webhook requests, STREAM instances or SDK callback threads concurrently invoke `accept` on the same sink
- **THEN** the sink MUST preserve its acceptance and duplicate-handling semantics without data races or an adapter-provided global lock

### Requirement: Webhook Events MUST expose caller-driven request handling
Webhook Events MUST expose thread-safe `handle(request, sink) -> response` using framework-neutral Webhook request and response values. Calls on the same `IMWebhookEvents` view MAY overlap each other and MAY overlap any root adapter operation, including `close()`. The view MUST depend only on immutable Provider-specific Webhook configuration; configuration material is not a runtime resource. It MUST NOT read, mutate, borrow or close a root-owned API client, session, cache or other runtime resource. The root adapter MUST NOT coordinate Webhook calls or invalidate an already obtained Webhook view during close. A Webhook view MAY outlive its root adapter.

The concrete capability MUST own thread-safe challenge handling, signature and timestamp verification, replay checks, decryption and Provider-specific response encoding. It MUST NOT retain a closeable runtime resource between `handle` calls. It MUST call the sink at most once for one authenticated event and only return a successful ACK response after the sink returns `ACCEPTED`.

#### Scenario: Webhook requests overlap
- **WHEN** multiple threads invoke `handle(request, sink)` concurrently on the same Webhook view
- **THEN** every invocation MUST authenticate and produce its response independently without accessing a root-owned resource

#### Scenario: Webhook handling overlaps root usage
- **WHEN** one thread invokes `handle(request, sink)` while another caller invokes Directory, Messaging, credential testing or `close()`
- **THEN** Webhook handling and the root operation MUST proceed without coordination or shared mutable runtime resources

#### Scenario: Root adapter closes after a Webhook view is obtained
- **WHEN** the root adapter closes before or during a call on an already obtained Webhook view
- **THEN** root close MUST NOT cancel, invalidate or close the Webhook view, and the view MUST remain usable from immutable configuration

#### Scenario: Provider sends a URL challenge
- **WHEN** a Provider sends a valid Webhook URL challenge
- **THEN** the Webhook capability MUST return the Provider-specific challenge response without calling the sink

#### Scenario: Authenticated Webhook event is accepted
- **WHEN** the Webhook capability authenticates one event and the sink returns `ACCEPTED`
- **THEN** `handle` MUST return the Provider-specific successful response

### Requirement: STREAM Events MUST own an independent single-run lifecycle

Each `IMStreamEvents` instance MUST own the STREAM resources it creates and MUST start in `NEW`. Its only state-advancing transitions MUST be `NEW -> RUNNING`, `NEW -> CLOSED` and `RUNNING -> CLOSED`; `CLOSED` MUST be terminal. The first eligible `run(sink, stop)` MUST atomically transition `NEW` to `RUNNING`; the instance MUST enter `RUNNING` at most once. Return, stop or terminal failure from that run, or `close()` from `NEW` or `RUNNING`, MUST transition the instance to `CLOSED`. `close()` MUST be thread-safe and idempotent. If close wins before run starts, the instance MUST NOT establish a Provider connection. If close is requested while run is active, run MUST stop reconnecting and release its owned resources before returning. Once `CLOSED`, the instance MUST NOT start another connection lifecycle. `IMProviderAdapter` MUST NOT track or close returned `IMStreamEvents` instances.

#### Scenario: Run calls compete on a new instance
- **WHEN** two or more threads concurrently invoke `run()` while the instance is `NEW`
- **THEN** at most one invocation MUST atomically transition the instance to `RUNNING`
- **AND** every other invocation MUST return without starting another lifecycle, establishing another connection or changing the instance state

#### Scenario: Close is called before run
- **WHEN** `close()` is invoked on a `NEW` instance
- **THEN** the instance MUST permanently enter `CLOSED` without establishing a connection
- **AND** any later `run()` invocation MUST return without registering callbacks or invoking the sink

#### Scenario: Close is called while run is active
- **WHEN** `close()` is invoked on a `RUNNING` instance, including from another thread
- **THEN** the instance MUST enter `CLOSED`, prevent any not-yet-started connection or reconnect, and release or arrange release of every in-flight or established STREAM resource according to the concrete SDK lifecycle

#### Scenario: Run and close compete on a new instance
- **WHEN** `run()` and `close()` concurrently attempt to transition one `NEW` instance
- **THEN** the transition MUST be atomic: either close wins and `run()` establishes no connection, or run wins and close terminally stops that single run lifecycle

#### Scenario: Closed instance is used again
- **WHEN** `close()` or `run()` is invoked after the instance has entered `CLOSED`
- **THEN** `close()` MUST remain a no-op and `run()` MUST return without leaving `CLOSED` or establishing a Provider connection

#### Scenario: Provider SDK invokes an event callback
- **WHEN** a STREAM SDK callback receives an authenticated business delivery
- **THEN** the STREAM capability MUST call the supplied sink and MUST keep Provider-specific ACK ownership inside the callback path

#### Scenario: Provider sends a control frame
- **WHEN** a Provider sends ping, reconnect, disconnect or another connection-control frame
- **THEN** the STREAM capability MUST handle it without producing an `AuthenticatedIMEvent`

#### Scenario: Stop is requested
- **WHEN** the supplied stop signal requests termination
- **THEN** `run` MUST stop reconnecting, close resources owned by that `IMStreamEvents` capability, transition to `CLOSED` and return according to the concrete SDK lifecycle

#### Scenario: Root adapter is closed after a STREAM instance starts
- **WHEN** an independently created `IMStreamEvents` is active and a caller invokes `IMProviderAdapter.close()` after all externally serialized root-context operations have returned
- **THEN** the STREAM resources MUST remain the responsibility of that instance's own run/close lifecycle rather than requiring the root adapter to track it

### Requirement: Transport lifecycle MUST remain outside AuthenticatedIMEvent
URL challenge data, HTTP response encoding, signature headers, encrypted request bodies, decryption keys, stream connection state, control frames, ACK envelope identifiers and SDK clients MUST remain inside the applicable concrete event capability.

#### Scenario: Authenticated event reaches a sink
- **WHEN** Webhook or STREAM Events calls the sink
- **THEN** the event MUST contain authenticated Provider facts and payload only, without transport credentials or response and connection objects

### Requirement: Provider event IDs MUST never be synthesized
The adapter MUST preserve a Provider event ID only when Provider evidence confirms that it identifies the event and remains stable across redelivery. It MUST NOT synthesize an event ID from payload hash, timestamp, message reference or transport ACK envelope data.

#### Scenario: Provider supplies no stable event ID
- **WHEN** an authenticated delivery has no confirmed stable Provider event ID
- **THEN** `AuthenticatedIMEvent` MUST contain no event ID and MUST leave duplicate handling to the sink

### Requirement: Provider event payload MUST remain independent from consumer schemas
`AuthenticatedIMEvent` MUST retain immutable decrypted Provider-native payload and MAY include a Provider-owned event-type discriminator. The Provider adapter MUST NOT decode it into a consumer-specific command, persistence record or business event model.

#### Scenario: Consumer needs a specialized event model
- **WHEN** a consumer receives an `AuthenticatedIMEvent`
- **THEN** an independent consumer or decoder MUST interpret the Provider-native payload after the adapter boundary
