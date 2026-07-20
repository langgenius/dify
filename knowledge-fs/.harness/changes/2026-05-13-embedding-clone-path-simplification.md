# Embedding Clone Path Simplification

## Summary

- Continued R6 from the code-review remediation plan by reducing dense-vector defensive clones in embedding providers.
- Kept clone isolation at external return boundaries while avoiding duplicate copies during cache serialization, cache decode, and HTTP dense-vector parsing.

## Changes

- Added an embedding code-health guardrail for known duplicate clone patterns.
- Changed embedding cache writes to serialize provider-owned results directly.
- Changed cache decode to return JSON-decoded ownership and let the caller clone once at the return boundary.
- Changed Cohere/OpenAI dense-vector parsing to validate parsed vectors and clone only in `buildResult`.

## Verification

- `pnpm --filter @knowledge/embeddings test -- src/embedding-code-health.test.ts src/embedding.test.ts`
- `pnpm --filter @knowledge/embeddings typecheck`
- `pnpm check`
- `pnpm build`
- `pnpm lint`
- `cargo test --workspace`
- `pnpm wasm:build`
- `pnpm compose:config`
- `docker compose --profile apps config`
- `git diff --check`

## Notes

- R6 remains open for further API decomposition; this slice specifically resolves the review note about excessive embedding vector copies.
