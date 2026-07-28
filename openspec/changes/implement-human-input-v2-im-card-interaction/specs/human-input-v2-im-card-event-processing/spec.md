## ADDED Requirements

### Requirement: Card Interaction MUST consume authenticated events from IM Provider Foundation

Card Interaction MUST register an explicit `AuthenticatedIMEventSink` with `implement-human-input-v2-im-provider-foundation`. The sink MUST accept the same `AuthenticatedIMEventEnvelope` contract regardless of whether Foundation received the provider event through `WEBHOOK` or `STREAM`. Card MUST NOT verify webhook transports, acknowledge providers, supervise streams or manage Integration transport configuration.

#### Scenario: Webhook card action is delivered
- **WHEN** Foundation verifies a provider webhook and routes its authenticated card-action envelope
- **THEN** the Card sink MUST process the envelope without receiving signatures, HTTP headers, verification material or provider acknowledgement responsibilities

#### Scenario: Stream card action is delivered
- **WHEN** Foundation receives the equivalent action from a revision-bound authenticated SDK stream
- **THEN** the Card sink MUST use the same envelope-to-inbox path without receiving SDK session, lease or fencing objects

#### Scenario: Transport authentication fails
- **WHEN** Foundation rejects a webhook or stream event before authenticated routing
- **THEN** the Card sink MUST NOT be invoked and MUST NOT create an interaction record

### Requirement: Provider Card event semantics MUST be normalized inside Card Interaction

For each supported provider, a Card-owned `IMCardEventNormalizer` MUST translate the bounded provider payload in an authenticated envelope into one `CanonicalIMCardInteraction`. The normalizer MUST map only stable event identity, provider actor identity, endpoint interaction reference, selected action and bounded input values. It MUST NOT construct identity proof, select a Grant, validate the Form or submit it.

#### Scenario: Supported provider action is normalized
- **WHEN** a Feishu, Lark or DingTalk envelope contains a recognized Human Input card action
- **THEN** its Card normalizer MUST produce the same provider-neutral interaction fields consumed by the shared processor

#### Scenario: Event is unrelated to Human Input Card
- **WHEN** an authenticated envelope event name or payload is not owned by Card Interaction
- **THEN** the sink MUST return `IGNORED` without creating a Card inbox record

#### Scenario: Card payload is malformed
- **WHEN** an authenticated provider payload cannot be mapped to bounded canonical action fields
- **THEN** the sink MUST return the configured safe terminal or retry result without passing provider extension data to the processor

### Requirement: Card sink acknowledgement MUST follow Card inbox durability

Every canonical interaction MUST be inserted or found under a unique `(integration_id, provider_event_id)` boundary before the Card sink returns `ACCEPTED` to Foundation. A persistence failure MUST return `RETRY`; duplicate delivery MUST return `ACCEPTED` without creating another record. Durable acceptance MUST NOT claim that the Form has been authorized or submitted.

#### Scenario: First interaction is accepted
- **WHEN** a normalized provider event identity has not been recorded for the Integration
- **THEN** the sink MUST commit one pending inbox record and only then return `ACCEPTED`

#### Scenario: Provider redelivers through another transport mode
- **WHEN** the same provider event identity arrives after a `WEBHOOK / STREAM` mode transition
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
