## ADDED Requirements

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

### Requirement: IMEventStream MUST expose a stoppable blocking run lifecycle
`IMEventStream` MUST expose `run(signal)`. It MUST deliver authenticated business events to the `IMEventConsumer` supplied to `create_stream_handler(consumer)`. The call MUST block while the event stream is running. After `StopSignal.stop_requested` becomes true, the event stream MUST stop establishing or reconnecting Provider connections, release all resources owned by that event stream, wait for every in-flight consumer call to return and then return. No consumer call may begin after `run()` returns. Each event stream instance MUST start at most one run lifecycle. A second invocation MUST raise `IMStreamRunError`. Root adapter close MUST NOT stop or otherwise replace the lifecycle of a previously created event stream.

#### Scenario: Stop is requested
- **WHEN** the supplied `StopSignal.stop_requested` becomes true while `run()` is active
- **THEN** `run()` MUST finish all in-flight consumer calls and return

#### Scenario: Event stream is run twice
- **WHEN** `run()` is invoked a second time on the same event stream instance
- **THEN** it MUST raise `IMStreamRunError` without starting another run lifecycle

#### Scenario: STREAM terminates with an exposed run failure
- **WHEN** a terminal STREAM failure crosses the shared interface
- **THEN** it MUST be represented by operator-safe `IMStreamRunError` rather than a Provider client or Provider-specific exception

#### Scenario: Root adapter closes while an event stream is running
- **WHEN** root close occurs after an event stream has started
- **THEN** the event stream MUST continue until its `StopSignal.stop_requested` becomes true or the run otherwise returns

### Requirement: StopSignal MUST expose caller-controlled termination state
A `StopSignal` MUST wrap a caller-owned stop source. Its `stop_requested` property MUST report whether stop has been requested, and its `wait(timeout)` operation MUST report whether stop was requested before the timeout. Once the caller-owned source requests stop, `stop_requested` MUST remain true.

#### Scenario: Caller stops a running event stream
- **WHEN** the caller requests stop through the source associated with the `StopSignal` passed to `run()`
- **THEN** the signal's `stop_requested` property MUST become true
- **AND** a waiting signal operation MUST observe the stop request

#### Scenario: Caller requests stop more than once
- **WHEN** the caller requests stop repeatedly through the same source
- **THEN** `stop_requested` MUST remain true without creating a new termination lifecycle

### Requirement: Transport implementation context MUST remain outside AuthenticatedIMEvent
An adapter MUST NOT augment `AuthenticatedIMEvent` with transport credentials, signature headers, raw encrypted envelopes, HTTP response state, connection state, control frames, acknowledgement handles, Provider client objects or other adapter-owned transport context not explicitly defined by the shared contract. This restriction MUST NOT remove fields already present in the decoded Webhook JSON object or exposed by the Provider SDK's supported STREAM serialization.

#### Scenario: Authenticated event reaches the application consumer
- **WHEN** a Webhook handler or event stream invokes `IMEventConsumer`
- **THEN** the event MUST contain authenticated delivery facts and a serialized Provider payload without transport implementation context not defined by the shared contract
