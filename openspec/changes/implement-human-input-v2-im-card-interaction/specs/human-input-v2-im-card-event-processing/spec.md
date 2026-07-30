## ADDED Requirements

### Requirement: Card Interaction MUST consume authenticated events from IM Provider Foundation

Card Interaction MUST register an explicit `AuthenticatedIMEventSink` with `implement-human-input-v2-im-provider-foundation`. The sink MUST accept the same `AuthenticatedIMEventEnvelope` contract regardless of whether Foundation received the provider event through deployment-selected `WEBHOOK` or `STREAM`. Card MUST NOT verify webhook transports, acknowledge providers, supervise persistent connections, read or modify deployment event transport policy, or manage event transport as Integration configuration.

#### Scenario: Webhook card action is delivered
- **WHEN** Foundation verifies a provider webhook and routes its authenticated card-action envelope
- **THEN** the Card sink MUST process the envelope without receiving signatures, HTTP headers, verification material or provider acknowledgement responsibilities

#### Scenario: Stream card action is delivered
- **WHEN** Foundation receives the equivalent action from a revision-bound authenticated SDK stream
- **THEN** the Card sink MUST use the same envelope-to-inbox path without receiving SDK session, lease or fencing objects

#### Scenario: Transport authentication fails
- **WHEN** Foundation rejects a webhook or stream event before authenticated routing
- **THEN** the Card sink MUST NOT be invoked and MUST NOT create an interaction record

### Requirement: Transport dispatch and Card semantic normalization MUST remain separate

The inbound sequence MUST remain `provider webhook or SDK listener -> provider transport adapter -> AuthenticatedIMEventEnvelope -> shared event router -> Card sink -> provider Card event normalizer -> CanonicalIMCardInteraction`. Provider transport adapters MUST own callback framing, signature/decryption, session authentication, revision/fencing and provider acknowledgement mapping. The shared router MUST select the Card sink from authenticated provider and event-name facts without interpreting Card action payloads. The Card-owned provider normalizer MUST execute only after sink selection and MUST NOT perform transport authentication or acknowledgement.

#### Scenario: Webhook Card action enters Dify
- **WHEN** a raw provider webhook carries a Card action
- **THEN** Foundation MUST authenticate and envelope the callback before routing, and Card normalization MUST occur only after the router selects the Card sink

#### Scenario: Persistent connection carries the same action
- **WHEN** a provider SDK listener receives the equivalent Card action
- **THEN** it MUST enter the same envelope -> router -> Card sink -> normalizer path without calling the Card processor directly

#### Scenario: Shared router examines a Card event
- **WHEN** the router selects a sink using authenticated provider and native event name
- **THEN** it MUST pass the bounded envelope without producing `CanonicalIMCardInteraction` or interpreting action, input, Grant or Form semantics

### Requirement: Provider Card event semantics MUST be normalized inside Card Interaction

After the shared router selects the Card sink, a Card-owned `IMCardEventNormalizer` for the authenticated provider MUST translate the bounded provider payload into one `CanonicalIMCardInteraction`. The canonical interaction MUST be the final anti-corruption boundary: inbox and downstream application/business processing MUST NOT receive callback、webhook、stream、SDK event or provider payload concepts. Authenticated Integration revision、provider、provider tenant and provider event identity MUST come from `AuthenticatedIMEventEnvelope` and MUST NOT be accepted from payload overrides. The normalizer MUST extract only provider user identity、endpoint interaction capability、selected action and bounded input values from the provider payload. It MAY enforce structural parsing、type and size bounds and malformed-payload classification, but MUST NOT load Integration、IM identity、binding、Contact、Account、Grant or Form state, resolve effective binding, perform Dify authorization, construct identity proof, validate the frozen Form or submit it.

#### Scenario: Supported provider action is normalized
- **WHEN** a Feishu, Lark or DingTalk envelope contains a recognized Human Input card action
- **THEN** its Card normalizer MUST produce the same provider-neutral interaction fields consumed by the shared processor

#### Scenario: Payload repeats authenticated provider identity
- **WHEN** a provider payload includes provider、provider tenant or Integration values that differ from the authenticated envelope
- **THEN** the normalizer MUST retain the envelope facts and MUST reject the conflicting payload instead of treating payload identity as authenticated

#### Scenario: Event is unrelated to Human Input Card
- **WHEN** an authenticated envelope event name or payload is not owned by Card Interaction
- **THEN** the sink MUST return `IGNORED` without creating a Card inbox record

#### Scenario: Card payload is malformed
- **WHEN** an authenticated provider payload cannot be mapped to bounded canonical action fields
- **THEN** the sink MUST return the configured safe terminal or retry result without passing provider extension data to the processor

#### Scenario: Canonical interaction enters business processing
- **WHEN** an inbox worker invokes `IMCardInteractionProcessor`
- **THEN** the processor MUST receive only `CanonicalIMCardInteraction` and provider-neutral Dify application boundaries, without callback transport mode, HTTP request, SDK event or raw provider payload

### Requirement: Card sink acknowledgement MUST follow Card inbox durability

Every canonical interaction MUST be inserted or found under a unique `(integration_id, provider_event_id)` boundary before the Card sink returns `ACCEPTED` to Foundation. A persistence failure MUST return `RETRY`; duplicate delivery MUST return `ACCEPTED` without creating another record. Durable acceptance MUST NOT claim that the Form has been authorized or submitted.

#### Scenario: First interaction is accepted
- **WHEN** a normalized provider event identity has not been recorded for the Integration
- **THEN** the sink MUST commit one pending inbox record and only then return `ACCEPTED`

#### Scenario: Provider redelivers during deployment transport rollout
- **WHEN** the same provider event identity arrives through both `WEBHOOK` and `STREAM` during a deployment mode rollout
- **THEN** the sink MUST find the existing inbox record and return `ACCEPTED` without duplicating processing

#### Scenario: Inbox commit fails
- **WHEN** the canonical interaction cannot be committed
- **THEN** the sink MUST return `RETRY` so Foundation preserves provider redelivery behavior

### Requirement: Card interaction inbox MUST remain bounded and Card-owned

The inbox MUST retain only allow-listed canonical interaction values, endpoint capability hash, Integration/provider correlation, processing state, attempt lease and safe outcome. It MUST NOT persist the raw envelope payload, callback body, signature, headers, SDK objects, credentials or plaintext endpoint capability. Foundation MUST NOT own Card inbox schema, retention or processing semantics.

#### Scenario: Valid interaction is persisted
- **WHEN** a normalized interaction contains an endpoint capability, action and provider actor
- **THEN** the inbox MUST hash and discard the plaintext capability before commit and retain only bounded values needed for processing and audit correlation

#### Scenario: Canonical values exceed Card limits
- **WHEN** a normalizer produces an action or input set outside Card Interaction bounds
- **THEN** the sink MUST reject the values without persisting unbounded content

### Requirement: Card inbox processing MUST be asynchronous and idempotent

Durably accepted interactions MUST be processed asynchronously with claim leases, bounded retries and stable terminal outcomes. Retrying or recovering one inbox item MUST NOT duplicate Form submission, audit, workflow resume or terminal card-update dispatch.

#### Scenario: Worker stops while processing
- **WHEN** an inbox processing lease expires before a terminal outcome is recorded
- **THEN** another worker MUST reclaim the item and converge on the current Form/submission state

#### Scenario: Accepted interaction fails authorization
- **WHEN** current identity, binding, Contact, Account or Form state rejects a durably accepted interaction
- **THEN** the processor MUST record a stable terminal rejection without changing the earlier transport acceptance result
