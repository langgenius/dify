# Research reasoning truncation recovery

Date: 2026-08-19

## What changed

- Removed the hard-coded 512-token ceiling from Research planning and evidence judgement.
- Added dedicated, operator-configurable normal and recovery output budgets. The defaults are
  1,024 and 2,048 tokens respectively.
- Raised the dedicated Research reasoning deadline from 30 to 60 seconds so the larger bounded
  recovery is not constrained by the old short judgement deadline. Other model call types retain
  their existing timeout policy.
- Propagated the model provider's terminal `finishReason` into Research reasoning and also inspect
  provider-reported completion-token usage.
- When an otherwise invalid structured response is proven to have reached an output limit, retry
  that one buffered reasoning call once with the larger recovery budget. Ordinary malformed JSON
  and schema violations are not retried.
- Account for the initial and recovery calls independently through the existing Research model
  observer and retain the shared model-request concurrency gate for both physical calls.
- Added a distinct terminal `RESEARCH_EVIDENCE_REASONING_TRUNCATED` error when the bounded recovery
  is also truncated. Both deterministic contract errors stop after one durable task attempt.
- Added the three Research reasoning bounds to local Compose, the Dify service env example, and the
  Kubernetes integration baseline.

## Why

The failed Research task retrieved and reranked the correct evidence (top score `0.9978258`) and
the model endpoint returned HTTP 200. The evidence judgement then consumed exactly 512 completion
tokens, matching the old hard ceiling, and returned an incomplete JSON object. Strict parsing
reported `RESEARCH_EVIDENCE_REASONING_INVALID`, so the user saw a failed Research request even
though retrieval itself had succeeded.

The fix distinguishes output truncation from a genuine response-contract violation. It provides
one bounded recovery opportunity without restoring broad retries or multiplying every Research
model call.

## Correctness and cost invariants

- A valid response is never repeated, even when its token usage reaches the configured bound.
- Recovery requires either an explicit output-limit finish reason or completion-token usage at the
  requested maximum.
- At most one recovery call is made per plan or judgement invocation.
- A non-truncated invalid response remains terminal and is never retried.
- Each physical call reserves and reconciles its own token budget, and each reacquires the shared
  model gate.
- Provider/network and timeout errors retain their existing retry classification.

## Verification

- Focused Research reasoning and durable task runtime: 70 tests passed.
- API-app Research runtime configuration: 4 tests passed.
- Deployment Compose/Kubernetes contract: 12 tests passed.
- Complete `@knowledge/api` suite: 416 files passed, 1 skipped; 4,601 tests passed, 3 skipped.
- Complete `@knowledge/api-app` suite: 46 files and 262 tests passed.
- `@knowledge/api` and `@knowledge/api-app` typechecks passed.
- Full `pnpm --dir knowledge-fs check` and `pnpm --dir knowledge-fs build` passed.
- Focused Biome checks and `git diff --check` passed. The repository-wide lint command remains
  blocked by existing formatting diagnostics in generated OpenAPI/Capability artifacts; none of
  the changed source or test files is involved.
