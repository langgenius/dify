## ADDED Requirements

### Requirement: Dify MUST own one shared IM provider foundation
Integration configuration, provider tenant confirmation, credential encryption/rotation, provider client construction and safe base diagnostics MUST have one Dify-owned implementation used by workspace, trusted internal, Sync and Card consumers. EE and downstream business services MUST NOT create parallel credential stores or provider client factories.

#### Scenario: Sync creates a provider client
- **WHEN** a manual sync needs authenticated directory access
- **THEN** its provider-specific directory adapter MUST use the Dify foundation client factory and MUST NOT decrypt Integration credentials itself

#### Scenario: Card delivery creates a provider client
- **WHEN** a card delivery needs authenticated messaging access
- **THEN** its provider-specific card adapter MUST use the same Dify foundation client lifecycle and MUST NOT copy Integration configuration into a second store

### Requirement: Supported providers MUST satisfy a fixed Human Input baseline
A provider released as supported for Human Input MUST implement directory read, message send, message/card update and provider tenant confirmation. These operations MUST be verified by provider contract tests and MUST NOT be represented as tenant-selectable `DIRECTORY_READ`, `CARD_SEND` or `CARD_UPDATE` capability flags.

#### Scenario: Provider implementation lacks a baseline operation
- **WHEN** a provider implementation cannot pass directory, send, update or tenant-confirmation contract tests
- **THEN** it MUST NOT be registered as a supported Human Input provider

#### Scenario: Form is incompatible with provider card controls
- **WHEN** a supported provider cannot faithfully render one Human Input form shape
- **THEN** Card Interaction MUST apply its own text-message-plus-link fallback without changing Foundation provider support

### Requirement: Provider SDK objects MUST remain inside provider packages
Foundation client construction MUST load current encrypted configuration through an owner-scoped boundary and create official SDK clients with bounded timeout, proxy and lifecycle configuration. SDK clients, credential DTOs, raw responses and SDK exceptions MUST NOT cross into core domain, controllers or provider-neutral application models.

#### Scenario: Provider client construction fails
- **WHEN** credentials are malformed, unavailable or rejected while constructing or testing a client
- **THEN** Foundation MUST return a stable sanitized diagnostic without exposing plaintext configuration or SDK exception text

#### Scenario: Downstream adapter receives a client
- **WHEN** a directory or card adapter performs provider I/O
- **THEN** the SDK client MUST remain inside the matching provider package and only provider-neutral results may cross the adapter boundary

### Requirement: IM source dependencies MUST point toward provider-neutral capability contracts
Dify domain and application modules MUST depend only on provider-neutral IM contracts and canonical values owned by Foundation, Sync or Card. Concrete provider adapters MAY depend on those contracts and the matching provider-local client lifecycle, but MUST NOT import Dify business service implementations, repositories, controllers or workflow runtime implementations. Dify business modules MUST NOT import concrete provider packages. Only explicit composition or factory modules MAY know both a concrete provider adapter and the Dify service or sink to which it is wired.

#### Scenario: Sync or Card invokes provider I/O
- **WHEN** a Dify application service reads a directory or sends, updates or normalizes a Card
- **THEN** it MUST invoke a provider-neutral port without importing or branching on a concrete Feishu, Lark or DingTalk implementation

#### Scenario: Concrete provider adapter is loaded
- **WHEN** a provider adapter converts SDK data into a capability-owned canonical value
- **THEN** the adapter MAY import that value or port contract but MUST NOT import the consuming Sync, Card or HITL service implementation

#### Scenario: Provider implementation is selected
- **WHEN** an Integration provider is wired to its directory, Card or event adapter
- **THEN** the selection MUST occur in an explicit composition or factory module rather than in Dify domain or application business logic

### Requirement: Foundation errors and diagnostics MUST be safe and stable
Authentication, permission, rate limit, unavailable, stale revision and sanitized internal outcomes MUST use stable provider-neutral result codes. Credentials, verification material, raw response bodies, event payloads and provider user PII MUST NOT appear in API responses, logs, traces or metric labels.

#### Scenario: Provider returns a sensitive error body
- **WHEN** provider I/O fails with a credential-bearing or PII-bearing response
- **THEN** Foundation MUST discard or redact the raw body and expose only an allow-listed safe code and operator-safe message

#### Scenario: Operational diagnostic changes
- **WHEN** connection health changes without configuration mutation
- **THEN** Foundation MUST persist or publish the safe diagnostic without advancing Integration configuration revision

### Requirement: Downstream business ownership MUST remain separate
Foundation MUST NOT fetch and reconcile directories, create sync runs, render cards, choose fallback content, construct IM identity proofs or submit Human Input Forms. Sync and Card services MUST consume Foundation through narrow provider/client and authenticated-event boundaries.

#### Scenario: Authenticated card event is received
- **WHEN** Foundation verifies and delivers a provider event to the Card sink
- **THEN** only Card Interaction may normalize card action values and invoke Human Input submission

#### Scenario: Directory change event is received in the future
- **WHEN** a future directory consumer subscribes to an authenticated provider event
- **THEN** Foundation MUST deliver transport facts only and the Sync owner MUST decide whether and how to schedule reconciliation
