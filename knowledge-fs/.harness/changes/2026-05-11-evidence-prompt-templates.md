# Evidence-Driven Prompt Templates

## What Changed

- Added `createEvidencePromptTemplateRegistry()` to `@knowledge/generation`.
- Added versioned, mode-specific default templates for `fast`, `deep`, and `research` answer generation.
- Prompt rendering now returns LLM messages plus template metadata: template id/version, mode, answerability state, evidence counts, omitted counts, and used evidence tokens.
- Added bounded prompt inputs with explicit query and evidence-context byte limits.
- Added validation for duplicate template modes, blank template ids/versions, unsupported modes, empty rendered messages, invalid roles, and blank message content.

## Why

- Sprint 7 generation needs a stable prompt layer between context-window packing and SSE query generation.
- Versioned templates make prompt strategy changes auditable and cacheable in later generation cache work.

## Performance And Safety Notes

- Rendering is pure in-memory string assembly with no database, cache, object storage, provider, filesystem, or network access.
- Query and evidence context are bounded before messages are produced.
- Prompt metadata records low-cardinality template state without storing provider credentials or raw request bodies.

## Verification

- `pnpm --filter @knowledge/generation test -- src/generation.test.ts`
- `pnpm --filter @knowledge/generation typecheck`
- `pnpm --filter @knowledge/generation test:coverage`
- `pnpm check`
- `pnpm build`
- `pnpm lint`
- `cargo test --workspace`
- `pnpm wasm:build`
- `pnpm compose:config`
- `docker compose --profile apps config`
- `git diff --check`

## Known Risks / Follow-Up

- The next slice should wire the rendered messages into the streaming query endpoint.
- Citation normalization and generation cache are still planned follow-up slices.
