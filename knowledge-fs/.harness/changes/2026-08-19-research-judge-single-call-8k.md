# Research Judge Single-Call 8K Budget

## Summary

- Replaced the 2,048-token Judge call plus 4,096-token full replay with one 8,192-token
  structured-output call.
- Removed the recovery output-token setting and the second physical provider call. A response that
  is still provider-confirmed as truncated at 8K now fails once with
  `RESEARCH_EVIDENCE_REASONING_TRUNCATED`.
- Sent `reasoning_effort=low` for supported OpenAI GPT-5 and o-series reasoning models. Other
  providers receive no provider-specific parameter.
- Tightened the Judge instruction to brief reasoning and compact schema-only JSON while retaining
  the existing 16,000-character response bound.
- Updated local Compose, Dify service env, and Kubernetes defaults to the single 8K limit.

## Observed Baseline

The diagnosed Research task spent 119.941 seconds in its first analyzing attempt. The first Judge
call reached exactly 2,048 completion tokens and returned truncated structured output after about
59.8 seconds. The 4,096-token recovery returned near the 60-second application deadline and was
timed out locally, causing the durable task to retry. On the retry, the same Judge produced a valid
394-token result in 6.828 seconds.

The selected OpenAI `gpt-5.6` plugin defaults `reasoning_effort` to `medium`, and its completion
usage includes reasoning tokens as well as the compact final JSON. This explains why the token
count was much larger than the visible Judge payload.

These measurements establish the defect baseline. They are not a post-change performance claim;
the deployed task must be replayed before reporting an observed latency or cost improvement.

## Regression Contract

- The default Research structured-output cap is 8,192 tokens.
- Every Judge call resolves its provider and model from the knowledge space's frozen retrieval
  profile; no deployment-global or test-fixture model can replace that selection.
- A provider-confirmed truncated response consumes one physical call and is never replayed in
  place.
- Supported OpenAI reasoning models receive low effort; unsupported model routes do not receive
  that parameter.
- Judge output remains compact, schema-only JSON and stays subject to the response character cap.
- Deployment examples contain no recovery-token environment variable.

## Verification

- `pnpm --dir knowledge-fs --filter @knowledge/api exec vitest run src/research-evidence-reasoning.test.ts`
- `pnpm --dir knowledge-fs --filter @knowledge/api-app exec vitest run src/research-evidence-reasoning-options.test.ts`
- `pnpm --dir knowledge-fs --filter @knowledge/generation exec vitest run src/dify-model-runtime-llm.test.ts`
- `pnpm --dir knowledge-fs --filter @knowledge/api test` (4,615 passed, 3 skipped)
- `pnpm --dir knowledge-fs --filter @knowledge/api-app test`
- `pnpm --dir knowledge-fs --filter @knowledge/generation test`
- `pnpm --dir knowledge-fs --filter @knowledge/api typecheck`
- `pnpm --dir knowledge-fs --filter @knowledge/api-app typecheck`
- `pnpm --dir knowledge-fs --filter @knowledge/generation typecheck`
- `pnpm --dir knowledge-fs lint:backend`
- `pnpm --dir knowledge-fs --filter @knowledge/api-app build:prod`
- `node knowledge-fs/scripts/compose-apps.test.mjs`
- `uv run --project api python api/dev/generate_knowledge_fs_contract.py --check`
