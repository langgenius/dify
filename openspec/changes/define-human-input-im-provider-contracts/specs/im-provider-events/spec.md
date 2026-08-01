## ADDED Requirements

### Requirement: Transport-specific authentication MUST converge at AuthenticatedEvent
Webhook and STREAM receivers MUST keep their wire-level authentication and lifecycle differences before a shared `AuthenticatedEvent` boundary. A successful `AuthenticatedEvent` MUST contain provider, provider tenant ID, optional provider event ID, provider event time, Dify receive time and immutable Provider-native payload after required decryption.

#### Scenario: Webhook delivery is authenticated
- **WHEN** a Provider Webhook passes its signature, timestamp, replay and decryption checks
- **THEN** the receiver MUST produce an `AuthenticatedEvent` without carrying raw verification secrets into downstream processing

#### Scenario: STREAM delivery is authenticated
- **WHEN** an event arrives through an authenticated Provider stream connection and passes envelope validation
- **THEN** the receiver MUST produce the same `AuthenticatedEvent` facts without pretending that HTTP signature or URL challenge semantics occurred

#### Scenario: Dual-transport Provider uses either configured transport
- **WHEN** Slack, Feishu/Lark or DingTalk delivers an event through its configured Webhook or STREAM transport
- **THEN** the concrete transport adapter MUST authenticate its own wire protocol and produce the same `AuthenticatedEvent` semantics after authentication

#### Scenario: Transport authentication fails
- **WHEN** Webhook verification or STREAM connection/envelope authentication fails
- **THEN** no `AuthenticatedEvent` or business-processable inbox record MUST be created

### Requirement: Webhook and STREAM lifecycle MUST remain outside AuthenticatedEvent
URL challenge, HTTP response encoding, signature headers, decryption keys, stream connection establishment, control frames, reconnect state and ACK envelope data MUST remain owned by the concrete transport adapter and MUST NOT be normalized into card submission facts.

#### Scenario: STREAM reconnect control frame arrives
- **WHEN** a Provider sends a connection-control or reconnect frame rather than a business event
- **THEN** the stream adapter MUST handle it without creating a `CardSubmissionRequest`

#### Scenario: Webhook URL challenge arrives
- **WHEN** a Provider validates a configured Webhook URL
- **THEN** the Webhook adapter MUST complete the Provider-specific challenge without treating it as an authenticated card submission

### Requirement: Inbox persistence MUST precede successful Provider ACK
The receiver MUST persist `AuthenticatedEvent` in a minimal inbox transaction before sending a successful Webhook response or STREAM ACK. Business decoding, Contact/binding lookup, submission authorization and workflow resume MUST occur after ACK in a worker.

#### Scenario: Inbox commit succeeds
- **WHEN** an authenticated event is committed to the inbox
- **THEN** the receiver MUST promptly complete the Provider-specific ACK and defer business processing to a worker

#### Scenario: Inbox commit fails
- **WHEN** an authenticated event cannot be durably committed
- **THEN** the receiver MUST NOT acknowledge successful durable receipt to the Provider

### Requirement: Inbox event record MUST retain `raw_payload` in the same atomic write
When Dify ingests one authenticated Provider event through the Inbox pattern, the Dify-owned event record MUST retain `raw_payload` for debugging. `raw_payload` MUST be persisted on the event record itself as part of the same atomic write as the rest of the event fields. `raw_payload` MUST NOT participate in dedupe, routing, authorization, or business decisions.

#### Scenario: Authenticated Provider event is written to Inbox
- **WHEN** one authenticated Provider event is accepted into the Dify-owned Inbox
- **THEN** Dify MUST persist `raw_payload` together with the event record in the same atomic write

#### Scenario: Event processing reads business fields
- **WHEN** downstream processing performs dedupe, routing, authorization, or business handling for one Inbox event
- **THEN** it MUST rely on the existing event and business fields and MUST NOT treat `raw_payload` as decision input

#### Scenario: No separate raw-payload failure mode exists
- **WHEN** one Inbox event record is persisted successfully
- **THEN** `raw_payload` MUST already be present on that event record, and Dify MUST NOT model a separate "event succeeded but raw payload write failed" state

### Requirement: Inbox deduplication MUST use only a real Provider event ID
When provider event ID is present, the inbox MUST deduplicate by provider, provider tenant ID and provider event ID. When provider event ID is absent, every authenticated delivery MUST create an independent inbox record. Dify MUST NOT synthesize an event ID from payload hash, timestamp, message reference or transport envelope data.

#### Scenario: Provider retries the same identified event
- **WHEN** an authenticated delivery repeats an existing non-empty provider event ID in the same provider tenant
- **THEN** the receiver MUST reuse the existing inbox outcome, ACK the delivery and MUST NOT enqueue a second processing attempt

#### Scenario: Provider supplies no event ID
- **WHEN** two equivalent authenticated payloads arrive without provider event IDs
- **THEN** the inbox MUST retain two records and MUST rely on downstream task first-success semantics rather than transport-level deduplication

### Requirement: Provider card decoding MUST converge at CardSubmissionRequest
A concrete Provider card decoder MUST transform an `AuthenticatedEvent` into a `CardSubmissionRequest` containing provider, provider tenant ID, provider user ID, optional source event ID/time, exact message/card reference, action identifier, submitted values and opaque association metadata. The decoder MUST NOT resolve Contact, binding, approver grant, task authorization or workflow state.

#### Scenario: Slack and Feishu card payloads differ
- **WHEN** Slack and Feishu/Lark deliver different card-action payload shapes for equivalent submitted values
- **THEN** their decoders MUST produce the same `CardSubmissionRequest` semantics while preserving the correct Provider identity and message reference

#### Scenario: Authenticated event is not a supported card action
- **WHEN** a worker receives an authenticated event that cannot be decoded as a supported card submission
- **THEN** the decoder MUST return a typed unsupported-event result and MUST NOT fabricate action or form values

### Requirement: CardSubmissionRequest MUST exclude transport credentials and lifecycle state
`CardSubmissionRequest` MUST NOT contain raw signatures, verification tokens, encrypted request bodies, HTTP headers, stream ACK envelope IDs, SDK clients or connection state. It MUST remain evidence of one decoded card action rather than proof that Human Input authorization succeeded.

#### Scenario: Decoded request enters Human Input processing
- **WHEN** the Human Input interaction service consumes `CardSubmissionRequest`
- **THEN** it MUST still resolve the opaque context, current provider identity, binding, allowed approver and task state before accepting submission

### Requirement: Deleted Integration MUST not admit new inbound business events
After local Integration deletion, Webhook and STREAM receivers MUST NOT create new business-processable `AuthenticatedEvent` inbox records for that Integration. Any locally maintained stream connection MUST stop. The Provider-specific terminal response for a late Webhook or frame MAY remain adapter-specific, but it MUST NOT re-enable or recreate the Integration.

#### Scenario: Webhook arrives after local deletion
- **WHEN** a Provider sends a new Webhook delivery for an Integration whose local credentials and active state were deleted
- **THEN** Dify MUST keep the event out of business processing and MUST NOT recreate credentials, identities or bindings

#### Scenario: Inbox event was committed before deletion
- **WHEN** an earlier inbox record is processed after its Integration bindings were removed
- **THEN** downstream current-binding revalidation MUST prevent that event from bypassing the deleted Integration state
