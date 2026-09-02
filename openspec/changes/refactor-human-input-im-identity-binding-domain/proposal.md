## Why

Current IM identity and binding persistence still depends on the old Integration aggregate and represents default bindings and workspace overrides through `scope + scope_id`. That shape leaks the former configuration owner, duplicates Provider facts, and forces callers to understand workspace/deployment differences that the new IM Channel boundary already hides.

## What Changes

- **BREAKING (internal)**: replace `integration_id`-scoped `IMIdentity` values with owner-free current projections backed by Channel-scoped persistence.
- Replace the polymorphic `HumanInputIMBinding` schema with one default-binding table and one workspace-override table. Remove `scope`, `scope_id`, denormalized Provider, and Organization terminology from the new model.
- Add current `IMIdentity` and `IMBinding` values that expose no Channel owner, workspace/deployment discriminator, normalized query columns, raw Provider payload, or actor metadata.
- Add one `IMIdentityRepository` and one `IMBindingRepository` Protocol. SQLAlchemy implementations bind Channel context at construction and use caller-owned transactions.
- Implement every method of `SQLAlchemyIMIdentityRepository` and `SQLAlchemyIMBindingRepository`. Both adapters bind only `Session` and trusted `IMChannelId`; Binding methods receive target `TenantId` and optional Dify actor only for operations that use them.
- Implement Channel-scoped reads, observation writes, default Binding mutations, workspace overrides, override-first effective reads, Identity ownership checks, expected conflict translation, and caller-owned flush behavior.
- Migrate reachable synchronization, reconciliation, and Contact-facing persistence paths to the new Channel-bound repositories, then remove their obsolete Integration-scoped current Identity and Binding code.
- Remove the non-importable `domain.py`, `schema.py`, and `repository.py` mirrors after verifying that production code and capability specs contain every contract they express.
- Keep synchronization and reconciliation decisions, effective-binding precedence, controller behavior, public DTOs, runtime authorization, and historical snapshots unchanged.

## Capabilities

### New Capabilities

- `human-input-v2-im-identity-repository`: defines Channel-scoped current Identity schema, owner-free Identity values, observation writes, one Repository port, stable persistence failures, and caller-owned Session behavior.
- `human-input-v2-im-binding-repository`: defines separate default-binding and workspace-override schemas, owner-free current Binding values, one Repository port, effective lookup precedence, uniqueness, and Channel/Identity ownership checks.

### Modified Capabilities

None.

## Impact

- Production placement under `api/models/human_input_v2.py` and `api/repositories/human_input_v2/`.
- Persistence-path migrations under `api/core/human_input_v2/im_integration/`, `api/repositories/human_input_v2/im_integration/`, synchronization, reconciliation, and Contact-facing binding reads.
- No external API, Provider adapter, Celery payload, historical record, credential, or IM Channel management change in this scope.
