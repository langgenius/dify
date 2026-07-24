# Human Input v2 migration

This module owns the frontend rollout policy, one-call batch migration orchestration, response validation, and atomic application of legacy Human Input migration results.

## Internal dependencies

- Workflow `Node` and `Edge` models.
- Legacy Human Input delivery-method types.
- Human Input v2 recipient and node types.
- A temporary mock migration adapter that delegates to the legacy pure planner.

## External dependencies

- `es-toolkit` for immutable deep cloning.

The executor depends only on `HumanInputMigrationApi`, whose request and response are correlated by `node_id` and contain the whole eligible batch. `mock-api.ts` is temporary: it keeps the frontend flow usable while the backend client is unavailable. When the real batch endpoint is ready, replace that adapter without changing the executor or graph mutation path.

The planner remains independent of React and workflow stores, but it is used only by the temporary mock adapter. It is not the final migration source of truth.
