## MODIFIED Requirements

### Requirement: The inbox sink MUST bind local routing outside AuthenticatedIMEvent

Dify MUST provide an `IMMessageInboxSink` concrete adapter from `IMEventConsumer` to one `im_message_inbox` table，bound to one current IM Channel。Every `accept()` operation MUST use that table through the inbox repository and MUST NOT expose the repository、ORM record or database session to the Provider adapter。The sink MUST capture `IMChannelId`、Provider and Provider tenant outside `AuthenticatedIMEvent`，and MUST reject an event whose Provider identity conflicts with the bound Channel。

#### Scenario: Provider capability receives the inbox adapter
- **WHEN** composition supplies an event sink to a Webhook or STREAM capability
- **THEN** it MUST supply `IMMessageInboxSink` through the `IMEventConsumer` interface while keeping the single inbox table and repository behind that adapter

#### Scenario: Bound sink accepts a matching event
- **WHEN** a Channel-bound sink receives an `AuthenticatedIMEvent` with the expected Provider and Provider tenant identity
- **THEN** it MUST persist `channel_id` as routing metadata while preserving the event contract unchanged

#### Scenario: Event identity conflicts with the bound Channel
- **WHEN** the event Provider or Provider tenant identity differs from the sink's bound context
- **THEN** the sink MUST NOT create an inbox record and MUST NOT return `ACCEPTED`

#### Scenario: One event is accepted
- **WHEN** `IMMessageInboxSink.accept()` takes durable responsibility for an authenticated event
- **THEN** it MUST persist the event and its processing metadata in the single `im_message_inbox` table without creating a payload side table or broker outbox record

### Requirement: The inbox record MUST atomically preserve authenticated event facts

One `im_message_inbox` record MUST atomically preserve an internal record ID、`channel_id: IMChannelId`、Provider、stable Provider tenant ID、nullable real Provider event ID、nullable Provider event time、Dify receive time、optional Provider event type、required event ingress kind、`AuthenticatedIMEvent.payload` and serialization version。Event ingress kind MUST be stored in a non-null column and MUST equal the `IMEventIngressKind` carried by the accepted event。The persisted `payload` MUST equal that event's `payload`; inbox persistence MUST NOT normalize Webhook and STREAM representations、unwrap Provider envelopes or create a second canonical payload。Immutable event facts，including Channel ID、ingress kind and payload，MUST NOT change during processing-state transitions。Inbox infrastructure MUST use ingress kind only to reconstruct the original authenticated event and make its payload interpretation available to a consumer；it MUST NOT use ingress kind or payload for deduplication、selection、authorization or routing。

#### Scenario: Authenticated event is inserted
- **WHEN** the sink durably accepts one authenticated Provider event
- **THEN** Channel ID、all event facts、non-null ingress kind and `payload` MUST be present in the same committed record

#### Scenario: Worker reconstructs the event
- **WHEN** a claimed record is handed to a downstream consumer
- **THEN** `IMInboxDelivery` MUST contain persisted `channel_id` and the reconstructed authenticated event

#### Scenario: Different ingress kinds expose different Provider-native representations
- **WHEN** Webhook and STREAM events persist different complete payload shapes for the same Provider callback
- **THEN** each inbox record MUST retain its accepted event's ingress-specific representation without projecting either payload into a shared canonical shape

#### Scenario: Processing metadata changes
- **WHEN** a record is claimed、retried or finalized
- **THEN** only processing metadata MUST change；Channel ID and authenticated event facts MUST remain immutable

#### Scenario: Inbox schema is created without historical records
- **WHEN** the unpublished migration creates the inbox schema
- **THEN** it MUST create non-null `channel_id` without a compatibility alias、nullable transition、server default、dual read/write or data backfill

### Requirement: Deduplication MUST use only a real Provider event ID

For a non-empty Provider event ID，the inbox MUST deduplicate by `(provider, provider_tenant_id, provider_event_id)` and MUST NOT include Channel ID or `IMEventIngressKind` in that key。When Provider event ID is absent，every authenticated delivery MUST create an independent record。Payload hash、ingress kind、event time、message reference、receive time and transport ACK envelope identifiers MUST NOT be synthesized or substituted as event IDs。Resolving a duplicate MUST preserve the existing record's Channel ID and immutable event facts。

#### Scenario: Identified Provider event is redelivered through the same ingress
- **WHEN** a delivery repeats an existing non-empty Provider event ID for the same Provider tenant and ingress kind
- **THEN** the sink MUST resolve the existing record、return `ACCEPTED` and MUST NOT create a second processing record

#### Scenario: Identified Provider event arrives through a different ingress
- **WHEN** Webhook and STREAM deliveries carry the same non-empty Provider event ID for the same Provider tenant
- **THEN** the inbox MUST resolve one identified event without including ingress kind in the deduplication key or overwriting the first record's immutable delivery facts

#### Scenario: Identified Provider event arrives through a different Channel
- **WHEN** the same real Provider event ID is delivered for the same Provider tenant after Channel replacement
- **THEN** the inbox MUST resolve the existing record without changing its Channel ID or event facts

#### Scenario: Equivalent deliveries have no Provider event ID
- **WHEN** two authenticated deliveries carry equivalent payloads but no real Provider event ID
- **THEN** the inbox MUST create two independent records and MUST NOT compare Channel ID、ingress kind or payload hashes to collapse them

#### Scenario: Same event ID appears in a different Provider tenant
- **WHEN** two authenticated events have the same Provider event ID but a different Provider or Provider tenant ID
- **THEN** the inbox MUST retain them as distinct records
