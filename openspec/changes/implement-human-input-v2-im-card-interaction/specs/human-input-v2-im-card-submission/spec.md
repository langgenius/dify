## ADDED Requirements

### Requirement: Authenticated Card interaction MUST not be treated as submission proof

`IMCardInteractionProcessor` MUST resolve the Endpoint capability hash retained by the Card inbox and revalidate current tenant-scoped Integration, provider tenant, IM identity, effective binding, Contact and Account before constructing `VerifiedIMIdentityProof`. Foundation envelopes, Card normalizers and inbox records MUST NOT create proofs, choose Grants or submit Forms directly.

#### Scenario: Current identity matches the Endpoint Grant
- **WHEN** a canonical interaction has a valid capability and its provider actor currently resolves through effective binding to the Contact-backed Grant
- **THEN** the processor MUST construct `VerifiedIMIdentityProof` from current facts and pass it to the shared HITL v2 submission boundary

#### Scenario: IM binding changed after delivery
- **WHEN** the event actor no longer matches current effective binding for the Endpoint Grant
- **THEN** the processor MUST record `IM_BINDING_CHANGED` and MUST NOT submit the Form

#### Scenario: Interaction targets another owner chain
- **WHEN** provider tenant, Integration, Form, Grant or Endpoint values do not match the resolved capability owner chain
- **THEN** the processor MUST reject before loading or exposing unrelated tenant data

### Requirement: Card action values MUST use shared frozen-Form validation

The processor MUST translate canonical Card values through the same transport-neutral frozen-Form validator used by other HITL v2 surfaces. Selected action and input identifiers MUST come from the frozen definition; unknown, duplicated, unsupported or missing required values MUST be rejected. Provider normalizers MUST NOT implement Form validation.

#### Scenario: Direct Card action has valid inputs
- **WHEN** a canonical interaction supplies one defined action and a complete valid input set
- **THEN** the processor MUST produce the same canonical values as Web or Service API submission

#### Scenario: Provider supplies unknown values
- **WHEN** a canonical interaction includes a field or action absent from the frozen definition
- **THEN** the processor MUST reject with a stable validation result and MUST NOT pass provider extension values into submission persistence

#### Scenario: Delivery used text-link fallback
- **WHEN** direct submission was disabled because the Form shape was incompatible
- **THEN** a provider event MUST NOT convert the fallback link action into direct Card submission

### Requirement: IM Card submission MUST reuse first-success transaction semantics

After proof and input validation, the processor MUST call the existing HITL v2 submission handler and repository transaction. It MUST NOT create provider-specific submission tables, lifecycle transitions or workflow resume paths. IM, Email, Web and Service API interactions for one Form MUST compete through the same first-success boundary.

#### Scenario: IM interaction wins
- **WHEN** a valid IM interaction reaches an active Form before another channel commits
- **THEN** exactly one Submission, authorization audit and Form transition MUST commit before shared idempotent workflow resume is enqueued

#### Scenario: Another channel wins concurrently
- **WHEN** Email, Web or Service API commits while the same Form Card interaction is processing
- **THEN** the IM processor MUST receive the stable already-completed result without creating another Submission or resume

#### Scenario: Inbox interaction is retried
- **WHEN** the same inbox item runs after its Submission transaction committed
- **THEN** processing MUST converge on the recorded terminal outcome without duplicating Submission, audit, resume or update dispatch

### Requirement: Submission outcome and Card update MUST be separated by after-commit boundary

The processor MUST persist terminal inbox outcome consistently with the submission decision and MUST schedule provider message updates only after successful commit. Provider update failure MUST remain an independent delivery diagnostic and MUST NOT alter Form, Submission or inbox business outcome.

#### Scenario: Submission commits
- **WHEN** the shared handler returns `SUBMITTED`
- **THEN** the system MUST record winning interaction correlation and enqueue terminal updates after commit

#### Scenario: Form is already terminal
- **WHEN** an interaction targets a submitted, timed-out or expired Form
- **THEN** the inbox MUST record a stable terminal result and schedule safe refresh for known message handles without another submission

#### Scenario: Terminal refresh fails
- **WHEN** provider update fails after successful interaction commit
- **THEN** the inbox outcome MUST remain successful and only the delivery update operation MUST retry

### Requirement: Card interaction audit MUST retain safe identity and event facts

Accepted and rejected interactions MUST retain enough immutable facts to explain provider, provider event identity, Endpoint, authorization result and winning Submission without storing raw envelope payload, callback/stream credentials, SDK objects or plaintext capability. The successful Submission actor MUST remain the resolved Dify Account rather than provider identity.

#### Scenario: IM submission succeeds
- **WHEN** verified IM proof authorizes one Contact-backed Grant
- **THEN** authorization audit MUST retain the IM proof snapshot and safe event correlation while Submission actor remains current Account

#### Scenario: Authorization is rejected
- **WHEN** current Contact, Account, Integration or binding state rejects an authentic interaction
- **THEN** audit and inbox MUST retain a stable rejection code and safe correlation without exposing Contact or provider payload details
