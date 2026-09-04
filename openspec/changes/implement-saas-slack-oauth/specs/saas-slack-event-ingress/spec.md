## ADDED Requirements

### Requirement: Official Slack callbacks MUST be authenticated before tenant routing

The public Events and interactivity endpoints MUST validate the raw HTTP request with the deployment-owned Slack signing secret and replay window before parsing or using any tenant routing field.

#### Scenario: Valid signed callback arrives

- **WHEN** a request contains exactly one current `X-Slack-Request-Timestamp`, exactly one valid `X-Slack-Signature` and the expected official App identity
- **THEN** ingress MUST parse the authenticated envelope and resolve its Slack workspace claim only after those checks succeed
- **AND** signature validation MUST use the unchanged raw request body

#### Scenario: Signature is invalid

- **WHEN** the signature is missing, duplicated, malformed, stale or does not match the raw body
- **THEN** ingress MUST reject the request before workspace claim lookup, tenant repository access or durable enqueue
- **AND** it MUST NOT expose whether a referenced Slack workspace is configured

#### Scenario: App identity is unexpected

- **WHEN** a correctly signed envelope identifies a Slack App other than the configured official App
- **THEN** ingress MUST reject the envelope before tenant business processing

### Requirement: Slack URL verification MUST remain authenticated and side-effect free

The Events endpoint MUST answer Slack `url_verification` only after signature and App identity validation, and MUST NOT create tenant event work for that handshake.

#### Scenario: Valid URL verification arrives

- **WHEN** the official App sends a valid signed `url_verification` request
- **THEN** ingress MUST return the exact challenge required by Slack within the acknowledgement deadline
- **AND** it MUST NOT create a Channel, workspace claim or business event

#### Scenario: Invalid URL verification arrives

- **WHEN** a `url_verification` body fails signature or App identity validation
- **THEN** ingress MUST NOT return the challenge

### Requirement: Authenticated callbacks MUST route only through an active workspace claim

After authentication, ingress MUST resolve `team_id` through the dedicated workspace claim and verify that the claim, Channel and OAuth installation form the same active ownership chain before dispatching tenant business work.

#### Scenario: Active claim resolves

- **WHEN** an authenticated envelope contains a `team_id` claimed by an active OAuth installation
- **THEN** ingress MUST route the envelope to that claim's Channel and tenant
- **AND** it MUST NOT accept a tenant identifier from the Slack payload or request URL

#### Scenario: Workspace is unknown

- **WHEN** an authenticated envelope has no current workspace claim
- **THEN** ingress MUST perform no tenant business work
- **AND** its response and safe telemetry MUST NOT disclose claim ownership

#### Scenario: Installation is not active

- **WHEN** a claim resolves to `disconnecting` or `reauthorization_required`
- **THEN** ingress MUST NOT dispatch ordinary event or interactivity business work
- **AND** it MUST still allow classified installation lifecycle facts to reach the lifecycle consumer when needed for idempotent recovery

#### Scenario: Claim chain is inconsistent

- **WHEN** claim, installation and Channel identifiers or Slack workspace identities do not match
- **THEN** ingress MUST fail closed and emit a high-signal integrity metric without exposing record details

### Requirement: Valid callbacks MUST be durably accepted before acknowledgement

Except for URL verification and safe no-op ownership cases, ingress MUST persist an authenticated envelope in the WTA-1282 durable inbox before returning a success acknowledgement. It MUST NOT run card decoding, HITL authorization or other business effects on the request thread.

#### Scenario: Event is durably accepted

- **WHEN** an authenticated Events API envelope resolves to an active claim and durable persistence succeeds
- **THEN** ingress MUST return a success acknowledgement within Slack's deadline
- **AND** a durable consumer MUST own all subsequent decoding and business retry

#### Scenario: Interaction is durably accepted

- **WHEN** an authenticated interactivity payload resolves to an active claim and durable persistence succeeds
- **THEN** ingress MUST acknowledge without waiting for card-event business decoding

#### Scenario: Durable persistence fails

- **WHEN** ingress cannot durably record a routed callback
- **THEN** it MUST return a retryable non-success response
- **AND** it MUST NOT claim successful business acceptance

### Requirement: Slack callback delivery MUST be idempotent

Ingress and durable consumption MUST derive a stable provider-scoped deduplication key and MUST permit at most one business-processing record for the same Slack delivery.

#### Scenario: Event API delivery has an event ID

- **WHEN** Slack retries an Events API envelope with the same `event_id`
- **THEN** all deliveries MUST resolve to the same deduplication key
- **AND** only one durable record MUST become eligible for business processing

#### Scenario: Interaction has no global event ID

- **WHEN** Slack retries an interactivity payload without `event_id`
- **THEN** ingress MUST derive the key from stable authenticated semantic identifiers and a canonical payload digest
- **AND** transport retry headers alone MUST NOT create another business event

#### Scenario: Duplicate is already durable

- **WHEN** an authenticated duplicate resolves to an existing accepted durable record
- **THEN** ingress MUST return a success acknowledgement without replaying synchronous side effects

### Requirement: Slack installation lifecycle events MUST be classified before business decoding

The durable ingress consumer MUST recognize official Slack installation lifecycle events and invoke the OAuth installation lifecycle port without depending on card-event decoding.

#### Scenario: App is uninstalled externally

- **WHEN** a durable authenticated `app_uninstalled` event resolves to an active claim
- **THEN** the lifecycle consumer MUST idempotently transition the installation to `reauthorization_required`
- **AND** it MUST NOT delete the workspace claim or Channel as if an administrator completed disconnect

#### Scenario: Tokens are revoked externally

- **WHEN** a durable authenticated `tokens_revoked` event affects the installation's authorization
- **THEN** the lifecycle consumer MUST idempotently mark the installation authorization invalid
- **AND** ordinary provider business work MUST subsequently fail closed

#### Scenario: Lifecycle event races with disconnect

- **WHEN** an uninstall or revocation event is consumed for an installation already in `disconnecting`
- **THEN** the consumer MUST record the fact without moving the lifecycle backward or recreating deleted ownership

### Requirement: Public Slack ingress observability MUST remain secret-free

Ingress MUST provide classified metrics and audit correlation without recording signatures, authorization material or raw interaction content.

#### Scenario: Callback is observed

- **WHEN** ingress records logs, traces, metrics or audit facts for a callback
- **THEN** any recorded fields MUST be limited to endpoint kind, safe correlation, signature result, claim resolution class, dedup result and enqueue latency
- **AND** it MUST NOT include signing secret, signature value, access token, OAuth state, raw request body or private interaction fields

#### Scenario: Unexpected ingress error occurs

- **WHEN** ingress cannot classify an internal failure safely
- **THEN** it MUST return a generic response and emit an internal correlation identifier
- **AND** it MUST NOT serialize provider payload or persistence diagnostics to Slack
