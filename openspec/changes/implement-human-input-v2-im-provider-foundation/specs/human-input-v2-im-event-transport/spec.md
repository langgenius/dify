## ADDED Requirements

### Requirement: Deployment runtime MUST select disabled, webhook or stream mode
Dify deployment runtime configuration MUST select one startup-time `DISABLED`, `WEBHOOK` or `STREAM` event transport mode for the deployment. The mode MUST NOT be stored on an Integration, accepted from workspace or EE management commands, or exposed as a tenant-selectable capability. Foundation MUST validate the selected mode against the narrow event transport modes supported by registered provider implementations without generalizing support into directory, messaging or Card capability flags.

#### Scenario: Deployment event transport is disabled
- **WHEN** Dify starts with deployment event transport mode `DISABLED`
- **THEN** no provider webhook event MUST be accepted and no persistent connection session MUST be started while manual Sync, binding and outbound messaging remain available

#### Scenario: Deployment uses webhook transport
- **WHEN** Dify starts with deployment event transport mode `WEBHOOK`
- **THEN** provider public webhook ingress MUST be enabled and no persistent connection runtime MUST acquire Integration leases

#### Scenario: Deployment uses stream transport
- **WHEN** Dify starts with deployment event transport mode `STREAM`
- **THEN** the dedicated persistent connection runtime MUST be enabled and provider public webhook ingress MUST reject or not register business callbacks

#### Scenario: Provider does not support deployment transport
- **WHEN** runtime readiness or Integration configure/test finds that a provider implementation does not support the deployment-selected `WEBHOOK` or `STREAM` mode
- **THEN** Foundation MUST return a stable incompatibility before a new Integration configuration is committed and MUST NOT offer a per-Integration mode override

#### Scenario: Existing Integration is incompatible after deployment rollout
- **WHEN** Dify starts under a deployment mode unsupported by an already configured Integration provider
- **THEN** Foundation MUST fail closed for inbound events, report safe incompatible operational health or readiness, and MUST NOT mutate the Integration revision or silently select another mode

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

### Requirement: Provider transport normalization MUST precede business sink dispatch
Raw webhook requests and provider SDK callbacks MUST pass through a provider-local transport adapter before entering the shared event router. That adapter MUST perform transport authentication, decryption or session validation, revision and fencing checks, and extraction of bounded native event metadata before creating `AuthenticatedIMEventEnvelope`. The shared router MUST select an explicit business sink using authenticated provider and event-name facts, but MUST NOT interpret Card, directory or other business payload semantics. Provider-specific capability normalization MUST occur only after the router selects the owning business sink.

#### Scenario: Raw webhook callback reaches the public entrypoint
- **WHEN** a provider-specific HTTP callback arrives
- **THEN** the webhook entrypoint MUST invoke the matching transport adapter and MUST NOT route the raw body directly to Card, Sync or another business sink

#### Scenario: Provider SDK listener receives an event
- **WHEN** a persistent provider connection invokes its SDK callback
- **THEN** the listener MUST convert the callback into the same authenticated envelope before shared dispatch and MUST NOT invoke Dify business logic directly

#### Scenario: Authenticated Card event is dispatched
- **WHEN** the shared router resolves an authenticated provider event to the Card sink
- **THEN** the router MUST pass the envelope unchanged at the business-semantic boundary and the Card-owned provider normalizer MUST create the canonical Card interaction after sink selection

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

#### Scenario: Integration configuration revision changes
- **WHEN** credentials, verification material, provider or provider tenant changes while deployment mode remains `STREAM`
- **THEN** the old session MUST stop and a new revision-bound session MUST start for the current Integration

#### Scenario: Deployment leaves stream mode
- **WHEN** a deployment rollout changes event transport mode from `STREAM` to `WEBHOOK` or `DISABLED`
- **THEN** the persistent connection process role MUST stop all sessions without changing any Integration configuration revision

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
Foundation MUST enforce request/event size limits before business delivery and MUST NOT persist raw webhook bodies or raw stream payloads. Logs, traces and metrics MUST retain only provider, deployment transport mode, safe result class, latency and non-PII correlation.

#### Scenario: Authenticated payload exceeds limits
- **WHEN** a validly authenticated webhook or stream event exceeds configured bounds
- **THEN** Foundation MUST reject it with a safe result and MUST NOT deliver or persist the oversized payload

#### Scenario: Provider transport fails
- **WHEN** verification, decrypt, stream connection or acknowledgement fails
- **THEN** diagnostics MUST exclude raw payloads and secrets while retaining an operator-safe failure class
