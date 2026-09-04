# Retryable embedding failures and initial website Source recovery

## Why

The Dify text-embedding bridge returned provider failures in a legacy HTTP 200 envelope without
machine-readable retry semantics. KnowledgeFS consequently treated Gemini `429 RESOURCE_EXHAUSTED`
responses as terminal, non-retryable model failures. Separately, retrying a failed initial website
workflow could complete every document while leaving the Source disabled with a stale
`initialImport.state = failed` marker because the retry reconciliation path only understood the
ordinary `pendingImport` and `lastImport` markers.

## What changed

- The text-embedding bridge keeps the legacy `data` and `error` fields and adds bounded, safe
  `error_code`, `retryable`, and `status` fields for rate limits, timeouts, and temporary transport
  failures.
- The KnowledgeFS model-runtime client validates those fields and maps them to typed retryable
  errors without exposing provider payloads in its public error message.
- The embedding adapter retries only the failed transport batch, at most twice with abort-aware
  exponential delays. Successful sibling batches are retained, result ordering is preserved, and
  metrics report the actual provider-call and retry counts.
- Failed initial website imports now retain their deferred sync policy. Retry reconciliation accepts
  only website `initialImport` markers for the matching workflow, moves them into the existing
  finalizer state machine, clears the stale marker, and activates the Source when the workflow is
  complete.
- Legacy failed website Sources that predate the retained policy recover with manual sync rather
  than guessing a schedule. Users can explicitly configure a schedule afterward.
- Online-document and online-drive initial-source behavior is unchanged.

## Verification

- Dify API controller, initial-source task, and source-import reconciliation unit tests: 70 passed.
- `@knowledge/dify-model-runtime-client`: 34 tests passed.
- `@knowledge/embeddings`: 32 tests passed.
- Full KnowledgeFS `pnpm check` and `pnpm build` passed.
- Focused Ruff, mypy, and Pyrefly checks passed for all changed Python implementation files.
- Focused TypeScript typechecks passed for both changed KnowledgeFS packages.
- Focused Biome formatting/checking and `git diff --check` passed.
- Full `pnpm lint` remains blocked by ten pre-existing repository findings in seven unrelated admin
  and test files, the generated Capability operations JSON, and the 1.6 MiB generated OpenAPI file.

## Risks and follow-up

- Retry classification is intentionally limited to the existing text-embedding bridge and to
  explicit transient signals. Unknown provider errors remain non-retryable.
- Retries reduce short rate-limit failures but cannot make a persistently exhausted provider quota
  succeed; terminal failures remain visible and manually retryable.
- Existing failed rows do not contain the originally selected sync policy, so their safe fallback is
  manual sync.
