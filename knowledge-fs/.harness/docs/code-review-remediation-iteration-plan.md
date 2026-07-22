# Code Review Remediation Iteration Plan

> Source: `docs/code-review-issues.md`
> Created: 2026-05-13
> Mode: loop execution, TDD-first

## Already Remediated From The Review List

- H2: critical database foreign keys now render into deterministic migrations.
- H3: `collectPlatformHealth` catches per-adapter health exceptions.
- H4/H5: Admin form actions and BFF allowlist now route through `/api/bff`.
- H6: gateway has centralized `onError` and `notFound` handlers.
- M1: SQL identifier rendering escapes dialect quote characters.
- M2/L21: Admin BFF/API client body reads are bounded.
- M3/L7/L10: approximate token counting is explicit and Unicode-aware, and TS wrapper avoids duplicate validation clones.
- M4/L18: memory cache supports `maxTotalBytes` and LRU touch-on-read eviction.
- M7: outer job queue idempotency indexes are cleaned with terminal lifecycle transitions.
- M9/M12: TiDB index rendering and pgvector/HNSW schema issues are covered by migration artifacts.
- M10: embedding stable JSON handles `null`.
- M11/M13: runtime adapter fallbacks report honest in-memory `kind`.
- L2/L3/L11/L12/L14/L15/L16/L17/L23/L24/L25: covered by focused remediation slices and regression tests.
- M6: provider SSE streaming now parses and yields incremental complete events with bounded cancellation.
- L13: generation, embedding/reranker, and Unstructured providers now retry bounded retriable status codes and honor `AbortSignal`.
- L22: generation, embedding/reranker, and parser provider boundaries now expose structured input, rate-limit, request, and response errors.

## Remaining Iterations

### R1: Incremental SSE Parser And Provider Streaming

- Issues: M6.
- Goal: provider `.stream()` methods must yield complete SSE events as soon as frames arrive, preserve multi-line `data:` semantics, parse `event` / `id` / `retry`, and keep max-response-byte cancellation.
- TDD:
  - RED: stream iterator yields first delta before the response closes.
  - RED: split chunks and multi-line data produce one event.
  - RED: oversize stream cancels the reader before reading all chunks.
- Verification: `pnpm --filter @knowledge/generation test -- src/generation.test.ts`.

Status: completed in commit `8be3ac4`.

### R2: Provider Reliability Boundary

- Issues: L13, L22.
- Goal: embeddings/generation/parser providers share structured provider errors, retry/backoff for 429/503-style failures, and `AbortSignal` cancellation support.
- TDD:
  - retriable status retries with bounded attempts and delay injection.
  - abort signal stops in-flight provider fetch.
  - callers can distinguish rate-limit, timeout/abort, validation, and provider-response errors.

Status: completed; retry/abort sub-slices landed in commits `d75b525`, `64bbfbc`, and `72980b3`, and structured provider errors are covered by the current slice.

### R3: Migration Runner And Lifecycle Closure

- Issues: M8, L1, L19.
- Goal: add a minimal versioned migration runner over `DatabaseAdapter.execute`, a `closePlatformAdapter` helper, and one preferred health path.
- TDD:
  - pending migrations are applied once and recorded in `schema_migrations`.
  - failed migrations do not advance version state.
  - close helper calls optional adapter `close()` methods once and tolerates missing close hooks.

Status: completed; RED/GREEN tests cover migration application, failed migration recording, and idempotent platform close hooks.

### R4: Command Registry Type Safety

- Issues: L4.
- Goal: make command execution output validation explicit instead of decorative generics.
- TDD:
  - command definitions may include an output schema.
  - invalid handler output fails before returning.
  - existing commands without output schema keep current behavior.

Status: completed; command definitions now support optional output schemas, invalid outputs fail before response, and legacy commands without output schemas remain unchanged.

### R5: WASM Build And Diff Guardrails

Superseded 2026-07-16: the guarded algorithms were migrated to TypeScript and the WASM build
pipeline was removed. The resource-limit and deterministic-diff requirements remain active.

- Issues: L6, L8.
- Goal: make `wasm-opt` optimization optional-but-detected in build, preserve reproducible cargo flags, and document/enforce effective LCS diff cell limits.
- TDD:
  - build script argument assembly includes `--locked`.
  - `wasm-opt` is skipped with an explicit warning when unavailable and used when available.
  - diff config rejects inconsistent `maxTokens` / `maxDiffCells` combinations.

Status: completed; build helper tests cover locked cargo args and optional `wasm-opt`, and Rust/TS diff boundaries reject inconsistent LCS matrix configs.

### R6: Shared Utilities And API Module Decomposition

- Issues: H1, L9, L20.
- Goal: keep shrinking `packages/api/src/index.ts`, extract repeated JSON/validation/formatting utilities, and reduce redundant embeddings clone paths where ownership is already validated.
- TDD:
  - static guardrails prevent new broad responsibilities in `index.ts`.
  - shared utilities cover null/canonicalization/formatting edge cases.
  - embeddings provider tests assert clone boundaries only at external input/output.

Status: in progress; JSON clone/byte/DB-column utilities are extracted to `json-utils.ts` with regression tests and a code-health guardrail preventing them from returning to `index.ts`. Embedding dense-vector clone paths now avoid duplicate cache/HTTP parsing copies while preserving external return clone isolation. Database row column helpers are extracted to `database-row-utils.ts` with focused tests and a gateway guardrail. `stableJson` is centralized in `@knowledge/core` and shared by embeddings/generation. API SQL rendering helpers are extracted to `database-sql-utils.ts` with identifier escaping tests. Auth verifier/middleware/scope helpers are extracted to `auth.ts` with a code-health guardrail. SSE event formatting is extracted to `sse-events.ts` with direct wire-format tests. Job payload JSON compatibility helpers are extracted to `job-payload-utils.ts` with clone-isolation and serialization-error tests. Trace route and rate-limit tool classification is extracted to `route-classification.ts` with low-cardinality route tests. HTTP trace middleware helpers are extracted to `http-tracing.ts` with trace-id and error-class tests. Rate limiter contracts, in-memory implementation, and middleware are extracted to `rate-limit.ts` with bounded-capacity tests. Gateway default parser and unavailable compute runtime wiring are extracted to `gateway-defaults.ts` with fail-closed tests. SourceFS and document storage path helpers are extracted to `storage-path-utils.ts` with traversal/key-isolation tests. Graph/path/golden-question cursor codecs are extracted to `cursor-utils.ts` with validation-error tests. KnowledgeFS path parsing and classification helpers are extracted to `knowledge-fs-path-utils.ts` with validation tests. Document upload parsing, bounded bulk upload reads, hashing, and status URL helpers are extracted to `document-upload-utils.ts` with upload-focused tests and a code-health guardrail. Storage quota policies and enforcement are extracted to `storage-quota.ts` with no-quota short-circuit and over-quota tests. Gateway component health aggregation is extracted to `gateway-health.ts` with thrown-provider and missing-provider tests. OpenAPI handler casting helpers are extracted to `openapi-handler-utils.ts` with zero-wrapper runtime tests. Safe-shell planning, parsing, transforms, and output bounding are extracted to `safe-shell.ts` and covered directly by the existing shell regression suite. Retention policy repository and retention cleanup workers are extracted to `retention-policy.ts` with focused clone-isolation and bounded cleanup tests plus a code-health guardrail. Document deletion lifecycle repository is extracted to `document-deletion-lifecycle.ts` with clone-isolation and bounded-retention tests plus a code-health guardrail. Bulk operation contracts and bounded in-memory repository are extracted to `bulk-operation.ts` with tenant-scope, clone-isolation, and capacity tests plus a code-health guardrail. Parse artifact memory/database repositories, row mapping, clone helper, prune validation, and capacity error are extracted to `parse-artifact-repository.ts` with clone-isolation and parameterized SQL tests plus a code-health guardrail. Resource mount repository contracts, bounded in-memory storage, longest-prefix lookup, and clone helper are extracted to `resource-mount-repository.ts` with tenant/space scoping tests plus a code-health guardrail. Golden question memory/database repositories, list-limit errors, row mapping, and clone helper are extracted to `golden-question-repository.ts` with clone-isolation, stable pagination, bounded-capacity, and parameterized SQL tests plus a code-health guardrail. Embedding model memory/database registries, stable keyset pagination, upsert SQL, row mapping, clone helper, and capacity error are extracted to `embedding-model-registry.ts` with bounded-capacity and parameterized SQL tests plus a code-health guardrail. Answer trace recorder assembly is extracted to `answer-trace-recorder.ts` with max-step validation and clone-isolation tests plus a code-health guardrail. Answer trace memory/database repositories and cleanup bounds are extracted to `answer-trace-repository.ts` with parameterized SQL tests plus a code-health guardrail. Document asset memory/database repositories, tenant-scoped reads, usage stats, and parser-status updates are extracted to `document-asset-repository.ts` with parameterized SQL tests plus a code-health guardrail. KnowledgeSpace memory/database repositories, tenant slug uniqueness, and list bounds are extracted to `knowledge-space-repository.ts` with parameterized SQL tests plus a code-health guardrail. Cache-backed session context repository, TTL handling, permission invalidation, and bounded active resource retention are extracted to `session-context-repository.ts` with focused tests plus a code-health guardrail.

KnowledgePath memory/database repositories, duplicate/capacity/list-limit errors, stable keyset pagination, row mapping, and clone helper are extracted to `knowledge-path-repository.ts` with direct repository tests plus a code-health guardrail. KnowledgeNode memory/database repositories, bounded batch/delete/list behavior, row mapping, and clone/sort helpers are extracted to `knowledge-node-repository.ts` with direct repository tests plus a code-health guardrail. KnowledgePath resolution cache key normalization, path byte bounds, corrupt-entry handling, and clone-isolated cache serialization are extracted to `knowledge-path-resolution-cache.ts` with direct cache tests plus a code-health guardrail.

Retrieval text normalization and query language detection are extracted to `retrieval-text-utils.ts` with direct CJK/Latin/mixed-language tests plus a code-health guardrail.

Index projection repository contracts, bounded memory implementation, database implementation, version lifecycle, row mapping, and projection parameter helpers are extracted to `index-projection-repository.ts` with direct repository tests plus a code-health guardrail.

Dense and FTS index projection builders plus projection build status normalization are extracted to `index-projection-builders.ts` with direct builder tests plus a code-health guardrail.

Incremental reindexer contracts, validation, and rebuild orchestration are extracted to `index-reindexer.ts` with direct reindex tests plus a code-health guardrail.

Retrieval candidate contracts, row mapping, metadata filtering, permission filtering, and clone helpers are extracted to `retrieval-candidates.ts` with direct candidate tests plus a code-health guardrail.

Hybrid retrieval item contracts, RRF runtime contract, default RRF fusion, and injected runtime fusion mapping are extracted to `retrieval-fusion.ts` with direct fusion tests plus a code-health guardrail.

Hybrid reranking, rerank/evidence text fallback selection, and reranked item clone isolation are extracted to `retrieval-rerank.ts` with direct rerank tests plus a code-health guardrail.

Hybrid retrieval item to evidence bundle item mapping, freshness/conflict extraction, and score projection are extracted to `retrieval-evidence.ts` with direct evidence tests plus a code-health guardrail.

Retrieval evaluation bounds, generic score validation, A/B strategy normalization, and winner selection are extracted to `retrieval-evaluation-utils.ts` with direct utility tests plus a code-health guardrail.

Retrieval evaluation report assembly, empty report factories, clone helpers, and metric delta helpers are extracted to `retrieval-evaluation-reports.ts` with direct report tests plus a code-health guardrail.

Review checkpoint: mandatory 10-commit health review completed after implementation commit `545a158`; no blocking findings were found, and the next implementation counter starts after the review checkpoint commit.

Review checkpoint: mandatory 10-commit health review completed after implementation commit `2a8533f`; no blocking findings were found, and the next implementation counter starts after the review checkpoint commit.

Graph index repository contracts, bounded memory/database implementations, traversal SQL, and graph extraction types are extracted to `graph-index-repository.ts` and `extraction-types.ts` with direct graph tests plus a code-health guardrail.

Graph index writer contracts, metadata extraction helpers, and deterministic graph id generation are extracted to `graph-index-writer.ts` with direct graph tests plus a code-health guardrail.

Summary tree builder contracts, maintenance flow, validation helpers, prompt assembly, and deterministic summary id generation are extracted to `summary-tree.ts` with direct summary-tree tests plus a code-health guardrail.

Retrieval path builders for summary-tree, table-specific, image/OCR, and graph-expanded retrieval are extracted to `retrieval-paths.ts`, while shared hybrid retrieval result/input/plan types are extracted to `retrieval-types.ts` with direct path coverage plus a code-health guardrail.

Retrieval planner contracts, auto-mode resolution, bounded fanout plan assembly, trace attributes, and default fast-plan fallback are extracted to `retrieval-planner.ts` with gateway planner coverage plus a code-health guardrail.

Query normalization and EvidenceBundle cache contracts are extracted to `retrieval-cache.ts`, while retrieval metadata filter normalization is extracted to `retrieval-filter-utils.ts`; both are covered by gateway cache tests plus a code-health guardrail.

EvidenceBundle assembly and rule-based answerability evaluation are extracted to `evidence-bundle-assembler.ts` with gateway assembler coverage plus a code-health guardrail.

Database hybrid retrieval SQL execution and basic hybrid retrieval orchestration are extracted to `hybrid-retrieval.ts` with gateway retrieval coverage plus a code-health guardrail.

Retrieval evaluation, advanced judge evaluation, strategy comparison, A/B comparison, and impact evaluation runners are extracted to `retrieval-evaluation-runners.ts` with gateway evaluation coverage plus a code-health guardrail.

Query generation and research task progress SSE response builders are extracted to `gateway-sse-responses.ts` with gateway streaming coverage plus a code-health guardrail.

Review checkpoint: mandatory 10-commit health review completed after implementation commit `af8a811`; no blocking findings were found, and the next implementation counter starts after the review checkpoint commit.

KnowledgeFS result and semantic diff contracts are extracted to `knowledge-fs-types.ts` with a code-health guardrail, creating a clean type boundary for later MCP and FS command registry extraction.

Knowledge MCP contracts and tool summary constants are extracted to `knowledge-mcp-types.ts` with a code-health guardrail, preparing the gateway for a later MCP server extraction.

Agent workspace snapshot request/response, replay, params, and MCP workspace snapshot schemas are extracted to `agent-workspace-snapshot-schemas.ts` with a code-health guardrail.

Knowledge MCP server construction, MCP-specific input schemas, bounded limit checks, and tool registration are extracted to `knowledge-mcp-server.ts` with focused MCP and gateway coverage plus a code-health guardrail.

SourceFS result contracts are extracted to `source-fs-types.ts` with focused SourceFS/gateway coverage plus a code-health guardrail.

SourceFS command registry wiring, mount resolution, object reads, and result assembly are extracted to `source-fs-command-registry.ts` with focused SourceFS/safe-shell/code-health coverage plus a code-health guardrail.

Durable document compilation worker orchestration and ingestion smoke evaluation gate are extracted to `document-compilation-worker.ts` with focused gateway/code-health coverage plus a code-health guardrail.

Embedding model upgrade workflow contracts, validation, evaluation-gated publish/rollback, and queue idempotency helpers are extracted to `embedding-model-upgrade-workflow.ts` with focused gateway/code-health coverage plus a code-health guardrail.

Contextual enrichment flow contracts, cache helpers, budget checks, quality-threshold handling, prompt construction, and metadata assembly are extracted to `contextual-enrichment-flow.ts` with focused contextual/code-health coverage plus a code-health guardrail.

Entity extraction flow contracts, validation, prompt construction, provider orchestration, and metadata assembly are extracted to `entity-extraction-flow.ts` with focused contextual/code-health coverage plus a code-health guardrail.

Review checkpoint: mandatory 10-commit health review completed after implementation commit `f01fa6b`; no blocking findings were found, and the next implementation counter starts after the review checkpoint commit.

Relation extraction flow contracts, validation, prompt construction, provider orchestration, relation metadata parsing, and metadata assembly are extracted to `relation-extraction-flow.ts` with focused contextual/code-health coverage plus a code-health guardrail.

Extraction quality control contracts, validation, entity/relation eligibility checks, duplicate detection, stats aggregation, and batch metadata update orchestration are extracted to `extraction-quality-control-flow.ts` with focused contextual/code-health coverage plus a code-health guardrail.

Topic view materializer contracts, enqueue/process orchestration, bounded semantic topic validation, and materialized path construction are extracted to `topic-view-materializer.ts` with focused contextual/code-health coverage plus a code-health guardrail.

Graph traversal response schemas and clone-isolated mappers are extracted to `graph-traversal-responses.ts` with focused graph/code-health coverage plus a code-health guardrail.

Shared API utility helpers for deterministic child ids, evidence bundle cloning, text diff operation cloning, and string deduplication are extracted to `api-shared-utils.ts` with focused utility/code-health coverage plus a code-health guardrail.

KnowledgeFS response schemas and semantic diff summary validation are extracted to `knowledge-fs-response-schemas.ts` with focused schema/code-health coverage plus a code-health guardrail.

Document upload, bulk document, and document compilation response schemas are extracted to `document-response-schemas.ts` with focused schema/code-health coverage plus a code-health guardrail.

Research task job, partial-result list, and dry-run plan response schemas are extracted to `research-task-response-schemas.ts` with focused schema/code-health coverage plus a code-health guardrail.

Bulk operation progress and retention policy response schemas are extracted to `operation-policy-response-schemas.ts` with focused schema/code-health coverage plus a code-health guardrail.

KnowledgeSpace, GoldenQuestion, ParseArtifact, and AnswerTrace response schemas are extracted to `core-resource-response-schemas.ts` with focused schema/code-health coverage plus a code-health guardrail.

Review checkpoint: mandatory 10-commit health review completed after implementation commit `fb2f326`; no blocking findings were found, and the next implementation counter starts after the review checkpoint commit.

KnowledgeSpace and GoldenQuestion request, params, and list query schemas are extracted to `knowledge-space-golden-question-schemas.ts` with focused schema/code-health coverage plus a code-health guardrail.

Research task create, dry-run planning, params, partial-result query, and progress query schemas are extracted to `research-task-request-schemas.ts` with focused schema/code-health coverage plus a code-health guardrail.

Document upload, asset, parse artifact, compilation job, bulk upload/delete/reindex request schemas are extracted to `document-request-schemas.ts` with focused schema/code-health coverage plus a code-health guardrail.

KnowledgeFS route query and command input schemas are extracted to `knowledge-fs-request-schemas.ts` with focused schema/code-health coverage plus a code-health guardrail.

Shared gateway route schemas for error responses, graph traversal, query streaming, answer-trace params, retention patches, and bulk operation params are extracted to `gateway-route-schemas.ts` with focused schema/code-health coverage plus a code-health guardrail.

KnowledgeFS not-found and validation errors are centralized in `knowledge-fs-errors.ts` with focused error/code-health coverage, leaving gateway route handlers to import shared error classes instead of defining local ones.

Golden question annotation types and metadata assembly are extracted to `golden-question-annotation.ts` with focused clone-isolation, bounded annotation retention, and code-health coverage.

Query virtual entry helpers and production bad-case golden question input assembly are extracted to `query-virtual-entries.ts` with focused evidence bundle extraction, virtual pagination, and code-health coverage.

KnowledgeFS command registry, directory listing, grep/find/cat/stat/diff, and table/image rendering helpers are extracted to `knowledge-fs-command-registry.ts` with focused command registration and permission-boundary tests plus a code-health guardrail.

Bulk operation progress summary assembly is extracted to `bulk-operation-summary.ts` with focused compilation-job status tests plus a code-health guardrail.

Review checkpoint: mandatory 10-commit health review completed after implementation commit `14576c7`; no blocking findings were found, and the next implementation counter starts after the review record commit.

Tenant-scoped AnswerTrace access is extracted to `answer-trace-access.ts` with focused cross-tenant nulling tests plus a code-health guardrail.

Async trace span wrapping is extracted to `trace-async.ts` with focused ok/error span tests plus a code-health guardrail.

Gateway option contracts are extracted to `gateway-options.ts` with a code-health guardrail, leaving the gateway entrypoint to import the configuration boundary instead of defining it inline.

Gateway OpenAPI shared contracts are extracted to `gateway-openapi-contracts.ts`, including the Hono env type and common 401/403 response specs used by protected route definitions.

KnowledgeSpace CRUD route definitions are extracted to `knowledge-space-routes.ts`, keeping `index.ts` focused on route registration and handler wiring for that resource.

GoldenQuestion and production bad-case route definitions are extracted to `golden-question-routes.ts`, including the corrected shared `CreateProductionBadCaseSchema` import from gateway route schemas.

GoldenQuestion handler registration is extracted to `golden-question-handlers.ts`, preserving tenant-scoped CRUD, annotation metadata, cursor pagination, and production bad-case capture behavior outside the gateway entrypoint.

DocumentCompilation job handler registration is extracted to `document-compilation-handlers.ts`, preserving tenant-scoped job reads, unavailable-worker responses, and cancellation conflict handling outside the gateway entrypoint.

AnswerTrace handler registration is extracted to `answer-trace-handlers.ts`, preserving tenant-scoped trace access and bounded evidence/conflict/missing virtual entry pagination outside the gateway entrypoint.

Operation policy handler registration is extracted to `operation-policy-handlers.ts`, preserving tenant-scoped bulk operation summaries and retention policy read/update behavior outside the gateway entrypoint.

Query streaming handler registration is extracted to `query-handlers.ts`, preserving tenant-scoped space checks, session context recording, and SSE response behavior outside the gateway entrypoint.

Review checkpoint: mandatory 10-commit health review completed after implementation commit `6590241`; no blocking findings were found, full verification remained green, and the next implementation counter starts after this review checkpoint.

Agent workspace snapshot handler registration is extracted to `agent-workspace-snapshot-handlers.ts`, preserving tenant-scoped snapshot create/get/replay behavior outside the gateway entrypoint.

Gateway system route definitions are extracted to `gateway-system-routes.ts`, starting with the public `/health` route.

OpenAPI document metadata is extracted to `gateway-openapi-document.ts`, leaving `createKnowledgeGateway` to register the document instead of defining static title/version metadata inline.

Gateway error and not-found handlers are extracted to `gateway-error-handlers.ts`, preserving structured HTTPException passthrough and bounded unexpected-error logging.

Gateway app shell construction is extracted to `gateway-app.ts`, centralizing `OpenAPIHono` creation plus shared error/not-found handler installation.

Review checkpoint: mandatory 10-commit health review completed after implementation commit `be2392e`; no blocking findings were found. Residual decomposition work remains in `packages/api/src/index.ts`, especially document, research task, and KnowledgeFS route definitions, and the next implementation counter starts after this review record commit.

Document read route definitions are extracted to `document-read-routes.ts`, covering tenant-scoped document asset and parse artifact reads.

Document write and bulk route definitions are extracted to `document-write-routes.ts`, covering upload, bulk upload, bulk delete, and bulk reindex OpenAPI route contracts while keeping handler wiring in the gateway entrypoint.

Document compilation job route definitions are extracted to `document-compilation-routes.ts`, covering job status and cancel route contracts while preserving the existing gateway handler flow.

Research task route definitions are extracted to `research-task-routes.ts`, covering dry-run planning, create/status, partial evidence listing, progress SSE, and cancel route contracts.

Agent workspace snapshot route definitions are extracted to `agent-workspace-snapshot-routes.ts`, covering snapshot creation, lookup, and replay route contracts.

Answer trace and query virtual route definitions are extracted to `answer-trace-routes.ts`, covering trace lookup plus evidence, conflict, and missing-information virtual trees.

Bulk operation and retention policy route definitions are extracted to `operation-policy-routes.ts`, covering bulk progress lookup plus tenant and KnowledgeSpace retention policy read/update contracts.

Graph traversal route definition is extracted to `graph-routes.ts`, covering the bounded tenant-scoped graph traversal route contract.

Query streaming route definition is extracted to `query-routes.ts`, covering the authenticated streaming answer route contract.

KnowledgeFS route definitions are extracted to `knowledge-fs-routes.ts`, covering list, tree, grep, find, diff, open-node, cat, and stat route contracts. After this slice, `packages/api/src/index.ts` no longer defines OpenAPI routes directly with `createRoute`.

Review checkpoint: mandatory 10-commit health review completed after implementation commit `faa4d54`; no blocking findings were found. Route definitions are now extracted from `packages/api/src/index.ts`; residual decomposition work remains in handler wiring and runtime composition, and the next implementation counter starts after this review record commit.

KnowledgeFS handler registration is extracted to `knowledge-fs-handlers.ts`, keeping the route command execution wiring and KnowledgeFS error mapping outside `packages/api/src/index.ts`.

Document read handler registration is extracted to `document-read-handlers.ts`, preserving tenant-scoped document asset and parse artifact lookup behavior while removing two read handlers from the gateway entrypoint.

Graph handler registration is extracted to `graph-handlers.ts`, preserving bounded tenant-scoped traversal lookup and empty-result 404 behavior outside the gateway entrypoint.

Gateway system handler registration is extracted to `gateway-system-handlers.ts`, preserving public health response composition and component health checks outside the gateway entrypoint.

KnowledgeSpace handler registration is extracted to `knowledge-space-handlers.ts`, preserving tenant-derived CRUD behavior and existing 400/404/409/429 error mappings outside the gateway entrypoint.

## Execution Rule

- Work top-down unless a new high-priority regression appears.
- Each behavioral slice starts with a failing test, then implementation, then focused verification.
- After each committed slice, continue to the next remaining iteration without stopping unless a user confirmation is genuinely required.
