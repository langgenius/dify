# Semantic entity grounding degradation

Date: 2026-08-17

## What changed

- Semantic chunk materialization still requires every Graph entity to be an exact substring of the
  immutable chunk text, but an ungrounded entity is now discarded instead of failing the complete
  document compilation.
- Relations that reference a discarded entity are discarded with it. Relations that reference an
  entity id the model never declared still fail closed.
- Duplicate entity ids, invalid or non-contiguous chunk ranges, coverage errors, response limits,
  and every other structural semantic-output invariant remain hard failures.
- Raw semantic-window checkpoints keep the original bounded model response. Replaying a checkpoint
  applies the same deterministic grounding filter without another provider call.
- Added regressions for noisy image OCR containing both grounded and normalized-but-ungrounded
  labels, relation cascade filtering, downstream Graph metadata validity, an all-ungrounded graph,
  and provider-free checkpoint replay.

## Why

PDF diagrams can produce noisy OCR text that omits or distorts visible labels. A reasoning model may
return a human-correct normalized label such as `Softmax` or `Masked Multi-Head Attention` even when
that exact text is absent from the immutable parser output. Those labels are not safe to publish as
grounded Graph evidence, but they also do not invalidate the model's otherwise valid contiguous
semantic chunk boundary. Previously, one such entity failed the whole import with
`LLM semantic chunking entity text must be an exact chunk substring`.

The new behavior preserves source fidelity and Graph safety: unsupported facts never escape, while
the valid semantic chunk and any independently grounded entities remain usable.

## Verification

- The new noisy-image and all-ungrounded checkpoint tests were first run against the previous
  implementation and reproduced the exact production failure before the implementation changed.
- `pnpm --dir knowledge-fs exec vitest run packages/api/src/llm-semantic-chunker.test.ts` passed all
  35 tests.
- `pnpm --dir knowledge-fs --filter @knowledge/api typecheck` passed.
- The complete `@knowledge/api` suite passed: 410 files passed, 1 skipped; 4,490 tests passed, 3
  skipped.
- `pnpm --dir knowledge-fs build` passed all 12 workspace builds.
- `pnpm --dir knowledge-fs check` passed the complete repository gate, including workspace
  typechecks/tests, contract export, CI coverage, retrieval evaluations, migration validation,
  workflow checks, Compose validation, semantic rollout tests, and Docker smoke tests.
- Biome checks for the changed semantic chunker source and tests passed, and `git diff --check`
  passed.
- The standalone repository-wide `pnpm --dir knowledge-fs lint` command retains its existing Admin
  and generated-artifact baseline findings. None is in this change set; both changed TypeScript
  files pass a focused Biome check.

## Risks and follow-up

- A noisy chunk can publish fewer Graph entities and relations than the reasoning model proposed.
  This intentionally favors grounded precision over unverified Graph recall; the chunk text itself
  remains available to dense, full-text, and PageIndex projections.
- This change does not use fuzzy matching or rewrite parser text, so similar-looking model output is
  never silently treated as source evidence.
- The raw bounded checkpoint can contain entities later filtered during materialization. Replay is
  deterministic and revalidates the checkpoint before publishing its grounded subset.
- Per-window discarded-entity observability is not added in this focused correction and can be
  considered separately without changing publication semantics.
