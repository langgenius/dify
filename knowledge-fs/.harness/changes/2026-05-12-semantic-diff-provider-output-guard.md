# Semantic Diff Provider Output Guard

## What Changed

- Added runtime validation for `SemanticDiffProvider` output before it enters KnowledgeFS API responses.
- Bounded semantic diff summaries to:
  - At most 100 changes.
  - At most 20 evidence strings per change.
  - At most 8,000 characters per summary/evidence field.
  - At most 16 KiB of metadata JSON.
- Reused the same bounded schema for the OpenAPI response shape.
- Added a regression test proving an oversized provider response fails closed with `503`.

## Why

- The 10-commit health review found that semantic diff provider output was previously trusted through TypeScript types only.
- A production LLM/provider implementation could accidentally return an oversized response, causing memory and response-size pressure.
- Semantic provider failures should degrade explicitly instead of leaking malformed or oversized payloads to clients.

## Verification

- RED first:
  - `pnpm --filter @knowledge/api test -- src/gateway.test.ts --runInBand` failed because an oversized semantic diff provider response returned `200`.
- Focused verification passed:
  - `pnpm exec biome check --write packages/api/src/index.ts packages/api/src/gateway.test.ts`
  - `pnpm --filter @knowledge/api test -- src/gateway.test.ts`
  - `pnpm --filter @knowledge/api typecheck`
  - `pnpm --filter @knowledge/api test:coverage`
- Full verification passed:
  - `pnpm check`
  - `pnpm build`
  - `pnpm lint`
  - `cargo test --workspace`
  - `pnpm wasm:build`
  - `pnpm compose:config`
  - `docker compose --profile apps config`
  - `git diff --check`

## Risks And Follow-Up

- The production semantic diff provider still needs prompt/model wiring and should enforce equivalent output limits at the provider adapter boundary.
- The current limits are intentionally conservative and can be made configurable later if product requirements need longer summaries.
