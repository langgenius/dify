## ADDED Requirements

### Requirement: Domain core MUST remain independent from transport and ORM models
Human Input v2 domain modules MUST express business state and behavior without depending on Flask resources, controller request/response DTOs, SQLAlchemy sessions, or ORM model instances.

#### Scenario: Domain rule is tested without transport or database
- **WHEN** a recipient resolution or form transition rule is exercised in a unit test
- **THEN** the test MUST run using domain values and ports without creating a Flask application or database engine

#### Scenario: Persistence record is loaded
- **WHEN** a repository adapter loads SQLAlchemy records for a Human Input v2 aggregate
- **THEN** it MUST map those records into domain objects before returning control to the application service

### Requirement: Domain behavior ownership MUST follow invariant and dependency boundaries
The domain core MUST keep local lifecycle invariants on the owning state model, use pure domain services for decisions spanning multiple current snapshots, and keep I/O orchestration and database atomicity outside those domain modules.

#### Scenario: Form lifecycle is modeled
- **WHEN** active-state and action-transition rules are implemented
- **THEN** `HumanInputForm` MUST own those rules without introducing a separate pass-through lifecycle object

#### Scenario: Cross-snapshot authorization is modeled
- **WHEN** submission authorization combines a grant, verified proof and current identity facts
- **THEN** one pure authorization module MUST own that decision without querying the database or performing the commit

#### Scenario: Read-only projection is queried
- **WHEN** a list or detail use case requires no domain transition
- **THEN** it MAY use a dedicated application read model without reconstructing a full domain aggregate

### Requirement: Contact identity and workspace-relative resolution MUST be separate concepts
The domain core MUST preserve immutable Contact lifecycle ownership separately from the Contact type resolved in a workspace.

#### Scenario: Organization Contact is visible in different workspaces
- **WHEN** the same Organization Contact is a member in one EE workspace and explicitly retained in another
- **THEN** directory resolution MUST return `WORKSPACE` in the first workspace and `PLATFORM` in the second without mutating the Contact identity source

#### Scenario: Contact is absent from a workspace
- **WHEN** a canonical Contact exists but has neither current membership nor a Platform allow-list entry in the requested workspace
- **THEN** directory resolution MUST return `ABSENT` and MUST NOT mutate or delete the Organization Contact

### Requirement: Recipient resolution MUST produce one canonical approval plan
The domain core MUST provide one recipient resolution operation that validates recipient specifications, resolves current identities, canonicalizes subjects, records matched sources, and selects delivery endpoints.

#### Scenario: Multiple sources resolve to one Contact
- **WHEN** a static Contact recipient, a dynamic Email and the current initiator resolve to the same Contact
- **THEN** recipient resolution MUST produce one canonical approver with all matched sources and MUST NOT duplicate the approver for multiple delivery channels

#### Scenario: Dynamic Email does not match a Contact
- **WHEN** a valid normalized dynamic Email does not match any Contact in the request-scoped directory snapshot
- **THEN** recipient resolution MUST produce an EmailAddress approver and an Email delivery endpoint

#### Scenario: Recipient value is invalid but another recipient remains valid
- **WHEN** one recipient value is invalid and another recipient resolves successfully
- **THEN** the plan MUST retain a machine-readable rejected-recipient fact and MUST still contain the valid approver

### Requirement: Approval authority, delivery endpoint, proof and actor MUST remain distinct
The domain core MUST model approver grant, delivery endpoint, verified authorization proof and submission actor as different concepts with no implicit conversion between them. Raw OTP codes, sessions, callback payloads and API tokens MUST be verified by proof-specific adapters before entering submission authorization.

#### Scenario: Form token is available
- **WHEN** a valid delivery endpoint token can read a form definition
- **THEN** that token MUST NOT by itself create an authorization proof or submission actor

#### Scenario: IM proof is accepted
- **WHEN** a current IM identity and binding prove access to a Contact-backed grant
- **THEN** the resulting submission actor MUST be the current Dify Account and MUST NOT be an IM identity actor

#### Scenario: Raw credential reaches authorization boundary
- **WHEN** a caller attempts to pass an unverified OTP, session credential or IM callback payload to submission authorization
- **THEN** the domain API MUST reject that input rather than treating it as a verified proof

### Requirement: Submission authorization MUST revalidate current identity state
The domain core MUST authorize submission using the current form state, current grant subject state and verified proof rather than relying only on snapshots captured when the form was created. Current identity validity MUST be evaluated against one coherent authorization context observed by the submission transaction.

#### Scenario: External Contact was deleted
- **WHEN** an Email OTP was issued for a Contact-backed grant and the External Contact is deleted before the authorization context is loaded
- **THEN** submission authorization MUST reject the proof while preserving the historical grant and endpoint snapshot

#### Scenario: Contact email changed
- **WHEN** a Contact email changes after an OTP challenge was issued to the previous email
- **THEN** submission authorization MUST reject the old challenge as stale identity proof

#### Scenario: IM binding changed
- **WHEN** an IM identity is no longer the current effective binding for the Contact
- **THEN** submission authorization MUST reject approval through the old IM identity

#### Scenario: Current identity changes after authorization snapshot
- **WHEN** Contact, Email, membership or binding state changes after a coherent authorization context has been loaded for an active submission transaction
- **THEN** the transaction MAY complete using that context and MUST NOT require an additional Contact or Binding version check

### Requirement: Human Input form submission MUST use first-success semantics
The persistence contract MUST atomically commit at most one successful submission for each Human Input form together with its authorization audit event and form status transition.

#### Scenario: Email and IM submit concurrently
- **WHEN** valid Email and IM requests concurrently submit the same active form
- **THEN** exactly one request MUST commit a submission and the other MUST receive the stable already-completed domain result

#### Scenario: Authorized submission persistence fails
- **WHEN** any write in the authorization audit, submission insert or form status transition fails
- **THEN** the transaction MUST roll back all writes and MUST NOT schedule workflow resumption

#### Scenario: Resume enqueue fails after commit
- **WHEN** the authorized submission transaction commits and the subsequent workflow resume enqueue fails
- **THEN** the form MUST remain submitted, the failure MUST NOT roll back the committed transaction, and the system MUST record the form and workflow identifiers for diagnosis

### Requirement: OTP challenge MUST enforce a separate proof-session lifecycle
The domain core MUST enforce OTP expiry, resend cooldown, send limit, attempt limit and invalidation independently from form submission state.

#### Scenario: OTP is resent
- **WHEN** an eligible approver requests a replacement OTP after the cooldown
- **THEN** the previous pending challenge MUST become unusable and exactly one current challenge MUST remain usable for that form and grant

#### Scenario: OTP proof is verified
- **WHEN** a valid OTP code is verified
- **THEN** the proof session MUST record successful verification without retaining plaintext code and MUST still require current grant authorization before form submission

### Requirement: IM Integration writes MUST use complete compare-and-swap tokens
The IM Integration aggregate MUST require both integration ID and configuration version for updates or deletion of an existing integration.

#### Scenario: Current revision is updated
- **WHEN** a configuration write provides the current integration ID and version
- **THEN** the write MUST apply atomically and MUST advance the configuration version exactly once

#### Scenario: Stale revision is used
- **WHEN** a configuration write or sync reconciliation uses a stale integration ID or version
- **THEN** the persistence adapter MUST reject current-state mutation and return a stable stale-revision domain result

### Requirement: Each IM Integration MUST have at most one active sync run
The persistence contract MUST prevent concurrent triggers from creating more than one active synchronization run for the same IM Integration, and retries of the same run MUST be idempotent.

#### Scenario: Concurrent sync triggers
- **WHEN** two requests concurrently trigger synchronization for the same Integration with no existing active run
- **THEN** at most one new active sync run MUST be created

#### Scenario: Sync is already active
- **WHEN** a synchronization trigger is received while the Integration already has an active run
- **THEN** the operation MUST return or report the existing active state without creating another active run

#### Scenario: Sync worker retries a run
- **WHEN** a worker retries reconciliation for the same `sync_run_id`
- **THEN** applying the same run MUST be idempotent and MUST still require the captured Integration revision to match

### Requirement: Persistence ports MUST expose transaction-oriented operations
Human Input v2 persistence ports MUST be organized around aggregate invariants and atomic use cases rather than generic CRUD methods for each database table.

#### Scenario: Authorized submission is persisted
- **WHEN** the application service commits an authorized submission
- **THEN** one persistence operation MUST own the audit, submission and form-state transaction boundary

#### Scenario: Directory snapshot is loaded
- **WHEN** recipient resolution begins for a batch or form creation request
- **THEN** the persistence layer MUST provide one tenant-scoped snapshot whose membership and Contact facts remain consistent for that operation

#### Scenario: Submission authorization context is loaded
- **WHEN** a submission transaction begins authorization
- **THEN** the persistence layer MUST provide one coherent tenant-scoped context containing the relevant form, grant, Contact, Account, workspace availability, Email and IM binding facts

### Requirement: Domain rejection reasons MUST be stable and transport-neutral
The domain core MUST expose typed rejection reasons that do not inherit HTTP exceptions and can be mapped consistently by HTTP, worker and audit adapters.

#### Scenario: No recipient can be resolved
- **WHEN** every recipient specification is invalid or unavailable and no initiator can be resolved
- **THEN** the domain operation MUST return the stable no-valid-recipients rejection without selecting an HTTP status

#### Scenario: Form is no longer active
- **WHEN** authorization targets a submitted, timed-out or expired form
- **THEN** the domain operation MUST return the corresponding stable form-state rejection for the caller to map
