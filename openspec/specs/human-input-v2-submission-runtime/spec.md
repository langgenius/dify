# human-input-v2-submission-runtime Specification

## Purpose
TBD - created by archiving change implement-human-input-v2-submission-runtime. Update Purpose after archive.
## Requirements
### Requirement: Submission authorization MUST be a pure transport-neutral decision
Submission authorization MUST combine form/grant state, verified proof and immutable current identity facts without database queries, HTTP status knowledge or raw credentials.

#### Scenario: Authorization rule is tested
- **WHEN** an authorization scenario is exercised in a unit test
- **THEN** it MUST run without Flask, a database engine or provider client

#### Scenario: Raw credential reaches authorization boundary
- **WHEN** a caller passes a raw OTP, session credential, API token or IM callback payload
- **THEN** the domain API MUST reject it rather than treating it as verified proof

### Requirement: Grant, endpoint, verified proof and submission actor MUST remain distinct
The runtime MUST require explicit verified proof and MUST resolve a submission actor from current facts. No grant, endpoint or historical snapshot may be implicitly converted into proof or actor.

#### Scenario: Account session is accepted
- **WHEN** a verified current Account session matches a Contact-backed grant
- **THEN** the submission actor MUST be the current Account

#### Scenario: IM proof is accepted
- **WHEN** a current IM identity and effective binding prove access to a Contact-backed grant
- **THEN** the submission actor MUST be the current Dify Account and MUST NOT be an IM identity actor

#### Scenario: Trusted EndUser is accepted
- **WHEN** verified trusted EndUser context matches an EndUser-backed grant
- **THEN** the actor MUST be that EndUser and MUST remain distinct from Account and EmailAddress actors

### Requirement: Submission authorization MUST revalidate current identity state
Authorization MUST use one coherent tenant-scoped context containing current Contact, Account, workspace availability, Email and relevant IM binding facts rather than relying only on form creation snapshots. Contact-backed grants MUST revalidate current Contact and binding state. EmailAddress-backed grants created from one-time Email or Dynamic Email MUST remain email-scoped at authorization time and MUST NOT be upgraded into Contact authority merely because a current Contact now shares the same normalized email.

#### Scenario: External Contact was deleted
- **WHEN** an Email proof targets a Contact-backed grant whose External Contact is absent when context is loaded
- **THEN** authorization MUST reject the proof while preserving historical grant and endpoint snapshots

#### Scenario: Contact Email changed
- **WHEN** a verified Email proof references a previous Contact Email
- **THEN** authorization MUST reject the proof as stale identity evidence

#### Scenario: IM binding changed
- **WHEN** the proof identity is no longer the current effective binding for the Contact
- **THEN** authorization MUST reject the proof

#### Scenario: Dynamic Email grant later overlaps a current Contact
- **WHEN** a verified Email proof targets an EmailAddress-backed grant that now shares its normalized email with a current Contact
- **THEN** authorization MUST continue treating the grant as EmailAddress-backed and MUST NOT accept Account session or Contact identity as an implicit substitute proof

#### Scenario: Current facts change after context load
- **WHEN** Contact, Email, membership, or binding state changes after a coherent context has been loaded for the active transaction
- **THEN** the transaction MUST remain authorized from that context and MUST NOT require another Contact or Binding version check

### Requirement: Form submission MUST use first-success transaction semantics
Persistence MUST atomically commit at most one successful submission per form together with its authorization audit event and form status transition.

#### Scenario: Email and IM submit concurrently
- **WHEN** valid Email and IM requests concurrently submit the same active form
- **THEN** exactly one request MUST commit and the other MUST receive the stable already-completed result

#### Scenario: Authorized persistence fails
- **WHEN** any audit, submission or form-transition write fails
- **THEN** all writes MUST roll back and workflow resume MUST NOT be scheduled

#### Scenario: Unique-conflict race occurs
- **WHEN** a concurrent insert reaches the unique submission constraint after another request succeeds
- **THEN** the adapter MUST translate the conflict into the stable already-completed result

### Requirement: Submission persistence ports MUST own the atomic use case
Persistence ports MUST provide one coherent authorization-context load and one `commit_authorized_submission_once` operation rather than generic CRUD for form, audit and submission tables.

#### Scenario: Authorization context is loaded
- **WHEN** a submission transaction begins
- **THEN** one tenant-scoped repository operation MUST load the relevant form, grant, Contact, Account, workspace, Email and IM facts coherently

#### Scenario: Authorized submission is committed
- **WHEN** the authorizer and form aggregate produce a successful decision
- **THEN** one persistence operation MUST own the Form row lock, audit insert, unique submission insert and form transition

#### Scenario: ORM records are used
- **WHEN** submission or audit records are loaded or written
- **THEN** explicit mappers MUST isolate ORM instances from domain and application layers

### Requirement: Workflow resume MUST occur only after submission commit
The submit application handler MUST enqueue workflow resume only after the authorized submission transaction commits, using an idempotent resume identity.

#### Scenario: Commit succeeds
- **WHEN** `commit_authorized_submission_once` returns success
- **THEN** the handler MUST enqueue resume after commit with the form/workflow identity

#### Scenario: Resume enqueue fails
- **WHEN** enqueue fails after commit
- **THEN** the form MUST remain submitted, the failure MUST NOT roll back persistence, and logs MUST include tenant, form and workflow identifiers

#### Scenario: Resume is dispatched repeatedly
- **WHEN** the same resume identity is requested more than once
- **THEN** the resume port contract MUST make duplicate dispatch safe

### Requirement: Submission rejection reasons MUST remain stable and transport-neutral
Form completion, grant mismatch, stale proof and current identity failures MUST use typed reason codes that can be mapped by HTTP, worker and audit adapters without inheriting transport exceptions.

#### Scenario: Form is completed
- **WHEN** authorization targets a submitted, timed-out or expired form
- **THEN** the runtime MUST return the corresponding stable form-state reason without selecting an HTTP status

#### Scenario: Proof does not match grant
- **WHEN** verified proof identifies a different current subject from the target grant
- **THEN** the runtime MUST return a stable grant-not-matched or stale-proof reason and MUST NOT persist a submission
