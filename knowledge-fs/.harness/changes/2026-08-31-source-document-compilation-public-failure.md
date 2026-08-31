# Source document compilation public failure

## What changed

- Added `SOURCE_DOCUMENT_COMPILATION_FAILED` to the KnowledgeFS public failure catalog with a
  manual-retry dependency policy.
- Added the same code to Dify's validated KnowledgeFS response DTO allowlist.
- Regenerated the KnowledgeFS contract lock and Dify TypeScript/Zod API contracts.
- Added TypeScript and Python regression coverage proving compilation failures retain their stable
  code while provider messages remain redacted.

## Why

Source workflow document compilation failures were persisted with the precise internal code but
normalized to `SOURCE_OPERATION_FAILED` at the public boundary. That prevented operators and the
product UI from distinguishing a compilation failure from an unrelated source dependency failure.

## Verification

- RED: `knowledge-fs-errors.test.ts` reproduced the downgrade to `SOURCE_OPERATION_FAILED`.
- GREEN: focused KnowledgeFS error tests passed (6 tests).
- Focused Python source-workflow DTO regression passed.
- KnowledgeFS contract generator `--check` passed using the staged subtree contract.
- Generated contracts passed `pnpm --dir packages/contracts type-check`.
- `git diff --check` passed before the final traceability note.

## Risks and follow-up

- This change intentionally exposes only the stable compilation error code and existing safe
  category message. Raw model/provider errors remain restricted to server logs.
- Deploy both the KnowledgeFS and Dify API images together so their public error-code contracts stay
  aligned.
