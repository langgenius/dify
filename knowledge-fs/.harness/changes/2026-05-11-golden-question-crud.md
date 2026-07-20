# Golden Question CRUD

## What Changed

- Added `GoldenQuestionSchema` to `@knowledge/core`.
- Added `golden_questions` to the schema catalog with PostgreSQL/TiDB migration artifacts.
- Added bounded in-memory and database-backed `GoldenQuestionRepository` implementations.
- Added authenticated API routes:
  - `POST /knowledge-spaces/{id}/golden-questions`
  - `GET /knowledge-spaces/{id}/golden-questions`
  - `GET /knowledge-spaces/{id}/golden-questions/{questionId}`
  - `PATCH /knowledge-spaces/{id}/golden-questions/{questionId}`
  - `DELETE /knowledge-spaces/{id}/golden-questions/{questionId}`
- Added OpenAPI schemas for golden question request and response bodies.

## Why

Sprint 4 requires golden question CRUD before the retrieval evaluation MVP can compute recall and citation metrics. Golden questions store human-labeled expected evidence ids and are scoped to a KnowledgeSpace, giving the next evaluation slice a durable source of truth.

## Performance And Safety

- List operations require explicit `limit` and use stable keyset pagination by `created_at, id`.
- Database reads, updates, and deletes are filtered by `knowledge_space_id`.
- Database operations use parameter arrays and never interpolate question text or evidence ids into SQL.
- Repository fallbacks are bounded by `maxQuestions` and `maxListLimit`.
- API routes validate the authenticated subject's tenant-scoped KnowledgeSpace before accessing golden question rows.

## Verification

- RED confirmed with `pnpm --filter @knowledge/api test -- src/gateway.test.ts`; tests failed because golden question routes and repository factories did not exist.
- Focused verification passed:
  - `pnpm --filter @knowledge/api test -- src/gateway.test.ts`
  - `pnpm --filter @knowledge/api test:coverage`
  - `pnpm --filter @knowledge/core test:coverage`
  - `pnpm --filter @knowledge/database test:coverage`
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

## Known Risks And Follow-Up

- This slice only manages golden questions. It does not run retrieval evaluation yet.
- Expected evidence ids currently reference ids generically; the evaluation MVP will define whether they must be node ids, document ids, or mixed evidence ids.
- No Admin Console UI is included in this slice; UI work is scheduled later.
