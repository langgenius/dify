## MODIFIED Requirements

### Requirement: Contact subject type MUST be immutable and owner-valid
A `HumanInputContactIdentity` MUST contain one immutable UUID Contact ID and exactly one immutable `ContactSubjectType`: `ACCOUNT` or `EXTERNAL`. An Account-backed Contact identity MUST map exactly one Account globally and MUST NOT store mutable Account profile、membership、Platform visibility or authorization facts. An External Contact identity MUST obtain workspace ownership and mutable fields from exactly one `HumanInputExternalContactProfile`. A workspace-relative Contact resolution MUST NOT be persisted in `subject_type`.

#### Scenario: Account-backed Contact identity is allocated
- **WHEN** an Account first requires a Contact identity
- **THEN** persistence MUST allocate exactly one Contact ID for that Account and MUST return the same Contact ID on every later ensure operation regardless of workspace context

#### Scenario: Account-backed Contact identity outlives membership
- **WHEN** the mapped Account loses current membership or Platform visibility in any workspace
- **THEN** `HumanInputContactIdentity` MUST retain its Contact ID and Account mapping without copying、clearing or tombstoning Account profile fields

#### Scenario: External Contact identity is allocated
- **WHEN** a workspace admits a new External Contact
- **THEN** persistence MUST atomically allocate one External Contact identity and one workspace-owned `HumanInputExternalContactProfile` with the same Contact ID

#### Scenario: Contact identity receives mutable profile data
- **WHEN** a caller attempts to persist name、normalized name、Email、normalized Email or avatar on `HumanInputContactIdentity`
- **THEN** the persistence model MUST reject that shape because those fields belong to `Account` or `HumanInputExternalContactProfile`

#### Scenario: Subject mapping is invalid
- **WHEN** a caller attempts to map one Contact ID to multiple subjects or map one Account to multiple Contact IDs
- **THEN** persistence MUST reject the write with a stable conflicting-identity result

### Requirement: Workspace-relative Contact resolution MUST remain separate from canonical identity
The directory MUST resolve `WORKSPACE`、`PLATFORM`、`EXTERNAL` or `ABSENT` from an immutable Contact identity plus current Account、membership、Platform allow-list and External Contact profile facts. Contact resolution MUST NOT mutate `HumanInputContactIdentity` or copy source-owned profile values into it.

#### Scenario: Account-backed Contact is visible differently across workspaces
- **WHEN** the same Account-backed Contact is a current member in one workspace and explicitly retained in another
- **THEN** resolution MUST return `WORKSPACE` in the first workspace and `PLATFORM` in the second while returning the same Contact ID

#### Scenario: Account-backed Contact is absent from a workspace
- **WHEN** an Account-backed Contact has neither current membership nor a Platform allow-list entry in the requested workspace
- **THEN** resolution MUST return `ABSENT` without mutating or deleting its Contact identity

#### Scenario: SaaS or CE Account rejoins one workspace
- **WHEN** an Account-backed Contact previously resolved as `ABSENT` after membership removal and the same Account rejoins a workspace
- **THEN** resolution MUST return `WORKSPACE` with the existing Contact ID

#### Scenario: External Contact is resolved
- **WHEN** an External identity has a current External Contact profile in its owning workspace
- **THEN** resolution MUST return `EXTERNAL` and MUST reject use from another workspace

#### Scenario: Deleted External Contact is referenced historically
- **WHEN** a historical grant、OTP proof or audit snapshot retains a Contact ID after its External Contact profile and Contact identity were deleted
- **THEN** current resolution MUST return `ABSENT` and MUST NOT recreate either deleted row

### Requirement: Contact lifecycle MUST enforce directory admission rules
Contact admission and mutation MUST enforce workspace-local External Contact uniqueness、Organization ownership、Account availability and subject-owner rules while keeping membership lookup and persistence I/O outside the identity value. External Contact normalized Email collisions MUST be rejected only against another current External Contact profile in the same workspace. A normalized Email overlap between an External Contact and an Account-backed Contact MUST remain allowed and MUST NOT force promotion、merge、downgrade or rejection.

#### Scenario: External Contact shares Email with an Account-backed Contact
- **WHEN** an External Contact uses a normalized Email already used by a current Account-backed Contact in the same workspace or Organization scope
- **THEN** admission MUST allow the External Contact to exist independently and MUST allocate a distinct Contact ID

#### Scenario: Duplicate External Contacts in one workspace are rejected
- **WHEN** an External Contact uses a normalized Email already owned by another current External Contact profile in the same workspace
- **THEN** admission MUST return a stable conflicting-identity rejection

#### Scenario: Account-backed Contact overlaps an existing External Contact
- **WHEN** an Account uses a normalized Email already owned by an External Contact in one workspace of the same Organization
- **THEN** Account profile reads and identity allocation MUST succeed and MUST preserve the two Contact identities

#### Scenario: External Contact is deleted and recreated
- **WHEN** an External Contact profile is deleted and a later create uses the same normalized Email
- **THEN** deletion MUST remove the original Contact identity and External Contact profile，and the later create MUST allocate a new Contact identity and Contact ID

#### Scenario: Account profile changes
- **WHEN** an Account-backed Contact's name、Email or avatar changes
- **THEN** current reads MUST use the new Account values without a Contact identity mutation or Contact-specific profile reconciliation

#### Scenario: Account is disabled
- **WHEN** an Account-backed Contact references a currently disabled Account
- **THEN** the current Contact facts MUST mark it unavailable for Contact resolution without deleting or updating its Contact identity

### Requirement: Current Contact facts MUST provide one coherent operation-scoped view
Recipient and authorization consumers MUST receive one tenant-scoped immutable view containing Contact identities and the current Account、membership、Platform allow-list、External Contact profile and Account availability facts needed for that operation. The view MUST expose one current Contact projection to consumers and MUST NOT expose ORM records or require consumers to branch on persistence layout.

#### Scenario: Current Contact facts are loaded
- **WHEN** a consumer starts a recipient-resolution or current Contact operation
- **THEN** the persistence layer MUST load all requested Contact identities and current source-owned facts under complete owner predicates and MUST map them into one coherent domain view

#### Scenario: Read-only list is requested
- **WHEN** a list or detail query requires no Contact identity transition
- **THEN** it MUST query Account and External Contact profile sources through one application projection without reconstructing a mutable Contact aggregate

### Requirement: Contact persistence MUST own directory transaction invariants
Contact persistence ports MUST be organized around Account-backed Contact identity ensure、current Contact facts load、External Contact lifecycle and Platform allow-list mutations rather than table-shaped CRUD. The adapter MUST own subject mapping、rollback and uniqueness conflict translation. Account profile、membership and Platform visibility updates MUST NOT mutate Account-backed Contact identity.

#### Scenario: First Account-backed identity is allocated
- **WHEN** concurrent operations ensure an identity for the same Account
- **THEN** global `account_id` uniqueness MUST allow exactly one Contact ID to commit and every successful retry MUST return that same ID

#### Scenario: Account membership is removed
- **WHEN** an Account loses membership in one SaaS or CE workspace
- **THEN** the owning operation MUST update membership and any required current binding state without deleting the Contact identity

#### Scenario: External Contact is deleted
- **WHEN** a workspace deletes one current External Contact
- **THEN** persistence MUST atomically delete its External Contact profile、Contact identity and current bindings while preserving historical snapshots and logical Contact ID values

#### Scenario: External duplicate admissions race in one workspace
- **WHEN** two External Contact admissions concurrently claim the same normalized Email in the same workspace
- **THEN** exactly one Contact identity plus External Contact profile admission MUST commit and the other MUST return a stable conflicting-identity rejection

#### Scenario: External admission shares an Account Email
- **WHEN** an External Contact admission and an Account-backed identity use the same normalized Email
- **THEN** their valid writes MUST be allowed to commit independently without sharing an Email-conflict serialization boundary

#### Scenario: Identity or dependent mutation fails
- **WHEN** Contact identity allocation、External Contact profile persistence、Platform allow-list persistence or required binding cleanup violates an invariant
- **THEN** the complete owning operation MUST roll back and return a transport-neutral domain rejection

#### Scenario: Aggregate is loaded
- **WHEN** Contact identity relationships and current source facts are needed by an application operation
- **THEN** the adapter MUST use explicit eager or explicit batch loading and MUST NOT trigger hidden lazy loads
