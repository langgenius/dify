# Agent Development Requirements

> This file records user-level development requirements that every agent must follow.

## Context Requirements

- Treat `.harness` as the complete information base for this project.
- While the temporary planning documents exist, every development round must read and carry:
  - `.harness/docs/TEMP-task-document.md`
  - `.harness/docs/TEMP-progress-document.md`
- Update `.harness/docs/TEMP-progress-document.md` when work completes, blocks, or context/token limits approach.
- Delete the temporary task and progress documents only after the full project development cycle is complete.
- After those temporary documents have been intentionally deleted, continue maintenance from `.harness/docs/iteration-plan.md`, `.harness/changes`, and this requirements file instead of recreating temporary docs.

## Traceability Requirements

- All code, configuration, architecture, test, and documentation changes must be summarized under `.harness/changes`.
- Each change summary must explain:
  - What changed.
  - Why it changed.
  - How it was verified.
  - Any known risks or follow-up work.
- Do not rely only on git history for traceability.

## Review Cadence

- After every 10 implementation commits, pause forward feature iteration and review project health before continuing.
- The review must cover:
  - Whether the technical direction still follows `.harness` architecture decisions.
  - Performance risks such as N+1 query paths, missing indexes, unbounded memory, repeated database round-trips, and large-object buffering.
  - Unit/integration test coverage and whether new behavior was developed with TDD.
  - CI/build/lint/test health.
  - Whether `.harness/changes` and temporary progress documents are complete.
- Record the review checkpoint commit and findings in `.harness/docs/TEMP-progress-document.md`.
- If the temporary progress document has already been intentionally deleted after project completion, record the review checkpoint and findings in `.harness/changes` instead.
- Fix high-priority review findings before continuing regular iteration.

## TDD Requirements

- Follow `.harness/skills/test-driven-development/SKILL.md` for all logic, bug fixes, and behavior changes.
- Write or update tests before implementing new behavior whenever the change is behavioral.
- Prefer state-based tests over implementation-detail interaction tests.
- Keep tests DAMP: each test should read as a clear behavioral specification.
- Use the test pyramid:
  - Mostly small unit tests.
  - Focused integration tests for API, database, filesystem, and provider boundaries.
  - Limited E2E tests for critical user flows.
- Project coverage must stay at or above 90% for lines, statements, branches, and functions.
- Coverage gates are mandatory for packages that contain behavior.
- If a package has no behavioral code yet, record that explicitly in the change summary.

## Performance Requirements

- This project has extremely high performance requirements.
- Code must be designed to avoid:
  - N+1 queries.
  - Missing or unused indexes on high-traffic query paths.
  - Repeated database round-trips for data that can be batched.
  - Unbounded result sets or unbounded in-memory accumulation.
  - Memory leaks from long-lived references, global mutable caches, or uncapped buffers.
  - Query waterfalls between API, retrieval, evidence, and trace loading.
- Database-facing work must document expected access patterns and required indexes.
- Retrieval and KnowledgeFS paths must batch related entity loads by ids instead of looping over per-row queries.
- New list/read APIs must include explicit pagination, limits, and stable ordering.
- Cache usage must be bounded and version-aware.
- Performance-sensitive behavior should have guard tests where practical, such as tests that verify required indexes or batched access contracts exist.
- If a performance trade-off is accepted temporarily, record it in `.harness/changes` with a follow-up.

## Code Review Regression Guardrails

- Do not add new broad responsibilities to `packages/api/src/index.ts`; prefer focused modules for repositories, workflows, route helpers, and provider logic.
- Do not reintroduce route-handler `context: any` assertions; if Hono/OpenAPI inference becomes too deep, isolate it behind a typed helper and keep validated request bodies/params/query values locally typed.
- Runtime adapters must report their real backing implementation through `kind`; in-memory fallbacks must not masquerade as S3, R2, KV, or other durable services.
- Production container entrypoints must run compiled JavaScript as a non-root user; `tsx` is allowed for development only.
- Large object access should prefer streaming-capable adapter contracts; all eager byte reads must keep explicit size caps.
- Admin UI network paths must go through the BFF allowlist instead of direct browser-to-API form actions.
- BFF/API client request and response bodies must enforce byte limits while streaming or chunk-reading; do not call `arrayBuffer()`, `json()`, or `text()` on untrusted bodies before bounds are checked.
- SQL identifier rendering must escape dialect quote characters, and generated migrations must remain deterministic through `pnpm db:migrations:check`.
- New database relationships should declare foreign keys or document why a relationship is intentionally application-managed.
- Cache and queue adapters must bound retained entries and retained bytes where applicable, and idempotency indexes must be cleaned up with terminal job lifecycle transitions.
- SSE parsers must preserve multi-line `data:` semantics and avoid exposing raw provider payloads or credentials in errors/logs.
- User-visible labels and utility formatting should be covered by tests for singular/plural grammar and rounding edge cases.

## Verification Requirements

- Before reporting completion, run the relevant verification commands.
- For the current TypeScript-only workspace, the default verification set is:
  - `pnpm check`
  - `pnpm build`
  - `pnpm lint`
- Record any skipped verification and the reason in both the progress document and the relevant change summary.
- If the temporary progress document has already been intentionally deleted after project completion, record skipped verification only in the relevant `.harness/changes` summary.
