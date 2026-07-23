# KnowledgeFS Operator Manual

This manual is for people running KnowledgeFS as an internal Dify backend in development,
staging, or production. KnowledgeFS has no independent deployment mode.

## Operating Model

KnowledgeFS is an internal Dify service with independently observable dependencies:

| Service | Responsibility |
|---|---|
| Admin Console | Human workflows, upload/evaluation dashboards, Retrieval Studio, trace diagnostics. |
| Hono API | Auth, ingestion, retrieval, KnowledgeFS, queries, evaluation routes, traces, MCP tools. |
| Database | Tenant-scoped metadata, generated artifacts, nodes, projections, traces, evaluation data. |
| Dify inner API | Model instances, datasource plugins, and unified object storage. |
| Object storage | Dify-owned raw uploaded document bytes. |
| Parser service | Unstructured-compatible parsing for complex document formats. |
| Queue runtime | Async document compilation, bulk jobs, cleanup, and research work when configured. |
| TypeScript compute | Pure bounded compute: chunking, token counting, RRF, packing, diff. |

The Admin Console must not bypass the Hono API for business data. The API is the security and tenant boundary.

## Daily Health Checks

Run these at the start of each operating day and after each deployment:

```bash
curl -fsS "$API/health"
curl -fsS "$API/openapi.json" >/dev/null
pnpm eval:regression
```

For the local developer harness only:

```bash
docker compose --env-file infra/local/.env -f infra/local/compose.yaml --profile apps ps
docker compose --env-file infra/local/.env.example -f infra/local/compose.yaml --profile apps config >/dev/null
```

Expected health:

- API returns healthy platform adapter status.
- Dify model, datasource, and object-storage configuration is healthy.
- Parser, database, cache, and enabled job components are healthy.
- Retrieval regression gate passes recall, citation-hit, no-answer, citation accuracy, and faithfulness thresholds.

## Release Checklist

Before promoting a release candidate:

```bash
pnpm install --frozen-lockfile
pnpm check
pnpm build
pnpm lint
pnpm compose:config
docker compose --env-file infra/local/.env.example -f infra/local/compose.yaml --profile apps config
pnpm docker:api:build
pnpm docker:api:bundle-smoke
git diff --check
```

`docker:api:bundle-smoke` deliberately starts the built API bundle with `NODE_ENV=test`. It proves
that the container can boot and serve `/health`. It also requires `ok === false` and
`components.objectStorage === false`, proving that an isolated container stays unhealthy without
Dify instead of falling back to standalone storage. It does not exercise production database
repositories, durable compilation, Dify object storage, or providers. Production promotion still
requires the Dify-connected health and tenant-scoped upload/query checks below. The legacy
`docker:api:http-smoke` command is only an alias for this isolated check.

Confirm:

- `.harness/changes` contains the change record for the release slice.
- `.harness/docs/TEMP-progress-document.md` records RED/GREEN verification and commit count.
- TypeScript compute tests and coverage gates passed.
- Database migration drift check passed.
- The implementation commit count since the latest review checkpoint is below 10, or the mandatory health review has been completed.

## Tenant And Auth Operations

Business routes require bearer auth. A valid subject includes `subjectId`, `tenantId`, and `scopes`.

Use scoped test tokens for smoke checks:

- `knowledge-spaces:read` for read-only checks.
- `knowledge-spaces:write` for upload and mutation checks.
- `knowledge-spaces:*` only for trusted administrative smoke flows.

Operational rules:

- Never put `tenantId` in client requests expecting it to be trusted.
- Treat cross-tenant 404s as expected behavior.
- Rotate Dify capability verification material through the environment secret manager; provider
  secrets remain in Dify and must never be copied into KnowledgeFS.
- Never log bearer tokens.

## Ingestion Operations

Single-file ingestion:

1. Create or choose a KnowledgeSpace.
   - For a new space, select its Dify-managed `pluginId`, `provider`, and embedding `model` at
     creation time or with `PUT /knowledge-spaces/{id}/embedding-profile` before uploading data.
     KnowledgeFS sends that routing identity to Dify's inner model API; Dify resolves the
     workspace model instance and credentials. Do not configure or copy model credentials into
     KnowledgeFS.
   - Do not configure a vector dimension; it is observed from the selected model and persisted by
     the service. Select the profile before the first ingestion. Ingestion atomically freezes the
     profile, and any later change requires the reindex/publish workflow (even if that first upload
     subsequently fails).
   - When rolling this admission-latch release into an existing cluster, drain older ingestion
     instances before enabling profile updates; older binaries do not stamp the latch.
2. Upload `multipart/form-data` field `file` to `/knowledge-spaces/{id}/documents`.
3. Check response:
   - `201` means synchronous MVP parsing completed.
   - `202` means async compilation was queued.
   - `500` with `Document parsing failed` means the raw object and asset should remain for retry or diagnostics.
4. Fetch `/knowledge-spaces/{id}/documents/{documentId}`.
5. Fetch `/knowledge-spaces/{id}/documents/{documentId}/parse-artifacts/{version}` when parsed.

Bulk ingestion:

- Keep file count and total byte size within configured limits.
- Use bulk upload when document compilation jobs are configured.
- Monitor `bulkJobId` and per-document status URLs.
- If a bulk upload fails after object writes, cleanup is best-effort; inspect object storage for leftover keys under the tenant/space prefix.

Parser failure triage:

| Symptom | Likely Cause | Action |
|---|---|---|
| `400` upload error | Missing multipart file or invalid body | Retry with `file` field. |
| `413` upload error | File size or quota exceeded | Reduce file size or adjust quota after review. |
| `500 Document parsing failed` | Parser or artifact persistence failed | Check `x-trace-id`, parser component health, and artifact repository logs. |
| Asset stuck `pending` | Async compilation worker unavailable | Check queue runtime and job status. |
| Asset `failed` | Parser/job failure or status update after job start failure | Reindex after fixing dependency. |

## Retrieval And Query Operations

Use `/queries` for user-facing retrieval plus generation. The endpoint streams SSE and records an answer trace.

The service has three retrieval pipelines and one optional public router:

- **Fast** runs ordinary dense + FTS hybrid recall, candidate fusion, and the configured final
  rerank.
- **Research** uses published Summary/Outline/PageIndex navigation. It does not run ordinary
  hybrid recall, Graph expansion, or the ordinary candidate reranker.
- **Deep** runs ordinary hybrid recall, adds permission-scoped Graph expansion, merges both
  candidate sets, and then runs one unified final rerank.
- An explicit `mode: "auto"` asks the knowledge space's published `reasoningModel` through the
  Dify model runtime to choose one of those pipelines. Auto is not a fourth pipeline. Omitting
  `mode` uses `defaultMode` directly, and explicit concrete modes bypass the router.

Auto routing is model-based; there is no CJK/language, query-length, word-count, or keyword
heuristic fallback. On timeout, provider failure, invalid structured output, or model-identity
mismatch, the request safely uses the published `defaultMode`. Treat repeated fallback decisions
as a reasoning-provider health signal, not as successful classifier behavior.

Operate with these checks:

- Record `x-trace-id` for HTTP/log/OTLP correlation, `x-query-run-id` (or SSE `data.traceId`) for the
  durable AnswerTrace resource, and `x-session-id` for session continuation. These IDs are not
  interchangeable.
- Fetch `/queries/{traceId}` with `x-query-run-id` or SSE `data.traceId`, never the transport
  `x-trace-id`.
- Use `/queries/{traceId}/evidence`, `/conflicts`, and `/missing` for bounded virtual evidence views.
- Use the Admin trace comparison and failed query diagnostics panels to compare routing, recall candidates, filters, rerank changes, and evidence bundles.
- Inspect the persisted `query.route` step when diagnosing mode selection. It records
  `requestedMode`, concrete `resolvedMode`, `resolver` (`explicit`, `llm`, or `fallback`), prompt
  version, bounded model/provider/usage provenance, duration, and `degraded` plus a safe error class
  for fallback. It never contains the router prompt or raw model response and is not streamed as an
  SSE event.
- For asynchronous Research jobs, an explicit Auto decision is made once against the frozen
  published profile during job creation. The concrete mode and bounded routing provenance are
  persisted; queue retries, lease recovery, and worker restarts must reuse that decision rather
  than invoke the classifier again.
- Before deploying this contract over a database that may contain unfinished legacy Research jobs
  with `mode=auto`, backfill each job to a reviewed concrete mode or cancel it. Workers fail closed
  on unresolved legacy Auto jobs because replaying the old heuristic would violate the frozen
  model/publication contract.

Do not place raw answer text, document chunks, prompts, JWTs, uploaded bytes, or AnswerTrace
evidence text in operational logs/OTLP attributes unless an incident-specific data handling process
authorizes it. AnswerTrace itself intentionally persists authorized evidence text inside its
EvidenceBundle, so apply the same data-classification and access controls to trace storage.

## Evaluation Operations

Evaluation quality is governed by:

- Golden question CRUD.
- Automatic question generation with human review.
- Human annotation workflow.
- Advanced metrics: context precision, relevance, faithfulness, citation accuracy.
- A/B retrieval strategy comparison.
- CI regression gate.

Routine flow:

1. Capture production bad cases from failed traces.
2. Review generated or captured questions before they enter the golden set.
3. Add human annotations for answer correctness and evidence relevance.
4. Run strategy comparisons against the same bounded golden set.
5. Promote retrieval or prompt changes only when `pnpm eval:regression` passes.

Regression gate failures:

| Failure | Meaning | Response |
|---|---|---|
| `totalQuestions below minQuestions` | Sample is too small to trust. | Restore or regenerate the evaluation report. |
| `recallAtK below minRecallAtK` | Retrieval missed expected evidence. | Inspect candidate ranking, filters, index freshness. |
| `citationHitRate below minCitationHitRate` | Citations do not cover expected evidence ids. | Inspect citation normalization and source locations. |
| `citationAccuracy below minCitationAccuracy` | Judge found unsupported or wrong citations. | Review answer/evidence alignment. |
| `faithfulnessScore below minFaithfulnessScore` | Judge found unsupported answer claims. | Review prompts, evidence packing, and generation model behavior. |
| `noAnswerRate exceeds maxNoAnswerRate` | System is abstaining too often. | Inspect retrieval thresholds and answerability classifier. |

## KnowledgeFS Operations

KnowledgeFS routes provide bounded filesystem-like inspection:

- `ls`, `tree`, `find` for navigation.
- `cat`, `stat`, `open_node` for inspection.
- `grep` for search.
- `diff` for version comparison.

Rules:

- Always supply explicit limits.
- Prefer `open_node` for citation-ready node inspection.
- Use `diff` for troubleshooting stale or changed document versions.
- Do not run ad hoc database scans to recreate KnowledgeFS views; use the bounded API or repository tools.

## Storage And Retention

Object storage:

- Raw documents are stored under tenant/space/document prefixes.
- Object metadata includes asset id, KnowledgeSpace id, tenant id, hash, and uploader when available.
- Dify integrated mode reaches Dify's configured unified storage through the authenticated inner
  API and must not receive separate provider credentials.
- KnowledgeFS must not connect directly to an object store or accept object-storage credentials.

Retention:

- Use tenant-level and KnowledgeSpace-level retention policy routes to configure cleanup cutoffs.
  The policy is declarative: verify that retention workers are scheduled and monitor their job
  results, because PATCH does not synchronously delete retained data.
- Do not bulk-delete object prefixes manually unless the database cascade state has been reviewed.
- Use bulk delete APIs for bounded cascade tracking across assets, artifacts, nodes, projections, objects, and lifecycle records.

## Performance Guardrails

Treat performance regressions as correctness failures:

- No unbounded list, dequeue, stream read, upload, provider response, or cache entry.
- Every database read path needs an explicit `maxRows` or route-level limit.
- Avoid N+1 queries; prefer repository methods that join or batch required data.
- Cache keys must include tenant, subject or permission snapshot, strategy, model, and index versions where relevant.
- Queue, retention, test adapters, and diagnostic surfaces must keep explicit max sizes.
- Never add a hot path that fetches object storage bytes after upload when bytes are already in memory.

## Incident Response

Use this order during production incidents:

1. Identify blast radius: tenant, KnowledgeSpace, document ids, trace id, job id, or bulk job id.
2. Check `/health` and component-level health.
3. Check recent deploy commit and `.harness/changes` record.
4. Gather bounded evidence: trace, job status, document asset, parse artifact, KnowledgeFS `stat/open_node`.
5. Stop the unsafe path:
   - Disable traffic to Admin for UI-only bugs.
   - Roll back API for ingestion, retrieval, auth, persistence, or queue bugs.
   - Pause workers or queue consumers for runaway async work.
6. Preserve data. Do not delete database rows or object prefixes without a recovery plan.
7. Add a regression test or evaluation case before closing the incident.

## Rollback Procedure

1. Stop or shift traffic from the faulty service.
2. Roll back API first for backend or data-path issues.
3. Roll back Admin first only for UI-only issues.
4. Keep database migrations in place unless a reviewed down-migration exists.
5. Keep object storage data in place.
6. Re-run smoke checks and `pnpm eval:regression`.
7. Record the rollback in `.harness/changes`.

## Observability

Trace ids:

- Every response should include `x-trace-id` for transport correlation. Query streams additionally
  expose `x-query-run-id` as the durable Query/AnswerTrace identity.
- Ingestion spans include bounded steps such as space lookup, upload read/hash, object put, asset create, parser parse, artifact create, status update, cleanup, and failure marking.
- Query traces record evidence, conflicts, missing evidence, and generation metadata.
- Query traces include `query.route` so operators can distinguish an explicit/default concrete
  selection, an LLM Auto selection, and a degraded Auto fallback without logging query content.

Safe attributes:

- Route, method, status, tenant id, subject id, low-cardinality error class, job id, trace id.

Forbidden attributes:

- JWTs.
- Raw file bytes.
- Full document text.
- Provider prompts or raw model responses.
- Secrets or object bodies.

## Admin Console Workflows

Use the Admin Console for:

- Upload health and retrieval preview.
- Trace viewer and trace comparison.
- Evaluation dashboard.
- Retrieval Studio comparison.
- Golden question management and generated-question review.
- Human annotation workflow.
- Failed query diagnostics.

The Admin BFF is a thin proxy and must not become a second business API.

## When To Escalate

Escalate before continuing feature work when:

- The 10-commit review cadence is due.
- Coverage drops below 90%.
- `pnpm check`, `pnpm build`, `pnpm lint`, or Compose config fails.
- A change needs production secrets, live database migration execution, or external provider account changes.
- A proposed fix requires deleting tenant data or object storage prefixes.
