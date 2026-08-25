# Research score-threshold test intent

## What changed

- Updated the score-threshold retrieval test plan to use the supported `direct` research intent.
- Applied the repository formatter's required layout to the associated retrieval metric expression.

## Why

- The test fixture used the removed `lookup` intent, causing the KnowledgeFS API TypeScript gate to fail.

## Verification

- `pnpm --filter @knowledge/api typecheck`
- `pnpm --filter @knowledge/api test -- research-evidence-retrieval.test.ts`
- `pnpm lint:backend`

## Risks and follow-up

- No production behavior changed; this only aligns the test fixture with the production query-plan contract.
