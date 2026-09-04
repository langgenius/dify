## Context

`refactor-human-input-im-channel-domain` replaces the old Integration aggregate with an owner-free `IMChannel` and owner-bound persistence adapters. Current Identity and Binding code still uses `integration_id` as its parent, stores Provider on child rows, and encodes default bindings and workspace overrides in one table through `scope + scope_id`.

The Contact redesign provides the relevant pattern: persistence rows keep source and visibility facts, Repository implementations enforce ownership and construct current projections, and Domain values do not reproduce the persistence owner. This change applies that pattern without mechanically splitting Identity into an unnecessary one-to-one profile table.

The new IM Channel, Identity, and Binding schemas are unpublished. The implementation may replace their current ORM and migration definitions directly without dual read/write or data backfill.

## Goals / Non-Goals

**Goals:**

- Use `IMChannelId` as the only Identity and Binding persistence parent.
- Define one current Identity table, one default Binding table, and one workspace-override table.
- Return the same owner-free `IMIdentity` and `IMBinding` values for workspace-owned and deployment-owned Channels.
- Keep normalized query columns, raw Provider payload, target tenant, configuring actor, and Channel ownership out of current Domain values.
- Define one Identity Repository and one Binding Repository Protocol.
- Implement the SQLAlchemy adapters whose constructors bind only caller Session and trusted Channel ID.
- Migrate reachable synchronization, reconciliation, and Contact-facing persistence paths to those adapters.
- Keep transaction ownership with the caller-provided SQLAlchemy `Session`.

**Non-Goals:**

- Do not change synchronization or reconciliation decisions, controller behavior, public DTOs, runtime authorization, inbox, delivery, or historical record contracts.
- Do not modify IM Channel management, Provider adapters, credentials, Webhook ingress, or Channel schema.
- Do not redesign sync runs, reconciliation plans/results, historical snapshots, or Celery payloads.
- Do not add an Organization entity, another parent entity, `scope + scope_id`, a polymorphic binding key, or a workspace/deployment Domain union.
- Do not add database foreign keys or ORM relationships; Human Input v2 continues to use explicit logical references and owner-scoped queries.

## Decisions

### 1. Channel ID is the only Identity namespace

`HumanInputIMIdentity` stores `channel_id` and `provider_user_id`. `UNIQUE(channel_id, provider_user_id)` defines one current Provider user inside one Channel.

The row does not store Provider or Provider tenant identity because the bound Channel already owns both facts. Repeating them on Identity would create drift and require every mutation to maintain redundant equality.

Identity is not split into identity/profile tables. Provider user ID, current profile facts, raw diagnostic payload, and last-seen observation are all written by the same synchronization capability and share the same current-row lifecycle. A one-to-one profile table would add a join without separating ownership or lifecycle.

The schema declares `IMIdentityRawPayload` directly as a frozen, strict `RootModel[dict[str, JsonValue]]`. It does not reuse the existing `_ImmutableJSONObject` base or another raw-payload definition.

Alternative considered: define a Provider-global identity from Provider, Provider tenant ID, and Provider user ID. This would share mutable Provider PII across independently owned Channels and weaken tenant isolation, so it is rejected.

### 2. Default bindings and workspace overrides use different tables

`HumanInputIMBinding` stores the default Contact-to-Identity binding for one Channel. `HumanInputIMBindingWorkspaceOverride` stores a target `tenant_id` and overrides the default binding only for that workspace.

Default uniqueness is:

- `UNIQUE(channel_id, contact_id)`;
- `UNIQUE(channel_id, im_identity_id)`.

Workspace-override uniqueness is:

- `UNIQUE(channel_id, tenant_id, contact_id)`;
- `UNIQUE(channel_id, tenant_id, im_identity_id)`.

Separate tables make both uniqueness boundaries portable across PostgreSQL, MySQL, and SQLite without nullable uniqueness, sentinel tenant IDs, partial indexes, `scope + scope_id`, or a polymorphic key.

Alternative considered: retain one table with a discriminator and nullable tenant ID. Ordinary unique constraints do not serialize duplicate default rows consistently when tenant ID is null, so it is rejected.

### 3. Current Domain values omit persistence context

`IMIdentity` contains current Provider user ID, safe profile fields, last-seen facts, and timestamps. It does not contain Channel ID, Provider, Provider tenant ID, normalized columns, raw payload, owner key, tenant ID, or ORM state.

`IMBinding` contains Binding ID, `IMBindingKind`, Contact ID, Identity ID, and timestamps. `IMBindingKind.DEFAULT` means the default Channel binding. `IMBindingKind.WORKSPACE_OVERRIDE` means the result came from the target workspace override table. It does not describe whether the Channel itself belongs to a workspace or deployment.

`IMIdentityObservation` is the write value accepted from synchronization. It contains Provider user/profile facts, opaque raw payload, sync run ID, and observation time. Repository mapping derives normalized query columns; callers do not provide them.

`OpaqueProviderPayload` is declared directly as a frozen, strict, default-validating `RootModel[dict[str, JsonValue]]`. It is a Domain boundary value, not a serialized-string wrapper. The persistence-only `IMIdentityRawPayload` remains a separate direct `RootModel`; neither type reuses the other.

`IMBindingAssignment` is the write value shared by default create and workspace override set. It carries only Contact ID, Identity ID, and assignment time. The Repository generates a Binding ID when it inserts a row. Updating an existing workspace override preserves the persisted ID and creation timestamp.

### 4. Identity and Binding each use one Repository contract

`IMIdentityRepository` exposes:

- `get/get_by_provider_user_id/list_all/search`;
- `create/update/delete`.

`list_all` remains part of both Repository contracts because reconciliation needs one complete Channel-scoped snapshot. It is not a general cross-Channel query. Identity delete and default Binding delete are idempotent commands that return `None` when the addressed bound-Channel row is absent.

`IMBindingRepository` exposes:

- `get/list_all` for default Bindings;
- `create/replace/delete` for default Bindings;
- `set_workspace_override/reset_workspace_override` for a method-supplied target workspace;
- `get_effective/get_effective_many` for override-first reads in a method-supplied target workspace.

Methods do not accept Channel ID, owner, workspace/deployment discriminator, raw owner key, Provider, or SQLAlchemy `Session`. Binding methods accept `tenant_id` only when selecting a target workspace. Binding mutations accept `bound_by_account_id` only as metadata for that write.

The contract does not expose a default-only Contact lookup. Workspace and runtime callers need the Binding effective for their target tenant and call `get_effective`; default create idempotency and effective fallback may locate the default row by Contact inside the adapter. Keeping that query internal prevents callers from bypassing workspace overrides or supplying an arbitrary tenant merely to inspect default persistence.

Reader/writer and default/override/effective splitting is rejected because all operations share the same Session, Channel predicate, tables, mapping, and concrete implementation. The Channel Repository split is not copied: Identity and Binding have no workspace/deployment adapter variants and no constructor asymmetry between reads and writes.

### 5. Concrete adapters bind trusted context and implement the ports

The production adapters use these constructor shapes:

- `SQLAlchemyIMIdentityRepository(Session, IMChannelId)`;
- `SQLAlchemyIMBindingRepository(Session, IMChannelId)`.

`bound_by_account_id` is not part of Repository identity. Default create/replace and workspace override set receive it as a keyword-only method argument. Automatic synchronization and deployment writes may pass null; an authenticated manual use case supplies its trusted Dify Account ID. Read, delete, reset, and effective-read operations do not receive actor metadata.

Target `tenant_id` is also not constructor state. Workspace override and effective-read methods receive it as the actual child selector for that operation. It does not choose or redefine the Channel owner.

Composition must obtain `IMChannelId` from the correct owner-bound Channel Reader. It must not pass a request-supplied Channel ID directly into these constructors. Workspace/deployment selection ends before Identity or Binding persistence is constructed.

Reachable synchronization, reconciliation, and Contact-facing composition paths are migrated in this change. The temporary rule that forbids production composition of the adapters is removed once their methods are implemented. Durable port boundaries continue to prevent Repository contracts from importing ORM or SQLAlchemy infrastructure.

Every existing-resource query and mutation must compare constructor-bound `channel_id` plus the addressed resource fields. Possession of a globally unique Identity or Binding ID does not authorize cross-Channel access.

`SQLAlchemyIMIdentityRepository` implements every `IMIdentityRepository` method. `SQLAlchemyIMBindingRepository` implements every `IMBindingRepository` method. A production method must execute the specified read or mutation and must not retain `NotImplementedError` placeholders.

Write methods flush their own DML before returning so database constraints and generated persistence state are observed inside the caller's transaction. They do not commit or roll back that transaction.

### 6. Effective Binding lookup is deterministic

For each requested Contact, `IMBindingRepository.get_effective` first selects an override matching constructor-bound `channel_id` plus method-supplied `tenant_id + contact_id`. If none exists, it selects the default Binding matching `channel_id + contact_id`. Otherwise it returns no Binding.

The same Identity may be referenced by a default Binding and workspace overrides because the two tables have independent uniqueness boundaries. The same Identity may also be reused in different target workspaces.

Repository mapping assigns `IMBindingKind` from the table actually read. Callers cannot provide a kind to choose persistence state.

### 7. Stable failures cover only expected persistence conflicts

Identity ports define one root `IMIdentityRepositoryError` with narrow already-exists, not-found, and in-use errors. Binding ports define one root `IMBindingRepositoryError` with conflict and Identity-not-found errors. Both roots derive directly from `Exception`.

Identity delete must reject an Identity still referenced by either current Binding table. Missing Identity and default Binding deletes succeed without returning a deleted value. A default Binding replacement that no longer matches its expected Identity returns no Binding. Binding writes must reject an Identity that is absent or belongs to another Channel. Unexpected mapping, SQLAlchemy, validation, and integrity failures propagate unchanged unless a requirement explicitly classifies the relevant constraint.

### 8. Caller owns transaction boundaries

SQLAlchemy adapters receive a caller-provided `Session`. They query, perform DML, and flush as required by their Repository contracts. They must not create a Session, commit, rollback, begin a nested transaction, acquire an Organization write lock, execute Provider I/O, or dispatch work.

Synchronization and reconciliation may combine the two repositories over the same caller-owned Session and external write guard.

### 9. Production code and capability specs own the final shapes

The original non-importable `domain.py`, `schema.py`, and `repository.py` mirrors contain no interface or schema fact absent from production code and the capability specs. They are removed to avoid a second implementation-shaped source of truth.

Production placement is:

- ORM rows in `api/models/human_input_v2.py`;
- Identity values and ports in `api/repositories/human_input_v2/im_identity_repository.py`;
- Binding values and ports in `api/repositories/human_input_v2/im_binding_repository.py`;
- SQLAlchemy adapters in matching `sqlalchemy_im_*_repository.py` modules.

Core, services, and controllers must not define compatibility copies. Repository contracts must not import ORM rows.

## Risks / Trade-offs

- [Effective reads combine two tables] → Only `IMBindingRepository` owns override-first composition; callers never query both tables directly.
- [Identity and Binding rows retain logical rather than database foreign keys] → Every Repository predicate includes the bound Channel ID, and behavior tests cover cross-Channel IDs and missing Identity endpoints.
- [Binding IDs are generated in two tables] → The Repository generates IDs only when inserting; `IMBindingKind + IMBindingId` is the complete generic persistence identity returned to callers.
- [Old rows can remain after Channel replacement until later migration] → Current reads always bind the current Channel ID, so old rows are immediately unreachable; retention and cleanup remain outside this change.
- [Constraint conflicts differ by database dialect] → Adapters translate only the named endpoint constraints owned by these tables and preserve every unrelated SQLAlchemy or integrity failure.

## Migration Plan

1. Replace the unpublished Identity/Binding ORM schema with the three final tables.
2. Add owner-free values, write values, errors, and the two Repository Protocols.
3. Implement the two SQLAlchemy adapters against the frozen ports.
4. Migrate reachable synchronization, reconciliation, and Contact-facing persistence paths to the implemented adapters and remove obsolete Integration-scoped current Identity and Binding code.
5. Add focused tests for the resulting production boundaries: deployed schema constraints, implemented Repository behavior, and migrated consumer behavior.
6. Validate portability, transaction ownership, and dependency boundaries through database-backed tests and static checks.

Rollback consists of reverting the unpublished ORM/contracts, Repository implementations, and migrated callers together. No data backfill or external rollback protocol is required.

## Follow-up Boundary

This change migrates current Identity and Binding persistence callers but preserves their external behavior and public DTOs. Runtime authorization, inbox and delivery flows, historical models and snapshots, credentials, Provider adapters, Webhook ingress, IM Channel management, and Celery payloads remain unchanged until an explicit follow-up change owns each migration.

## Open Questions

None.
