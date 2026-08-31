## MODIFIED Requirements

### Requirement: The inbox sink MUST bind local routing outside AuthenticatedIMEvent

Dify MUST provide an `IMMessageInboxSink` concrete adapter from `IMEventConsumer` to one `im_message_inbox` table，bound to one current IM Channel。Every `accept()` operation MUST use that table through the inbox repository and MUST NOT expose repository、ORM record or database session to Provider adapter。The sink MUST capture `IMChannelId`、Provider and Provider tenant outside `AuthenticatedIMEvent`，and MUST reject an event whose Provider identity conflicts with the bound Channel。

#### Scenario: Provider capability receives the inbox adapter
- **WHEN** composition supplies a consumer to Webhook or STREAM capability
- **THEN** it MUST supply `IMMessageInboxSink` through `IMEventConsumer` while keeping inbox persistence behind that adapter

#### Scenario: Bound sink accepts a matching event
- **WHEN** Channel-bound sink receives `AuthenticatedIMEvent` with expected Provider and Provider tenant
- **THEN** it MUST persist Channel ID as local routing metadata while preserving event contract unchanged

#### Scenario: Event identity conflicts with bound Channel
- **WHEN** event Provider or Provider tenant differs from sink context
- **THEN** sink MUST create no inbox record and MUST NOT return `ACCEPTED`

#### Scenario: One event is accepted
- **WHEN** sink takes durable responsibility for authenticated event
- **THEN** it MUST persist event and processing metadata in the single inbox table without payload side table or broker outbox

### Requirement: The inbox record MUST atomically preserve authenticated event facts

One `im_message_inbox` record MUST atomically preserve internal record ID、logical local Channel ID、Provider、stable Provider tenant ID、nullable real Provider event ID、nullable Provider event time、Dify receive time、optional Provider event type、required ingress kind、`AuthenticatedIMEvent.payload`、serialization version and processing metadata。Persisted `channel_id` MUST contain `IMChannelId` and MUST replace the removed Integration routing field without compatibility alias。Immutable event facts and Channel routing identity MUST NOT change during processing transitions。

#### Scenario: Authenticated event is inserted
- **WHEN** sink durably accepts one authenticated Provider event
- **THEN** Channel ID、all event facts、ingress kind and payload MUST commit in the same record

#### Scenario: Worker reconstructs delivery
- **WHEN** worker claims one inbox record
- **THEN** `IMInboxDelivery` MUST contain persisted `channel_id` and reconstructed authenticated event without adding claim state to that event

#### Scenario: Processing metadata changes
- **WHEN** record is claimed、retried or finalized
- **THEN** only processing metadata MUST change；Channel ID and authenticated event facts MUST remain immutable

#### Scenario: Routing migration has no historical records
- **WHEN** migration replaces inbox `integration_id` with non-null `channel_id` under confirmed no-historical-data precondition
- **THEN** it MUST add no legacy alias、nullable transition、server default、dual read/write or backfill

### Requirement: Deduplication MUST use only a real Provider event ID

For a non-empty Provider event ID，inbox MUST deduplicate by `(provider, provider_tenant_id, provider_event_id)` and MUST NOT include local Channel ID or ingress kind in that key。When Provider event ID is absent，every authenticated delivery MUST create an independent record。Resolving a duplicate MUST preserve the existing record's immutable Channel routing and event facts rather than overwrite them with later delivery。

#### Scenario: Identified event is redelivered through the same ingress
- **WHEN** delivery repeats existing non-empty Provider event ID for same Provider tenant
- **THEN** sink MUST resolve existing record、return `ACCEPTED` and create no second processing record

#### Scenario: Identified event arrives through a different Channel
- **WHEN** same real Provider event ID is delivered for same Provider tenant after Channel replacement
- **THEN** inbox MUST resolve one identified event without including Channel ID in deduplication key
- **AND** it MUST preserve first record's Channel ID and event facts

#### Scenario: Equivalent deliveries have no Provider event ID
- **WHEN** two authenticated deliveries have equivalent payloads but no real Provider event ID
- **THEN** inbox MUST create two independent records

#### Scenario: Same event ID appears in a different Provider tenant
- **WHEN** two events share Provider event ID but differ in Provider or Provider tenant
- **THEN** inbox MUST retain distinct records

### Requirement: Consumer handoff MUST remain outside inbox persistence semantics

Worker MUST hand `IMInboxDelivery` containing Channel ID、claim metadata and reconstructed `AuthenticatedIMEvent` to independent `IMInboxConsumer`。Repository and claim logic MUST NOT decode Provider business payloads、load Contact or Binding state、authorize submissions or resume workflows。Consumer delivery remains at-least-once。

#### Scenario: Consumer needs current Channel state
- **WHEN** consumer processes claimed delivery
- **THEN** it MUST use `delivery.channel_id` to resolve current authorization context outside inbox repository

#### Scenario: Consumer needs card-specific fields
- **WHEN** Provider-native payload may represent card action
- **THEN** independent consumer or decoder MUST interpret it after claim

#### Scenario: Worker fails after consumer side effect
- **WHEN** consumer completes side effect but worker loses lease before terminal transition
- **THEN** record MAY be delivered again and consumer MUST rely on its own idempotency or first-success invariant

### Requirement: Inbox observability MUST not expose sensitive payloads

Inbox MUST emit structured metrics for acceptance、identified duplicates、acceptance failure、dispatch failure、claims、lease reclamation、retry、terminal outcomes、lost leases、backlog size and oldest pending age。Logs may identify inbox record、Channel ID、Provider、attempt and sanitized failure code。Logs and broker messages MUST NOT contain Provider payload、credentials、verification material or submitted values。

#### Scenario: Intake or processing fails
- **WHEN** sink or worker records failure
- **THEN** diagnostic MAY contain record ID、Channel ID and Provider but MUST contain no Provider-native payload or credentials

#### Scenario: Recovery backlog grows
- **WHEN** pending or expired-lease records accumulate
- **THEN** operators MUST observe count and oldest pending age without inspecting payloads

#### Scenario: No retention contract exists
- **WHEN** inbox record reaches terminal outcome
- **THEN** system MUST retain record rather than delete payload and lose identified-event deduplication state
