# im-provider-events Specification

## Purpose
TBD - created by archiving change define-im-provider-adapter-contracts. Update Purpose after archive.
## Requirements
### Requirement: Event transport support MUST be expressed by factories
Slack and Feishu/Lark adapters MUST create Webhook handlers and event streams. Microsoft Teams MUST create Webhook handlers and return `None` from `create_stream_handler(consumer)`. DingTalk and WeCom MUST return `None` from both event transport factories in this release. Factory results MUST be authoritative; no separate support flag or dummy event transport may exist.

#### Scenario: Initial Provider event capabilities are inspected
- **WHEN** callers invoke the event transport factories on the five initial adapters
- **THEN** each factory MUST return the applicable event transport or `None` according to the Provider capability matrix

### Requirement: Authenticated inbound events MUST converge at IMEventConsumer
`create_webhook_handler(consumer)` and `create_stream_handler(consumer)` MUST bind the supplied application `IMEventConsumer` to the returned event transport. `IMWebhookHandler` and `IMEventStream` MUST preserve their distinct request and run interfaces while delivering successfully authenticated business events to that consumer. `accept(event)` MUST return `ACCEPTED` only after the application has processed the event or taken responsibility for later processing. It MUST return `NOT_ACCEPTED` otherwise.

#### Scenario: Event consumer is supplied to an event transport factory
- **WHEN** a caller creates a supported Webhook handler or event stream with an `IMEventConsumer`
- **THEN** authenticated business events received by the returned event transport MUST be delivered to that same `IMEventConsumer`

#### Scenario: Event consumer accepts an event
- **WHEN** `accept()` returns `ACCEPTED`
- **THEN** the Provider event transport MUST report a successful Provider acknowledgement where the Provider protocol exposes an acknowledgement decision controlled by the adapter

#### Scenario: Event consumer does not accept an event
- **WHEN** `accept()` returns `NOT_ACCEPTED`
- **THEN** the Provider event transport MUST NOT report a successful acknowledgement where the Provider protocol exposes that decision

#### Scenario: Event is delivered by a Provider without redelivery support
- **WHEN** the Provider cannot redeliver an unaccepted event
- **THEN** `NOT_ACCEPTED` MUST NOT be interpreted as a guarantee that the event will be delivered again

### Requirement: IMEventConsumer MUST be thread-safe
The same `IMEventConsumer` MAY receive concurrent calls from Webhook handlers and event streams. `accept(event)` MUST safely support concurrent invocation. One authenticated delivery MUST invoke the composed consumer at most once.

#### Scenario: Multiple authenticated deliveries arrive concurrently
- **WHEN** concurrent Webhook or STREAM deliveries invoke one event consumer
- **THEN** the consumer MUST preserve its acceptance semantics under concurrent use

### Requirement: AuthenticatedIMEvent MUST contain only authenticated delivery facts
After successful authentication and applicable decryption, Webhook handlers and event streams MUST produce values conforming to the same immutable `AuthenticatedIMEvent` contract. The event MUST contain Provider, stable Provider tenant ID, trusted local receive time and the transport-specific serialized Provider payload defined below. Its real Provider event ID, Provider event type and Provider event time MUST each be optional and MUST be present only when the Provider supplies that fact with confirmed semantics.

#### Scenario: Inbound delivery is authenticated
- **WHEN** a Webhook or STREAM delivery passes all applicable authentication and decryption checks
- **THEN** the composed event consumer MUST receive one `AuthenticatedIMEvent`

#### Scenario: Inbound delivery is not authenticated
- **WHEN** an applicable authentication or decryption check fails
- **THEN** the composed event consumer MUST NOT be invoked

#### Scenario: Provider supplies no event time
- **WHEN** an authenticated delivery has no Provider event time with confirmed semantics
- **THEN** `AuthenticatedIMEvent.occurred_at` MUST be `None`

### Requirement: Provider event IDs MUST never be synthesized
An event transport MUST preserve a Provider event ID only when authoritative Provider semantics confirm that it identifies the event and remains stable across redelivery. It MUST NOT synthesize an event ID from payload, timestamps, message references or transport envelope data.

#### Scenario: Provider supplies no stable event ID
- **WHEN** an authenticated delivery has no confirmed stable Provider event ID
- **THEN** `AuthenticatedIMEvent` MUST contain no event ID

### Requirement: Serialized Provider payload MUST remain independent from consumer schemas
For Webhook transports, `AuthenticatedIMEvent.payload` MUST be a string containing the JSON serialization of the complete JSON object obtained from the Provider HTTP request body after successful authentication and, when applicable, decryption. The adapter MUST preserve every field and value in the decoded JSON data model and MUST NOT perform consumer-specific transformation. If the Provider uses an encrypted envelope, `payload` MUST represent the decrypted plaintext JSON object rather than the outer encrypted envelope. This preservation requirement does not require retaining the original body bytes, object-member order, whitespace or other lexical JSON representation.

For STREAM transports, `AuthenticatedIMEvent.payload` MUST be the complete JSON serialization of the native event value supplied by the Provider SDK to the event callback. The adapter MUST use the Provider SDK's supported serialization, preserve every field and value exposed by that serialization and MUST NOT perform consumer-specific transformation. The contract does not require preservation of original STREAM wire bytes or fields not exposed by the Provider SDK. Webhook and STREAM payloads are not required to be byte-for-byte identical.

For both transports, the adapter MUST NOT replace the serialized Provider payload with a consumer-specific command, persistence record or business event.

#### Scenario: Consumer needs a specialized event model
- **WHEN** a consumer receives an `AuthenticatedIMEvent`
- **THEN** consumer-specific interpretation MUST occur after the Provider adapter boundary

#### Scenario: Webhook body contains a complete JSON data model
- **WHEN** a successfully authenticated Webhook request yields a decoded Provider JSON object
- **THEN** `AuthenticatedIMEvent.payload` MUST preserve every object member, array element, scalar value and null from that JSON object

#### Scenario: Webhook body uses an encrypted envelope
- **WHEN** a successfully authenticated Provider Webhook request contains an applicable encrypted envelope
- **THEN** `AuthenticatedIMEvent.payload` MUST serialize the complete decrypted plaintext JSON object rather than the outer encrypted envelope

#### Scenario: SDK callback contains Provider-defined envelope metadata
- **WHEN** a Provider SDK supplies a serializable Python native value containing both event data and Provider-defined envelope metadata
- **THEN** `AuthenticatedIMEvent.payload` MUST preserve every field and value exposed by the Provider SDK's supported serialization without requiring a business-field projection

### Requirement: WebhookRequest and WebhookResponse MUST be framework-neutral
`WebhookRequest` MUST carry the uppercase HTTP method, ordered headers with duplicates preserved, exact body bytes before decoding and trusted local receive time. `WebhookResponse` MUST carry status code, ordered response headers and exact response body bytes. Neither value MUST expose framework request or response objects.

#### Scenario: Provider signature covers exact request bytes
- **WHEN** a Webhook request is adapted from an HTTP framework
- **THEN** the `WebhookRequest` body and duplicate headers MUST preserve the values required for Provider verification

#### Scenario: Provider returns a challenge or acknowledgement
- **WHEN** a Webhook handler completes request processing
- **THEN** its `WebhookResponse` MUST contain all response facts needed by the HTTP boundary

### Requirement: IMWebhookHandler MUST expose thread-safe request handling
`IMWebhookHandler` MUST expose `handle(request) -> response`. Calls on the same handler MAY overlap. A created handler MUST remain bound to the Provider configuration and the `IMEventConsumer` supplied to `create_webhook_handler(consumer)`, and it MAY outlive the root adapter. Webhook handling MUST apply the Provider's authentication, challenge and acknowledgement semantics before returning its response.

#### Scenario: Webhook requests overlap
- **WHEN** multiple threads invoke `handle(request)` on the same Webhook handler
- **THEN** each invocation MUST independently produce the response for its request

#### Scenario: Root adapter closes after a Webhook handler is created
- **WHEN** root close overlaps or precedes a call on the created Webhook handler
- **THEN** root close MUST NOT cancel or invalidate that handler

#### Scenario: Provider sends a valid URL challenge
- **WHEN** a Provider sends a valid challenge request
- **THEN** `handle()` MUST return the Provider-specific challenge response without invoking `IMEventConsumer`

### Requirement: IMEventStream MUST be an owner-managed resource
`IMEventStream` MUST expose only `start()` and `stop()` as its lifecycle API. It MUST deliver authenticated business events to the `IMEventConsumer` supplied to `create_stream_handler(consumer)`. `start()` MUST synchronously complete initialization and start event reception. It MAY block for initialization and readiness, but MUST return while the stream remains active and MUST leave ongoing event reception in execution contexts owned by the concrete implementation. Each event stream instance MUST successfully start at most once and MUST NOT restart after it has stopped. A disallowed subsequent `start()` MUST raise an operator-safe `IMStreamStartError` without creating new resources. Root adapter close MUST NOT stop or replace the lifecycle of a previously created event stream.

#### Scenario: Event stream starts successfully
- **WHEN** the lifecycle owner invokes `start()` on a new event stream
- **THEN** `start()` MUST return after synchronous initialization and readiness complete
- **AND** the stream MUST continue receiving events in its implementation-owned execution context

#### Scenario: Event stream is started after its one-shot lifecycle
- **WHEN** `start()` is invoked after that event stream has already started successfully or stopped
- **THEN** it MUST raise `IMStreamStartError` without creating another event-reception lifecycle

#### Scenario: Root adapter closes while an event stream is active
- **WHEN** root close occurs after an event stream has started
- **THEN** the event stream MUST continue until its lifecycle owner invokes `stop()`

### Requirement: IMEventStream stop SHOULD provide graceful shutdown
`stop()` MUST synchronously request stream termination and return after the implementation's stop operation completes. It SHOULD first stop accepting new events, then wait for every already accepted event to finish conversion, consumer processing and any Provider protocol response, and finally release resources owned by the event stream. The transition from accepting to not accepting SHOULD have a defined order relative to naturally concurrent internal event delivery. After `stop()` returns, the stream SHOULD NOT invoke its consumer, execute accepted event processing, establish or reconnect a Provider connection, leave a Provider protocol response pending or retain implementation-owned background tasks or resources. An implementation MAY provide a weaker shutdown boundary when it cannot provide these graceful-shutdown guarantees. Serial calls after a successful `stop()` MUST be no-ops. `stop()` MUST also be safe to place in a `finally` block after `start()` fails. If the implementation's stop operation fails, it MUST raise an operator-safe `IMStreamStopError` rather than expose a Provider client or Provider-specific exception.

#### Scenario: Stop drains an accepted event
- **WHEN** `stop()` begins while an already accepted event is still being processed
- **THEN** `stop()` SHOULD wait for that processing and its applicable Provider protocol response before returning
- **AND** no event crossing the acceptance boundary after stop takes effect SHOULD invoke the consumer

#### Scenario: Graceful drain is not supported
- **WHEN** an implementation cannot guarantee that accepted event processing and applicable Provider protocol responses finish before `stop()` returns
- **THEN** `stop()` MAY return after its supported stop operation completes
- **AND** callers MUST NOT infer a cross-Provider drain barrier from the shared contract

#### Scenario: Stop is repeated serially
- **WHEN** the lifecycle owner invokes `stop()` more than once without overlap
- **THEN** later invocations MUST return without reopening or repeating the completed lifecycle

#### Scenario: Start fails before finally cleanup
- **WHEN** `start()` raises `IMStreamStartError`
- **THEN** a subsequent serial `stop()` MUST be safe to invoke

### Requirement: IMEventStream lifecycle calls MUST be externally serialized and non-reentrant
The lifecycle owner MUST invoke `start()` and `stop()` serially. These lifecycle methods are not required to be concurrent-safe and MUST NOT be invoked re-entrantly from an `IMEventConsumer` callback. Implementations SHOULD coordinate naturally concurrent internal deliveries against the stop acceptance boundary when they provide graceful shutdown.

#### Scenario: Lifecycle calls overlap
- **WHEN** callers overlap `start()` and `stop()`, overlap multiple `stop()` calls or invoke either method from the consumer callback
- **THEN** that use MUST be outside the event stream contract

### Requirement: STREAM event failures MUST remain isolated from lifecycle ownership
`start()` MUST report only synchronous startup failures as `IMStreamStartError`. A single event conversion, consumer or Provider protocol-response failure MUST NOT propagate to the lifecycle owner, MUST NOT automatically stop the event stream and MUST be recorded by the implementation with the applicable unsuccessful-delivery semantics. Runtime failures that are not synchronously observable during `start()` belong to implementation observability or a separate supervisor.

#### Scenario: One event fails
- **WHEN** conversion, consumer processing or the Provider protocol response fails for one event
- **THEN** the implementation MUST record the failure and apply the Provider's unsuccessful-delivery semantics
- **AND** the failure MUST NOT stop the stream or propagate through a lifecycle call

#### Scenario: Runtime stream failure occurs after start
- **WHEN** an unrecoverable transport failure occurs after `start()` returns
- **THEN** the implementation MUST make it observable without adding a blocking wait or failure signal to `IMEventStream`

### Requirement: Transport implementation context MUST remain outside AuthenticatedIMEvent
An adapter MUST NOT augment `AuthenticatedIMEvent` with transport credentials, signature headers, raw encrypted envelopes, HTTP response state, connection state, control frames, acknowledgement handles, Provider client objects or other adapter-owned transport context not explicitly defined by the shared contract. This restriction MUST NOT remove fields already present in the decoded Webhook JSON object or exposed by the Provider SDK's supported STREAM serialization.

#### Scenario: Authenticated event reaches the application consumer
- **WHEN** a Webhook handler or event stream invokes `IMEventConsumer`
- **THEN** the event MUST contain authenticated delivery facts and a serialized Provider payload without transport implementation context not defined by the shared contract
