## ADDED Requirements

### Requirement: IM card callbacks MUST converge at IMCardEvent
The shared contract MUST define frozen `IMCardEvent` fields with exactly one `ProviderUserId`, non-empty action identifier, JSON-object inputs keyed by strings, and the `CorrelationToken` embedded by `send_card()`. The `inputs` root mapping MUST reject key replacement and deletion and MUST NOT alias the constructor's source mapping. Nested JSON objects and arrays MUST remain ordinary mutable containers; the contract MUST NOT recursively wrap them as immutable values. The event MUST NOT contain Provider-specific callback objects, raw Provider payloads, transport credentials, message references, Contact or binding identities, HITL form/grant models, submission state or workflow state.

#### Scenario: Different Provider callbacks represent the same interaction
- **WHEN** two supported Dynamic Card Providers deliver callbacks with the same normalized actor, action, inputs and correlation token through different Provider payload shapes
- **THEN** their decoders MUST produce the same `IMCardEvent` semantics
- **AND** neither result MUST expose either Provider's callback field names or SDK objects

#### Scenario: Card callback contains submitted inputs
- **WHEN** a supported card callback contains submitted values accepted by the Provider JSON protocol
- **THEN** `IMCardEvent.inputs` MUST contain only those normalized JSON values keyed by their card input identifiers
- **AND** it MUST NOT contain action metadata or the raw callback envelope

#### Scenario: Caller mutates card event inputs
- **WHEN** a caller replaces or deletes a key on the `IMCardEvent.inputs` root mapping
- **THEN** the operation MUST fail
- **AND WHEN** a caller mutates a nested JSON object or array
- **THEN** the nested mutation MUST remain observable through the event

### Requirement: IMCardEvent ProviderUserId MUST use the adapter identity namespace
`IMCardEvent.provider_user_id` MUST identify the callback actor in the same `(provider, provider_tenant_id)` namespace and identifier representation used by the concrete adapter's Directory and Messaging capabilities. A decoder MUST NOT expose a second callback-only actor identifier as `ProviderUserId`.

#### Scenario: Callback actor is decoded
- **WHEN** a supported Provider card callback identifies its acting user
- **THEN** the decoder MUST return that actor as the same `ProviderUserId` representation used by the Provider adapter's Directory and Messaging capabilities

#### Scenario: Feishu or Lark callback is decoded
- **WHEN** a Feishu or Lark card callback is decoded
- **THEN** `IMCardEvent.provider_user_id` MUST use the `union_id` representation required by the Feishu/Lark Directory and Messaging contract
- **AND** the adapter MUST NOT substitute an application-scoped `open_id`

### Requirement: IMCardEventDecoder MUST distinguish non-card events from decoding failures
The shared contract MUST define `UnrecognizedIMEvent`, `IMCardEventDecodeResult` as `IMCardEvent | UnrecognizedIMEvent`, `IMCardEventDecodingError`, and `IMCardEventDecoder.decode(AuthenticatedIMEvent)`. A decoder MUST return `UnrecognizedIMEvent` when the authenticated event is not a card event supported by that concrete Provider decoder. A coarse Provider event type that carries both Dify submission actions and other interactions MUST NOT by itself establish recognition. After Provider-specific recognition establishes a Dify card action, missing or incorrectly typed required facts, ambiguous invoked actions, and callback payloads that violate the expected Dify card schema MUST raise `IMCardEventDecodingError` rather than return `UnrecognizedIMEvent` or fabricate an `IMCardEvent`. Invalid serialized JSON or a malformed transport envelope MUST also raise `IMCardEventDecodingError` when safe decoding of that authenticated transport-discriminated event is required before the decoder can inspect the Provider-specific recognition marker.

#### Scenario: Authenticated event is not a card event
- **WHEN** a decoder receives a valid authenticated event whose Provider discriminator and event type do not identify a supported card event
- **THEN** it MUST return `UnrecognizedIMEvent`
- **AND** it MUST NOT raise a decoding error or fabricate card facts

#### Scenario: Transport-discriminated event has invalid JSON
- **WHEN** a Provider event type requires safe payload inspection to distinguish a Dify card action but its serialized payload is not valid JSON
- **THEN** it MUST raise `IMCardEventDecodingError`

#### Scenario: Provider event type carries a non-Dify interaction
- **WHEN** a valid authenticated Provider event uses the same coarse event type as Dify submissions but contains no Provider-specific Dify action marker
- **THEN** the decoder MUST return `UnrecognizedIMEvent`
- **AND** it MUST NOT require that interaction to satisfy the Dify callback schema

#### Scenario: Recognized card event violates the callback schema
- **WHEN** a decoder recognizes a Provider card event but its payload omits, ambiguously supplies or incorrectly types the callback actor, invoked action, submitted inputs or correlation token required by the Dify card schema
- **THEN** it MUST raise `IMCardEventDecodingError`
- **AND** it MUST NOT return `UnrecognizedIMEvent`

#### Scenario: Decoding error is reported safely
- **WHEN** `IMCardEventDecoder.decode()` raises `IMCardEventDecodingError`
- **THEN** the exception MUST NOT contain raw Provider payloads, submitted input values, correlation tokens, Provider profiles, credentials or Provider SDK exceptions

### Requirement: Card-event decoder MUST be a class-level optional Provider capability
Every concrete `IMProviderAdapter` class MUST expose `card_event_decoder()` as a class method returning `IMCardEventDecoder | None`. Calling the class method MUST require no adapter instance, credentials, Provider client or Channel context and MUST perform no network or persistence I/O. A returned decoder MUST be immutable in observable behavior, thread-safe, credential-free and independent from every root adapter instance lifecycle. Callers MUST NOT rely on decoder object identity across calls.

#### Scenario: Decoder capability is inspected without an adapter instance
- **WHEN** a caller invokes `card_event_decoder()` on a concrete Provider adapter class
- **THEN** the call MUST return the Provider's decoder or `None` without constructing a root adapter or performing I/O

#### Scenario: Decoder is used concurrently
- **WHEN** multiple inbox workers invoke one returned decoder concurrently with independent authenticated events
- **THEN** every invocation MUST follow the same deterministic decoding contract without external serialization

#### Scenario: Root adapter lifecycle changes
- **WHEN** any root adapter instance of the same concrete Provider is closed, replaced or never constructed
- **THEN** a returned decoder MUST remain usable without accessing that root instance or its credentials

### Requirement: Dynamic Card Messaging and card-event decoding MUST appear together
A concrete Provider adapter MUST expose Dynamic Card Messaging if and only if its class-level `card_event_decoder()` returns an `IMCardEventDecoder`. Slack, Feishu, Lark and Microsoft Teams MUST expose both capabilities. DingTalk and WeCom MUST expose neither. Capability presence MUST remain the authoritative support signal; the adapter MUST NOT add a separate support flag or dummy decoder.

#### Scenario: Initial Provider capabilities are inspected
- **WHEN** callers inspect the initial concrete Provider adapters
- **THEN** Slack, Feishu, Lark and Microsoft Teams MUST expose both Dynamic Card Messaging and card-event decoding
- **AND** DingTalk and WeCom MUST expose neither capability

#### Scenario: Provider implementation adds Dynamic Card Messaging
- **WHEN** a future concrete Provider implementation adds Dynamic Card Messaging
- **THEN** the same implementation change MUST add a decoder that satisfies the shared card-event contract

### Requirement: Sending and decoding MUST preserve one Provider-owned round trip
Each concrete Dynamic Card Provider implementation MUST own both the encoding used by `send_card()` and the decoding used by `IMCardEventDecoder`. For every callback produced from an accepted Dify card, decoding MUST preserve the supplied `CorrelationToken`, the invoked action identifier, the callback actor as `ProviderUserId`, and every submitted input JSON value. Provider callback metadata and legal card input identifiers MUST NOT silently overwrite one another. The shared interface MUST NOT expose the Provider-specific encoding or reserved wire members used to satisfy this requirement.

#### Scenario: Correlation and action identity round trip
- **WHEN** a user invokes one action on a card accepted from `send_card(provider_user_id, intent, correlation_token)`
- **THEN** the decoded event MUST contain the same `correlation_token` value unchanged
- **AND** it MUST contain the identifier of the invoked action unchanged

#### Scenario: Provider repeats action identity in two callback locations
- **WHEN** a Provider callback contains both an outer action identifier and the Dify action identifier embedded at send time
- **THEN** the decoder MUST require the two identifiers to match
- **AND** a mismatch MUST raise `IMCardEventDecodingError`

#### Scenario: Input name resembles callback metadata
- **WHEN** a card input identifier could collide with Provider callback metadata during send or callback merging
- **THEN** the Provider implementation MUST either isolate the metadata or reject the complete card as unrepresentable before Provider I/O
- **AND** it MUST NOT silently replace input values or callback metadata

### Requirement: Slack card decoding MUST converge across Webhook and Socket Mode
The Slack sender MUST use exact stable block IDs: `__dify.input.<ordinal>` for each input in render order and `__dify.actions` for the submission block. It MUST accept `static_select` controls with 1 through 100 options and reject larger option sets before Provider I/O. The Slack decoder MUST decode authenticated Block Actions delivered through either the Webhook direct payload or the complete Socket Mode SDK serialization. After safe JSON and transport-envelope decoding, it MUST recognize a Dify submission only when at least one invoked action uses the exact sender-owned `__dify.actions` block ID. Slack selection changes, legacy prefix-like IDs and other Block Actions without that exact marker MUST return `UnrecognizedIMEvent` before strict Dify callback validation. Once the marker is present, the decoder MUST read the callback actor as Slack `ProviderUserId`, require one unambiguous invoked Dify button action, recover the embedded `CorrelationToken`, validate the exact sender-owned message/state schema, and normalize every supported submitted card input. Equivalent Webhook and Socket Mode submission callbacks MUST produce equal `IMCardEvent` semantics.

#### Scenario: Slack sender renders a stable callback layout
- **WHEN** Slack renders a Dify card with ordered inputs and submission actions
- **THEN** input block IDs MUST be `__dify.input.0`, `__dify.input.1` and so on in render order
- **AND** the submission block ID MUST equal `__dify.actions`
- **AND** repeated rendering of the same intent MUST NOT introduce a nonce into those IDs

#### Scenario: Slack static select reaches its option boundary
- **WHEN** a Slack card contains a `static_select` with exactly 100 options
- **THEN** assessment and rendering MUST accept it
- **AND WHEN** the control contains 101 options
- **THEN** assessment and rendering MUST reject it before Provider I/O

#### Scenario: Equivalent Slack callbacks use different transports
- **WHEN** equivalent Slack Block Actions arrive through Webhook and Socket Mode with different authenticated payload envelopes
- **THEN** the Slack decoder MUST produce equal `IMCardEvent` values

#### Scenario: Slack callback contains multiple invoked actions
- **WHEN** a Slack Block Actions payload contains an exact `__dify.actions` marker but does not identify exactly one valid invoked Dify button action
- **THEN** the Slack decoder MUST raise `IMCardEventDecodingError`

#### Scenario: Slack selection change is not a Dify submission
- **WHEN** Slack delivers a `static_select` or `radio_buttons` change through Block Actions under a `__dify.input.<ordinal>` or foreign block ID
- **THEN** the Slack decoder MUST return `UnrecognizedIMEvent`
- **AND** it MUST NOT decode the current state as a form submission

#### Scenario: Slack Block Actions contain no Dify submission marker
- **WHEN** Slack delivers missing, empty, non-object or non-Dify invoked action entries without an exact `__dify.actions` block marker
- **THEN** the Slack decoder MUST return `UnrecognizedIMEvent`
- **AND** non-Dify blocks MUST NOT be forced through the Dify callback schema

#### Scenario: Marked Slack submission is malformed
- **WHEN** any invoked action uses the exact `__dify.actions` block ID but the action type, value, actor, metadata, state, reserved message-block ownership or complete callback schema is malformed or ambiguous
- **THEN** the Slack decoder MUST raise `IMCardEventDecodingError`
- **AND** it MUST NOT downgrade that recognized submission to `UnrecognizedIMEvent`

#### Scenario: Foreign Slack message block claims a reserved identifier
- **WHEN** a non-input message block uses a canonical `__dify.input.<ordinal>` ID or a non-actions message block uses exact `__dify.actions`
- **THEN** the Slack decoder MUST raise `IMCardEventDecodingError`
- **AND** prefix-like or non-canonical near IDs on otherwise foreign blocks MAY remain unrecognized foreign schema

#### Scenario: Marked Slack submission lacks its sender-owned action
- **WHEN** an exact-marked submission message omits the sender-owned `__dify.actions` block or that block does not contain the invoked button and metadata
- **THEN** the Slack decoder MUST raise `IMCardEventDecodingError`

#### Scenario: Prefix-like Slack action block is foreign
- **WHEN** a Slack Block Actions payload uses `__dify.actions.legacy` or another prefix-like action block ID instead of exact `__dify.actions`
- **THEN** the Slack decoder MUST return `UnrecognizedIMEvent`

### Requirement: Feishu and Lark card decoding MUST implement the shared callback protocol
The Feishu and Lark adapters MUST each expose a card-event decoder implemented through their verified shared callback protocol path while retaining their distinct Provider discriminators. The decoders MUST support authenticated card actions delivered through Webhook and STREAM, normalize the callback actor as the `union_id`-based `ProviderUserId` used by Directory and Messaging, recover the invoked action and embedded `CorrelationToken`, and return only submitted JSON values as `IMCardEvent.inputs`. These behaviors MUST be backed by sanitized real callback evidence for both transport envelopes.

#### Scenario: Equivalent Feishu and Lark callbacks are decoded
- **WHEN** Feishu and Lark deliver equivalent authenticated card actions through their verified shared protocol
- **THEN** both decoders MUST produce equal `IMCardEvent` semantics except for source context retained outside the decoded event
- **AND** both results MUST use the callback actor's `union_id` representation

#### Scenario: Equivalent Feishu or Lark callbacks use different transports
- **WHEN** equivalent card actions arrive through Webhook and STREAM with different authenticated payload envelopes
- **THEN** the applicable Feishu or Lark decoder MUST produce equal `IMCardEvent` values

#### Scenario: Recognized Feishu or Lark card event lacks union_id
- **WHEN** a recognized Feishu or Lark card callback does not provide the verified `union_id` required by the Provider identity contract
- **THEN** the decoder MUST raise `IMCardEventDecodingError`
- **AND** it MUST NOT substitute `open_id`, perform Provider I/O or fabricate a `ProviderUserId`

#### Scenario: Feishu or Lark event is not a card event
- **WHEN** an authenticated Feishu or Lark event is not the supported card-action event type
- **THEN** the applicable decoder MUST return `UnrecognizedIMEvent`

### Requirement: Microsoft Teams card decoding MUST separate metadata from inputs
The Microsoft Teams decoder MUST recognize the applicable authenticated card invoke activity, read the activity actor as Microsoft Teams `ProviderUserId`, recover action and correlation metadata embedded by its sender, and return only the remaining submitted JSON values as `IMCardEvent.inputs`. Its sender and decoder MUST use one collision-safe metadata layout despite Microsoft Teams merging `Action.Submit.data` and card inputs into the callback `value` object.

#### Scenario: Teams invoke contains action metadata and inputs
- **WHEN** Microsoft Teams returns one Dify `Action.Submit` callback containing sender metadata and submitted inputs in its activity value
- **THEN** the decoder MUST recover the action identifier and `CorrelationToken`
- **AND** `IMCardEvent.inputs` MUST contain every submitted input and no sender metadata

#### Scenario: Teams invoke is not a Dify card callback
- **WHEN** an authenticated Microsoft Teams event is not an applicable Dify card invoke activity
- **THEN** the Teams decoder MUST return `UnrecognizedIMEvent`

### Requirement: Card-event decoding MUST stop before HITL authorization
`IMCardEventDecoder` MUST perform no credential resolution, directory lookup, Contact or binding lookup, form/action authorization, input canonicalization, submission persistence, workflow resume or card replacement. It MUST NOT construct `VerifiedIMIdentityProof` or claim that an authenticated Provider callback is an authorized HITL submission. Provider, tenant, event identity, event time and raw payload MUST remain in the accompanying `AuthenticatedIMEvent` or inbox delivery rather than being duplicated in `IMCardEvent`.

#### Scenario: Valid card event is decoded
- **WHEN** a decoder returns `IMCardEvent`
- **THEN** it MUST have performed only Provider-specific payload validation and normalization
- **AND** a later integration MUST still use authenticated source context and current HITL state before accepting a submission
