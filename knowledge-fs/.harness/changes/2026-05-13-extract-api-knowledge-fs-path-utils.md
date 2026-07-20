# Extract API KnowledgeFS Path Utilities

## Summary

- Continued R6 API decomposition by moving KnowledgeFS path normalization, physical path parsing, by-entity/by-topic classification, topic-list validation, descendant prefix generation, and related constants into `packages/api/src/knowledge-fs-path-utils.ts`.
- Added direct unit tests for normalization, physical view parsing, by-entity id decoding, by-topic validation, and validation-error behavior.
- Added a code-health guardrail so KnowledgeFS path helpers stay out of `packages/api/src/index.ts`.

## Why

- KnowledgeFS path parsing is a request-boundary concern with security and routing implications. Keeping it in a focused module makes malformed path handling easier to review.
- Existing path strings, semantic-view metadata, and validation error semantics are preserved.

## Verification

- RED: `pnpm --filter @knowledge/api test -- src/knowledge-fs-path-utils.test.ts src/code-health.test.ts` failed because `knowledge-fs-path-utils.ts` did not exist.
- GREEN: `pnpm --filter @knowledge/api test -- src/knowledge-fs-path-utils.test.ts src/code-health.test.ts src/sourcefs.test.ts src/gateway.test.ts`
- `pnpm --filter @knowledge/api typecheck`
- `pnpm check`
- `pnpm build`
- `pnpm lint`
- `cargo test --workspace`
- `pnpm wasm:build`
- `pnpm compose:config`
- `docker compose --profile apps config`
- `git diff --check`

## Risks And Follow-Up

- KnowledgeFS normalization still only trims trailing slashes. If stricter traversal validation is needed for `/knowledge` paths, this module is now the single place to add it.
- This is the 10th implementation commit after review checkpoint `754942f`; project health review is required immediately after commit and push.
