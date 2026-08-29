## Why

`HumanInputContact` currently combines a stable identifier, lifecycle ownership, mutable Account profile projection, workspace-owned External Contact data, and workspace-relative availability inputs. This forces Account profile writes, initialization, and periodic repair to maintain a duplicate Contact projection even though downstream workflows, grants, OTP proofs, IM bindings, and sync history only require one stable `ContactId` anchor.

## What Changes

- Define the unreleased `HumanInputContact` persistence model as a thin Contact identity map plus a workspace-owned External Contact profile model.
- Keep one stable, opaque UUID `ContactId` for every Contact and preserve existing `contact_id` fields in workflow configuration, form grants, OTP proofs, IM bindings, sync results, reconciliation history, Platform allow-list entries, and Console APIs.
- Represent each Account with one global immutable Contact identity mapping. Account name、Email、avatar and status remain owned by `Account`; workspace membership and Platform visibility remain owned by `TenantAccountJoin` and Platform allow-list records.
- Treat membership removal as a workspace-availability change rather than Contact identity deletion. The same Account keeps one Contact ID across workspace membership and Platform visibility changes.
- Store External Contact name、normalized name、Email、normalized Email、avatar and workspace ownership only in the External Contact profile model. Deleting an External Contact atomically removes its profile、identity and current bindings; recreating the address allocates a new Contact ID.
- Keep `WORKSPACE`, `PLATFORM`, `EXTERNAL`, and `ABSENT` as workspace-relative query results. They are not identity-map discriminator values.
- Limit ongoing lifecycle work to Account/member creation-time identity allocation and bounded repair of missing identity mappings; Account profile reconciliation is forbidden.
- Supersede the stale CE/SaaS removal/rejoin and mutable profile-projection requirements in `initialize-human-input-contact-projection` and `implement-contact-projection-lifecycle-maintenance` before those changes are implemented.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `contact-directory-governance`: Make Account-backed Contact identity global and stable across workspace membership/visibility changes、retain current availability checks and reduce lifecycle maintenance to identity allocation and missing-map repair.
- `human-input-v2-contact-directory-core`: Separate the immutable Contact identity map from Account-owned and External-owned profile facts while preserving one unified Contact ID boundary and existing downstream references.

## Impact

- Persistence: update the unreleased `human_input_contacts` schema directly、add the External Contact profile relation and keep UUID Contact IDs plus all referencing columns.
- Domain and repositories: replace `ORGANIZATION_ACCOUNT / WORKSPACE_MEMBER / EXTERNAL` profile entities with identity-map subjects plus source-owned current projections; centralize workspace-scoped current resolution.
- Account/member lifecycle: allocate one identity per Account and remove Contact writes from Account profile updates、disable/reactivate、membership add/remove and Platform visibility changes.
- Contact management: continue External CRUD and Platform allow-list commands through the unified Contact ID boundary while loading mutable fields from their source owners.
- Runtime and IM: keep workflow, grant, OTP, binding, sync-result, and reconciliation schemas on UUID `contact_id`; update query paths that currently join copied Contact profile fields.
- Operations: remove Contact profile-drift reconciliation; initial identity provisioning for pre-existing Accounts remains owned outside this schema change.
- OpenSpec dependencies: revise or supersede the unimplemented `initialize-human-input-contact-projection` and `implement-contact-projection-lifecycle-maintenance` artifacts so they do not reintroduce mutable Account profile projection or CE/SaaS Contact reincarnation.
