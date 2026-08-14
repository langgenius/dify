## MODIFIED Requirements

### Requirement: Contact lifecycle MUST enforce directory admission rules
Contact admission and mutation MUST enforce workspace-local External Contact uniqueness, organization ownership, Account availability, and lifecycle-source rules while keeping membership lookup and persistence I/O outside the entity. External Contact normalized email collisions MUST be rejected only against another External Contact in the same workspace. A normalized email overlap between an External Contact and an internal Contact MUST remain allowed and MUST NOT by itself force promotion, merge, downgrade, or rejection.

#### Scenario: External Contact shares email with an internal Contact
- **WHEN** an External Contact uses a normalized email already used by a current internal Contact in the same workspace or Organization scope
- **THEN** admission MUST allow the External Contact to exist independently and MUST NOT reinterpret it as an internal Contact

#### Scenario: Duplicate External Contacts in one workspace are rejected
- **WHEN** an External Contact uses a normalized email already owned by another External Contact in the same workspace
- **THEN** admission MUST return a stable conflicting-identity rejection

#### Scenario: Organization Contact overlaps an existing External Contact
- **WHEN** an Organization Contact uses a normalized email already owned by an External Contact in one workspace of the same deployment Organization
- **THEN** the Organization write MUST succeed and MUST preserve the two identities as separate Contacts

#### Scenario: External Contact is deleted and recreated
- **WHEN** an External Contact is hard deleted and later recreated with the same normalized email
- **THEN** the new Contact MUST receive a new Contact ID and the deleted identity MUST NOT be revived

#### Scenario: Account is disabled
- **WHEN** an Account-backed Contact references a currently disabled Account
- **THEN** the directory snapshot MUST mark it unavailable for current resolution without deleting its canonical history

### Requirement: Contact persistence MUST own directory transaction invariants
Contact persistence ports MUST be organized around snapshot load and lifecycle mutations rather than table-shaped CRUD. The adapter MUST own locking, mapping, rollback, and uniqueness conflict translation. Organization-backed admission and workspace-owned External Contact admission MUST serialize only the invariants that remain exclusive after the corrected rules; same-email internal/external coexistence MUST NOT be translated into a conflict.

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
