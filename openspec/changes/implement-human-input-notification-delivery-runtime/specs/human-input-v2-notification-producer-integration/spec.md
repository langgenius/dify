## ADDED Requirements

### Requirement: Human Input v2 creation MUST produce notifications through the new path

The authoritative v2 task/form creation composition MUST select channels, issue endpoint capabilities, render supported Email notifications and persist their initial attempts. The producer MUST be invoked by the real v2 creation path; an unused standalone service does not satisfy this capability.

#### Scenario: V2 form has an Email endpoint

- **WHEN** v2 task creation commits a resolved form with an Email endpoint
- **THEN** it MUST persist one protected rendered Email request and one initial queued attempt for that endpoint
- **AND** the v2 publisher MUST make the attempt eligible for Runtime delivery

#### Scenario: V2 form has Email and IM endpoints

- **WHEN** both endpoint kinds are present
- **THEN** supported Email production MUST proceed independently
- **AND** this change MUST NOT convert or dispatch the IM endpoint

### Requirement: V2 producer MUST select channel before rendering and sending

The producer MUST attach the complete shared `ChannelRef` before creating a rendered delivery request. The first production Email reference MUST be Resend. Delivery workers and Runtime MUST preserve that reference and MUST NOT select another channel.

#### Scenario: Email endpoint is planned

- **WHEN** the v2 producer materializes an Email endpoint
- **THEN** its protected request MUST contain the preselected Resend Email channel reference

### Requirement: V2 producer MUST render while endpoint capability is available

The producer MUST generate one cryptographically random opaque endpoint access capability, persist only its hash and use the plaintext only to build the v2 form URL and rendered Email. A worker MUST NOT reconstruct, replace or reveal a token from the persisted hash.

#### Scenario: Email request is materialized

- **WHEN** task creation has message-template, variable and plaintext capability facts
- **THEN** it MUST produce the final subject/body/form action before protecting the request
- **AND** plaintext capability material MUST be discarded after protection

#### Scenario: Historical queued attempt lacks a protected request

- **WHEN** a worker finds only an endpoint token hash
- **THEN** it MUST fail as `delivery_payload_unavailable`
- **AND** it MUST NOT generate a replacement URL

### Requirement: V2 Email layout MUST own the standard form action

The producer MUST render a standard v2 Email layout that includes the form action/link independently from user-authored message body content. It MUST NOT require or interpret the v1 `{{#url#}}` placeholder.

#### Scenario: V2 body has no URL placeholder

- **WHEN** a valid v2 message body contains no `{{#url#}}`
- **THEN** the rendered Email MUST still include the standard form action

### Requirement: Rendered requests MUST be protected as durable attempt facts

Recipient, subject, body and form URL MUST be protected with workspace-scoped encryption before persistence. Form, grants, endpoints, token hashes, initial attempts and protected requests MUST commit atomically. Celery arguments MUST contain only an attempt identity and no rendered content or capability.

#### Scenario: Form creation transaction fails

- **WHEN** any form, endpoint, token-hash, attempt or protected-request write fails
- **THEN** none of those facts MAY commit

#### Scenario: Queue message is inspected

- **WHEN** the v2 Celery message is serialized
- **THEN** it MUST contain no recipient, subject, body, form URL, endpoint token or provider credential

### Requirement: Queued attempts MUST drive v2 dispatch

A bounded publisher MUST enqueue due queued attempt IDs on the dedicated `human_input_delivery` queue. A worker MUST claim the attempt, reveal its protected rendered request and call Runtime without loading current workflow or template state.

#### Scenario: Publisher runs twice

- **WHEN** the same due attempt is published more than once
- **THEN** duplicate tasks MUST preserve one logical attempt and one provider idempotency identity

#### Scenario: Publication fails

- **WHEN** a due attempt cannot be enqueued
- **THEN** it MUST remain queued and eligible for a later publisher scan

### Requirement: V2 delivery MUST be isolated from the legacy mail queue

Every v2 notification producer, publisher and worker task MUST route through `human_input_delivery`. No v2 delivery task MAY be published to `mail`. Default Community and Cloud worker queue lists and deployment documentation MUST include the dedicated queue, while existing v1 and System Email tasks MUST remain on `mail`.

#### Scenario: V2 attempt is published

- **WHEN** the due-attempt publisher enqueues a v2 delivery task
- **THEN** Celery routing MUST target `human_input_delivery`
- **AND** the task MUST NOT enter `mail`

#### Scenario: Default worker configuration is used

- **WHEN** a Community or Cloud worker starts without an explicit queue override
- **THEN** it MUST consume `human_input_delivery`

#### Scenario: Deployment uses explicit queue configuration

- **WHEN** an operator configures `CELERY_QUEUES` or `CELERY_WORKER_QUEUES`
- **THEN** deployment documentation MUST identify `human_input_delivery` as required for HITL v2 notification delivery

#### Scenario: Legacy task is published

- **WHEN** a v1 Human Input or System Email task is enqueued
- **THEN** its existing `mail` routing MUST remain unchanged

### Requirement: V2 worker MUST bind snapshot before provider I/O

After claiming an attempt, the worker MUST prepare the rendered request through Runtime, persist safe configuration snapshot identity and payload fingerprint, release database work and only then call Runtime send.

#### Scenario: Configuration rotates before first send

- **WHEN** first preparation occurs after channel configuration changed
- **THEN** the worker MUST bind the current send-time snapshot

#### Scenario: Configuration rotates after a retryable send

- **WHEN** a requeued attempt expects its previously bound snapshot
- **THEN** Runtime MUST reject the changed configuration without provider I/O

### Requirement: V2 attempt lifecycle MUST be retry-safe and form-independent

The worker MUST use controlled compare-and-swap transitions for queue, claim, requeue and terminal completion. Retry of one provider invocation MUST retain attempt ID/number, protected request, fingerprint, snapshot and idempotency key. Delivery failure MUST NOT mutate form lifecycle.

#### Scenario: Duplicate workers claim one attempt

- **WHEN** two workers process the same queued attempt
- **THEN** at most one current claim MUST win

#### Scenario: Retryable outcome is returned

- **WHEN** Runtime returns retry guidance inside the configured horizon
- **THEN** the same attempt MAY return to queued with a later schedule

#### Scenario: Attempt completes

- **WHEN** provider delivery is accepted or terminally fails
- **THEN** CAS completion MUST record one safe terminal outcome
- **AND** form status MUST remain unchanged

### Requirement: V1 delivery MUST remain isolated

V2 producer, publisher and worker composition MUST use version-specific entrypoints. It MUST NOT reinterpret v1 form IDs, delivery rows, pause reasons or task payloads.

#### Scenario: Workflow contains a v1 Human Input node

- **WHEN** its notification path is triggered
- **THEN** the existing v1 task and sender behavior MUST remain unchanged
