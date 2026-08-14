# human-input-v2-contact-directory-core Specification

## Purpose
TBD - created by archiving change implement-human-input-v2-contact-directory. Update Purpose after archive.
## Requirements
### Requirement: Contact Directory domain MUST remain independent from transport and ORM models
Contact Directory domain modules MUST express identity, lifecycle and workspace resolution without depending on Flask resources, controller DTOs, SQLAlchemy sessions or ORM model instances. Persistence adapters MUST map records into domain objects before returning them.

#### Scenario: Contact rule is tested without infrastructure
- **WHEN** a Contact owner invariant or workspace resolution rule is exercised in a unit test
- **THEN** the test MUST run without creating a Flask application or database engine

#### Scenario: Contact record is loaded
- **WHEN** a repository adapter loads Contact persistence records
- **THEN** it MUST return mapped domain snapshots rather than ORM instances

### Requirement: Contact identity source MUST be immutable and owner-valid
A Contact MUST have exactly one lifecycle source and a valid owner combination: EE Organization Account, CE/SaaS workspace member, or workspace-owned External Contact. Workspace-relative Contact type MUST NOT be persisted as the identity source.

#### Scenario: Organization Contact is created
- **WHEN** an EE Organization Account Contact is created
- **THEN** it MUST have no tenant owner, MUST reference an Account, and MUST retain `ORGANIZATION_ACCOUNT` as its immutable identity source

#### Scenario: Workspace-owned Contact is created
- **WHEN** a workspace member or External Contact is created
- **THEN** it MUST have a tenant owner and MUST satisfy the Account/Email requirements of its identity source

#### Scenario: Owner combination is invalid
- **WHEN** a caller attempts to construct a Contact with an owner combination that does not match its identity source
- **THEN** the domain factory MUST return a stable invalid-owner rejection

### Requirement: Workspace-relative Contact resolution MUST remain separate from canonical identity
The directory MUST resolve `WORKSPACE`, `PLATFORM`, `EXTERNAL` or `ABSENT` from current membership and Platform allow-list facts without mutating the canonical Contact.

#### Scenario: Organization Contact is visible differently across workspaces
- **WHEN** the same Organization Contact is a current member in one workspace and explicitly retained in another
- **THEN** resolution MUST return `WORKSPACE` in the first workspace and `PLATFORM` in the second

#### Scenario: Contact is absent from a workspace
- **WHEN** a canonical Contact has neither current membership nor a Platform allow-list entry in the requested workspace
- **THEN** resolution MUST return `ABSENT` and MUST NOT mutate or delete the Contact

#### Scenario: External Contact is resolved
- **WHEN** an External Contact is queried in its owning workspace
- **THEN** resolution MUST return `EXTERNAL` and MUST reject use from another workspace

### Requirement: Contact lifecycle MUST enforce directory admission rules
Contact admission and mutation MUST enforce workspace-local External Contact uniqueness, organization ownership, Account availability and lifecycle-source rules while keeping membership lookup and persistence I/O outside the entity. External Contact normalized email collisions MUST be rejected only against another External Contact in the same workspace. A normalized email overlap between an External Contact and an internal Contact MUST remain allowed and MUST NOT by itself force promotion, merge, downgrade, or rejection.

#### Scenario: External Contact shares email with an internal Contact
- **WHEN** an External Contact uses a normalized email already used by a current internal Contact in the same workspace or Organization scope
- **THEN** admission MUST allow the External Contact to exist independently and MUST NOT reinterpret it as an internal Contact

#### Scenario: Duplicate External Contacts in one workspace are rejected
- **WHEN** an External Contact uses a normalized email already owned by another External Contact in the same workspace
- **THEN** admission MUST return a stable conflicting-identity rejection

#### Scenario: Organization Contact overlaps an existing External Contact
- **WHEN** an EE Organization Contact uses a normalized email already owned by an External Contact in one workspace of the same deployment Organization
- **THEN** the Organization write MUST succeed and MUST preserve the two identities as separate Contacts

#### Scenario: External Contact is deleted and recreated
- **WHEN** an External Contact is hard deleted and later recreated with the same normalized Email
- **THEN** the new Contact MUST receive a new Contact ID and the deleted identity MUST NOT be revived

#### Scenario: Account is disabled
- **WHEN** an Account-backed Contact references a currently disabled Account
- **THEN** the directory snapshot MUST mark it unavailable for current resolution without deleting its canonical history

### Requirement: Directory snapshot MUST provide one coherent operation-scoped view
Recipient and authorization consumers MUST receive one tenant-scoped immutable snapshot containing the Contact, membership, Platform allow-list and Account availability facts needed for that operation.

#### Scenario: Directory snapshot is loaded
- **WHEN** a consumer starts a recipient-resolution or current-identity operation
- **THEN** the persistence layer MUST load the relevant facts as one coherent snapshot and MUST apply complete owner predicates

#### Scenario: Read-only list is requested
- **WHEN** a list or detail query requires no Contact transition
- **THEN** it MUST be allowed to use a dedicated application projection without reconstructing a full aggregate

### Requirement: Contact persistence MUST own directory transaction invariants
Contact persistence ports MUST be organized around snapshot load and lifecycle mutations rather than table-shaped CRUD. The adapter MUST own locking, mapping, rollback and uniqueness conflict translation. Organization-backed admission and workspace-owned External Contact admission MUST serialize only the invariants that remain exclusive after the corrected rules; same-email internal/external coexistence MUST NOT be translated into a conflict.

#### Scenario: EE Organization Contact is written
- **WHEN** a Contact with `tenant_id IS NULL` is created or changes a unique identity value
- **THEN** the adapter MUST lock the deployment `DifySetup` row before mutation and MUST enforce only Organization-scoped invariants that still apply

#### Scenario: Organization and External same-email admissions race
- **WHEN** a deployment `DifySetup` owner exists and an EE Organization admission and a workspace External admission concurrently claim the same normalized email for different identity sources
- **THEN** the adapter MUST allow both writes to commit if their remaining owner predicates are valid and MUST NOT translate the overlap into a conflicting-identity rejection

#### Scenario: External duplicate admissions race in one workspace
- **WHEN** two workspace External admissions concurrently claim the same normalized email in the same workspace
- **THEN** exactly one admission MUST commit and the other MUST return a stable conflicting-identity rejection

#### Scenario: SaaS External Contact is admitted without a deployment owner
- **WHEN** no deployment `DifySetup` owner exists and a workspace admits an External Contact
- **THEN** admission MUST use the tenant-scoped identity boundary and MUST NOT return `SETUP_ROW_MISSING`

#### Scenario: Lifecycle mutation fails
- **WHEN** a Contact or Platform allow-list write violates an invariant or a dependent write fails
- **THEN** the entire operation MUST roll back and return a transport-neutral domain rejection

#### Scenario: Aggregate is loaded
- **WHEN** Contact logical relationships are needed by an application operation
- **THEN** the adapter MUST use explicit eager loading and MUST NOT trigger hidden lazy loads
