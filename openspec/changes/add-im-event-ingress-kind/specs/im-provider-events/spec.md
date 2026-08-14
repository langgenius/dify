## MODIFIED Requirements

### Requirement: AuthenticatedIMEvent MUST contain only authenticated delivery facts
After successful authentication and applicable decryption, Webhook handlers and event streams MUST produce values conforming to the same immutable `AuthenticatedIMEvent` contract. The event MUST contain Provider, stable Provider tenant ID, trusted local receive time, required `IMEventIngressKind` and the ingress-specific serialized Provider payload defined below. `IMEventIngressKind` MUST contain exactly `WEBHOOK` and `STREAM` for the supported ingress contracts. A Webhook handler MUST set `ingress_kind` to `WEBHOOK`, and an event stream MUST set it to `STREAM`. The value MUST describe the actual ingress contract used to construct this delivery's payload snapshot; it MUST NOT represent deployment configuration, desired transport mode or event identity. The event's real Provider event ID, Provider event type and Provider event time MUST each be optional and MUST be present only when the Provider supplies that fact with confirmed semantics.

#### Scenario: Inbound delivery is authenticated
- **WHEN** a Webhook or STREAM delivery passes all applicable authentication and decryption checks
- **THEN** the composed event consumer MUST receive one `AuthenticatedIMEvent` whose `ingress_kind` identifies the actual ingress contract

#### Scenario: Inbound delivery is not authenticated
- **WHEN** an applicable authentication or decryption check fails
- **THEN** the composed event consumer MUST NOT be invoked

#### Scenario: Provider supplies no event time
- **WHEN** an authenticated delivery has no Provider event time with confirmed semantics
- **THEN** `AuthenticatedIMEvent.occurred_at` MUST be `None`

#### Scenario: Deployment selects one event transport mode
- **WHEN** composition selects Webhook or STREAM as the effective deployment transport
- **THEN** each resulting event MUST record its actual ingress kind without treating `AuthenticatedIMEvent.ingress_kind` as integration configuration

### Requirement: Serialized Provider payload MUST remain independent from consumer schemas
For Webhook ingress, `AuthenticatedIMEvent.ingress_kind` MUST be `WEBHOOK`, and `AuthenticatedIMEvent.payload` MUST be a string containing the JSON serialization of the complete JSON object obtained from the Provider HTTP request body after successful authentication and, when applicable, decryption. The adapter MUST preserve every field and value in the decoded JSON data model and MUST NOT perform consumer-specific transformation. If the Provider uses an encrypted envelope, `payload` MUST represent the decrypted plaintext JSON object rather than the outer encrypted envelope. This preservation requirement does not require retaining the original body bytes, object-member order, whitespace or other lexical JSON representation.

For STREAM ingress, `AuthenticatedIMEvent.ingress_kind` MUST be `STREAM`, and `AuthenticatedIMEvent.payload` MUST be the complete Provider SDK callback serialization. The adapter MUST use the Provider SDK's supported serialization, preserve every field and value exposed by it and MUST NOT perform consumer-specific transformation. The contract does not require preservation of original STREAM wire bytes or fields not exposed by the Provider SDK. Webhook and STREAM payloads are not required to be byte-for-byte identical.

For both ingress kinds, the adapter MUST NOT replace the serialized Provider payload with a consumer-specific command, persistence record or business event. It MUST NOT normalize Webhook and STREAM representations before `IMEventConsumer`, wrap them only to encode provenance or introduce a second canonical payload. A Provider-specific decoder that supports more than one ingress kind MUST select the top-level payload interpretation using `AuthenticatedIMEvent.ingress_kind`; it MUST NOT infer ingress kind from Provider payload fields or silently fall back to another ingress parser when the declared kind and payload shape are inconsistent.

#### Scenario: Consumer needs a specialized event model
- **WHEN** a consumer receives an `AuthenticatedIMEvent`
- **THEN** consumer-specific interpretation MUST occur after the Provider adapter boundary

#### Scenario: Webhook body contains a complete JSON data model
- **WHEN** a successfully authenticated Webhook request yields a decoded Provider JSON object
- **THEN** `AuthenticatedIMEvent.ingress_kind` MUST be `WEBHOOK` and `payload` MUST preserve every object member, array element, scalar value and null from that JSON object

#### Scenario: Webhook body uses an encrypted envelope
- **WHEN** a successfully authenticated Provider Webhook request contains an applicable encrypted envelope
- **THEN** `AuthenticatedIMEvent.payload` MUST serialize the complete decrypted plaintext JSON object rather than the outer encrypted envelope

#### Scenario: Provider SDK callback contains Provider-defined envelope metadata
- **WHEN** a Provider SDK callback supplies a serializable native value containing both event data and Provider-defined envelope metadata
- **THEN** `AuthenticatedIMEvent.ingress_kind` MUST be `STREAM` and `payload` MUST preserve every field and value exposed by the Provider SDK's supported serialization without requiring a business-field projection

#### Scenario: Provider decoder receives a Webhook snapshot
- **WHEN** a Provider-specific decoder receives an event whose `ingress_kind` is `WEBHOOK`
- **THEN** it MUST interpret the payload from the Webhook body snapshot boundary without using payload content to guess another ingress kind

#### Scenario: Declared ingress and payload shape conflict
- **WHEN** a Provider-specific decoder receives a recognized event whose payload cannot be interpreted according to its declared `ingress_kind`
- **THEN** decoding MUST fail through the applicable operator-safe decoding failure contract and MUST NOT retry using another ingress interpretation

#### Scenario: Two ingress representations carry an equivalent Provider card callback
- **WHEN** a Provider-specific decoder receives valid Webhook and STREAM representations of the same logical card interaction
- **THEN** it MUST normalize both representations into equivalent `IMCardEvent` values without replacing either persisted `AuthenticatedIMEvent.payload`

### Requirement: Transport implementation context MUST remain outside AuthenticatedIMEvent
An adapter MUST NOT augment `AuthenticatedIMEvent` with transport credentials, signature headers, raw encrypted envelopes, HTTP response state, connection state, control frames, acknowledgement handles, Provider client objects or other adapter-owned transport context not explicitly defined by the shared contract. `IMEventIngressKind` is an authenticated delivery provenance fact that selects the payload snapshot interpretation and MUST be the only shared transport-level discriminator added by this change. This restriction MUST NOT remove fields already present in the decoded Webhook JSON object or exposed by the supported STREAM callback serialization.

#### Scenario: Authenticated event reaches the application consumer
- **WHEN** a Webhook handler or event stream invokes `IMEventConsumer`
- **THEN** the event MUST contain authenticated delivery facts, its ingress kind and a serialized Provider payload without unspecified transport implementation context

#### Scenario: Stream implementation changes its client library
- **WHEN** a concrete adapter changes the SDK or client used to receive the same STREAM ingress contract
- **THEN** it MUST continue to emit `IMEventIngressKind.STREAM` without exposing the client implementation in `AuthenticatedIMEvent`

## ADDED Requirements

### Requirement: Slack MUST preserve native ingress payloads and dispatch card decoding explicitly
Slack Webhook handling MUST construct `AuthenticatedIMEvent` with `ingress_kind = WEBHOOK` and MUST preserve the complete authenticated decoded Provider JSON object as `payload`. Slack Socket Mode handling MUST construct `AuthenticatedIMEvent` with `ingress_kind = STREAM` and MUST preserve the complete `SocketModeRequest.to_dict()` Provider SDK callback serialization, including its Socket Mode envelope, as `payload`.

`_SlackCardCodec` MUST dispatch by `AuthenticatedIMEvent.ingress_kind`. For `WEBHOOK`, it MUST decode the payload root as the card callback. For `STREAM`, it MUST first validate and unwrap the Socket Mode envelope and then decode its nested Provider callback. It MUST NOT infer STREAM ingress solely from `payload["type"] == "interactive"`, and it MUST NOT normalize either payload representation before `IMEventConsumer`.

#### Scenario: Slack Webhook event is accepted
- **WHEN** a Slack Webhook delivery authenticates and yields a business event
- **THEN** the consumer MUST receive `ingress_kind = WEBHOOK` and the complete decoded Slack request JSON without a Dify-owned provenance wrapper

#### Scenario: Slack Socket Mode event is accepted
- **WHEN** a Slack Socket Mode SDK callback yields a supported business event
- **THEN** the consumer MUST receive `ingress_kind = STREAM` and the complete Socket Mode request serialization including its Provider envelope

#### Scenario: Slack STREAM card callback is decoded
- **WHEN** `_SlackCardCodec` receives a valid Slack card event with `ingress_kind = STREAM`
- **THEN** it MUST unwrap the Socket Mode envelope before decoding the nested card callback

#### Scenario: Slack payload shape attempts to override declared ingress
- **WHEN** `_SlackCardCodec` receives a Socket Mode envelope declared as `WEBHOOK` or a bare Webhook callback declared as `STREAM`
- **THEN** it MUST raise the applicable operator-safe decoding error and MUST NOT select a decoder branch solely from the payload `type` field

#### Scenario: Equivalent Slack callbacks arrive through both ingress kinds
- **WHEN** Slack Webhook and Socket Mode payloads represent the same card interaction
- **THEN** `_SlackCardCodec` MUST produce equivalent `IMCardEvent` values while both `AuthenticatedIMEvent` values retain their complete ingress-specific payloads

### Requirement: Feishu and Lark MUST persist direct Provider payloads without provenance wrappers
Feishu/Lark Webhook handling MUST construct `AuthenticatedIMEvent` with `ingress_kind = WEBHOOK` and MUST store the complete authenticated decrypted Provider JSON directly as `payload`. Feishu/Lark STREAM handling MUST construct `AuthenticatedIMEvent` with `ingress_kind = STREAM` and MUST store `sdk_event.native_payload` directly as `payload`.

The adapters MUST remove the Dify-owned payload representations produced by `_authenticated_webhook_payload` and `_authenticated_stream_payload`; they MUST NOT persist encryption provenance, custom Webhook/STREAM wrapper keys, SDK object type or implementation-specific SDK class names solely for decoder dispatch. Supported stream SDK object-type validation MUST remain at the stream adapter boundary before `AuthenticatedIMEvent` reaches `IMEventConsumer`.

`_MSFeishuLarkCardCodec` MUST dispatch explicitly by `AuthenticatedIMEvent.ingress_kind` and then decode the direct Provider callback JSON. It MUST normalize valid Webhook and STREAM representations into the same `IMCardEvent` contract. It MUST reject malformed JSON, obsolete Dify-owned provenance wrappers and payloads that violate the direct Provider callback contract, without retrying another ingress interpretation. When valid Webhook and SDK callback serializations expose the same Provider JSON shape, the decoder MUST NOT fabricate additional provenance by persisting an SDK class name or adding a canonical wrapper.

#### Scenario: Encrypted Feishu or Lark Webhook event is accepted
- **WHEN** a Feishu/Lark Webhook envelope authenticates and decrypts to a Provider business-event JSON object
- **THEN** the consumer MUST receive `ingress_kind = WEBHOOK` and `payload` MUST be the complete decrypted Provider JSON directly rather than the encrypted envelope or a Dify-owned wrapper

#### Scenario: Feishu or Lark STREAM event is accepted
- **WHEN** the stream adapter validates a supported Provider SDK event object and constructs its `_SDKEventEnvelope`
- **THEN** the consumer MUST receive `ingress_kind = STREAM` and `payload` MUST equal `sdk_event.native_payload` without an object-type wrapper

#### Scenario: Feishu or Lark stream SDK object type is unsupported
- **WHEN** the stream adapter receives an unsupported SDK callback object type
- **THEN** it MUST reject the callback at the stream adapter boundary and MUST NOT persist an implementation-specific class name for later decoder dispatch

#### Scenario: Feishu or Lark legacy provenance wrapper reaches the decoder
- **WHEN** `_MSFeishuLarkCardCodec` receives a recognized card event whose payload uses the removed `_authenticated_webhook_payload` or `_authenticated_stream_payload` wrapper shape
- **THEN** it MUST raise the applicable operator-safe decoding error rather than accept the wrapper or infer ingress from it

#### Scenario: Equivalent Feishu or Lark callbacks arrive through both ingress kinds
- **WHEN** direct decrypted Webhook JSON and direct `sdk_event.native_payload` represent the same card interaction
- **THEN** `_MSFeishuLarkCardCodec` MUST produce equivalent `IMCardEvent` values without introducing a canonical payload representation
