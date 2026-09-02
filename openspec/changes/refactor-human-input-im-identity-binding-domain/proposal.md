## Why

Current IM identity and binding persistence still depends on the old Integration aggregate and represents default bindings and workspace overrides through `scope + scope_id`. That shape leaks the former configuration owner, duplicates Provider facts, and forces callers to understand workspace/deployment differences that the new IM Channel boundary already hides.

## What Changes

- **BREAKING (internal)**: replace `integration_id`-scoped `IMIdentity` values with owner-free current projections backed by Channel-scoped persistence.
- Replace the polymorphic `HumanInputIMBinding` schema with one default-binding table and one workspace-override table. Remove `scope`, `scope_id`, denormalized Provider, and Organization terminology from the new model.
- Add current `IMIdentity` and `IMBinding` values that expose no Channel owner, workspace/deployment discriminator, normalized query columns, raw Provider payload, or actor metadata.
- Add one `IMIdentityRepository` and one `IMBindingRepository` Protocol stub. Both bind Channel context at construction and use caller-owned transactions.
- Add two SQLAlchemy adapter constructor stubs that bind only `Session` and trusted `IMChannelId`. Binding methods receive target `TenantId` and optional Dify actor only for operations that use them.
- Add non-importable `domain.py`, `schema.py`, and `repository.py` reference artifacts that fix the intended production shapes.
- Keep Provider synchronization, reconciliation decisions, effective-binding precedence, controllers, public DTOs, runtime authorization, and historical snapshots unchanged.

## Capabilities

### New Capabilities

- `human-input-v2-im-identity-repository`: defines Channel-scoped current Identity schema, owner-free Identity values, observation writes, one Repository port, stable persistence failures, and caller-owned Session behavior.
- `human-input-v2-im-binding-repository`: defines separate default-binding and workspace-override schemas, owner-free current Binding values, one Repository port, effective lookup precedence, uniqueness, and Channel/Identity ownership checks.

### Modified Capabilities

None.

## Impact

- Reference artifacts under `openspec/changes/refactor-human-input-im-identity-binding-domain/`.
- Future production placement under `api/models/human_input_v2.py` and `api/repositories/human_input_v2/`.
- Future migrations of `api/core/human_input_v2/im_integration/`, `api/repositories/human_input_v2/im_integration/`, synchronization, reconciliation, Contact-facing binding reads, and tests.
- No external API, Provider adapter, Celery payload, historical record, credential, or IM Channel management change in this scope.
