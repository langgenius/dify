## 1. Freeze The Replacement Contracts

- [x] 1.1 Inventory every production import of the old Contact packages and every direct `HumanInputContact` read/write; classify each path as current Contact query、Contact lifecycle write、IM binding query、current authorization or historical snapshot read.
- [ ] 1.2 Add failing architecture tests that require tenant-scoped consumers to depend on `ContactRepository`、EE candidate/Platform consumers to depend on `EnterpriseContactRepository` and binding readers to depend on `ContactIMBindingRepository`; forbid direct source-table composition outside the unified SQLAlchemy Contact implementation.
- [x] 1.3 Add failing contract tests for `ContactQuery`、`Contact`、`ExternalContact`、the `CandidateId = ContactId` round-trip、`OrganizationCandidate`、batch omission/deduplication、availability mapping、Email multi-match、candidate pagination and membership-over-Platform precedence.
- [x] 1.4 Remove the legacy `contact-directory-governance` requirements, migrate current Contact behavior to the Contact Repository capability, and retain cross-tenant Platform candidate search in EE capabilities.

## 2. Define The Final Unreleased Schema

- [x] 2.1 Rewrite the unreleased Contact ORM and schema revision to create `HumanInputContactIdentity`、`HumanInputExternalContactProfile`、`human_input_contact_identities` and `human_input_external_contact_profiles` directly.
- [ ] 2.2 Add schema tests for valid `ContactSubjectType.ACCOUNT / ContactSubjectType.EXTERNAL` shapes、global `UNIQUE(account_id)`、one-to-one External profile ownership and `UNIQUE(tenant_id, normalized_email)`.
- [x] 2.3 Retarget existing logical `contact_id` relationships, including Platform entries、IM bindings、grant、OTP、sync and reconciliation records, to `HumanInputContactIdentity.id` without changing UUID column shapes.
- [x] 2.4 Remove mutable profile columns and obsolete `ORGANIZATION_ACCOUNT / WORKSPACE_MEMBER` persistence values without compatibility columns、data-copy code or an additional migration revision.

## 3. Add Contact Values And Repository Ports

- [x] 3.1 Define `ContactType` with only `WORKSPACE / PLATFORM / EXTERNAL` and add immutable `Contact`、`ExternalContact`、`ContactQuery` and `Page` values.
- [x] 3.2 Define `ContactRepository` with count/list/detail/batch/availability/Email query、Account provisioning and External save/delete methods matching `domain.py`.
- [x] 3.3 Define `EnterpriseContactRepository` with candidate count/list、`CandidateId` create and `ContactId` delete methods, and keep the Protocol unavailable to CE/SaaS/core consumers.
- [x] 3.4 Define `ContactIMBindingRepository.get_im_bindings` as the Contact-facing binding query port while leaving binding mutations on the existing IM control-plane contract.
- [x] 3.5 Implement one `SQLAlchemyContactRepository` that satisfies both core and enterprise Protocols, receives a caller-provided `Session`, shares mapping/query helpers, may flush, and never creates a Session、commits、rolls back or introduces another Unit of Work abstraction.

## 4. Implement Current Contact Queries And Lifecycle Writes

- [x] 4.1 Implement one reusable query builder that joins Contact identity to current Account or External profile facts and applies Account active status、tenant ownership、membership and Platform entry predicates.
- [x] 4.2 Implement `count_contact` and `list_contact` with identical `ContactQuery` filtering before count/pagination and add keyword、type、page-boundary and query-plan tests.
- [x] 4.3 Implement detail、batch and availability queries with tenant isolation、missing/unavailable omission、duplicate-ID deduplication and unspecified-order contract tests.
- [x] 4.4 Implement Email batch matching that reads Account Email and External normalized Email from their owners and returns both Contacts when one Email matches both identities.
- [x] 4.5 Implement idempotent Account-backed Contact provisioning with global uniqueness、concurrent conflict translation and same-ID retry coverage.
- [x] 4.6 Implement External save as atomic identity/profile create or profile-only update, preserving workspace-local External uniqueness and Account/External same-email coexistence.
- [x] 4.7 Implement External delete with complete tenant predicates、profile/identity atomicity、new-ID recreation behavior and unchanged historical references.
- [x] 4.8 Implement Enterprise candidate count/list with shared keyword predicates、pagination and `CandidateId = ContactId` without encryption/signing/token encoding; implement Platform create by revalidating that candidate Contact ID and delete by `ContactId` while persisting the stable `(tenant_id, contact_id)` entry.
- [x] 4.9 Implement `ContactIMBindingRepository` using explicit batch queries without adding bindings to `Contact` or triggering hidden lazy loads.

## 5. Migrate Existing Consumers

- [x] 5.1 Rewrite Console Contact list、detail、batch、options and External management services to compose `ContactRepository` results and optional `ContactIMBindingRepository` results; route EE candidate and Platform management through `EnterpriseContactRepository`.
- [ ] 5.2 Rewrite recipient-resolution application orchestration to batch-load current Contacts through `ContactRepository` and bindings through `ContactIMBindingRepository`, pass immutable values to the pure resolver, remove snapshot/policy inputs and preserve deterministic approval-plan behavior.
- [ ] 5.4 Rewrite IM synchronization so that one caller-owned transaction and injected Session load every current `WORKSPACE` and `PLATFORM` Contact plus current IM facts、generate the in-memory plan、apply all mutations、persist sync results/reconciliation changes and update run status; add rollback coverage proving no step commits independently.
- [ ] 5.5 Rewrite binding detail and delivery-capability reads to use `ContactIMBindingRepository` without changing IM control-plane mutation ownership.
- [x] 5.6 Remove ORM relationships and helper mappers that assume Contact identity owns mutable profile fields.
- [x] 5.7 Keep EE Platform candidate search outside `ContactRepository`; pass selected `CandidateId` values to Enterprise create and current Platform `ContactId` values to Enterprise delete.

## 6. Replace Lifecycle Hooks And Delete The Old Implementation

- [x] 6.1 Connect authoritative Account creation and bounded missing-identity repair to `provision_account_backed_contact`; remove profile write-through and profile-drift repair.
- [x] 6.2 Keep Account profile、disable/reactivate、membership and Platform operations independent from identity mutation while making current Repository reads reflect committed source facts immediately.
- [x] 6.3 Ensure core and enterprise Contact ports resolve to the same `SQLAlchemyContactRepository` instance or class implementation, bind all participating repositories to the same Session and use one caller-owned `session.begin()` transaction; add complete rollback tests.
- [x] 6.4 Delete `api/core/human_input_v2/contact_directory` and `api/repositories/human_input_v2/contact_directory`, including old values、errors、snapshot、policy、ports、mappers and aggregate adapter.
- [x] 6.5 Remove remaining production imports、comments、exceptions and branches that reference `ContactDirectoryPolicy`、`ContactDirectorySnapshot`、`ContactResolution`、`ABSENT` or old identity-source values.

## 7. Verification

- [ ] 7.1 Run focused non-container backend unit suites through `uv run --project api`, including schema、Repository、recipient、authorization、IM matching and architecture coverage.
- [x] 7.2 Run backend formatter、lint and type checks for every changed module.
- [x] 7.3 Run CI-owned PostgreSQL/MySQL tests for Account provisioning concurrency、External uniqueness races、IM reconciliation transaction atomicity、Session rollback、query parity and tenant isolation.
- [x] 7.4 Run `openspec validate separate-human-input-contact-identity-from-profile --strict` and validate every revised dependent change.
- [x] 7.5 Search production code and this change for stale active references to the removed packages、snapshot、policy、resolution enum or mutable Account profile projection before enabling Contact/IM rollout gates.
