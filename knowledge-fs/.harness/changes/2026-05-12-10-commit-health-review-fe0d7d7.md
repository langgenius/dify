# 10-Commit Health Review After fe0d7d7

## What Changed

- Reviewed the 10 implementation commits after checkpoint `3b9b4d8`, ending at `fe0d7d7 Add native structured data parsers`.
- Fixed two review findings before allowing feature iteration to continue:
  - Parser router now applies `maxNativeInputBytes` to structured data formats before choosing the native structured parser.
  - Database-backed embedding model registry `register()` now uses dialect-aware upsert semantics, matching the in-memory registry and supporting model upgrade status transitions under the `model_id + version` unique index.
- Removed an optional-provider `IS NULL OR` list predicate from embedding model registry SQL and added `embedding_models_status_model_idx` for provider-agnostic stable pagination.
- Bounded CSV and JSONL row parsing earlier so structured parsers fail once `maxRows` is exceeded instead of fully materializing rows first.

## Why It Changed

- The review cadence requires a project-health pause every 10 implementation commits.
- Structured parser routing had a size-policy gap that could keep large native inputs on the request/runtime path instead of falling back to Unstructured.
- Embedding model upgrade would have failed against a real SQL database when promoting or disabling an already registered candidate model.
- Provider-agnostic model registry listing needs an index shape and SQL predicate that can be planned without an `OR` guard.

## Verification

- RED first:
  - `pnpm --filter @knowledge/parsers test -- src/parser.test.ts` failed because structured CSV ignored router `maxNativeInputBytes`.
  - `pnpm --filter @knowledge/api test -- src/gateway.test.ts` failed because database registry SQL lacked `ON CONFLICT`.
- GREEN focused verification passed:
  - `pnpm --filter @knowledge/parsers test -- src/parser.test.ts`
  - `pnpm --filter @knowledge/api test -- src/gateway.test.ts`
  - `pnpm --filter @knowledge/database test -- src/schema.test.ts`
  - `pnpm db:migrations:write`
  - `pnpm db:migrations:check`
- Full verification passed:
  - `pnpm check`
  - `pnpm build`
  - `pnpm lint`
  - `cargo test --workspace`
  - `pnpm wasm:build`
  - `pnpm compose:config`
  - `docker compose --profile apps config`
  - `git diff --check`

## Known Risks / Follow-Up

- The registry upsert returns the submitted model on TiDB because the current adapter contract does not expose a portable `RETURNING` equivalent.
- No further high-priority blockers were found in the reviewed commit range.
- Latest reviewed checkpoint after this remediation commit: `c8f1064`.
