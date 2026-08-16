## ADDED Requirements

### Requirement: Manual IM sync orchestration MUST be transport-neutral and server-authoritative

Manual sync MUST be exposed through a Dify-owned application service that accepts trusted scope and actor facts, validates a current connected IM Integration, and delegates durable run creation/dispatch to the existing sync service. Transport controllers MUST NOT implement eligibility, repository access, Celery dispatch or reconciliation mutation.

#### Scenario: A connected IM channel starts synchronization

- **WHEN** an authorized caller requests manual sync for a scope with a current connected IM Integration
- **THEN** the application service MUST create or reuse the authoritative active run and dispatch its stable run ID through the existing sync service

#### Scenario: The current channel is not eligible

- **WHEN** the trusted scope has no current Integration, has a non-IM channel or has an IM Integration whose persisted status is not connected
- **THEN** the application service MUST return the stable `im_sync_not_allowed` outcome before run creation, dispatch or provider I/O

#### Scenario: Workspace transport triggers synchronization

- **WHEN** a Workspace owner or administrator calls the manual sync endpoint
- **THEN** the controller MUST construct trusted Workspace scope/actor facts and call the shared manual-sync application service
- **AND** it MUST restrict itself to authorization, DTO mapping and stable error translation

### Requirement: Existing IMProviderAdapter implementations MUST remain the sole provider directory integration

All provider directory synchronization MUST reuse the existing provider-specific `IMProviderAdapter` implementations. The worker MUST obtain the adapter through `DifyIMProviderAdapterFactory` and MUST read the directory through `adapter.directory.read_directory()`. This runtime MUST NOT introduce a parallel directory adapter, provider directory HTTP client, pagination/normalization pipeline or management-owned directory read.

#### Scenario: A current provider directory is synchronized

- **WHEN** a worker executes a manual sync for any current IM provider
- **THEN** it MUST construct the existing provider-specific adapter through the factory and call its directory capability
- **AND** no controller, application service or repository MAY implement or invoke a parallel provider directory read

#### Scenario: Existing credentials construct the adapter

- **WHEN** current plaintext/encrypted credential models can round-trip persisted configuration and construct the existing provider adapter
- **THEN** this runtime MUST reuse those structures without renaming, duplicating or replacing them

### Requirement: Manual sync MUST consume current Contact projections without mutating them

After provider directory I/O completes, reconciliation MUST load current available Contacts and membership facts for the trusted scope. Manual-sync services, workers, planners and IM repositories MUST NOT create, update, delete, initialize, backfill or repair Contacts.

#### Scenario: Reconciliation inputs are loaded

- **WHEN** the worker has read a complete provider directory
- **THEN** the guarded reconciliation input load MUST query current eligible Contact, membership, identity and binding facts before planning
- **AND** it MUST interpret unavailable or missing Contacts as current input facts without invoking a lifecycle writer

#### Scenario: Contact initialization has not converged

- **WHEN** a current source Account/member has no current Contact projection
- **THEN** manual sync MUST NOT create or repair that Contact
- **AND** production rollout MUST remain governed by the independent Contact initialization/lifecycle gates

### Requirement: Default runtime MUST consume dedicated IM Contact sync work

Every supported default API worker deployment MUST consume `human_input_contact_sync`, and every documented custom queue override MUST identify that queue as required for manual IM Contact synchronization. Delivery and redelivery MUST preserve one logical run and idempotent terminal state.

#### Scenario: A default worker starts

- **WHEN** a standard Community or Cloud worker starts without a custom queue override
- **THEN** its queue list MUST include `human_input_contact_sync`
- **AND** a persisted queued run MUST be claimable by a registered worker

#### Scenario: An operator configures a custom queue list

- **WHEN** `CELERY_QUEUES` or `CELERY_WORKER_QUEUES` overrides the defaults
- **THEN** deployment guidance MUST identify `human_input_contact_sync` as required for manual synchronization
- **AND** repository-owned configuration tests MUST detect omission from maintained examples

#### Scenario: A terminal run is redelivered

- **WHEN** the worker receives a stable run ID whose run is already terminal
- **THEN** it MUST short-circuit without duplicating current-state mutations, change-log records or sync result facts

#### Scenario: Dispatch fails after run persistence

- **WHEN** asynchronous dispatch fails after a queued run has been persisted
- **THEN** the application MUST return a sanitized unavailable outcome while retaining the queued run for same-ID recovery

### Requirement: Every managed IM provider MUST use the same synchronization runtime

Every canonical IM provider completed by `complete-human-input-im-channel-management` MUST enter the same factory, worker, reconciliation and terminal persistence path. Runtime eligibility MUST depend on channel kind and persisted connected status, not provider-name branching. Email channels MUST remain ineligible.

#### Scenario: A managed IM provider is connected

- **WHEN** any canonical managed IM provider has a current connected Integration and manual sync is requested
- **THEN** the runtime MUST use the shared manual-sync facade, dedicated queue and provider adapter factory path

#### Scenario: An Email channel is present

- **WHEN** manual directory sync is requested for an Email channel
- **THEN** the runtime MUST return `im_sync_not_allowed` before run creation, dispatch or provider I/O
