## ADDED Requirements

### Requirement: The inbox sink MUST bind local routing outside AuthenticatedIMEvent
Dify MUST provide an `IMMessageInboxSink` concrete adapter from `IMEventSink` to one `im_message_inbox` table, bound to one local Integration. Every `accept()` operation MUST use that table through the inbox repository and MUST NOT expose the repository, ORM record or database session to the Provider adapter. The sink MUST capture local Integration routing metadata without adding it to or mutating `AuthenticatedIMEvent`, and MUST reject an event whose Provider or Provider tenant identity conflicts with the bound context.

#### Scenario: Provider capability receives the inbox adapter
- **WHEN** composition supplies an event sink to a Webhook or STREAM capability
- **THEN** it MUST supply `IMMessageInboxSink` through the `IMEventSink` interface while keeping the single inbox table and repository behind that adapter

#### Scenario: Bound sink accepts a matching event
- **WHEN** an Integration-bound sink receives an `AuthenticatedIMEvent` with the expected Provider and Provider tenant identity
- **THEN** it MUST persist the local Integration ID as routing metadata while preserving the event contract unchanged

#### Scenario: Event identity conflicts with the bound Integration
- **WHEN** the event Provider or Provider tenant identity differs from the sink's bound context
- **THEN** the sink MUST NOT create an inbox record and MUST NOT return `ACCEPTED`

#### Scenario: One event is accepted
- **WHEN** `IMMessageInboxSink.accept()` takes durable responsibility for an authenticated event
- **THEN** it MUST persist the event and its processing metadata in the single `im_message_inbox` table without creating a payload side table or broker outbox record

### Requirement: ACCEPTED MUST mean durable inbox responsibility
The sink MUST return `EventAcceptance.ACCEPTED` only after a new inbox record is durably committed or an existing record for the same identified Provider event is resolved. Serialization, insert, duplicate resolution or commit failure MUST produce `EventAcceptance.RETRY` or a failure that the Provider adapter maps to retry-compatible behavior. Business processing and broker publish MUST NOT be part of the acceptance transaction.

#### Scenario: New event commit succeeds
- **WHEN** the complete inbox record commits successfully
- **THEN** the sink MUST return `ACCEPTED` so the Provider adapter may complete its successful ACK

#### Scenario: Inbox commit fails
- **WHEN** serialization or database persistence cannot durably commit the event
- **THEN** the sink MUST NOT return `ACCEPTED` and the Provider adapter MUST NOT acknowledge successful durable receipt

#### Scenario: Business consumer is unavailable during intake
- **WHEN** inbox commit succeeds while the downstream consumer or broker is unavailable
- **THEN** the sink MUST return `ACCEPTED` without running business processing in the Provider receive path

### Requirement: The inbox record MUST atomically preserve authenticated event facts
One `im_message_inbox` record MUST atomically preserve an internal record ID, logical local Integration ID, Provider, stable Provider tenant ID, nullable real Provider event ID, nullable Provider event time, Dify receive time, optional Provider event type, serialized decrypted Provider-native `raw_payload` and serialization version. Immutable event facts MUST NOT change during processing-state transitions. Inbox infrastructure MUST use the payload only to reconstruct the original authenticated event for a consumer and MUST NOT interpret it for inbox deduplication, selection, authorization or routing.

#### Scenario: Authenticated event is inserted
- **WHEN** the sink durably accepts one authenticated Provider event
- **THEN** all event facts and `raw_payload` MUST be present in the same committed record with no separate payload-write state

#### Scenario: Worker reconstructs the event
- **WHEN** a claimed record is handed to a downstream consumer
- **THEN** the worker MUST reconstruct the same Provider facts and Provider-native payload without adding persistence or claim state to `AuthenticatedIMEvent`

#### Scenario: Processing metadata changes
- **WHEN** a record is claimed, retried or finalized
- **THEN** only processing metadata MUST change and the persisted authenticated event facts MUST remain immutable

### Requirement: Deduplication MUST use only a real Provider event ID
For a non-empty Provider event ID, the inbox MUST deduplicate by `(provider, provider_tenant_id, provider_event_id)` and MUST NOT include local Integration ID in that key. When Provider event ID is absent, every authenticated delivery MUST create an independent record. Payload hash, event time, message reference, receive time and transport ACK envelope identifiers MUST NOT be synthesized or substituted as event IDs.

#### Scenario: Identified Provider event is redelivered
- **WHEN** a delivery repeats an existing non-empty Provider event ID for the same Provider tenant
- **THEN** the sink MUST resolve the existing record, return `ACCEPTED` and MUST NOT create a second processing record

#### Scenario: Equivalent deliveries have no Provider event ID
- **WHEN** two authenticated deliveries carry equivalent payloads but no real Provider event ID
- **THEN** the inbox MUST create two independent records and MUST NOT compare payload hashes to collapse them

#### Scenario: Same event ID appears in a different Provider tenant
- **WHEN** two authenticated events have the same Provider event ID but a different Provider or Provider tenant ID
- **THEN** the inbox MUST retain them as distinct records

### Requirement: Database state MUST remain the dispatch source of truth
The committed database inbox MUST be the canonical source of pending work. A post-commit broker task MAY reduce latency but MUST carry only the inbox record ID and MUST NOT replace, precede or roll back durable acceptance. A bounded recovery path MUST rediscover available pending records and expired processing leases after publish or worker failure.

#### Scenario: Post-commit publish succeeds
- **WHEN** a new record commits and the broker accepts its wakeup task
- **THEN** the task MUST process the record only after acquiring it through the repository claim contract

#### Scenario: Post-commit publish fails
- **WHEN** a new record commits but its broker wakeup cannot be published
- **THEN** the sink MUST keep the event `ACCEPTED` and recovery MUST later rediscover the record from the database

#### Scenario: Duplicate wakeups race
- **WHEN** direct dispatch, Provider redelivery and recovery each wake the same record
- **THEN** every worker MUST pass through the same exclusive claim operation and at most one current lease MUST be valid

### Requirement: Worker claim MUST use a renewable fenced lease
Claiming MUST occur in a short database transaction that atomically selects an available `PENDING` record or an expired `PROCESSING` record, assigns an opaque claim token and lease expiry, increments attempt count and commits before consumer execution. Lease renewal and every retry or terminal transition MUST compare both record ID and current claim token. Processing MUST occur outside the claim transaction.

#### Scenario: Two workers claim the same pending record
- **WHEN** concurrent workers attempt to claim one available record
- **THEN** exactly one worker MUST receive the current claim token and the other MUST perform no consumer work for that record

#### Scenario: Worker crashes after claim
- **WHEN** a worker stops without finalizing and its lease expires
- **THEN** a later worker MUST be able to reclaim the record with a new claim token

#### Scenario: Stale worker completes after reclamation
- **WHEN** an earlier worker tries to finalize using an expired claim token after another worker reclaimed the record
- **THEN** the repository MUST reject the stale transition and MUST preserve the new owner's state

#### Scenario: Consumer execution is slow
- **WHEN** valid processing approaches lease expiry
- **THEN** the current worker MUST be able to renew the lease with the same claim token without holding the original claim transaction open

### Requirement: Processing outcomes MUST be explicit and bounded
The inbox worker MUST support `SUCCEEDED`, `IGNORED`, `RETRY` and `FAILED` consumer decisions. `SUCCEEDED`, `IGNORED` and `FAILED` MUST produce terminal records that recovery does not automatically claim. `RETRY` and unexpected consumer failure MUST return the record to `PENDING` with bounded backoff until configured maximum attempts are exhausted, after which the record MUST become terminal `FAILED`.

#### Scenario: Consumer completes successfully
- **WHEN** the current lease owner receives `SUCCEEDED`
- **THEN** the record MUST become terminal success and MUST NOT be automatically replayed

#### Scenario: Consumer does not support the event
- **WHEN** the current lease owner receives `IGNORED`
- **THEN** the record MUST retain a terminal ignored outcome without fabricating business processing

#### Scenario: Consumer requests retry
- **WHEN** the current lease owner receives `RETRY` before maximum attempts are exhausted
- **THEN** the record MUST return to `PENDING` with a future availability time and no active claim token

#### Scenario: Maximum attempts are exhausted
- **WHEN** a retryable or unexpected failure reaches the configured attempt limit
- **THEN** the record MUST become terminal `FAILED` and recovery MUST stop automatic delivery

### Requirement: Consumer handoff MUST remain outside inbox persistence semantics
The worker MUST hand an `IMInboxDelivery` containing local routing metadata and the reconstructed `AuthenticatedIMEvent` to an independent `IMInboxConsumer`. Repository and claim logic MUST NOT decode Provider business payloads, load Contact or binding state, authorize Human Input submissions or resume workflows. Consumer delivery MUST be treated as at-least-once because a worker can fail after consumer side effects but before terminal persistence.

#### Scenario: Consumer needs card-specific fields
- **WHEN** a claimed Provider-native payload may represent a card action
- **THEN** an independent consumer or decoder MUST interpret it after claim rather than adding card semantics to the inbox repository

#### Scenario: Worker fails after a consumer side effect
- **WHEN** the consumer completes a side effect but the worker loses its lease before recording terminal outcome
- **THEN** the record MAY be delivered again and the consumer MUST rely on its own idempotency or first-success invariant

### Requirement: Inbox observability MUST not expose sensitive payloads
The inbox MUST emit structured metrics for acceptance, identified duplicates, acceptance failure, dispatch failure, claims, lease reclamation, retry, terminal outcomes, lost leases, backlog size and oldest pending age. Logs and broker messages MUST NOT contain `raw_payload`, credentials, verification material or submitted values. This change MUST NOT automatically delete inbox records before a separate retention contract defines deduplication tombstones.

#### Scenario: Intake or processing fails
- **WHEN** the sink or worker records a failure
- **THEN** logs and metrics MUST identify the inbox record or Integration, Provider, attempt and sanitized error classification without including Provider-native payload content

#### Scenario: Recovery backlog grows
- **WHEN** pending or expired-lease records accumulate
- **THEN** operators MUST be able to observe backlog count and oldest pending age without inspecting event payloads

#### Scenario: No retention contract exists
- **WHEN** an inbox record reaches a terminal outcome under this change
- **THEN** the system MUST retain the record rather than delete its payload and lose identified-event deduplication state

### Requirement: Inbox unit tests MUST use SQLite and integration tests MUST use PostgreSQL
The event inbox unit-test suite MUST exercise the real inbox schema and persistence adapter with SQLite. Database integration tests MUST use PostgreSQL and MUST be the acceptance evidence for transaction isolation, row locking, `SKIP LOCKED`, concurrent insert, exclusive claim, lease recovery and fencing behavior. SQLite results MUST NOT be treated as evidence for PostgreSQL concurrency semantics.

#### Scenario: Inbox unit test exercises persistence
- **WHEN** a unit test covers inbox mapping, insert-or-resolve, state transition, sink acceptance or worker outcome
- **THEN** it MUST execute against a SQLite-backed `im_message_inbox` table rather than a mocked database session

#### Scenario: Integration test exercises database behavior
- **WHEN** a test covers concurrent writers, transaction rollback, row locking, `SKIP LOCKED`, lease reclamation or stale-claim fencing
- **THEN** it MUST execute against PostgreSQL

#### Scenario: SQLite cannot reproduce a locking invariant
- **WHEN** SQLite omits or weakens a PostgreSQL locking or isolation behavior
- **THEN** the corresponding requirement MUST remain unverified until its PostgreSQL integration test passes
