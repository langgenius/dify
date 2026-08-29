## Context

`human_input_contacts` currently acts as both the shared Contact identity anchor and a mutable profile projection. Account-backed rows copy `Account.name` and `Account.email`; workspace-owned External rows store their own profile in the same columns. `identity_source` also distinguishes EE Organization Account、CE/SaaS workspace membership and External lifecycle ownership. This shape gives workflow、grant、OTP、binding and sync tables one UUID `contact_id`, but it requires Account/member initialization、profile write-through and periodic reconciliation to keep copied data current.

The current business model treats a Dify Account as one Contact identity. Membership and Platform allow-list rows determine whether that identity currently resolves as Workspace、Platform or Absent in each workspace. External Contact remains a workspace-owned identity with mutable profile data and hard-delete/recreate semantics.

The Contact API and every durable consumer already depend on UUID `ContactId`. This change must preserve those identifiers and keep Account/External persistence details below the Contact Directory boundary.

## Goals / Non-Goals

**Goals:**

- Keep `human_input_contacts` as a thin, immutable UUID identity map used by every downstream `contact_id` reference.
- Move mutable Account-backed profile reads to `Account` and mutable External profile fields to a dedicated workspace-owned model.
- Replace the three persistence sources `ORGANIZATION_ACCOUNT / WORKSPACE_MEMBER / EXTERNAL` with the two subject kinds `ACCOUNT / EXTERNAL`; keep `WORKSPACE / PLATFORM / EXTERNAL / ABSENT` as query results.
- Preserve one global Account-backed Contact ID across profile changes、disable/reactivate、workspace membership changes and EE Workspace/Platform transitions.
- Keep UUID Contact IDs and existing referencing-column shapes unchanged in the first released schema.
- Reduce initialization and repair to missing identity mappings; eliminate Account profile drift reconciliation.

**Non-Goals:**

- Do not change Console Contact request/response fields、workflow recipient schema、form grant schema or IM API semantics.
- Do not encode subject type into Contact ID or expose identity-map discriminator values to frontend clients.
- Do not merge External Contact with Account-backed Contact when their normalized Emails overlap.
- Do not add IM bindings to External Contact.
- Do not change frozen historical snapshots into current profile lookups.
- Do not define legacy Contact-row migration、compatibility columns、dual-read/write rollout or rollback rehydration; the affected Contact implementation has not shipped.
- Do not define first-time identity provisioning for pre-existing Accounts; that rollout concern remains owned outside this schema change.

## Decisions

### 1. Retain `human_input_contacts` as the unified identity anchor

The existing table remains the single target of every logical `contact_id` reference, but its row stores only immutable subject facts. Conceptually the contracted shape is:

```text
HumanInputContactIdentity
  id: ContactId
  subject_kind: ACCOUNT | EXTERNAL
  account_id: AccountId | null
  created_at
```

`ACCOUNT` requires a globally unique `account_id`. Membership、Platform visibility、IM binding scope、form ownership and authorization already carry their workspace/Organization context; identity allocation must not copy that scope. Possession of a Contact ID never grants access, so every read and mutation still applies complete workspace/Organization owner predicates.

`EXTERNAL` forbids `account_id` and obtains workspace ownership plus mutable fields through a one-to-one External profile row keyed by the same Contact ID. External deletion removes both rows and current bindings in one transaction. Historical grants、OTP rows and audit records keep their logical Contact ID and frozen snapshots without requiring a live identity row.

An alternative is to allocate one Account Contact per Tenant/Organization. That duplicates `TenantAccountJoin` and Platform visibility facts、reintroduces membership-driven identity provisioning and does not enforce authorization; it is rejected. Replacing Contact ID with Account ID or a type-encoded opaque string is also rejected because it spreads a polymorphic reference across grants、OTP、bindings、sync history and workflow configuration.

### 2. Profile facts remain with their authoritative source

Account-backed current projections read name、Email、avatar、status and timestamps from `Account`; Contact writes never copy these fields. External Contact profile owns name、normalized name、Email、normalized Email and avatar because no other source owns them.

Contact list、detail、recipient resolution、submission authorization and IM matching join identity rows to current source facts under their existing tenant/Organization predicates. Query repositories may use source-owned normalization expressions and indexes, but they must not restore normalized Account copies on the identity map. Query parity tests continue to compare repository results with the pure workspace-resolution policy.

An alternative is to retain copied normalized Account fields only for search performance. That recreates profile write-through and drift repair, so it is rejected. Source-owned indexes or measured query-specific optimization must address performance instead.

### 3. Workspace resolution never changes identity state

The canonical resolution input becomes:

```text
Contact identity
+ current Account or External profile
+ current Account status
+ current workspace membership
+ current Platform allow-list entry
```

Resolution applies these rules in order:

- a current owning-workspace External profile resolves as `EXTERNAL`;
- an active Account with current workspace membership resolves as `WORKSPACE`;
- an active EE Account with a current Platform allow-list entry resolves as `PLATFORM`;
- every other state resolves as `ABSENT`.

Account profile update、disable/reactivate、membership removal/re-addition and Platform add/remove do not update the identity row. Reads remain side-effect free.

### 4. All durable consumers keep UUID `contact_id`

Platform allow-list、IM bindings、sync results、reconciliation history、form grants、OTP challenges and workflow recipient specifications retain their existing Contact UUID. Their Contact relationship targets the identity map, not a profile row. Repositories that need current data call the Contact Directory projection or explicitly batch-load identity plus source facts; ORM relationships must not synthesize a polymorphic Account/External profile object.

Historical tables keep their captured snapshots. External deletion and Account unavailability do not delete historical rows. Current authorization resolves the stored Contact ID against current source facts and rejects a missing、disabled or workspace-unavailable subject.

An alternative is to replace source-specific references with `account_id` and generic references with encoded strings. That makes every consumer understand Contact source layout and is rejected as information leakage.

### 5. Lifecycle writes become identity allocation and source-owned mutation

The Contact Directory exposes an idempotent Account identity ensure operation keyed only by `account_id`. First ensure allocates one UUID; later ensures return it. Account profile、membership and Platform visibility writes do not mutate the Contact identity.

External create atomically inserts one identity row and one profile row. External update changes only its profile. External delete removes the profile、identity and current bindings. A later create with the same Email allocates a new identity.

Periodic repair scans only Accounts missing identity mappings and invalid current External identity/profile shapes. It does not compare or rewrite Account profile values. Foreground ensure and repair use the same allocation primitive.

### 6. Identity uniqueness is enforced by the subject key

Account mapping uniqueness is global `UNIQUE(account_id)`. Concurrent ensure operations attempt the same subject key; one insert commits and a unique-conflict retry loads the committed Contact ID. Tenant and `DifySetup` owner locks are not part of Account identity allocation.

External Email uniqueness remains `(tenant_id, normalized_email)` on current External profiles. It does not share a uniqueness or lock boundary with Account Email. Identity-plus-profile creation and profile deletion plus binding cleanup execute in one explicit transaction.

### 7. Define the unreleased schema directly

The implementation must edit the existing unreleased Contact ORM models and schema revision so the first shipped shape already contains the thin identity map and External profile table. It must not add compatibility columns、copy legacy Contact rows、rewrite downstream Contact IDs or introduce expand/contract phases for an implementation that has never reached production.

### 8. Existing projection lifecycle changes are superseded before implementation

`initialize-human-input-contact-projection` must target one identity mapping per Account without migrating an earlier Contact representation. `implement-contact-projection-lifecycle-maintenance` must remove Account profile write-through、membership-driven identity mutation and profile-drift repair; it retains global identity ensure、missing-map repair、current availability and required binding cleanup. Production gates remain closed until their revised contracts and this schema are compatible.

## Risks / Trade-offs

- [Account-backed list/search loses copied normalized indexes] → Query source-owned Account fields, retain parity tests, inspect query plans, and add Account-owned or expression indexes only where measured.
- [Identity mapping is missing after a bypass Account write] → Use idempotent foreground ensure plus bounded missing-map repair; do not repair profile data.
- [A global Contact ID is presented in another workspace] → Treat identifiers as non-authorizing references and require complete membership、Platform entry or External owner predicates on every current read and mutation.
- [Repository code bypasses the unified Contact projection] → Add import/call-graph tests and focused authorization/query parity coverage for every Contact consumer.
- [Active OpenSpec changes reintroduce stale semantics] → Revise or supersede their artifacts before implementation and validate the combined dependency graph.

## Delivery Plan

1. Update the unreleased Contact schema and ORM models directly to the final identity-map plus External-profile shape.
2. Switch domain objects、repositories and current queries to identity-plus-source facts without adding legacy compatibility paths.
3. Connect Account creation/ensure to global identity allocation and keep Account profile、membership and Platform visibility operations independent from Contact identity writes.
4. Revise the dependent initialization and lifecycle-maintenance changes、run focused unit/type/lint checks and CI-owned database integration，then enable the production gate.

## Open Questions

None.
