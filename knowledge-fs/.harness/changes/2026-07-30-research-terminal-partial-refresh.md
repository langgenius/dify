# Refresh final Research evidence after terminal transition

Date: 2026-07-30

## What changed

- Added an explicit selected-task transition guard for Research retrieval: when the same task moves
  from an active stage to `completed`, the Retrieval Test page performs one final partial-result
  refetch.
- Kept the existing one-second partial polling while the task is active and stopped all periodic
  polling after completion.
- Added a regression test for the active-to-completed transition, including guards against initial
  historical selection, repeated completed snapshots, and switching to another task.

## Why

Research task state and partial evidence are read through independent queries. Production
diagnostics showed the last partial request returning an empty list at `06:36:24.738`, followed by
the durable final partial (three evidence items and the generated answer) at `06:36:25.463` and the
task completion at `06:36:25.468`. The task list then exposed `completed`, so the frontend disabled
partial polling without issuing a read after the durable result became visible. The UI therefore
rendered “no chunks retrieved” even though retrieval and LLM synthesis had succeeded.

## Verification

- Confirmed RED first: the new transition regression failed before the refresh policy existed.
- `RetrievalTestPage` focused suite passed: 6 tests.
- Retrieval Test model focused suite passed: 7 tests.
- Focused Web formatting, lint, and type diagnostics passed for the changed source and test files.
- `git diff --check` passed.

## Risks and follow-up

- The fix adds at most one request per selected Research task completion; it does not create a new
  terminal polling loop.
- Completed tasks selected from history still rely on the normal initial partial query and do not
  trigger the transition-only refetch.
- No retrieval, database, API, or model-execution behavior changed. The production task inspected
  already contained three evidence items and a generated answer; this change closes only the
  frontend consistency window.
- Repository-wide `pnpm check`, `pnpm build`, and `pnpm lint` were not run because this is a focused
  Web orchestration fix in the Dify monorepo. The affected suites and focused Vite+ static gate were
  run instead.
