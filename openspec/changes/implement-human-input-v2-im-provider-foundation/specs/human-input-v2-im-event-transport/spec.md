## ADDED Requirements

### Requirement: Event transport MUST support disabled, webhook and stream modes
An Integration MUST select `DISABLED`, `WEBHOOK` or `STREAM`. Active mode selection MUST be validated against the narrow event transport modes supported by that provider. Event transport support MUST NOT be generalized into directory, messaging or card capability flags.

#### Scenario: Event transport is disabled
- **WHEN** an Integration selects `DISABLED`
- **THEN** no webhook event MUST be accepted and no stream session MUST be started while other IM capabilities remain available

#### Scenario: Provider does not support selected transport
- **WHEN** an administrator selects `WEBHOOK` or `STREAM` that the provider transport implementation does not support
- **THEN** configuration MUST fail before the Integration revision or credentials change

### Requirement: Webhook and stream MUST produce one authenticated envelope contract
Provider webhook and stream adapters MUST establish transport authenticity and emit the same provider-neutral authenticated event metadata: current Integration revision, provider tenant, stable provider event identity, event name, occurred time and bounded event payload. Credentials, signatures, encryption keys, HTTP headers, SDK tokens and SDK objects MUST NOT enter the envelope.

#### Scenario: Valid webhook event arrives
- **WHEN** provider-specific signature, timestamp, nonce and encryption checks succeed
- **THEN** the adapter MUST deliver an authenticated envelope through the shared event router

#### Scenario: Valid stream event arrives
- **WHEN** an authenticated revision-bound SDK stream receives the equivalent provider event
- **THEN** the adapter MUST deliver the same envelope contract without invoking downstream business logic inside the SDK listener

#### Scenario: Webhook handshake arrives
- **WHEN** a provider sends its valid endpoint-verification challenge
- **THEN** the adapter MUST return only the required handshake response and MUST NOT deliver a business event

### Requirement: Event transport acknowledgement MUST follow sink durability
Foundation MUST route an authenticated envelope to the explicit business sink for its event name. A webhook or stream event MUST receive success acknowledgement only after the sink reports durable acceptance, idempotent prior acceptance or safe ignore. Sink failure MUST preserve provider redelivery behavior.

#### Scenario: Card sink accepts durably
- **WHEN** Card Interaction commits or finds its canonical inbox record
- **THEN** Foundation MUST emit the provider-specific success acknowledgement without claiming the Form was submitted

#### Scenario: Sink cannot persist
- **WHEN** the selected sink returns retry because durable acceptance failed
- **THEN** Foundation MUST NOT emit success acknowledgement and MUST allow webhook or stream redelivery

#### Scenario: No business sink owns the event
- **WHEN** an authenticated event name is not enabled for any business consumer
- **THEN** the router MUST apply the configured safe-ignore policy without creating a Card or Sync record

### Requirement: Stream sessions MUST use revision-bound lease and fencing
Long-lived provider SDK streams MUST run in a dedicated supervised runtime. The system MUST allow at most one active lease holder for a complete Integration revision; events from stale or fenced sessions MUST be rejected before business sink delivery. Reconnect MUST use bounded exponential backoff with jitter.

#### Scenario: Two runtimes claim one Integration revision
- **WHEN** two stream supervisors attempt to own the same current Integration revision
- **THEN** exactly one fencing-valid lease holder MUST remain active

#### Scenario: Configuration revision changes
- **WHEN** mode, credentials, verification material, provider or provider tenant changes
- **THEN** the old session MUST stop and a new session MUST start only if the current mode remains `STREAM`

#### Scenario: Lease owner stops heartbeating
- **WHEN** the current runtime exits or loses its renewable lease
- **THEN** another runtime MUST be able to acquire the Integration revision and reconnect without advancing configuration revision

### Requirement: Event transport MUST remain free of Card and Sync semantics
Foundation transport MUST NOT parse Form action IDs, validate Human Input fields, construct IM identity proofs, submit Forms, fetch provider directories or apply reconciliation. Business sinks MUST own bounded semantic normalization and persistence after transport authentication.

#### Scenario: Card interaction payload is delivered
- **WHEN** an authenticated event belongs to Card Interaction
- **THEN** Foundation MUST pass the bounded envelope to the Card sink without choosing a Grant or action

#### Scenario: Directory event support is added later
- **WHEN** a provider directory-change event is enabled
- **THEN** the same transport MUST deliver it to the explicitly registered Sync-owned sink, while Foundation MUST NOT decide whether to start or apply synchronization

### Requirement: Event transport data MUST remain bounded and non-persistent by default
Foundation MUST enforce request/event size limits before business delivery and MUST NOT persist raw webhook bodies or raw stream payloads. Logs, traces and metrics MUST retain only provider, transport mode, safe result class, latency and non-PII correlation.

#### Scenario: Authenticated payload exceeds limits
- **WHEN** a validly authenticated webhook or stream event exceeds configured bounds
- **THEN** Foundation MUST reject it with a safe result and MUST NOT deliver or persist the oversized payload

#### Scenario: Provider transport fails
- **WHEN** verification, decrypt, stream connection or acknowledgement fails
- **THEN** diagnostics MUST exclude raw payloads and secrets while retaining an operator-safe failure class
