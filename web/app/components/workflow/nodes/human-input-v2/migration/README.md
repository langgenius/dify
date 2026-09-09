# Human Input v2 migration

This module owns the frontend rollout policy, one-call batch migration orchestration, response validation, and application of legacy Human Input migration results.

The provider uses the generated `consoleClient.workspaces.current.humanInput.nodeDataMigration.post` endpoint. The server owns recipient conversion, legacy aliases, and lossless-conversion blockers. The HTTP compatibility DTO accepts raw historical delivery JSON; its generated schema documents only canonical delivery methods, so the adapter preserves historical input at that boundary. Successful responses are validated with the generated schema and normalized for the existing paragraph editor. HTTP 400 migration failures become node-scoped blockers; other failures leave the graph untouched.

The executor sends the whole eligible batch and verifies that every requested node appears exactly once as v2 data before applying anything. A changed migration candidate, added legacy node, or lost editing permission cancels the attempt. Unrelated node, layout, and edge edits made while the request is pending are retained.

All migrated nodes are applied together, followed by one draft save and one history event. If draft saving fails, rollback restores untouched migration results while preserving edits made after migration was applied. Published workflows are unaffected until separately published.

`mock-api.ts` and `planner.ts` remain only as isolated legacy test fixtures. Runtime migration does not resolve contacts locally or use their conversion semantics.
