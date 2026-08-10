# Knowledge Retrieval v2 workflow node

Date: 2026-08-09

## What changed

- Added a bounded, evidence-only Retrieval Test contract with fixed metadata filters and optional
  candidate text, and registered it as the read-only Capability v2 operation
  `queries.retrieval_test`.
- Added the Dify product operation, DTOs, capability execution path, and the independent
  `knowledge-retrieval-v2` Workflow / Chatflow node.
- Added bounded four-way multi-Space execution, stable score-preserving merge, citation-rich output,
  per-Space trace metrics, deterministic fail-closed errors, and draft-only binding enablement.
- Added publish-time Space validation and transactional exact workflow-binding synchronization.
  Removed Space references revoke their workflow bindings; published runs never silently recreate
  them. DSL imports report unresolved environment-specific Space ids.
- Added the feature-gated frontend node, Space/Profile configuration panel, fixed filters, output
  variables, single-step run support, English and Simplified Chinese copy, English fallback copy
  for every other supported locale, and a DSL regression fixture.
- Stabilized `runRetrievalTest` as the cross-service OpenAPI operation id, classified the
  evidence-only POST as read scope, and declared its explicit 4 MiB response bound.

## Why

The existing Knowledge Retrieval node is coupled to the legacy Dataset model and node-owned
retrieval settings. KnowledgeFS needs an independent node that preserves Space-owned profiles,
Capability v2 authorization, immutable citations, and PageIndex-aware modes without changing or
retiring the old node.

The initial plan was tightened before implementation: `auto` is not a valid KFS mode, per-Space
min-max normalization would distort relevance, workflow bindings require exact graph
synchronization, and custom observability values cannot be inserted into graphon's closed metadata
enum. A permanently skipped Cucumber scenario was also rejected until the E2E environment provides
a resettable KnowledgeFS service and document fixture.

## Verification

- `pnpm --dir knowledge-fs test`: 22/22 Turbo tasks passed; the API package reported 4,332 passed
  tests and 3 existing skips.
- `pnpm --dir knowledge-fs build`: 12/12 production build tasks passed.
- Changed KnowledgeFS TypeScript/MJS files pass Biome; `openapi:export:test` passes both hermetic
  export tests. The whole-tree Biome command still reports unrelated pre-existing Admin formatting
  findings and the ignored 1.5 MiB generated OpenAPI file exceeding Biome's 1 MiB scan limit.
- Dify focused backend suite: 234 tests passed across product DTO/operation/capability, binding
  lifecycle, publish handler, workflow service, DSL service, node concurrency/merge/empty/error
  behavior, and the DSL fixture; all changed Python files pass Ruff.
- Frontend: 22 focused Vitest tests passed; all changed TypeScript files pass formatting/lint and
  the full web TypeScript check passes. The workflow locale namespace is aligned across all
  supported languages.
- Generated KnowledgeFS OpenAPI and Capability v2 artifacts plus the Dify contract lock pass the
  staged-subtree drift check.

## Risks and follow-up

- Scores from Spaces using different profiles or rerank models are only weakly comparable. The node
  preserves the final KFS score and documents this instead of fabricating a second normalization.
- Ten maximum-size Space responses are bounded but can still retain meaningful memory during one
  node run. The four-worker limit prevents an unbounded request fan-out; a future cross-Space rerank
  service can replace client-side merging if stronger comparability is required.
- Full browser E2E remains gated on deterministic KnowledgeFS provisioning in `e2e/`. The current
  release uses route, service, node, publication-lifecycle, frontend interaction, and DSL contract
  tests rather than a permanently skipped or mocked Cucumber scenario.
- Automatic LLM-generated metadata filters, cross-Space rerank, failed-query feedback, and v1-to-v2
  migration remain explicitly out of scope.
