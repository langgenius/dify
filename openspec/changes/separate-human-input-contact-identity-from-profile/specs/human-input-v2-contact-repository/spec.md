## ADDED Requirements

### Requirement: Contact identity persistence MUST separate immutable subject mapping from mutable profile facts
系统 MUST 使用 `HumanInputContactIdentity` 保存 immutable Contact ID 与 `ContactSubjectType`。`ContactSubjectType.ACCOUNT` MUST reference exactly one globally unique Account；`ContactSubjectType.EXTERNAL` MUST have no `account_id`。Account profile、membership、Platform visibility 与 authorization state MUST NOT 存入 identity row。External Contact 的 tenant ownership、name、normalized name、Email、normalized Email 与 avatar MUST 只存入以相同 `contact_id` 为主键的 `HumanInputExternalContactProfile`。

#### Scenario: Account-backed identity 被 provision
- **WHEN** `provision_account_backed_contact(account_id)` first runs for one Account
- **THEN** persistence MUST allocate one Contact ID and map it to that Account

#### Scenario: Account-backed identity 被并发 provision
- **WHEN** concurrent calls provision the same Account
- **THEN** global `UNIQUE(account_id)` MUST allow one mapping and every successful retry MUST return the same Contact ID

#### Scenario: Identity 接收 mutable profile
- **WHEN** a caller attempts to persist name、Email、avatar、membership or Platform visibility on `HumanInputContactIdentity`
- **THEN** the persistence model MUST reject or make that shape unrepresentable

#### Scenario: External Contact 被创建
- **WHEN** `save_external_contact` creates a new External Contact
- **THEN** one External identity and one owning-tenant `HumanInputExternalContactProfile` with the same Contact ID MUST be inserted atomically

### Requirement: ContactRepository MUST return only current tenant-visible Contacts
`ContactRepository` MUST return `Contact` values whose `type` is exactly `WORKSPACE`、`PLATFORM` or `EXTERNAL`。An owning-tenant External profile MUST produce `EXTERNAL`。An active Account with current membership MUST produce `WORKSPACE`。An active Account without membership but with a current Platform entry MUST produce `PLATFORM`。Membership MUST take precedence when both membership and Platform entry exist。Inactive Accounts、Account identities with neither fact、foreign-tenant External profiles and missing identities MUST produce no current Contact。

#### Scenario: Membership 决定 WORKSPACE type
- **WHEN** an active Account has a current `TenantAccountJoin` in the requested tenant
- **THEN** Repository queries MUST return one Contact with `ContactType.WORKSPACE`

#### Scenario: Platform entry 决定 PLATFORM type
- **WHEN** an active Account has no current membership but has a `HumanInputPlatformContactWorkspaceEntry` in the requested tenant
- **THEN** Repository queries MUST return one Contact with `ContactType.PLATFORM`

#### Scenario: Membership 覆盖 Platform entry
- **WHEN** an active Account has both current membership and a Platform entry in the requested tenant
- **THEN** Repository queries MUST return one Contact with `ContactType.WORKSPACE`

#### Scenario: Account-backed identity 当前不可用
- **WHEN** an Account is inactive or has neither current membership nor a Platform entry in the requested tenant
- **THEN** list and batch queries MUST omit it，detail MUST return `None`，and `available` MUST return false

#### Scenario: External profile 仅在 owning tenant 可见
- **WHEN** an External Contact is queried in its owning tenant
- **THEN** Repository queries MUST return `ContactType.EXTERNAL`
- **AND** the same identity MUST produce no Contact in another tenant

### Requirement: ContactRepository query methods MUST share visibility and filter semantics
`count_contact` and `list_contact` MUST accept the same optional `ContactQuery` and MUST apply identical tenant visibility、keyword and `ContactType` predicates before count and pagination。`get_contacts_by_ids` MUST omit missing or unavailable Contacts、deduplicate repeated Contact IDs and MUST NOT promise result order。`available` MUST return one boolean for each distinct requested Contact ID。`query_contacts_by_email` MUST return all current Contacts matching requested Emails and MUST allow one Email to return both Account-backed and External Contacts。

#### Scenario: Filtered count 与 list 使用同一 predicates
- **WHEN** callers pass the same `ContactQuery` to `count_contact` and `list_contact`
- **THEN** count MUST equal the total number of Contacts eligible for that filtered list before pagination

#### Scenario: Batch query 包含 unavailable ID
- **WHEN** `get_contacts_by_ids` receives visible、unavailable、missing and repeated Contact IDs
- **THEN** it MUST return each visible Contact at most once，omit all unavailable or missing Contacts，and MAY return them in any order

#### Scenario: Availability batch 被查询
- **WHEN** `available` receives Contact IDs in one tenant
- **THEN** it MUST map every distinct requested ID to true only when `get_contacts_by_id` would return a current Contact in that tenant

#### Scenario: Account 与 External 共享 Email
- **WHEN** one normalized Email matches both a current Account-backed Contact and a current External Contact
- **THEN** `query_contacts_by_email` MUST return both Contacts without merging either identity

### Requirement: ContactRepository MUST own core Contact identity and profile lifecycle writes
`ContactRepository` MUST expose idempotent Account-backed identity provisioning and External Contact save/delete。`save_external_contact` and `delete_external_contact` MUST accept `ExternalContact` rather than current `Contact`。Account profile、membership and Platform entry changes MUST NOT mutate the Account-backed identity。

#### Scenario: External profile 被更新
- **WHEN** `save_external_contact` receives an existing External Contact owned by the tenant
- **THEN** it MUST update only `HumanInputExternalContactProfile` mutable fields and MUST retain the Contact ID

#### Scenario: Duplicate External Email 被并发创建
- **WHEN** two transactions create External Contacts with the same normalized Email in one tenant
- **THEN** exactly one MUST commit and the other MUST receive a stable conflict result

#### Scenario: External 与 Account 共享 Email
- **WHEN** an External Contact uses an Email already owned by an Account-backed Contact
- **THEN** the External save MUST succeed if no other External profile in the tenant owns that normalized Email

#### Scenario: External Contact 被删除并重建
- **WHEN** `delete_external_contact` removes an External Contact and a later save reuses the Email
- **THEN** the delete MUST remove the profile and External identity，and the later save MUST allocate a new Contact ID

### Requirement: EnterpriseContactRepository MUST expose only EE Contact capabilities
`EnterpriseContactRepository` MUST expose paginated Organization candidate list/count and Platform entry create/delete operations。`list_organization_candidates` and `count_organization_candidates` MUST apply the same keyword predicate。This implementation MUST define `CandidateId = ContactId` and return the candidate's Contact ID directly；it MUST NOT require encryption、signing、a separate token or another encoded identifier。Opaque means callers pass the identifier back without deriving Account ID、tenant ownership or authorization from it。`create_platform_entry` MUST accept `CandidateId`，while `delete_platform_entry` MUST accept the current Platform Contact's `ContactId`。

#### Scenario: Organization candidates 被分页查询
- **WHEN** an EE application passes the same keyword to candidate count and list methods
- **THEN** count MUST equal the complete matching candidate set before pagination and list MUST return the requested page

#### Scenario: Candidate identifier 被返回
- **WHEN** `list_organization_candidates` returns one candidate
- **THEN** it MUST expose that candidate's Contact ID as `CandidateId` without encryption、signing or separate token generation
- **AND** the caller MUST be able to pass that value unchanged to `create_platform_entry`

#### Scenario: Platform entry 被创建
- **WHEN** `create_platform_entry` receives a tenant、candidate ID and adding Account ID
- **THEN** it MUST interpret the `CandidateId` as Contact ID、revalidate the EE Organization candidate predicates and persist one tenant-scoped `(tenant_id, contact_id)` entry without creating a Platform-specific identity

#### Scenario: Platform entry 被删除
- **WHEN** `delete_platform_entry` receives a tenant and current Platform Contact ID
- **THEN** it MUST delete only that tenant's Platform entry and MUST NOT delete or mutate the Account-backed Contact identity

#### Scenario: Core caller receives ContactRepository
- **WHEN** a CE、SaaS or tenant-scoped core application operation is composed
- **THEN** it MUST depend on `ContactRepository` and MUST NOT require `EnterpriseContactRepository`

### Requirement: Contact and Enterprise ports MUST share one SQLAlchemy implementation
One concrete `SQLAlchemyContactRepository` MUST implement both `ContactRepository` and `EnterpriseContactRepository`。The implementation MUST share Contact identity mapping、Account/profile mapping、Platform persistence、owner predicates、query helpers and one injected Session across both Protocol surfaces。The codebase MUST NOT maintain separate core and enterprise SQLAlchemy Contact implementations。

#### Scenario: Core and EE ports are composed together
- **WHEN** one EE application operation needs both Protocols
- **THEN** composition MAY inject the same `SQLAlchemyContactRepository` instance for both port types

#### Scenario: Query rules are changed
- **WHEN** Account/profile mapping or Platform visibility logic changes
- **THEN** one shared concrete implementation and parity tests MUST cover both Protocol surfaces without duplicated SQL logic

### Requirement: Contact-facing IM binding reads MUST use ContactIMBindingRepository
Contact query and delivery consumers that need IM bindings MUST call `ContactIMBindingRepository.get_im_bindings` with tenant and Contact IDs。`ContactRepository` MUST NOT embed IM bindings in `Contact` or load them implicitly。IM binding create、update and delete MUST remain owned by the existing IM control-plane persistence contract。

#### Scenario: Contact detail 需要 IM bindings
- **WHEN** a Contact detail application operation needs current IM binding data
- **THEN** it MUST batch-load Contacts through `ContactRepository` and bindings through `ContactIMBindingRepository` before composing the response

#### Scenario: Contact list 不需要 IM bindings
- **WHEN** a Contact list operation only needs `Contact` fields
- **THEN** `ContactRepository` MUST return Contacts without loading IM binding rows

### Requirement: SQLAlchemy Session MUST be the repository transaction boundary
SQLAlchemy implementations of `ContactRepository`、`EnterpriseContactRepository` and `ContactIMBindingRepository` MUST receive a caller-provided `Session`。Repository methods MUST NOT create another Session、commit、rollback or introduce another Unit of Work abstraction。Application operations that require atomic writes across repositories MUST bind them to the same Session and own one surrounding `session.begin()` transaction。

#### Scenario: Two repositories participate in one transaction
- **WHEN** an application operation writes through two Repository instances
- **THEN** both MUST use the same Session and any failure MUST roll back the complete `session.begin()` transaction

#### Scenario: Repository write succeeds locally
- **WHEN** a Repository method flushes a valid write
- **THEN** it MUST leave commit ownership with the caller

#### Scenario: IM reconciliation plans and applies in one transaction
- **WHEN** synchronization has obtained one provider directory result and starts database reconciliation
- **THEN** one caller-owned `session.begin()` transaction MUST load all current Contact and IM facts、generate the in-memory reconciliation plan、apply every mutation、persist sync results and reconciliation changes、and update the sync run status
- **AND** every participating Repository MUST use the same injected Session until the complete transaction commits or rolls back

### Requirement: Current Contact consumers MUST NOT depend on removed implementation or Contact ORM layout
Console Contact、IM matching and lifecycle code MUST obtain current Contact facts through `ContactRepository` and optionally `ContactIMBindingRepository`。EE candidate and Platform mutation code MUST use `EnterpriseContactRepository`。Only the unified SQLAlchemy Contact implementation MAY combine `HumanInputContactIdentity`、`Account`、`TenantAccountJoin`、`HumanInputPlatformContactWorkspaceEntry` and `HumanInputExternalContactProfile` into Contact values or candidates。Historical readers MAY continue reading their own frozen snapshot columns without current Contact lookup。

#### Scenario: IM reconciliation loads matching candidates
- **WHEN** IM synchronization prepares Email reconciliation for one tenant
- **THEN** it MUST load every current `WORKSPACE` and `PLATFORM` Contact through paginated `ContactRepository.list_contact` queries
- **AND** the pure reconciler MUST match provider identities against that complete in-memory Contact set rather than issuing per-Email Repository queries

#### Scenario: Removed packages are imported
- **WHEN** architecture tests scan production modules after migration
- **THEN** no production module MUST import the removed domain or SQLAlchemy adapter packages
