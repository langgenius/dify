# KnowledgeFS Capability v2 CLI authorization

## What changed

- Passed the authenticated Capability v2 grant into candidate-content authorization for all
  KnowledgeFS command handlers: `ls`, `tree`, `grep`, `find`, `diff`, `open_node`, `cat`, `stat`,
  `write`, and `append`.
- Classified every registered GET operation as `knowledge-spaces:read` when constructing the
  authenticated Capability v2 subject, while retaining the explicit read-action exceptions for
  POST-style query operations and failing unknown actions closed as write scope.
- Added a handler regression covering Capability v2 requests without the legacy authorization
  decision and verifying that the grant's normalized content scope reaches every command.
- Added a verifier regression that derives all GET actions from the operation registry, preventing
  future read endpoints from silently drifting out of scope classification.

## Why

The Capability v2 gateway had already authenticated and authorized CLI requests, but the command
handlers only consulted the legacy authorization decision. Capability v2 requests therefore lost
their candidate scope at the handler boundary and were rejected with `403 Knowledge space access
denied`; Dify surfaced that product response as `503 knowledge_fs_unavailable` for every CLI
filesystem command. After that boundary was fixed, the verifier's separately maintained read-action
allowlist still classified all seven CLI actions as write scope, so the read-only command registry
rejected them and the product returned 500. Deriving GET classification from the canonical operation
registry fixes both layers and removes the duplicated list that allowed this drift.

## Performance and safety

- The fix only forwards the sanitized grant already stored on the request context; it adds no
  database, model, or network calls.
- `currentCandidateGrants` continues to bind the grant to the exact tenant, subject, and knowledge
  space and to fail closed for malformed or mismatched scopes.
- Legacy authorization decisions remain supported as the fallback path.

## Verification

- RED: the new focused regression returned 403 for Capability v2 `ls` before the implementation.
- RED: the operation-derived verifier regression showed that all seven KnowledgeFS CLI GET actions,
  plus other recently added GET actions, were incorrectly assigned `knowledge-spaces:write`.
- `pnpm --filter @knowledge/api exec vitest run src/knowledge-fs-handlers-branch-coverage.test.ts`:
  passed, 16 tests.
- Focused handler and Capability v2 verifier suites: passed, 37 tests.
- `pnpm --filter @knowledge/api typecheck`: passed.
- Targeted Biome check for both changed TypeScript files: passed.
- `CI=1 pnpm check`: passed, including the full workspace test suite, coverage gates,
  retrieval evaluations, migration checks, and deployment/static guards.
- `CI=1 pnpm build`: passed for all 12 KnowledgeFS packages.
- `CI=1 pnpm lint:backend`: passed, 980 files checked.
- `CI=1 pnpm lint`: attempted but remains blocked by 10 pre-existing, unrelated
  whole-workspace Admin/generated-contract findings. These include formatting in Admin files
  outside this change and the checked-in 1.5 MiB OpenAPI artifact exceeding Biome's 1 MiB limit.
- `uv run --project api python api/dev/generate_knowledge_fs_contract.py --check`: passed after
  intentionally refreshing the staged KnowledgeFS subtree lock; OpenAPI and Capability v2
  contract digests were unchanged.

## Risks and follow-up

- The change affects authorization plumbing for ten command handlers but does not broaden access:
  the existing subject, tenant, resource, and content-scope checks are unchanged.
- Only actions registered as GET, or already present in the explicit read-action set, receive read
  scope. Unknown actions and every registered mutation continue to receive write scope.
- Dify's translation of upstream authorization failures into the generic
  `knowledge_fs_unavailable` response is separate from this root-cause fix.
