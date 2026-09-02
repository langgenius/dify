## 1. Freeze Reference Contracts

- [x] 1.1 Review `domain.py`, `schema.py`, and `repository.py` against both capability specs and resolve any field, naming, signature, or lifecycle mismatch before production edits.
- [x] 1.2 Add behavioral contract tests for owner-free `IMIdentity`, `IMIdentityObservation`, `IMBinding`, `IMBindingAssignment`, and `IMBindingKind` values without asserting module or symbol placement.
- [x] 1.3 Add import-linter boundaries that keep Repository contracts independent from ORM models and prevent core, services, and controllers from declaring compatibility copies.

## 2. Replace The Unpublished Identity Schema

- [x] 2.1 Replace `HumanInputIMIdentity.integration_id` and denormalized Provider with non-null logical `channel_id` and `UNIQUE(channel_id, provider_user_id)` in the unpublished migration and ORM.
- [x] 2.2 Make latest sync run ID and observation timestamp non-null for current Identity rows while preserving opaque raw payload and standard timestamps.
- [x] 2.3 Define `IMIdentityRawPayload` directly as the frozen, strict, default-validating JSON-object `RootModel`; do not reuse the existing `_ImmutableJSONObject` base.
- [x] 2.4 Add Channel-prefixed search/last-seen indexes and Repository mapping tests for canonical source/normalized pairs without database pair check constraints.
- [x] 2.5 Add Repository behavior tests for Channel-local Identity uniqueness and cross-Channel Provider-user reuse without asserting ORM or DDL structure.

## 3. Split Default Bindings And Workspace Overrides

- [x] 3.1 Replace the polymorphic `HumanInputIMBinding` schema with default `HumanInputIMBinding` fields `channel_id/contact_id/im_identity_id/bound_by_account_id`.
- [x] 3.2 Add `HumanInputIMBindingWorkspaceOverride` with non-null `channel_id/tenant_id/contact_id/im_identity_id` and optional actor metadata.
- [x] 3.3 Remove `integration_id`, `scope`, `scope_id`, and denormalized Provider from current Binding persistence.
- [x] 3.4 Add portable unique constraints for default Contact/Identity endpoints and target-workspace Contact/Identity endpoints.
- [x] 3.5 Add Repository behavior tests proving same-scope conflicts, cross-kind Identity reuse, cross-workspace Identity reuse, and no partial state after a failed write.

## 4. Add Owner-Free Domain Values

- [x] 4.1 Add current `IMIdentity`, `IMIdentityObservation`, and `IMIdentityPage` values with no persistence owner fields or construction-time validation, and define `OpaqueProviderPayload` directly as a frozen, strict, default-validating JSON-object `RootModel`.
- [x] 4.2 Add `IMBindingKind.DEFAULT/WORKSPACE_OVERRIDE`, current `IMBinding`, and `IMBindingAssignment` values without Channel, target tenant, actor, Provider, scope, or ORM state.
- [x] 4.3 Add mapper examples/tests that produce identical current values from workspace-owned and deployment-owned Channels and derive `IMBindingKind` only from the persisted table read.

## 5. Add Repository Ports

- [x] 5.1 Add one `IMIdentityRepository` Protocol with observation-based create/update and bound-Channel read/search/delete signatures.
- [x] 5.2 Add direct-`Exception` Identity root and narrow already-exists, not-found, and in-use errors.
- [x] 5.3 Add one `IMBindingRepository` Protocol covering default Binding, workspace override, and effective-read operations without owner or infrastructure arguments.
- [x] 5.4 Add direct-`Exception` Binding root and narrow endpoint-conflict, Identity-not-found, and stale-write errors.
- [x] 5.5 Add behavioral test doubles for the two Repository contracts without recreating a combined IM control-plane repository.

## 6. Add SQLAlchemy Adapter Stubs

- [x] 6.1 Add `SQLAlchemyIMIdentityRepository(Session, IMChannelId)` constructor and method stubs without persistence SQL.
- [x] 6.2 Add `SQLAlchemyIMBindingRepository(Session, IMChannelId)` constructor and default/override/effective method stubs without persistence SQL.
- [x] 6.3 Keep target `TenantId` and optional `bound_by_account_id` as method arguments only; prove one Binding Repository instance supports different operation values without reconstruction.
- [x] 6.4 Add import/composition guards proving stubs receive trusted Channel IDs only after owner-bound Channel reads and are not wired into production callers before their SQL behavior is implemented.
- [x] 6.5 Document in each stub that the caller owns Session transaction, external locking, Provider I/O ordering, commit, rollback, and task dispatch.

## 7. Verify Scope And Follow-up Boundary

- [x] 7.1 Run focused Domain, Repository behavior, and import-boundary tests through `uv run --project api`.
- [x] 7.2 Run backend formatter, lint, and type checks for the changed models and Repository contracts.
- [x] 7.3 Search this change for Organization entities, another parent abstraction, `integration_id`, `scope`, `scope_id`, duplicated Provider fields, raw owner keys, and workspace/deployment Domain unions; none may remain except explicit removal/history statements in artifacts.
- [x] 7.4 Confirm synchronization, reconciliation, Contact-facing reads, controllers, runtime authorization, historical models, and Celery payloads remain unchanged and list their migrations as follow-up changes.
- [x] 7.5 Run `openspec validate refactor-human-input-im-identity-binding-domain --strict` and resolve every validation error.
