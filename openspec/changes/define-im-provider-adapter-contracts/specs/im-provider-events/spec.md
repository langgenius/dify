## ADDED Requirements

### Requirement: Event transport support MUST be expressed by adapter capabilities
Slack and Feishu/Lark adapters MUST expose both Webhook Events and STREAM Events. Microsoft Teams MUST expose Webhook Events only. DingTalk and WeCom MUST expose neither event capability in this release. Capability presence MUST be authoritative; no separate transport-support flag or dummy unsupported event capability may exist.

#### Scenario: Microsoft Teams event capabilities are inspected
- **WHEN** a caller inspects a Microsoft Teams adapter
- **THEN** Webhook Events MUST be present and STREAM Events MUST be absent

#### Scenario: DingTalk event capabilities are inspected
- **WHEN** a caller inspects a DingTalk adapter
- **THEN** both Webhook Events and STREAM Events MUST be absent

#### Scenario: WeCom event capabilities are inspected
- **WHEN** a caller inspects a WeCom adapter
- **THEN** both Webhook Events and STREAM Events MUST be absent

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
- **THEN** the concrete adapter MUST complete the Provider-specific successful ACK

#### Scenario: Sink cannot accept an event
- **WHEN** the sink returns `RETRY` or raises an unexpected failure
- **THEN** the concrete adapter MUST NOT send a successful ACK and MUST use the Provider-specific retry-compatible failure behavior

#### Scenario: Sink recognizes an identified duplicate
- **WHEN** the sink has already accepted an event with the same real Provider event ID
- **THEN** it MAY return `ACCEPTED` so the adapter acknowledges the redelivery without exposing deduplication state through the Provider contract

### Requirement: Webhook Events MUST expose caller-driven request handling
Webhook Events MUST expose `handle(request, sink) -> response` using framework-neutral Webhook request and response values. The concrete adapter MUST own URL challenge, signature and timestamp verification, replay checks, decryption and Provider-specific response encoding. It MUST call the sink at most once for one authenticated event and only return a successful ACK response after the sink returns `ACCEPTED`.

#### Scenario: Provider sends a URL challenge
- **WHEN** a Provider sends a valid Webhook URL challenge
- **THEN** the adapter MUST return the Provider-specific challenge response without calling the sink

#### Scenario: Authenticated Webhook event is accepted
- **WHEN** the adapter authenticates one event and the sink returns `ACCEPTED`
- **THEN** `handle` MUST return the Provider-specific successful response

### Requirement: STREAM Events MUST expose SDK-driven run lifecycle
STREAM Events MUST expose a long-running `run(sink, stop)` operation. The concrete adapter MUST own Provider SDK connection establishment, callback registration, connection authentication, control frames, reconnect behavior and protocol ACK. Provider SDK callbacks MUST authenticate and normalize one delivery, call the sink, and map the sink outcome to the ACK owned by the same callback or connection.

#### Scenario: Provider SDK invokes an event callback
- **WHEN** a STREAM SDK callback receives an authenticated business delivery
- **THEN** the adapter MUST call the supplied sink and MUST keep Provider-specific ACK ownership inside the callback path

#### Scenario: Provider sends a control frame
- **WHEN** a Provider sends ping, reconnect, disconnect or another connection-control frame
- **THEN** the adapter MUST handle it without producing an `AuthenticatedIMEvent`

#### Scenario: Stop is requested
- **WHEN** the supplied stop signal requests termination
- **THEN** `run` MUST stop reconnecting, close adapter-owned STREAM resources and return according to the concrete SDK lifecycle

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
