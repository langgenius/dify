# Research process log details

## What changed

- Enriched durable Research task stage-transition events with bounded, structured details:
  - planning records the research question and effective Top K;
  - retrieval records the fused candidate count and selected chunk count;
  - analysis records the candidate and evidence chunk counts;
  - generation records final chunk, document, and source counts.
- Updated the Dify Research process log to associate transition details with the stage that just
  completed instead of taking the last event in the new stage. This prevents answer-delta events
  from hiding generation details.
- Added a persisted-task/evidence fallback so historical tasks created before detailed progress
  payloads, and sessions where SSE is temporarily unavailable, still show truthful stage content.
- Added backend runtime and frontend component regressions for durable detail replay and legacy
  empty-event fallback behavior.

## Why

Research progress events previously carried almost only `previousStage`. The UI deliberately
filters internal fields, so users saw four stage headings with no explanation of what happened.
The new payload stays presentation-neutral and reports only data produced by the real retrieval
run; it does not claim that the runtime decomposed a question when no decomposition occurred.

## Performance and safety

- No database or network round trips were added.
- Progress payloads contain only bounded scalar counts, the existing task query, and one result
  summary; raw model/provider metadata is not exposed.
- Frontend aggregation is linear in the already bounded progress event list and evidence list.

## Verification

- RED: focused backend and frontend regressions failed before the implementation because stage
  details were absent or associated with the wrong stage.
- `pnpm exec vitest run src/research-task-runtime.test.ts` (`@knowledge/api`): passed.
- `pnpm exec vp test run features/new-rag/__tests__/retrieval-test-page.spec.tsx` (`web`): passed.
- `pnpm --filter @knowledge/api typecheck`: passed.
- Targeted Biome and Vite+ formatting/lint/type checks: passed.
- `pnpm check`: passed, including full workspace tests, coverage gates, retrieval evaluations,
  migration checks, and deployment/static guards.
- `pnpm build`: passed for all 12 KnowledgeFS packages.
- `uv run --project api python api/dev/generate_knowledge_fs_contract.py --check`: passed after
  intentionally updating the staged subtree lock; OpenAPI and capability hashes were unchanged.
- `pnpm lint`: attempted but remains blocked by 10 pre-existing, unrelated whole-workspace findings,
  including formatting in Admin files outside this change and the checked-in 1.5 MiB OpenAPI file
  exceeding Biome's 1 MiB processing limit. Targeted lint for all changed source files passed.

## Risks and follow-up

- Historical events cannot reconstruct candidate counts that were never persisted; their fallback
  uses the task query and final persisted evidence counts.
- The current Research runtime executes one retrieval query rather than producing sub-questions.
  The process log intentionally reflects that real behavior. A future multi-query planner can add
  multiple result summaries without changing the event envelope.
