## 1. Retire Reference Scaffolding

- [ ] 1.1 Verify that `domain.py`, `schema.py`, and `repository.py` contain no contract absent from production code or the capability specs, then delete the three mirrors and remove their remaining references.
- [ ] 1.2 Restore the durable IM Channel service and Identity/Binding port import boundaries; keep the temporary no-composition guard removed.

## 2. Replace The Unpublished Identity Schema

- [x] 2.1 Replace `HumanInputIMIdentity.integration_id` and denormalized Provider with non-null logical `channel_id` and `UNIQUE(channel_id, provider_user_id)` in the unpublished migration and ORM.
- [x] 2.2 Make latest sync run ID and observation timestamp non-null for current Identity rows while preserving opaque raw payload and standard timestamps.
- [x] 2.3 Define `IMIdentityRawPayload` directly as the frozen, strict, default-validating JSON-object `RootModel`; do not reuse the existing `_ImmutableJSONObject` base.
- [ ] 2.4 Remove the unused Channel/last-seen-run index and retain only Channel-prefixed search indexes.

## 3. Split Default Bindings And Workspace Overrides

- [x] 3.1 Replace the polymorphic `HumanInputIMBinding` schema with default `HumanInputIMBinding` fields `channel_id/contact_id/im_identity_id/bound_by_account_id`.
- [x] 3.2 Add `HumanInputIMBindingWorkspaceOverride` with non-null `channel_id/tenant_id/contact_id/im_identity_id` and optional actor metadata.
- [x] 3.3 Remove `integration_id`, `scope`, `scope_id`, and denormalized Provider from current Binding persistence.
- [x] 3.4 Add portable unique constraints for default Contact/Identity endpoints and target-workspace Contact/Identity endpoints.
- [ ] 3.5 Remove `hiimb_contact_idx` and `hiimb_identity_idx` from the ORM and unpublished migration; all allowed default-Binding queries must use the Channel-prefixed unique indexes.

## 4. Add Owner-Free Domain Values

- [x] 4.1 Add current `IMIdentity`, `IMIdentityObservation`, and `IMIdentityPage` values with no persistence owner fields or construction-time validation, and define `OpaqueProviderPayload` directly as a frozen, strict, default-validating JSON-object `RootModel`.
- [ ] 4.2 Keep `IMBindingKind.DEFAULT/WORKSPACE_OVERRIDE`, `IMBinding`, and `IMBindingAssignment` owner-free, and remove caller-supplied `new_binding_id` from `IMBindingAssignment`.

## 5. Refine Repository Ports

- [ ] 5.1 Retain `IMIdentityRepository.list_all` for reconciliation and make Identity delete an idempotent `None`-returning command.
- [x] 5.2 Keep the direct-`Exception` Identity root and narrow already-exists, update-not-found, and in-use errors.
- [ ] 5.3 Retain `IMBindingRepository.list_all` for reconciliation, make default delete idempotent, and return no Binding when exact replace no longer matches current state.
- [ ] 5.4 Remove `StaleIMBindingWriteError`; keep only the direct-`Exception` Binding root, endpoint-conflict error, and Identity-not-found error.

## 6. Implement SQLAlchemy Adapters

- [ ] 6.1 Implement `SQLAlchemyIMIdentityRepository.get/get_by_provider_user_id/list_all/search` with constructor-bound Channel predicates and owner-free mapping.
- [ ] 6.2 Implement Identity observation create/update, duplicate and update-not-found error translation, in-use delete protection, idempotent missing delete, and flush-before-return behavior.
- [ ] 6.3 Implement default Binding `get/list_all/create/replace/delete`; generate IDs on insert, preserve idempotent create, return no Binding for stale replace, and make delete idempotent.
- [ ] 6.4 Implement workspace `set/reset` and override-first `get_effective/get_effective_many`; generate IDs only on insert and preserve an existing override's ID and creation timestamp.
- [ ] 6.5 Keep target `TenantId` and optional `bound_by_account_id` as operation arguments; prove one Binding Repository instance supports different operation values without reconstruction.
- [ ] 6.6 Preserve unrelated SQLAlchemy, mapping, validation, and integrity failures instead of translating them to domain conflicts.
- [ ] 6.7 Verify both adapters query, mutate, and flush through the supplied Session without creating a Session, committing, rolling back, opening a nested transaction, acquiring external locks, performing Provider I/O, or dispatching work.
- [ ] 6.8 Remove the temporary no-composition guard and construct the real adapters only after an owner-bound Channel Reader returns the trusted Channel ID.
- [ ] 6.9 Add focused tests for the implemented adapters covering canonical Identity mapping, Channel-local uniqueness, owner-free mapping, endpoint conflicts, cross-kind and cross-workspace reuse, effective precedence, and rollback without partial state.

## 7. Migrate Reachable Current Consumers

- [ ] 7.1 Migrate synchronization and reconciliation current Identity reads and writes from Integration-scoped ORM access to `SQLAlchemyIMIdentityRepository`; use `list_all` for each bound Channel snapshot.
- [ ] 7.2 Migrate reconciliation current Binding reads and writes to `SQLAlchemyIMBindingRepository` while preserving existing decisions, locking, and caller-owned transaction boundaries.
- [ ] 7.3 Migrate Contact-facing Binding reads to `get_effective/get_effective_many` after owner-bound Channel resolution while preserving public Contact DTOs.
- [ ] 7.4 Remove obsolete Integration-scoped current `IMIdentity`/`IMBinding` values, mappers, Repository methods, and direct reads of removed ORM fields; preserve historical sync-run, result, and snapshot values.
- [ ] 7.5 Add focused behavior tests for the migrated synchronization, reconciliation, and Contact-facing paths.

## 8. Verify Scope And Contracts

- [ ] 8.1 Run focused Domain, SQLAlchemy Repository, transaction, constraint, migrated-consumer, and import-boundary tests through `uv run --project api`.
- [ ] 8.2 Run backend formatter, lint, and type checks for changed models, Repository contracts, SQLAlchemy implementations, and migrated consumers.
- [ ] 8.3 Verify no current production path references removed `integration_id`, `scope`, `scope_id`, Provider columns, obsolete current values, reference mirrors, or `NotImplementedError` placeholders.
- [ ] 8.4 Confirm controller behavior, public DTOs, runtime authorization, historical models and snapshots, Provider adapters, credentials, IM Channel management, and Celery payloads remain unchanged.
- [ ] 8.5 Run `openspec validate refactor-human-input-im-identity-binding-domain --strict` and resolve every validation error.
