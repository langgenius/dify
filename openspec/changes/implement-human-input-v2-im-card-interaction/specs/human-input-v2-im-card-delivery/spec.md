## ADDED Requirements

### Requirement: IMCardSender MUST use one HITL v2 delivery abstraction

`IMCardSender` MUST accept a Human Input v2 `FormDeliveryProjection` containing the frozen form definition, frozen surface/message presentation, rendered content, approver Grant, IM Endpoint and expiry. It MUST hide provider render/send/update differences and return only provider-neutral delivery facts. Application/core layers MUST NOT import provider SDK models, provider payload JSON, credentials or ORM records.

#### Scenario: Active Form is sent to IM
- **WHEN** an active HITL v2 Form has one current IM delivery Endpoint
- **THEN** the sender MUST use the frozen projection to create the provider delivery without reloading mutable workflow DSL

#### Scenario: Provider-specific delivery completes
- **WHEN** a Feishu, Lark or DingTalk adapter sends or updates the message
- **THEN** it MUST return a safe provider-neutral result while SDK objects, raw responses and opaque handle internals remain in its provider package

### Requirement: IMCardSender MUST fall back to text and secure link for incompatible Form shapes

For each delivery, the provider Card renderer MUST either produce a faithful direct interactive card or return a typed incompatibility. If any required input or action cannot be represented faithfully, `IMCardSender` MUST send `MessageTemplate`-controlled text plus a secure HITL v2 form link. It MUST NOT omit, coerce or default required values to force direct submission.

#### Scenario: Form shape is faithfully supported
- **WHEN** the provider renderer can represent every required input and action in the frozen definition
- **THEN** the sender MUST send a direct interactive card whose canonical identifiers map back to that definition

#### Scenario: One required input is incompatible
- **WHEN** the provider renderer cannot faithfully map one required control
- **THEN** the sender MUST send text plus a secure form link and MUST NOT expose a partial direct-submission action

#### Scenario: Fallback link is opened
- **WHEN** an approver follows the link from the fallback message
- **THEN** the link MUST open only the existing HITL v2 form surface and MUST NOT itself become IM identity proof or submission authority

### Requirement: Card delivery MUST use Foundation current state and stable delivery facts

Before provider I/O, the sender MUST verify that Endpoint Integration, provider tenant and identity still belong to current tenant-scoped state. Provider adapters MUST use the shared Foundation client lifecycle. Each send MUST use a stable operation identity, append safe delivery facts and classify failure as retryable, terminal or ambiguous without blindly replaying an unsafe mutation.

#### Scenario: Endpoint Integration is stale
- **WHEN** a queued delivery targets an Integration or provider tenant that has been replaced
- **THEN** the sender MUST record a stable stale-endpoint failure and MUST NOT call the provider

#### Scenario: Provider confirms message creation
- **WHEN** the provider creates a direct card or fallback text message
- **THEN** the delivery operation MUST record a safe message identifier and adapter-owned update handle without persisting the raw provider response

#### Scenario: Provider send times out ambiguously
- **WHEN** the provider might have accepted the mutation but the adapter cannot determine the result
- **THEN** the sender MUST record `AMBIGUOUS` and MUST retry only with provider-supported idempotency or deterministic reconciliation

#### Scenario: Delivery operation runs repeatedly
- **WHEN** the same stable operation is dispatched more than once
- **THEN** persistence and adapter idempotency MUST prevent a duplicate successful message or return the recorded outcome

### Requirement: Supported Card providers MUST not use runtime send/update flags

Feishu, Lark and DingTalk Card adapters MUST implement message send and terminal update as fixed provider-onboarding requirements. The Card application MUST NOT select providers through tenant-level `CARD_SEND` or `CARD_UPDATE` flags, a generic capability registry or dynamically assembled capability adapter graph. Per-Form rendering incompatibility MUST be handled only by `IMCardSender` fallback.

#### Scenario: Provider adapter lacks send or update
- **WHEN** a provider cannot pass the shared Card send/update contract suite
- **THEN** it MUST NOT be registered as a supported Human Input Card provider

#### Scenario: One Form requires fallback
- **WHEN** a registered provider cannot directly render one Form shape
- **THEN** the sender MUST retain provider support and deliver the text-plus-link fallback

### Requirement: Terminal message updates MUST remain diagnostic side effects

After Form submission, timeout or expiry, the system MUST schedule updates for every successfully delivered IM message of that Form. A terminal document MUST remove or disable actionable controls and display safe status. Form lifecycle and first-success submission MUST remain authoritative.

#### Scenario: One channel submits the Form
- **WHEN** Email, Web, Service API or IM wins the first-success transaction
- **THEN** the system MUST schedule terminal updates for all known IM message handles only after commit

#### Scenario: Terminal update fails
- **WHEN** a provider rejects or times out while updating an already delivered message
- **THEN** the system MUST append a retryable or terminal delivery diagnostic and MUST NOT roll back or reopen the Form

#### Scenario: User clicks a stale Card
- **WHEN** an update failed and a later interaction targets an already terminal Form
- **THEN** the submission pipeline MUST return the stable terminal result without a second submission

### Requirement: Card delivery MUST not expose credentials or unrestricted capabilities

Provider credentials, event transport secrets, raw provider responses and plaintext interaction capabilities MUST NOT appear in provider-neutral documents, task payloads, logs, metrics or persistent diagnostics. Endpoint MUST store only the capability hash. Recoverable capability material at rest MUST be limited to encrypted, access-controlled delivery-operation escrow and MUST be purged after terminal delivery or Form expiry.

#### Scenario: Delivery diagnostics are recorded
- **WHEN** provider send or update fails
- **THEN** persisted and logged diagnostics MUST contain only allow-listed safe codes, provider identifiers and correlation metadata

#### Scenario: Capability is copied to another Endpoint
- **WHEN** a valid capability is presented with a different provider tenant, Integration, Form, Grant or Endpoint context
- **THEN** the system MUST reject it before constructing verified IM identity proof

#### Scenario: Delivery reaches a terminal outcome
- **WHEN** send succeeds, fails terminally or can no longer retry because the Form expired
- **THEN** the operation MUST purge encrypted capability escrow while retaining the Endpoint hash and safe delivery facts
