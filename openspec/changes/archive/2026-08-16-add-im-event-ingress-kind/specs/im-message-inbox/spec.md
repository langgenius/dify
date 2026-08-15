## MODIFIED Requirements

### Requirement: The inbox record MUST atomically preserve authenticated event facts
One `im_message_inbox` record MUST atomically preserve an internal record ID, logical local Integration ID, Provider, stable Provider tenant ID, nullable real Provider event ID, nullable Provider event time, Dify receive time, optional Provider event type, required event ingress kind, `AuthenticatedIMEvent.payload` and serialization version. Event ingress kind MUST be stored in a non-null column and MUST equal the `IMEventIngressKind` carried by the accepted event. The persisted `payload` MUST equal that event's `payload`; inbox persistence MUST NOT normalize Webhook and STREAM representations, unwrap Provider envelopes or create a second canonical payload. Immutable event facts, including ingress kind and payload, MUST NOT change during processing-state transitions. Inbox infrastructure MUST use ingress kind only to reconstruct the original authenticated event and make its payload interpretation available to a consumer; it MUST NOT use ingress kind or payload for deduplication, selection, authorization or routing.

#### Scenario: Authenticated event is inserted
- **WHEN** the sink durably accepts one authenticated Provider event
- **THEN** all event facts, non-null ingress kind and `payload` MUST be present in the same committed record with no separate payload concept or payload-write state

#### Scenario: Worker reconstructs the event
- **WHEN** a claimed record is handed to a downstream consumer
- **THEN** the worker MUST reconstruct the same Provider facts, ingress kind and Provider-native payload without adding persistence or claim state to `AuthenticatedIMEvent`

#### Scenario: Different ingress kinds expose different Provider-native representations
- **WHEN** Webhook and STREAM events persist different complete payload shapes for the same Provider callback
- **THEN** each inbox record MUST retain its accepted event's ingress-specific representation without projecting either payload into a shared canonical shape

#### Scenario: Processing metadata changes
- **WHEN** a record is claimed, retried or finalized
- **THEN** only processing metadata MUST change and the persisted authenticated event facts, including ingress kind, MUST remain immutable

#### Scenario: Inbox schema is created without historical records
- **WHEN** the migration adds ingress kind and aligns inbox payload naming under the confirmed precondition that no historical inbox records exist
- **THEN** it MUST create ingress kind as non-null and name the persisted event payload `payload` without a legacy value, compatibility alias, nullable transition, server default or data backfill

### Requirement: Deduplication MUST use only a real Provider event ID
For a non-empty Provider event ID, the inbox MUST deduplicate by `(provider, provider_tenant_id, provider_event_id)` and MUST NOT include local Integration ID or `IMEventIngressKind` in that key. When Provider event ID is absent, every authenticated delivery MUST create an independent record. Payload hash, ingress kind, event time, message reference, receive time and transport ACK envelope identifiers MUST NOT be synthesized or substituted as event IDs. Resolving a duplicate MUST preserve the existing record's immutable event facts rather than overwrite them with the later delivery's ingress kind or payload.

#### Scenario: Identified Provider event is redelivered through the same ingress
- **WHEN** a delivery repeats an existing non-empty Provider event ID for the same Provider tenant and ingress kind
- **THEN** the sink MUST resolve the existing record, return `ACCEPTED` and MUST NOT create a second processing record

#### Scenario: Identified Provider event arrives through a different ingress
- **WHEN** Webhook and STREAM deliveries carry the same non-empty Provider event ID for the same Provider tenant
- **THEN** the inbox MUST resolve one identified event without including ingress kind in the deduplication key or overwriting the first record's immutable delivery facts

#### Scenario: Equivalent deliveries have no Provider event ID
- **WHEN** two authenticated deliveries carry equivalent payloads but no real Provider event ID
- **THEN** the inbox MUST create two independent records and MUST NOT compare ingress kinds or payload hashes to collapse them

#### Scenario: Same event ID appears in a different Provider tenant
- **WHEN** two authenticated events have the same Provider event ID but a different Provider or Provider tenant ID
- **THEN** the inbox MUST retain them as distinct records
