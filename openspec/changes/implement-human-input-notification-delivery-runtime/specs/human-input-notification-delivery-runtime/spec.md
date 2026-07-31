## ADDED Requirements

### Requirement: Channel identity MUST be shared without coupling Runtime to Control Plane DTOs

Channel kind, provider and reference MUST be credential-free shared values used by Channel Management, Human Input v2 planning and Delivery Runtime. Runtime core MUST NOT import Channel Management commands, views, handlers or facade contracts. Existing Channel Management imports MUST remain compatible during extraction.

#### Scenario: V2 planning selects a channel

- **WHEN** v2 task creation selects a channel reference
- **THEN** the same shared value MUST be accepted by the rendered-Email runtime
- **AND** no management operation DTO MUST be required

### Requirement: Delivery Runtime MUST accept one complete rendered Email

One logical Email delivery MUST be represented by an immutable request containing trusted workspace identity, a preselected Email channel reference, stable delivery identity, one recipient, rendered subject, rendered HTML and optional text body, and a provider-safe idempotency key. Runtime MUST NOT load or accept a Human Input form, endpoint, node execution, workflow revision or template.

#### Scenario: Complete rendered Email is prepared

- **WHEN** a structurally valid rendered request reaches Runtime
- **THEN** Runtime MUST preserve its recipient, subject and body without rerendering
- **AND** it MUST prepare exactly one logical Email delivery

#### Scenario: Rendered Email is incomplete

- **WHEN** the request has no usable body or lacks a required invariant
- **THEN** Runtime MUST return a stable validation failure before configuration or provider access

### Requirement: Runtime MUST preserve the channel selected before delivery

Upstream planning MUST select the Email channel reference before Runtime. Runtime MUST NOT select, rank, replace or fall back to another channel.

#### Scenario: Resend Email channel was selected

- **WHEN** a request carries the supported Resend Email channel reference
- **THEN** Runtime MUST retain that reference through preparation and send

#### Scenario: Selected channel is unsupported

- **WHEN** a request carries an IM channel or unsupported Email provider
- **THEN** Runtime MUST fail before tenant configuration access
- **AND** it MUST NOT substitute another configured channel

### Requirement: Runtime MUST capture one tenant configuration snapshot at send time

Runtime MUST resolve sender settings and credentials from trusted workspace plus preselected channel immediately before provider dispatch. The request MUST NOT carry configuration identity, version, sender or credential. Runtime MUST NOT call the Channel Management facade, inspect another workspace or fall back to System Email.

#### Scenario: Current matching configuration exists

- **WHEN** first preparation begins for a selected Resend channel
- **THEN** Runtime MUST capture the current configuration ID/version, sender and credential as one immutable snapshot

#### Scenario: Configuration changed after planning

- **WHEN** the selected channel remains the same but its configuration changed before first preparation
- **THEN** Runtime MUST use the current send-time snapshot

#### Scenario: Retry expects an earlier snapshot

- **WHEN** a retry supplies a safe expected snapshot identity that no longer matches current configuration
- **THEN** preparation MUST fail as `provider_configuration_changed`
- **AND** Runtime MUST NOT send with replacement settings

#### Scenario: Selected channel is no longer configured

- **WHEN** no current configuration matches workspace plus channel
- **THEN** Runtime MUST return `email_channel_not_configured`
- **AND** it MUST NOT inspect System Email or another channel

### Requirement: Preparation and provider sending MUST be separate operations

Runtime MUST return a strict `PreparedRenderedEmailDelivery` after resolving and validating configuration. Provider I/O MUST accept only that prepared value. The safe snapshot identity and payload fingerprint MUST be available for caller persistence before provider I/O, while credentials remain encapsulated.

#### Scenario: V2 worker prepares an attempt

- **WHEN** preparation succeeds
- **THEN** the worker MUST be able to persist safe snapshot identity and payload fingerprint before calling send
- **AND** it MUST NOT receive a serializable credential

#### Scenario: Caller fabricates prepared settings

- **WHEN** a caller attempts to invoke send with arbitrary provider settings
- **THEN** Runtime MUST reject values not created by its preparation boundary

### Requirement: Configuration and provider boundaries MUST remain typed

Runtime MUST resolve snapshots through `TenantEmailConfigurationSnapshotResolver` and provider adapters through a duplicate-safe registry keyed by selected Email provider type. SDK models, credentials and raw responses MUST NOT escape those boundaries.

#### Scenario: Snapshot matches selected Resend provider

- **WHEN** preparation returns a matching Resend snapshot
- **THEN** send MUST dispatch through the registered Resend adapter

#### Scenario: Duplicate provider adapter is registered

- **WHEN** composition registers two adapters for one provider type
- **THEN** registry construction MUST fail before serving requests

### Requirement: Database work and provider I/O MUST be separated

Configuration resolution MUST return detached immutable snapshot data and release repository sessions and transactions before provider I/O. Runtime DTOs MUST NOT contain ORM records or mutable persisted dictionaries.

#### Scenario: Provider blocks or retries

- **WHEN** a provider request blocks, times out or retries
- **THEN** no SQLAlchemy transaction or row lock MAY remain open

### Requirement: Retry MUST preserve attempt-owned identities

Every retry of one logical attempt MUST reuse the exact configuration snapshot identity, payload fingerprint, idempotency key, sender, recipient, subject and body. Runtime MUST NOT derive another identity from current form or workflow state.

#### Scenario: Retry payload changes

- **WHEN** retry material differs from the original fingerprint
- **THEN** Runtime MUST fail as `delivery_payload_changed` before provider I/O

#### Scenario: Short retry budget is exhausted

- **WHEN** in-invocation retries are exhausted
- **THEN** Runtime MUST return safe retry guidance to the v2 worker
- **AND** Runtime MUST NOT enqueue or persist work itself

### Requirement: Delivery outcomes MUST be credential-free and persistence-independent

Outcomes and logs MUST contain only stable status/provider/failure codes, valid provider message ID, safe snapshot identity and bounded retry guidance. Runtime MUST NOT persist form, endpoint, attempt or event state.

#### Scenario: Provider response contains sensitive data

- **WHEN** Resend returns headers, raw body or exception text
- **THEN** none of those raw values MAY be logged or returned

### Requirement: Runtime introduction MUST leave Human Input v1 unchanged

The new Runtime MUST NOT be wired into existing Human Input v1 services or tasks. Existing v1 rendering, feature gates, queue placement, sender selection and delivery behavior MUST remain unchanged.

#### Scenario: Existing v1 task is invoked

- **WHEN** either legacy Human Input delivery task runs
- **THEN** it MUST continue through the existing v1 implementation
- **AND** it MUST NOT construct or call the new Runtime
