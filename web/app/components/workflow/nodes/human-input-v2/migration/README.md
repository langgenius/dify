# Human Input v2 migration

This module owns the frontend-only rollout policy and pure conversion of legacy Human Input node data to the v2 wire shape.

## Internal dependencies

- Workflow `Node` and `Edge` models.
- Legacy Human Input delivery-method types.
- Human Input v2 recipient and node types.

## External dependencies

- `es-toolkit` for immutable deep cloning.

The planner is deliberately independent of React, workflow stores, and API clients. Callers must pass one stable member/contact snapshot and apply a successful plan through the workflow state boundary.
