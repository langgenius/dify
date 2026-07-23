# Knowledge-FS Gateway — API Reference

Human-readable reference for the HTTP API served by the gateway (`apps/api`, Hono + zod-openapi).
It is maintained alongside the route definitions in `packages/api/src/*-routes.ts` and their zod
request/response schemas. `GET /openapi.json` is the authoritative machine-readable inventory when
the live spec and this companion document differ.

## Overview

- **Base URL (local dev)**: `http://localhost:8788` (the gateway). The Swagger UI proxy runs on
  `http://localhost:8088` and fetches `/openapi.json` from the gateway.
- **Live spec**: `GET /openapi.json` — the machine-readable OpenAPI document (public, unauthenticated),
  served via `app.doc(...)`. This reference is a human-readable companion.
- **Content type**: JSON (`application/json`) unless noted; document upload is `multipart/form-data`;
  streaming answers/progress are `text/event-stream`; raw multimodal assets are
  `application/octet-stream`.

## Authentication & scopes

- **Bearer token** (JWT) on every guarded route: `Authorization: Bearer <token>`. The tenant is taken
  from the JWT; a knowledge space is always resolved as `spaces.get({ id, tenantId })`, so one tenant
  can never read another tenant's space (returns `404`).
- **Scopes** (`getRequiredScope`): every `GET` needs `knowledge-spaces:read`; every `POST/PATCH/DELETE`
  needs `knowledge-spaces:write` — **except** `POST /queries`, `POST /research-tasks/plan`, and
  `POST /agent-workspace-snapshots/{id}/replay`, which need only `read`. The wildcard scope
  `knowledge-spaces:*` satisfies both.
- **Auth is path-prefix middleware**, not per-route: it guards `/knowledge-spaces*`, `/queries*`,
  `/jobs*`, `/research-tasks*`, `/agent-workspace-snapshots*`, `/bulk-jobs*`, `/retention-policy`.
  **Public (no auth)**: `GET /health` and `GET /openapi.json`.
- **Auth failures**: `401` (missing/invalid token), `403` (token lacks the required scope), both
  `{ error: string }`.

## Conventions

- **Errors**: non-2xx bodies are `{ error: string }` (unless a richer shape is documented, e.g. research
  task `422`).
- **Pagination**: list endpoints take `cursor` (opaque string) + `limit`, and return
  `{ items: [...], nextCursor?: string }`. Pass `nextCursor` back as `cursor` for the next page.
- **Strict bodies/queries**: most request bodies and query objects are `.strict()` — unknown keys are
  rejected with `400`.
- **SSE**: streaming endpoints return `text/event-stream`; frames are `event: <name>\ndata: <json>\n\n`.
- **Datetimes** are ISO-8601 strings unless a field is documented as an epoch number.

---

## Knowledge spaces & documents

### `POST /knowledge-spaces`
**Description**: Create a new knowledge space for the caller's tenant.
**Auth**: Bearer; scope `knowledge-spaces:write`.
**Path params**: None.
**Query params**: None.
**Request body** (`application/json`, strict): `name` (string, 1–160, required); `slug` (string, required, `^[a-z0-9]+(?:-[a-z0-9]+)*$`) — tenant-unique; `description` (string, ≤2000, optional); `embeddingProfile` (optional) `{ pluginId, provider, model }`. When omitted, the configured deployment default is persisted for new spaces. Clients cannot set credentials, dimension, revision, or `vectorSpaceId`.
**Responses**:
- `201`: `KnowledgeSpace` `{ id: uuid, name, slug, description?, tenantId, createdAt, updatedAt }`.
- `409` slug conflict; `429` capacity exceeded; `401`/`403`.

### `GET /knowledge-spaces`
**Description**: List the tenant's knowledge spaces (cursor-paginated).
**Auth**: Bearer; scope `knowledge-spaces:read`.
**Query params** (strict): `limit` (int ≥1, optional, default 100); `cursor` (string, optional).
**Responses**: `200` `{ items: KnowledgeSpace[], nextCursor?: string }`; `400`; `401`/`403`.

### `GET /knowledge-spaces/{id}`
**Description**: Fetch a single knowledge space by id.
**Auth**: Bearer; scope `knowledge-spaces:read`.
**Path params**: `id` (uuid).
**Responses**: `200` `KnowledgeSpace`; `404`; `401`/`403`.

### `GET /knowledge-spaces/{id}/manifest`
**Description**: Return the space's control-plane manifest (storage/consistency/quota policies).
**Auth**: Bearer; scope `knowledge-spaces:read`.
**Path params**: `id` (uuid).
**Responses**:
- `200`: `KnowledgeSpaceManifest` — `{ id, knowledgeSpaceId, tenantId, manifestVersion: int, embeddingProfile?: { pluginId, provider, model, vectorSpaceId, revision, dimension? }, embeddingProfileFrozenAt?: datetime, minClientVersion, nodeSchemaVersion: int, parserPolicyVersion, projectionSetVersion, objectKeyPrefix, metadataDialect: enum(portable|postgres|tidb), storageProvider: enum(dify|memory-dev|r2|s3-compatible), consistencyPolicy: { defaultClass: enum(path-consistent|snapshot-consistent|cache-consistent|eventual-preview), snapshotTtlSeconds, cacheTtlSeconds? }, encryptionPolicy: { strategy: enum(provider-managed|customer-managed|none), keyRef? }, retentionPolicy: { artifactVersionsToKeep, failedCommitRetentionDays, traceRetentionDays }, quotaPolicy: { maxActiveJobCount, maxActiveSessionCount, maxArtifactBytes, maxGraphEntityCount, maxGraphRelationCount, maxNodeCount, maxProjectionCount, maxRawDocumentBytes, maxSegmentCount, maxTraceBytes: int|null, providerBudgets: { maxEmbeddingTokensPerDay, maxLlmTokensPerDay, maxParserPagesPerDay, maxRerankRequestsPerDay: int|null } }, metadata, createdAt, updatedAt }`. `embeddingProfileFrozenAt` is set atomically when the first document ingestion is admitted. New spaces use `dify`; the other storage values are retained only to decode legacy manifests during coexistence.
- `404`; `401`/`403`.

### `PUT /knowledge-spaces/{id}/embedding-profile`
**Description**: Bind the space to a Dify-managed embedding route and immutable vector-space identity.
**Auth**: Bearer; scope `knowledge-spaces:write`.
**Path params**: `id` (uuid).
**Request body** (`application/json`, strict): `{ pluginId, provider, model }` (all non-empty strings). KnowledgeFS never accepts model credentials; Dify resolves the tenant's active credentials through `ModelManager`/`ModelInstance`. The server owns `vectorSpaceId`, revision, and the dimension observed from the first real model response.
**Responses**:
- `200`: `{ pluginId, provider, model, vectorSpaceId, revision, dimension? }`.
- `409`: ingestion has already been admitted (or legacy content exists), so the candidate reindex/publish workflow is required before changing vector space. The admission latch is fail-closed and remains set even if the first upload later fails.
- `404`; `401`/`403`.

### `GET /knowledge-spaces/{id}/status`
**Description**: Bounded runtime status snapshot (leases, sessions, failed commits, index health, storage/parser).
**Auth**: Bearer; scope `knowledge-spaces:read`.
**Path params**: `id` (uuid).
**Responses**:
- `200`: `KnowledgeSpaceStatus` `{ knowledgeSpaceId, tenantId, generatedAt, activeLeases: { count, truncated, items: [{ id, leaseType: enum(read|publish|delete|reindex), targetType, virtualPath, expiresAt }] }, activeSessions: { count, truncated, items: [{ id, subjectId, clientKind: enum(api|mcp|worker|admin), consistencyClass, heartbeatAt, expiresAt }] }, failedCommits: { count, truncated, items: [{ id, status: enum(failed-retryable|failed-terminal), errorCode?, expiresAt?, updatedAt }] }, index: { nodeSchemaVersion, projectionVersion, projectionSetVersion, summaries: { denseVector, fts, graph, metadata: { total, ready, building, stale, failed } } }, manifest: { manifestVersion, metadataDialect, storageProvider, objectKeyPrefix, consistencyClass }, parser: { kind, policyVersion }, storage: { healthy, provider, objectStorageKind } }`.
- `404`; `401`/`403`.

### `GET /knowledge-spaces/{id}/stats`
**Description**: Low-cardinality aggregate statistics over a time window.
**Auth**: Bearer; scope `knowledge-spaces:read`.
**Path params**: `id` (uuid). **Query** (strict): `windowMinutes` (int 1–1440, optional, default 60).
**Responses**:
- `200`: `KnowledgeSpaceStats` `{ knowledgeSpaceId, tenantId, generatedAt, window: { start, end, minutes }, storage: { documentCount, rawDocumentBytes }, projections: { denseVector, fts, graph, metadata: { total, ready, building, stale, failed }, projectionVersion }, commits: { failedRetryable, failedTerminal, sampled, truncated }, cache: { available, entries, totalBytes }, metrics: { available, reason? }, runtime: { activeLeaseSampleCount, activeSessionSampleCount, truncated } }`.
- `400`; `404`; `401`/`403`.

### `GET /knowledge-spaces/{id}/fsck`
**Description**: Bounded filesystem-consistency diagnostics over one check class.
**Auth**: Bearer; scope `knowledge-spaces:read`.
**Path params**: `id` (uuid). **Query** (strict): `check` (enum `raw-objects|artifact-segments|references`, optional, default `raw-objects`); `cursor` (string 1–1024, optional).
**Responses**:
- `200`: `KnowledgeFsckReport` `{ knowledgeSpaceId, tenantId, scannedAt, cursor?, summary: { scanned, info, warning, error, critical, repairable }, issues: [{ code, message, type: enum(missing-raw-object|checksum-mismatch|size-mismatch|missing-artifact-object|segment-hash-mismatch|broken-path-target|missing-node-target|stale-projection|orphaned-staged-object|failed-commit-expired), severity: enum(info|warning|error|critical), repairability: enum(auto-repairable|manual|not-repairable), target: { type, id?, objectKey?, documentAssetId?, parseArtifactId?, virtualPath? } }] (≤1000) }`.
- `400`; `404`; `401`/`403`.

### `GET /knowledge-spaces/{id}/gc/staged-objects`
**Description**: Bounded dry-run listing of staged-object / failed-commit GC candidates.
**Auth**: Bearer; scope `knowledge-spaces:read`.
**Path params**: `id` (uuid). **Query** (strict): `cursor` (string 1–1024, optional); `stagedObjectPrefix` (string 1–1024, object-key-prefix regex, optional).
**Responses**:
- `200`: `KnowledgeFsGcDryRunReport` `{ knowledgeSpaceId, tenantId, dryRunId, generatedAt, cursor?, summary: { candidateCount, stagedObjectCount, failedCommitCount, estimatedBytes }, candidates: [{ candidateType: enum(staged-object|failed-commit|artifact-segment|parse-artifact|index-projection|answer-trace), count>0, estimatedBytes, idempotencyKey, reason, target: {...} }] (≤1000) }`.
- `400`; `404`; `401`/`403`.

### `POST /knowledge-spaces/{id}/gc/staged-objects/execute`
**Description**: Execute deletion for supplied GC candidates (skips objects with an active lease).
**Auth**: Bearer; scope `knowledge-spaces:write`.
**Path params**: `id` (uuid).
**Request body** (`application/json`, strict): `candidates` (array ≤100, required) — each `{ candidateType, count>0, estimatedBytes≥0, idempotencyKey (1–512), reason (1–1000), target: { type: enum(raw-object|artifact-object|artifact-segment|knowledge-path|knowledge-node|index-projection|staged-commit), id?, objectKey?, documentAssetId?, parseArtifactId?, virtualPath? } }`.
**Responses**:
- `200`: `{ tenantId, deleted: int, skipped: int, items: [{ objectKey, idempotencyKey, status: enum(deleted|skipped-active-lease) }] }`.
- `400`; `404`; `401`/`403`.

### `GET /knowledge-spaces/{id}/staged-commits`
**Description**: Read-only paginated staged-commit diagnostics, optionally filtered by status.
**Auth**: Bearer; scope `knowledge-spaces:read`.
**Path params**: `id` (uuid). **Query** (strict): `limit` (int ≥1, optional, default 100); `cursor` (uuid, optional); `status` (enum `received|object-staged|object-verified|metadata-prepared|artifacts-built|nodes-built|projections-built|published|failed-retryable|failed-terminal|canceled|gc-pending|gc-complete`, optional).
**Responses**:
- `200`: `{ items: KnowledgeSpaceStagedCommit[], nextCursor? }` — each `{ id, knowledgeSpaceId, tenantId, idempotencyKey, operationType: enum(document-upload|artifact-segment-write|bulk-reindex|projection-publish), status, documentAssetId?, parseArtifactId?, rawObjectKey?, publishedObjectKey?, projectionFingerprint?, checksum?, sizeBytes?, errorCode?, errorMessage?, expiresAt?, createdAt, updatedAt }`.
- `400`; `404`; `401`/`403`.

### `GET /knowledge-spaces/{id}/leases/active`
**Description**: Read-only paginated diagnostics of currently active KnowledgeFS leases.
**Auth**: Bearer; scope `knowledge-spaces:read`.
**Path params**: `id` (uuid). **Query** (strict): `limit` (int ≥1, optional, default 100); `cursor` (string 1–1024, optional).
**Responses**:
- `200`: `{ items: KnowledgeFsLease[], nextCursor? }` — each `{ id, knowledgeSpaceId, tenantId, sessionId, leaseType: enum(read|publish|delete|reindex), status: enum(active|released|expired|failed), targetId, targetType, targetVersion?, virtualPath, metadata, acquiredAt, heartbeatAt, expiresAt, updatedAt }`.
- `400`; `404`; `401`/`403`.

### `PATCH /knowledge-spaces/{id}`
**Description**: Update mutable fields (name/slug/description).
**Auth**: Bearer; scope `knowledge-spaces:write`.
**Path params**: `id` (uuid). **Body** (`application/json`, strict, all optional): `name` (1–160); `slug` (slug regex); `description` (≤2000).
**Responses**: `200` `KnowledgeSpace`; `404`; `409` slug conflict; `401`/`403`.

### `DELETE /knowledge-spaces/{id}`
**Description**: Delete a knowledge space.
**Auth**: Bearer; scope `knowledge-spaces:write`.
**Path params**: `id` (uuid).
**Responses**: `204`; `404`; `401`/`403`.

### `GET /knowledge-spaces/{id}/documents`
**Description**: List document assets (cursor-paginated).
**Auth**: Bearer; scope `knowledge-spaces:read`.
**Path params**: `id` (uuid). **Query** (strict): `limit` (int 1–100, optional, default 50); `cursor` (uuid, optional).
**Responses**:
- `200`: `{ items: DocumentAsset[], nextCursor?: uuid }` — each `DocumentAsset` `{ id, knowledgeSpaceId, sourceId?, filename, mimeType, objectKey, sha256, sizeBytes, parserStatus: enum(pending|parsed|failed), version: int>0, metadata, createdAt, updatedAt? }`.
- `404`; `401`/`403`.

### `GET /knowledge-spaces/{id}/documents/{documentId}`
**Description**: Fetch a single document asset.
**Auth**: Bearer; scope `knowledge-spaces:read`.
**Path params**: `id` (uuid); `documentId` (uuid).
**Responses**: `200` `DocumentAsset`; `404`; `401`/`403`.

### `GET /knowledge-spaces/{id}/documents/{documentId}/parse-artifacts/{version}`
**Description**: Fetch a specific version of a document's parse artifact (parsed elements).
**Auth**: Bearer; scope `knowledge-spaces:read`.
**Path params**: `id` (uuid); `documentId` (uuid); `version` (positive int).
**Responses**:
- `200`: `ParseArtifact` `{ id, documentAssetId, artifactHash, contentType: enum(text|structured|mixed), parser: enum(native-markdown|native-html|native-structured|unstructured), version: int>0, elements: [{ id, type: enum(title|heading|paragraph|table|list|image|code|page-break), text?, pageNumber?, sectionPath: string[], metadata }], metadata, createdAt, updatedAt? }`.
- `404`; `401`/`403`.

### `GET /knowledge-spaces/{id}/documents/{documentId}/outline`
**Description**: Fetch a document's hierarchical outline / table of contents.
**Auth**: Bearer; scope `knowledge-spaces:read`.
**Path params**: `id` (uuid); `documentId` (uuid).
**Responses**:
- `200`: `DocumentOutline` `{ id, knowledgeSpaceId, documentAssetId, parseArtifactId, artifactHash, outlineVersion, version: int>0, nodes: DocumentOutlineNode[], metadata, createdAt, updatedAt? }`; each node `{ id, title, level: int>0, tocSource, sectionPath: string[], childNodeIds: string[], children: node[] (recursive), sourceElementIds: string[], sourceNodeIds: string[], startOffset?, endOffset?, startPage?, endPage?, summary?, titleLocation?, metadata }`.
- `404`; `401`/`403`.

### `GET /knowledge-spaces/{id}/documents/{documentId}/multimodal`
**Description**: Fetch a document's multimodal manifest (images/tables/pages/code + enrichment status).
**Auth**: Bearer; scope `knowledge-spaces:read`.
**Path params**: `id` (uuid); `documentId` (uuid).
**Responses**:
- `200`: `DocumentMultimodalManifest` `{ id, knowledgeSpaceId, documentAssetId, parseArtifactId, artifactHash, manifestVersion, version: int>0, items: [{ id, parseElementId, modality: enum(code|image|page|table), title?, caption?, textPreview?, ocrText?, pageNumber?, boundingBox?: { x, y, width, height }, sectionPath: string[], startOffset?, endOffset?, assetRef?: { objectKey?, uri?, contentType?, sha256?, variants?: Record<string,{ objectKey?, uri?, contentType?, sha256?, width?, height? }> }, enrichment: { asset, caption, ocr, tableStructure, visualEmbedding: enum(missing|pending|provided|unsupported) }, sourceMetadata } ], metadata, createdAt, updatedAt? }`.
- `404`; `401`/`403`.

### `GET /knowledge-spaces/{id}/documents/{documentId}/multimodal/{itemId}/asset`
**Description**: Stream the raw binary asset (or a named variant) for a multimodal item.
**Auth**: Bearer; scope `knowledge-spaces:read`.
**Path params**: `id` (uuid); `documentId` (uuid); `itemId` (string 1–1024). **Query** (strict): `variant` (string 1–64, `^[A-Za-z0-9._=-]+$`, optional).
**Responses**:
- `200` (`application/octet-stream`): binary asset bytes.
- `404` not found; `409` external (non-inline) asset; `413` exceeds max readable size; `401`/`403`.

### `POST /knowledge-spaces/{id}/documents`
**Description**: Upload a single document — compiled synchronously, or accepted for durable async compilation.
**Auth**: Bearer; scope `knowledge-spaces:write`.
**Path params**: `id` (uuid).
**Request body** (`multipart/form-data`): `file` (binary, required); `sourceId` (uuid, optional).
**Responses**:
- `201`: `DocumentAsset` (compiled synchronously).
- `202`: `{ asset: DocumentAsset, compilationJob: { id, stage: "queued" }, statusUrl }` (async handoff).
- `400`; `404`; `413` too large; `429` capacity; `500` upload failed; `401`/`403`.

### `POST /knowledge-spaces/{id}/documents/bulk`
**Description**: Upload multiple documents for durable async compilation.
**Auth**: Bearer; scope `knowledge-spaces:write`.
**Path params**: `id` (uuid). **Body** (`multipart/form-data`): `files` (binary[], required).
**Responses**:
- `202`: `{ bulkJobId, total, items: [{ asset: DocumentAsset, compilationJob: { id, stage: "queued" }, statusUrl }] }`.
- `400`; `404`; `413`; `429`; `500`; `503` durable compilation not configured; `401`/`403`.

### `DELETE /knowledge-spaces/{id}/documents/bulk`
**Description**: Delete multiple documents by id; report per-document results.
**Auth**: Bearer; scope `knowledge-spaces:write`.
**Path params**: `id` (uuid). **Body** (`application/json`, strict): `documentIds` (uuid[], min 1).
**Responses**:
- `200`: `{ bulkJobId, total, items: [{ documentId, status: enum(deleted|not_found), objectDeleted, artifactsDeleted, nodesDeleted, projectionsDeleted }] }`.
- `400`; `404`; `401`/`403`.

### `POST /knowledge-spaces/{id}/documents/bulk/reindex`
**Description**: Queue reindex (recompilation) of all documents or a specified set.
**Auth**: Bearer; scope `knowledge-spaces:write`.
**Path params**: `id` (uuid). **Body** (`application/json`, strict; exactly one of): `all` (boolean) | `documentIds` (uuid[], min 1).
**Responses**:
- `202`: `{ bulkJobId, total, items: Array<{ asset, compilationJob: { id, stage: "queued" }, status: "queued", statusUrl } | { documentId, status: "not_found" }> }`.
- `400`; `404`; `413` quota; `503` durable compilation not configured; `401`/`403`.

### `GET /jobs/{id}`
**Description**: Fetch the status of a durable document compilation job.
**Auth**: Bearer; scope `knowledge-spaces:read`.
**Path params**: `id` (string, min 1).
**Responses**:
- `200`: `DocumentCompilationJob` `{ id, knowledgeSpaceId, tenantId, documentAssetId, queueJobId, stage: enum(queued|parsed|outline_built|nodes_generated|projection_built|smoke_eval_passed|published|failed|canceled), version: int>0, error?, createdAt: number, updatedAt: number, completedAt?: number }`.
- `404`; `503` compilation jobs unavailable; `401`/`403`.

### `DELETE /jobs/{id}`
**Description**: Cancel a durable document compilation job.
**Auth**: Bearer; scope `knowledge-spaces:write`.
**Path params**: `id` (string, min 1).
**Responses**: `200` `DocumentCompilationJob` (canceled); `404`; `409` terminal (cannot cancel); `503`; `401`/`403`.

---

## Query, answers, golden & failed queries

### `POST /queries`
**Description**: Run a knowledge-space query and stream the generated answer as SSE.
**Auth**: Bearer; scope `knowledge-spaces:read`.
**Request body** (`application/json`, strict): `knowledgeSpaceId` (uuid, required); `query` (string
1–16000, required); `mode` (enum `auto|deep|fast|research`, optional; defaults to the published
knowledge-space retrieval profile's `defaultMode`, or `fast` for a legacy space without a profile);
`activeDocumentIds` (uuid[] ≤100, optional, default `[]`); `activeEntityIds` (string[1–200][] ≤100,
optional, default `[]`); `sessionId` (uuid, optional).

`auto` is a public **routing selector**, not a fourth retrieval pipeline. Only an explicit
`mode: "auto"` invokes the knowledge space's published `reasoningModel` through Dify's model
runtime to
select exactly one concrete pipeline. Omitting `mode` does not invoke the router; it uses the
published `defaultMode`. Explicit `fast`, `research`, and `deep` requests also bypass routing.

The model is instructed to select the least expensive sufficient pipeline: **Fast** for ordinary
dense + FTS hybrid recall, fusion, and final rerank; **Research** for Summary/Outline/PageIndex tree
navigation without ordinary hybrid, Graph, or ordinary rerank; and **Deep** for ordinary hybrid
recall plus Graph expansion, followed by one unified final rerank. Selection is not implemented by
hard-coded CJK/language, query-length, word-count, or keyword rules. A timeout, provider failure,
invalid response, or model-identity mismatch safely degrades to the published `defaultMode` and is
recorded in the trace; it never falls back to the removed heuristic.

**Response headers**:

- `x-query-run-id`: server-generated UUID used as the durable `AnswerTrace.id`, retrieval lease ID,
  session query ID, and query activity resource ID. Use this value with `GET /queries/{traceId}`.
- `x-trace-id`: HTTP request correlation ID. It can originate from the caller and is deliberately
  separate from the durable query-run ID; do not use it as the AnswerTrace resource ID.
- `x-session-id`: generated or reused query session ID. A successful streamed query has a resolved
  session even when the request omitted `sessionId`.

**Responses**:

- `200` (`text/event-stream`):
  - `answer.delta` `{ delta, traceId }`: one generated answer fragment. `traceId` is the durable
    query-run ID.
  - `answer.done` `{ finishReason, metadata?, traceId }`: the single successful terminal frame.
    Production finish reasons are `retrieval-evidence` and `no-retrieval-evidence`.
  - `answer.error` `{ error, traceId }`: the terminal failure frame. No `answer.done` follows it.
- `400` invalid request or retrieval-profile/mode mismatch; `404` space not found; `409` query
  admission rejected while deletion is active; `503` query generation, published runtime snapshot,
  embedding profile, projection snapshot, or required retrieval capability unavailable; `401`/`403`.

`answer.done.metadata` is generator-dependent and can contain `generator`, `mode`, reasoning
`model`, `provider`, `providerFinishReason`, opaque `providerMetadata`, `topScore`, `citations`, the
complete `evidenceBundle`, multimodal evidence/answer metadata, and the same `projectionSnapshot`,
`retrievalProfile`, retrieval `plan`, and retrieval `metrics` persisted in the AnswerTrace.

The gateway buffers the terminal `answer.done` frame until the AnswerTrace transaction commits. If
the trace commit fails, the client receives `answer.error` instead of a false successful terminal
frame. A disconnect before terminal ownership is claimed normally cancels the run without creating
an AnswerTrace. After a successful trace commit, failed-query capture is best-effort and currently
recognizes `no-retrieval-evidence` and configured low-confidence results.

Internal `trace-step` events are collected for AnswerTrace persistence and are never emitted as SSE
frames. Answer deltas may arrive before the terminal persistence fence; after any generation,
lease, or trace-persistence failure the stream emits `answer.error` when the client is still
connected and then closes while retaining HTTP status `200` for the already-open SSE response.

### `GET /queries/{traceId}`
**Description**: Fetch the durable retrieval/generation execution trace for a query. This is an
execution trace, not a replayable copy of the generated answer.
**Auth**: Bearer; scope `knowledge-spaces:read`.
**Path params**: `traceId` (uuid).
**Responses**:

- `200`: `AnswerTrace` `{ id, knowledgeSpaceId, query, mode:
  enum(fast|deep|research|auto), createdAt, evidenceBundleId?, steps: [{ name, status:
  enum(ok|error|skipped), startedAt, endedAt?, metadata }] }`. New online-query traces store the
  concrete resolved mode (`fast|research|deep`) at the top level; `auto` remains readable in the
  schema for historical records.
- `404`; `401`/`403`.

`createdAt` is the terminal trace-recording time, not the query admission time. Public responses
omit the internal creator `subjectId`, permission-snapshot ID/revision/access channel, and database
`completed` flag. A trace is readable only by its original authenticated subject while the stored
permission snapshot, current knowledge-space read access, API-key binding (when applicable), and
all referenced node/document/asset visibility checks still pass. Hidden, deleted, legacy-unowned,
or unresolved-evidence traces fail closed with `403` or `404`.

Online queries normally persist these steps:

- `query.route`: routing provenance with `requestedMode`, concrete `resolvedMode`, `resolver`
  (`explicit`, `llm`, or `fallback`), `selectionSource`, published reasoning-model/profile identity,
  prompt version, bounded provider/usage metadata, duration, and a `degraded` flag plus safe error
  class when Auto falls back. The step is persisted but is not emitted as an SSE frame. Explicit
  modes and omitted-mode defaults record routing without making an LLM call.
- `query.embed` (Fast and Deep only): `durationMs`, observed embedding `model`, observed
  `dimension`, and immutable `vectorSpaceId`. Research does not call the embedding capability and
  omits this step.
- `query.retrieve`: `durationMs`, `itemCount`, optional immutable `projectionSnapshot`, published
  `retrievalProfile`, resolved retrieval `plan`, and retrieval `metrics`.
- `query.answer`: `durationMs`, `answerChars`, `synthesis`, and, for LLM generation, `model`,
  `provider`, and `providerFinishReason`. A failed multimodal attempt followed by a successful text
  fallback can produce both an `error` and an `ok` `query.answer` step.
- `query.generate`: terminal summary with `eventCount`, optional `finishReason`, and the complete
  terminal generator metadata. Its status is authoritative for the database `completed` state.

The retrieval `plan` contains `{ strategyVersion, requestedMode, resolvedMode, queryLanguage, topK,
denseTopK, ftsTopK, fusionLimit, rerankCandidateLimit }`. The `retrievalProfile` contains the
non-secret published configuration that governed the run: `{ revision, defaultMode, topK,
scoreThreshold, reasoningModel, rerank }`, including model `pluginId`, `provider`, and `model`
identifiers but no plugin credentials. The `projectionSnapshot` contains `{ publicationId,
fingerprint, headRevision, projectionVersion }`.

Retrieval metrics use a shared shape. Common fields include dense/FTS/fusion candidate counts and
latencies, final candidate count, permission/metadata/projection/score-threshold filtered counts,
rerank candidates and latency, multimodal/image/table/visual candidate counts, degradation flags,
and `totalMs`. Mode-specific fields are:

- **Fast**: ordinary dense + FTS hybrid recall and candidate fusion, followed by the single final
  rerank pass when reranking is enabled by the published profile.
- **Research**: PageIndex/Outline/Summary fields such as `pageIndexMatchedNodes`,
  `pageIndexOpenedRanges`, scanned outlines/nodes, candidate truncation, PageIndex score version,
  Summary candidates/selected sections, and threshold-filtered candidates. Dense/FTS/rerank plan
  limits are zero and no Graph expansion is used.
- **Deep**: ordinary hybrid fields plus `graphExpansionSeeds`, traversed entities, relations,
  candidates, latency, and timeout state, followed by the single final rerank pass when reranking
  is enabled by the published profile.

Graph expansion, PageIndex, and rerank currently appear inside `query.retrieve.plan/metrics`, not as
separate trace steps. A stage step is emitted only after that stage completes; an embedding or
retrieval exception before emission can therefore leave only the terminal `query.generate:error`
step. `completed=true` means execution reached a successful terminal summary: a
`no-retrieval-evidence` result is still completed, and a recovered intermediate error does not make
the terminal query fail.

AnswerTrace deliberately does **not** persist the generated answer text, SSE delta fragments,
prompt/messages, session ID, active document/entity context, raw query vector, normalized token
usage/cost, or exception stack. Token/usage data is present only when a provider places it in opaque
`providerMetadata`. Clients that require answer replay or audit must persist the SSE answer content
separately.

`steps[].metadata` is an open JSON object and the direct trace response returns it after the access
checks above. It can contain complete evidence text, provider and multimodal metadata, internal
projection identifiers, and aggregate filtered-candidate diagnostics; clients must treat it as
sensitive authorized content.

The terminal `EvidenceBundle` embedded in `query.generate.metadata.evidenceBundle` has this shape:

`{ id, query, traceId?, createdAt, state: enum(answerable|partial|not-enough-evidence|conflict|permission-limited), items: [{ nodeId, text, score, scores: { retrieval, rerank?, freshness?, final }, freshness, citations: [{ documentAssetId, documentVersion, artifactHash?, pageNumber?, sectionPath, startOffset?, endOffset? }], conflicts, metadata }], missingEvidence: [{ expectedEvidenceId?, reason, text, metadata }] }`.

For an online query the same complete bundle is stored in the terminal step metadata and in the
scoped `evidence_bundles` storage; `evidenceBundleId` identifies that persisted bundle.

### `GET /queries/{traceId}/evidence`
**Description**: List the evidence supporting an answer trace (paginated virtual-tree listing).
**Auth**: Bearer; scope `knowledge-spaces:read`.
**Path params**: `traceId` (uuid). **Query** (strict): `cursor` (string, optional); `limit` (int 1–100, optional, default 25).
**Responses**:

- `200`: KnowledgeFS list `{ path, truncated, items: [{ kind: "resource", name: nodeId, path,
  resourceType: "node", targetId: nodeId, metadata: { citationCount, conflictCount, freshness,
  score, scores } }], nextCursor? }`.
- `400`; `404`; `401`/`403`.

This is a compact virtual-tree projection. It does not repeat evidence text or citation arrays; the
authorized direct AnswerTrace currently contains the complete embedded EvidenceBundle.

### `GET /queries/{traceId}/conflicts`
**Description**: List conflicting evidence for an answer trace (paginated virtual-tree listing).
**Auth**: Bearer; scope `knowledge-spaces:read`.
**Path params**: `traceId` (uuid). **Query** (strict): `cursor`; `limit` (int 1–100, default 25).
**Responses**: `200` KnowledgeFS list with resource entries containing `{ nodeId, reason,
severity }` metadata and a target node ID; `400`; `404`; `401`/`403`.

### `GET /queries/{traceId}/missing`
**Description**: List evidence gaps (missing/not-found evidence) for an answer trace.
**Auth**: Bearer; scope `knowledge-spaces:read`.
**Path params**: `traceId` (uuid). **Query** (strict): `cursor`; `limit` (int 1–100, default 25).
**Responses**: `200` KnowledgeFS list with evidence entries containing the missing-evidence
`reason` plus its metadata and `expectedEvidenceId` when present; `400`; `404`; `401`/`403`.

### `GET /knowledge-spaces/{id}/quality/traces`
**Description**: List subject-owned, candidate-authorized AnswerTrace summaries for the Quality
history view.
**Auth**: Bearer; scope `knowledge-spaces:read`; current knowledge-space read authorization is also
required.
**Path params**: `id` (uuid).
**Query** (strict): `cursor` (opaque string, optional); `from`/`to` (datetime,
optional); `limit` (int 1–100, optional, default 50); `mode` (enum
`auto|deep|fast|research`, optional); `query` (trimmed string 1–500, optional); `status` (enum
`completed|failed`, optional).
**Responses**:

- `200`: `{ items: QualityAnswerTraceSummary[], nextCursor? }`, where each summary is
  `{ id, query, mode, createdAt, completed, evidenceBundleId?, evidenceState?, finalScore?, scores:
  { retrieval?, rerank?, final? }, profile: { embeddingModel?, embeddingVectorSpaceId?,
  reasoningModel?, rerankModel?, retrievalProfileRevision?, projectionPublicationId?,
  projectionVersion? }, stages: [{ name, status, candidateCount? }] }`.
- `400`; `404`; `503` Quality runtime unavailable; `401`/`403`.

`completed` represents terminal execution success, not evidence answerability. This endpoint is the
paginated/searchable summary view; use `GET /queries/{traceId}` for the authorized full execution
trace. Quality replay can also create AnswerTrace-shaped stage records without a terminal
`query.generate` step or EvidenceBundle, so consumers must not assume every history row has the
online-query step sequence.

Compatibility note: the current `status` filter treats any trace containing an `error` step as
`failed`, even when a later `query.generate:ok` makes `completed` true. Consequently, a recovered
multimodal-to-text fallback can return `completed: true` while matching `status=failed`; the two
filters are not yet a strict partition of terminal execution state.

### `PATCH /knowledge-spaces/{id}/quality/traces/{traceId}/missing/{itemKey}`
**Description**: Create or update the review state of one missing-evidence item with optimistic
revision checking.
**Auth**: Bearer; scope `knowledge-spaces:write`; the referenced trace must remain subject-owned and
currently visible.
**Path params**: `id` (uuid); `traceId` (uuid); `itemKey` (`sha256:` followed by 64 lowercase hex
characters).
**Body** (`application/json`, strict): `{ expectedRevision: int>=0, status:
enum(active|dismissed), reason?: string 1–2000 }`.
**Responses**:

- `200`: `MissingEvidenceReview` `{ id, knowledgeSpaceId, itemKey, status, reason?, revision,
  actorSubjectId, createdAt, updatedAt }`.
- `400`; `404`; `409` revision conflict; `503` Quality runtime unavailable; `401`/`403`.

### `GET /knowledge-spaces/{id}/quality/traces/{traceId}/missing/{itemKey}/history`
**Description**: Fetch the immutable review history for one missing-evidence item.
**Auth**: Bearer; scope `knowledge-spaces:read`; the referenced trace must remain subject-owned and
currently visible.
**Path params**: same as the missing-evidence review endpoint.
**Responses**:

- `200`: `{ items: [{ id, action, actorSubjectId, fromStatus?, toStatus, reason?, revision,
  createdAt }] }`.
- `400`; `404`; `503` Quality runtime unavailable; `401`/`403`.

### `POST /knowledge-spaces/{id}/golden-questions`
**Description**: Create a golden (reference) question for evaluation.
**Auth**: Bearer; scope `knowledge-spaces:write`.
**Path params**: `id` (uuid). **Body** (`application/json`, strict): `question` (string 1–4000, required); `expectedEvidenceIds` (uuid[], optional, default `[]`); `tags` (string[1–80][], optional, default `[]`); `metadata` (object, optional, default `{}`).
**Responses**:
- `201`: `GoldenQuestion` `{ id, knowledgeSpaceId, question, expectedEvidenceIds: uuid[], tags: string[], metadata, createdAt, updatedAt }`.
- `404`; `429` capacity; `401`/`403`.

### `GET /knowledge-spaces/{id}/golden-questions`
**Description**: List golden questions (cursor-paginated).
**Auth**: Bearer; scope `knowledge-spaces:read`.
**Path params**: `id` (uuid). **Query** (strict): `cursor` (optional); `limit` (int ≥1, optional, default 100).
**Responses**: `200` `{ items: GoldenQuestion[], nextCursor? }`; `400`; `404`; `401`/`403`.

### `GET /knowledge-spaces/{id}/golden-questions/{questionId}`
**Description**: Fetch a single golden question.
**Auth**: Bearer; scope `knowledge-spaces:read`.
**Path params**: `id` (uuid); `questionId` (uuid).
**Responses**: `200` `GoldenQuestion`; `404`; `401`/`403`.

### `PATCH /knowledge-spaces/{id}/golden-questions/{questionId}`
**Description**: Partially update a golden question.
**Auth**: Bearer; scope `knowledge-spaces:write`.
**Path params**: `id` (uuid); `questionId` (uuid). **Body** (`application/json`, strict, all optional): `question` (1–4000); `expectedEvidenceIds` (uuid[]); `tags` (string[1–80][]); `metadata` (object).
**Responses**: `200` updated `GoldenQuestion`; `404`; `401`/`403`.

### `POST /knowledge-spaces/{id}/golden-questions/{questionId}/annotations`
**Description**: Record a human evaluation annotation (answer correctness + per-evidence relevance).
**Auth**: Bearer; scope `knowledge-spaces:write`.
**Path params**: `id` (uuid); `questionId` (uuid). **Body** (`application/json`, strict): `answerCorrectness` (enum `correct|incorrect|not-answerable|partially-correct`, required); `evidenceRelevance` (array ≤50, optional, default `[]`) each `{ evidenceId: uuid, relevant: boolean, note?: string 1–1000 }`; `note` (string 1–1000, optional).
**Responses**: `200` annotated `GoldenQuestion` (annotation in metadata); `400`; `404`; `401`/`403`.

### `DELETE /knowledge-spaces/{id}/golden-questions/{questionId}`
**Description**: Delete a golden question.
**Auth**: Bearer; scope `knowledge-spaces:write`.
**Path params**: `id` (uuid); `questionId` (uuid).
**Responses**: `204`; `404`; `401`/`403`.

### `POST /knowledge-spaces/{id}/production-bad-cases`
**Description**: Capture a production answer trace as a bad case, queued (as a golden question) for review.
**Auth**: Bearer; scope `knowledge-spaces:write`.
**Path params**: `id` (uuid). **Body** (`application/json`, strict): `traceId` (uuid, required); `reason` (string 1–1000, optional); `tags` (string[1–80][] ≤20, optional, default `[]`).
**Responses**: `201` `GoldenQuestion`; `404` space/trace not found; `429` capacity; `401`/`403`.

### `PATCH /knowledge-spaces/{id}/failed-queries/{failedQueryId}`
**Description**: Annotate a failed query — `retrieval-miss` promotes it to a golden question, `coverage-gap` marks it annotated, `irrelevant` dismisses it.
**Auth**: Bearer; scope `knowledge-spaces:write`.
**Path params**: `id` (uuid); `failedQueryId` (uuid). **Body** (`application/json`, strict): `verdict` (enum `retrieval-miss|coverage-gap|irrelevant`, required); `expectedEvidenceIds` (uuid[] ≤100, optional) — carried onto the promoted golden question; `note` (string ≤2000, optional).
**Responses**:
- `200`: `FailedQuery` `{ id, knowledgeSpaceId, query, mode: enum(fast|deep|research|auto), trigger: enum(no-retrieval-evidence|low-confidence|abstained), status: enum(pending-triage|triaged|pending-annotation|annotated|dismissed|promoted), metadata, answerTraceId?, createdAt, updatedAt }`.
- `404`; `401`/`403`.

### `GET /knowledge-spaces/{id}/failed-queries/metrics`
**Description**: Failed-query counts by status plus the golden-question promotion rate.
**Auth**: Bearer; scope `knowledge-spaces:read`.
**Path params**: `id` (uuid).
**Responses**:
- `200`: `{ total: number, promotionRate: number, byStatus: { "pending-triage", triaged, "pending-annotation", annotated, dismissed, promoted: number } }`.
- `404`; `401`/`403`.

### `GET /knowledge-spaces/{id}/failed-queries/clusters`
**Description**: Group failed queries into clusters (most frequent first) with a representative per cluster.
**Auth**: Bearer; scope `knowledge-spaces:read`.
**Path params**: `id` (uuid). **Query** (strict): `limit` (int 1–1000, optional, default 200); `status` (enum, optional).
**Responses**:
- `200`: `{ clusters: [{ clusterKey: string, count: number, failedQueryIds: string[], representative: FailedQuery }] }`.
- `404`; `401`/`403`.

### `POST /knowledge-spaces/{id}/failed-queries/triage`
**Description**: Run the relevance-triage runner over a batch of pending failed queries, auto-assigning verdicts.
**Auth**: Bearer; scope `knowledge-spaces:write`.
**Path params**: `id` (uuid). **Query** (strict): `limit` (int 1–200, optional).
**Responses**:
- `200`: `{ triaged: number, verdicts: { "retrieval-miss", "coverage-gap", irrelevant, uncertain: number } }`.
- `404`; `501` relevance triage not configured; `401`/`403`.

### `GET /knowledge-spaces/{id}/failed-queries`
**Description**: List failed queries (cursor-paginated), optionally filtered by status.
**Auth**: Bearer; scope `knowledge-spaces:read`.
**Path params**: `id` (uuid). **Query** (strict): `cursor` (optional); `limit` (int 1–200, optional, default 50); `status` (enum, optional).
**Responses**: `200` `{ items: FailedQuery[], nextCursor? }`; `400`; `404`; `401`/`403`.

---

## Data sources, graph, semantic & research

> **Source object & conventions**
> - `Source` = `{ id, knowledgeSpaceId, name, type: enum(upload|object-storage|connector|web), uri, status: enum(active|syncing|error|disabled), permissionScope: string[], metadata, version: int≥1, createdAt, updatedAt }`.
> - **Optimistic locking**: `version` is bumped on every write. Pass it back as `expectedVersion` on PATCH to fail with `409` instead of overwriting a concurrent modification.
> - **Scheduled sync**: set `metadata.syncPolicy` to `{"everyHours": N}` (1–720) or `{"dailyAt": ["HH:MM", …], "utcOffset": "±HH:MM"?}`. Invalid policies are rejected with `400` at create/update. A background scheduler (multi-replica safe; `KNOWLEDGE_SOURCE_SYNC*` env) then re-syncs due sources: web → re-crawl with content-hash dedup, connector pages → re-import previously imported pages whose `lastEditedTime` changed, drive → re-download previously imported files. The scheduler records progress under `metadata.syncState` `{ lastSyncAt, lastSyncStatus: ok|error, lastSyncError?, nextSyncAt, syncStartedAt? }`.
> - **Reserved metadata keys** (managed by the platform; user PATCHes should carry them through): `tenantId` (auto-stamped on create/update), `sync` (last sync summary), `crawled`, `imported`, `importedFiles` (per-source sync state), `syncState`.

### `POST /knowledge-spaces/{id}/sources`
**Description**: Register a new data source (upload/object-storage/connector/web).
**Auth**: Bearer; scope `knowledge-spaces:write`.
**Path params**: `id` (uuid). **Body** (`application/json`, strict): `name` (string 1–200, required); `type` (enum `upload|object-storage|connector|web`, required); `uri` (string, min 1, required); `status` (enum `active|syncing|error|disabled`, optional); `permissionScope` (string[], optional); `metadata` (object, optional) — connector/provider config (e.g. `pluginId`, `provider`, `datasource`, `credentials`, `parameters`) and optionally `syncPolicy` (see conventions above). The owning `tenantId` is stamped into metadata automatically.
**Responses**:
- `201`: `Source` (shape above, `version: 1`).
- `400` invalid `metadata.syncPolicy`; `404`; `429` capacity; `401`/`403`.

### `GET /knowledge-spaces/{id}/sources`
**Description**: List a space's sources (cursor-paginated).
**Auth**: Bearer; scope `knowledge-spaces:read`.
**Path params**: `id` (uuid). **Query** (strict): `limit` (int 1–200, optional, default 50); `cursor` (optional).
**Responses**: `200` `{ items: Source[], nextCursor? }`; `400`; `404`; `401`/`403`.

### `GET /knowledge-spaces/{id}/sources/{sourceId}`
**Description**: Fetch a single source.
**Auth**: Bearer; scope `knowledge-spaces:read`.
**Path params**: `id` (uuid); `sourceId` (uuid).
**Responses**: `200` `Source`; `404`; `401`/`403`.

### `PATCH /knowledge-spaces/{id}/sources/{sourceId}`
**Description**: Update a source's mutable fields (name/status/metadata), optionally guarded by optimistic locking.
**Auth**: Bearer; scope `knowledge-spaces:write`.
**Path params**: `id` (uuid); `sourceId` (uuid). **Body** (`application/json`, strict, all optional): `name` (1–200); `status` (enum); `metadata` (object, **replaces wholesale** — `tenantId` is re-stamped automatically); `expectedVersion` (int ≥1) — the `version` from your last read; when provided, a concurrent modification makes the update fail with `409` instead of overwriting it.
**Responses**:
- `200`: updated `Source` (`version` bumped).
- `400` invalid `metadata.syncPolicy`; `404`; `409` concurrent modification (`expectedVersion` mismatch); `401`/`403`.

### `DELETE /knowledge-spaces/{id}/sources/{sourceId}`
**Description**: Delete a source and, by default, cascade-delete its documents.
**Auth**: Bearer; scope `knowledge-spaces:write`.
**Path params**: `id` (uuid); `sourceId` (uuid). **Query** (strict): `documents` (enum `cascade|keep`, optional, default `cascade`).
**Responses**: `204`; `404`; `401`/`403`.

### `POST /knowledge-spaces/{id}/sources/{sourceId}/crawl`
**Description**: Trigger a website crawl for a `web` source and materialize crawled pages into documents, with content-hash dedup: pages whose content is byte-identical to the last crawl are **skipped**; changed pages are re-materialized and their superseded document is cascade-deleted (**replaced**); new pages are imported. Per-URL state lives in `metadata.crawled` `{ [url]: { documentAssetId, sha256 } }`.
**Auth**: Bearer; scope `knowledge-spaces:write`.
**Path params**: `id` (uuid); `sourceId` (uuid). **Body**: None (target from the source's `uri`/metadata).
**Responses**:
- `200`: `WebsiteCrawlResult` `{ pages: [{ sourceUrl, content, title?, description? }], status?, total?, completed?, failed?, imported?, replaced?, skipped? }` — `imported` = newly materialized documents, `skipped` = unchanged pages deduped by content hash, `replaced` = superseded documents deleted for changed pages.
- `400` not a web source; `404`; `501` connector not configured; `502` crawl failed; `401`/`403`.

### `GET /knowledge-spaces/{id}/sources/{sourceId}/pages`
**Description**: List authorized pages from an online-document connector (e.g. Notion), grouped by workspace.
**Auth**: Bearer; scope `knowledge-spaces:read`.
**Path params**: `id` (uuid); `sourceId` (uuid).
**Responses**:
- `200`: `OnlineDocumentPages` `{ workspaces: [{ workspaceId?, workspaceName?, total?, pages: [{ pageId, pageName, type, parentId?, lastEditedTime? }] }] }`.
- `400` not a connector; `404`; `501` connector not configured; `502` provider failed; `401`/`403`.

### `POST /knowledge-spaces/{id}/sources/{sourceId}/test`
**Description**: Validate the stored credentials for a source against its provider.
**Auth**: Bearer; scope `knowledge-spaces:write`.
**Path params**: `id` (uuid); `sourceId` (uuid).
**Responses**: `200` `{ valid: boolean, error? }`; `404`; `501` tester not configured; `401`/`403`.

### `POST /knowledge-spaces/{id}/sources/{sourceId}/import`
**Description**: Import selected online-document pages as documents; re-import skips pages whose `lastEditedTime` is unchanged. Imported pages are recorded in `metadata.imported` `{ [pageId]: { documentAssetId, lastEditedTime? } }`, which scheduled sync refreshes (never-imported pages are not auto-added — selection stays manual).
**Auth**: Bearer; scope `knowledge-spaces:write`.
**Path params**: `id` (uuid); `sourceId` (uuid). **Body** (`application/json`, strict): `pages` (array 1–200) each `{ pageId (min 1, required), workspaceId (min 1, required), type (min 1, required), name? (1–200), lastEditedTime? (min 1) }`.
**Responses**:
- `200`: `SourceImportResult` `{ documents: [{ documentAssetId, filename }], failed: [{ filename, error }], skipped: string[] }`.
- `400` not a connector; `404`; `501`; `502`; `401`/`403`.

### `GET /knowledge-spaces/{id}/sources/{sourceId}/files`
**Description**: Browse files from an online-drive connector (e.g. S3/Drive), grouped by bucket.
**Auth**: Bearer; scope `knowledge-spaces:read`.
**Path params**: `id` (uuid); `sourceId` (uuid). **Query** (strict): `bucket` (optional); `prefix` (optional); `maxKeys` (int 1–1000, optional).
**Responses**:
- `200`: `OnlineDriveFiles` `{ buckets: [{ bucket?, isTruncated?, files: [{ id, name, type, size? }] }] }`.
- `400` not a drive connector; `404`; `501`; `502`; `401`/`403`.

### `POST /knowledge-spaces/{id}/sources/{sourceId}/import-files`
**Description**: Import selected online-drive files as documents. Successfully imported files are recorded in `metadata.importedFiles` `{ [fileId]: { name, bucket?, mimeType? } }`, which scheduled sync re-downloads.
**Auth**: Bearer; scope `knowledge-spaces:write`.
**Path params**: `id` (uuid); `sourceId` (uuid). **Body** (`application/json`, strict): `files` (array 1–200) each `{ id (min 1, required), name (1–255, required), bucket?, mimeType? }`.
**Responses**: `200` `SourceImportResult` `{ documents, failed, skipped }`; `400`; `404`; `501`; `502`; `401`/`403`.

### `GET /knowledge-spaces/{id}/graph/traverse`
**Description**: Bounded breadth-limited traversal of the knowledge graph from a seed entity.
**Auth**: Bearer; scope `knowledge-spaces:read`.
**Path params**: `id` (uuid). **Query** (strict): `entityId` (uuid, required); `depth` (int 1–2, optional, default 2); `fanout` (int 1–50, optional, default 20); `maxNodes` (int 1–200, optional, default 50); `timeoutMs` (int 1–5000, optional, default 250).
**Responses**:
- `200`: `{ entities: GraphEntity[], relations: GraphRelation[], truncated, metrics: { depthReached, elapsedMs, exploredRelations, fanout, maxDepth, maxNodes, timedOut } }`. `GraphEntity` `{ id, knowledgeSpaceId, name, canonicalKey, aliases: string[], type: enum(date|metric|organization|person|policy|product|term), confidence, depth, extractionVersion, permissionScope: string[], sourceNodeIds: string[], metadata, createdAt, updatedAt }`. `GraphRelation` `{ id, knowledgeSpaceId, subjectEntityId, objectEntityId, type: enum(contradicts|defines|depends_on|mentions|references|supersedes), confidence, depth, extractionVersion, permissionScope, sourceNodeIds, metadata, createdAt, updatedAt }`.
- `404` space/seed entity not found; `401`/`403`.

### `POST /knowledge-spaces/{id}/semantic-views/topic/materialize`
**Description**: Materialize a KnowledgeFS topic semantic view (virtual topic path over documents).
**Auth**: Bearer; scope `knowledge-spaces:write`.
**Path params**: `id` (uuid). **Body** (`application/json`, strict, all optional): `topicName` (1–120); `topicSlug` (1–120, kebab-case); `generatedVersion` (1–120); `limit` (int 1–100, default 50).
**Responses**: `200` `{ knowledgeSpaceId, topicName, topicSlug, generatedVersion, documentCount, pathCount }`; `400`; `404`; `401`/`403`.

### `POST /knowledge-spaces/{id}/semantic-views/entities/extract`
**Description**: Extract & index semantic entities/relations from the space's nodes via the model provider.
**Auth**: Bearer; scope `knowledge-spaces:write`.
**Path params**: `id` (uuid). **Body** (`application/json`, strict): `limit` (int 1–100, optional, default 50).
**Responses**: `200` `{ knowledgeSpaceId, extractionMode: "provider", nodesScanned, nodesUpdated, entitiesExtracted, graphEntitiesIndexed, graphRelationsIndexed }`; `400`; `404`; `401`/`403`.

### `POST /knowledge-spaces/{id}/semantic-views/communities/materialize`
**Description**: Materialize a KnowledgeFS community semantic view (entity-cluster grouping).
**Auth**: Bearer; scope `knowledge-spaces:write`.
**Path params**: `id` (uuid). **Body** (`application/json`, strict): `generatedVersion` (1–120, optional).
**Responses**: `200` `{ knowledgeSpaceId, generatedVersion, communityCount, entityCount, documentCount, pathCount }`; `400`; `404`; `401`/`403`.

### `POST /research-tasks/plan`
**Description**: Produce a dry-run plan (cost/latency/retrieval estimates) for a research task without executing.
**Auth**: Bearer; scope `knowledge-spaces:read`.
**Body** (`application/json`, strict): `knowledgeSpaceId` (uuid, required); `query` (string 1–16000, required); `mode` (enum `auto|deep|fast|research`, optional); `topK` (int 1–50, optional); `budgetUsd` (number ≥0, optional).

An omitted `mode` uses the published `defaultMode`. An explicit `auto` is resolved through the
published reasoning model before the deterministic dry-run planner runs; `retrievalPlan` preserves
`requestedMode: "auto"` and reports the concrete `resolvedMode`.

**Responses**:
- `200`: `ResearchTaskDryRunPlan` `{ knowledgeSpaceId, query, strategyVersion, budget: { budgetUsd?, exceedsBudget, remainingBudgetUsd? }, estimates: { costUsd: { currency, estimated, min, max }, inputTokens, outputTokens, totalTokens, latencyMs: { p50, p95 }, retrievalSteps, scannedResources, toolCalls, cacheHitProbability }, retrievalPlan: { requestedMode, resolvedMode, queryLanguage, topK, denseTopK, ftsTopK, fusionLimit, rerankCandidateLimit, strategyVersion }, steps: [{ name: enum(analyze|generate|inspect|plan|retrieve), estimatedInputTokens, estimatedOutputTokens, estimatedToolCalls, estimatedLatencyMs, estimatedCostUsd }] }`.
- `400`; `404`; `401`/`403`.

### `POST /research-tasks`
**Description**: Create and enqueue an asynchronous research task job.
**Auth**: Bearer; scope `knowledge-spaces:write`.
**Body** (`application/json`): `knowledgeSpaceId` (uuid, required); `query` (string 1–16000, required); `mode` (enum `auto|deep|fast|research`, optional); `topK` (int 1–50, optional); `budgetUsd` (number ≥0, optional); `limits` (object, optional) `{ maxRetrievalSteps?, maxScannedResources?, maxToolCalls?, timeoutMs? }`; `metadata` (object, optional); `permissionScope` (object, optional).

For an explicit `auto`, creation authorizes the caller, freezes the published publication/profile
tuple, invokes that profile's reasoning model once, and persists the concrete mode plus bounded
routing provenance. Queue retries and worker restarts reuse the persisted decision and never
reclassify the query. Router failure uses the frozen profile's `defaultMode`; omitting `mode` uses
that default directly without an LLM call. Auto creation requires a query-ready published runtime
snapshot and returns `503` when that immutable tuple is unavailable; the legacy mutable-profile
compatibility path does not admit Auto.

**Responses**:
- `201`: `ResearchTaskJob` `{ id, tenantId, subjectId, knowledgeSpaceId, queueJobId, query, stage: enum(queued|planning|retrieving|analyzing|generating|completed|failed|canceled), limits?, budgetUsd?, cost: { totalUsd, budgetUsd?, budgetExceeded?, entries: [{ step, provider, costUsd, usage, recordedAt: number }] }, error?, createdAt: number, updatedAt: number, completedAt?: number }`.
- `400`; `404`; `422` limits exceeded `{ error, violations: [{ limit, limitValue, estimatedValue }] }`; `401`/`403`.

### `GET /research-tasks/{id}`
**Description**: Get the current status/result of a research task job.
**Auth**: Bearer; scope `knowledge-spaces:read`.
**Path params**: `id` (string, min 1).
**Responses**: `200` `ResearchTaskJob`; `404`; `401`/`403`.

### `GET /research-tasks/{id}/partials`
**Description**: List a research task's partial evidence bundles (cursor-paginated).
**Auth**: Bearer; scope `knowledge-spaces:read`.
**Path params**: `id` (string, min 1). **Query** (strict): `limit` (int 1–100, optional, default 25); `cursor` (optional).
**Responses**:
- `200`: `{ items: [{ tenantId, knowledgeSpaceId, researchTaskJobId, sequence: int>0, evidenceBundle }], nextCursor? }`. `EvidenceBundle` `{ id, query, state: enum(answerable|partial|not-enough-evidence|conflict|permission-limited), items: [{ nodeId, text, score: 0–1, scores, freshness, citations[], conflicts[], metadata }], missingEvidence: [{ text, reason: enum(not-retrieved|permission-filtered|stale|conflict|unknown), expectedEvidenceId?, metadata }], traceId?, createdAt }`.
- `404`; `401`/`403`.

### `GET /research-tasks/{id}/events`
**Description**: Stream research task progress as SSE.
**Auth**: Bearer; scope `knowledge-spaces:read`.
**Path params**: `id` (string, min 1). **Query** (strict): `limit` (int 1–100, optional, default 25); `cursor` (optional).
**Responses**: `200` (`text/event-stream`) progress event frames; `404`; `401`/`403`.

### `DELETE /research-tasks/{id}`
**Description**: Request cancellation of an in-flight research task job.
**Auth**: Bearer; scope `knowledge-spaces:write`.
**Path params**: `id` (string, min 1).
**Responses**: `200` `ResearchTaskJob` (stage `canceled`); `404`; `409` already terminal; `401`/`403`.

---

## System, policy, KnowledgeFS & agent workspace

### `GET /health`
**Description**: Platform runtime + per-component health.
**Auth**: **None (public)**.
**Responses**: `200` `{ ok: boolean, runtime: enum(cloudflare-workers|node-docker), components: Record<string, boolean> }`.

### `GET /openapi.json`
**Description**: The machine-readable OpenAPI 3 document for the whole API (served via `app.doc`).
**Auth**: **None (public)**.
**Responses**: `200` OpenAPI JSON document.

### `GET /bulk-jobs/{id}`
**Description**: Progress for a bulk document operation job.
**Auth**: Bearer; scope `knowledge-spaces:read`.
**Path params**: `id` (string, min 1).
**Responses**:
- `200`: `{ id, knowledgeSpaceId, type: enum(document_upload|document_delete|document_reindex), status: enum(running|completed|failed), totalItems, completedItems, failedItems, failedItemIds: string[], createdAt, updatedAt }`.
- `404`; `503` dependencies unavailable; `401`/`403`.

### `GET /retention-policy`
**Description**: The tenant-level retention policy.
**Auth**: Bearer; scope `knowledge-spaces:read`.
**Responses**:
- `200`: `RetentionPolicy` `{ id, tenantId, knowledgeSpaceId: uuid|null, scope: enum(tenant|knowledge_space), answerTraceRetentionDays: int>0, evidenceCacheRetentionDays: int>0, inactiveProjectionRetentionDays: int>0, parseArtifactVersions: int>0, rawDocumentRetentionDays: int>0|null, sessionInactivityMinutes: int>0, createdAt, updatedAt }`.
- `401`/`403`.

`answerTraceRetentionDays` is the operational cutoff consumed by bounded asynchronous retention
cleanup. Updating the policy does not synchronously delete traces, and a trace can become
unreadable earlier when its permission snapshot, current content visibility, or knowledge-space
lifecycle state no longer passes authorization.

The default operational policy is 90 days for AnswerTrace, 7 days for evidence cache, 30 days for
inactive projections, three parse-artifact versions, no raw-document expiry, and 30 minutes of
session inactivity. Tenant and knowledge-space policies are stored independently; an absent
knowledge-space policy receives its own defaults rather than inheriting the tenant row. The
manifest field `retentionPolicy.traceRetentionDays` is a separate manifest value; AnswerTrace
cleanup uses this API's `answerTraceRetentionDays`.

Retention policy routes are declarative and there is no public synchronous cleanup endpoint. A
deployment must schedule the bounded retention workers for a configured cutoff to take effect.

### `PATCH /retention-policy`
**Description**: Update the tenant-level retention policy.
**Auth**: Bearer; scope `knowledge-spaces:write`.
**Body** (`application/json`, strict, all optional): `answerTraceRetentionDays`, `evidenceCacheRetentionDays`, `inactiveProjectionRetentionDays`, `parseArtifactVersions`, `sessionInactivityMinutes` (each int>0); `rawDocumentRetentionDays` (int>0|null).
**Responses**: `200` updated `RetentionPolicy`; `400`; `401`/`403`.

### `GET /knowledge-spaces/{id}/retention-policy`
**Description**: The retention policy for a specific knowledge space.
**Auth**: Bearer; scope `knowledge-spaces:read`.
**Path params**: `id` (uuid).
**Responses**: `200` `RetentionPolicy` (`scope` may be `knowledge_space`); `404`; `401`/`403`.

### `PATCH /knowledge-spaces/{id}/retention-policy`
**Description**: Update the retention policy for a specific knowledge space.
**Auth**: Bearer; scope `knowledge-spaces:write`.
**Path params**: `id` (uuid). **Body** (`application/json`, strict): same fields as `PATCH /retention-policy`.
**Responses**: `200` updated `RetentionPolicy`; `400`; `404`; `401`/`403`.

> **KnowledgeFS virtual filesystem** — the `/fs/*` routes browse a virtual tree over the space's
> sources/knowledge/evidence/workspaces. `path` (and `oldPath`/`newPath`) must match
> `^/(sources|knowledge|evidence|workspaces)(/…)*$`. All query objects are strict; `consistencyClass`
> ∈ `path-consistent|snapshot-consistent|cache-consistent|eventual-preview`.

### `GET /knowledge-spaces/{id}/fs/ls`
**Description**: List direct children of a KnowledgeFS virtual directory.
**Auth**: Bearer; scope `knowledge-spaces:read`.
**Path params**: `id` (uuid). **Query** (strict): `path` (required, namespaced); `limit` (int ≥1, required); `cursor` (optional); `consistencyClass` (optional).
**Responses**:
- `200`: `{ path, items: [{ kind: enum(directory|resource), name, path, metadata, resourceType?: enum(source|document|node|artifact|evidence|workspace), targetId?, version? }], truncated, nextCursor?, consistencyClass?, preview? }`.
- `400`; `404`; `401`/`403`.

### `GET /knowledge-spaces/{id}/fs/tree`
**Description**: Recursive KnowledgeFS directory tree.
**Auth**: Bearer; scope `knowledge-spaces:read`.
**Path params**: `id` (uuid). **Query** (strict): `path` (required); `limit` (int ≥1, required); `depth` (int 1–8, optional); `cursor` (optional); `consistencyClass` (optional).
**Responses**: `200` `{ path, root: <nested tree>, truncated, nextCursor?, consistencyClass?, preview? }`; `400`; `404`; `401`/`403`.

### `GET /knowledge-spaces/{id}/fs/grep`
**Description**: Scoped full-text search across KnowledgeFS content.
**Auth**: Bearer; scope `knowledge-spaces:read`.
**Path params**: `id` (uuid). **Query** (strict): `q` (string 1–4000, required); `path` (required); `limit` (int ≥1, required); `cursor` (optional); `consistencyClass` (optional); `timeoutMs` (int 1–10000, optional).
**Responses**:
- `200`: `{ path, matches: [{ kind: enum(node|segment), path, snippet, startOffset, endOffset, metadata, nodeId?, segmentId? }], truncated, nextCursor? }`.
- `400`; `404`; `401`/`403`.

### `GET /knowledge-spaces/{id}/fs/find`
**Description**: Search KnowledgeFS entries by name/metadata/resource-type.
**Auth**: Bearer; scope `knowledge-spaces:read`.
**Path params**: `id` (uuid). **Query** (strict): `path` (required); `limit` (int ≥1, required); `cursor` (optional); `consistencyClass` (optional); `nameContains` (1–240, optional); `metadataKey` (1–120, optional); `metadataValue` (1–4000, optional); `resourceType` (enum, optional).
**Responses**: `200` (same shape as `fs/ls`); `400`; `404`; `401`/`403`.

### `GET /knowledge-spaces/{id}/fs/diff`
**Description**: Text (and optional semantic) diff between two KnowledgeFS paths.
**Auth**: Bearer; scope `knowledge-spaces:read`.
**Path params**: `id` (uuid). **Query** (strict): `oldPath` (required); `newPath` (required); `mode` (enum `line|word`, optional); `semantic` (enum `"true"|"false"`, optional); `consistencyClass` (optional).
**Responses**:
- `200`: `{ mode, oldPath, newPath, operations: [{ kind: enum(equal|insert|delete), text, oldStart?, oldEnd?, newStart?, newEnd? }], stats: { equal, insert, delete }, semantic?: { summary, changes: [{ category, summary, evidence: string[] }], metadata, model? } }`.
- `400`; `404`; `503` diff unavailable; `401`/`403`.

### `GET /knowledge-spaces/{id}/fs/open_node`
**Description**: A single citation-ready KnowledgeFS node with its source citation.
**Auth**: Bearer; scope `knowledge-spaces:read`.
**Path params**: `id` (uuid). **Query** (strict): `nodeId` (uuid, required); `consistencyClass` (optional).
**Responses**:
- `200`: `{ citation: { documentAssetId, parseArtifactId, artifactHash, sectionPath: string[], startOffset, endOffset, pageNumber? }, node: KnowledgeNode }`; `KnowledgeNode` `{ id, knowledgeSpaceId, documentAssetId, parseArtifactId, artifactHash, kind: enum(chunk|section|table|image|summary), text, startOffset, endOffset, sourceLocation, permissionScope, metadata, updatedAt? }`.
- `404`; `401`/`403`.

### `GET /knowledge-spaces/{id}/fs/cat`
**Description**: Read file content at a KnowledgeFS path.
**Auth**: Bearer; scope `knowledge-spaces:read`.
**Path params**: `id` (uuid). **Query** (strict): `path` (required); `limit` (int ≥1, optional); `cursor` (optional); `consistencyClass` (optional).
**Responses**: `200` `{ path, contentType, text, truncated, nextCursor? }`; `404`; `401`/`403`.

### `GET /knowledge-spaces/{id}/fs/stat`
**Description**: Metadata for a KnowledgeFS path without reading content.
**Auth**: Bearer; scope `knowledge-spaces:read`.
**Path params**: `id` (uuid). **Query** (strict): `path` (required); `consistencyClass` (optional).
**Responses**:
- `200`: `{ path, targetId, resourceType: enum(source|document|node|artifact|evidence|workspace), metadata, contentType?, sha256?, sizeBytes?, version?, parserStatus?: enum(pending|parsed|failed), consistencyClass?, preview? }`.
- `404`; `401`/`403`.

### `POST /knowledge-spaces/{id}/fs/write`
**Description**: Overwrite a KnowledgeFS file with new text content.
**Auth**: Bearer; scope `knowledge-spaces:write`.
**Path params**: `id` (uuid). **Body** (`application/json`, strict): `path` (required, namespaced); `text` (string, ≤262144 bytes / 256 KiB, required).
**Responses**: `200` `{ path, targetId, objectKey, version, bytesWritten, mode: "write" }`; `400`; `404`; `401`/`403`.

### `POST /knowledge-spaces/{id}/fs/append`
**Description**: Append text to an existing KnowledgeFS file.
**Auth**: Bearer; scope `knowledge-spaces:write`.
**Path params**: `id` (uuid). **Body** (`application/json`, strict): `path` (required, namespaced); `text` (string, ≤256 KiB, required).
**Responses**: `200` `{ path, targetId, objectKey, version, bytesWritten, mode: "append" }`; `400`; `404`; `401`/`403`.

### `POST /agent-workspace-snapshots`
**Description**: Create an immutable agent-workspace snapshot (mounts, evidence, command log, source versions).
**Auth**: Bearer; scope `knowledge-spaces:write`.
**Body** (`application/json`, strict): `knowledgeSpaceId` (uuid, required); `indexProjection` `{ fingerprint (1–512), projectionIds: string[] }` (required); `manifestVersion` (int>0, default 1); `commandLog` (array, default `[]`) each `{ command (1–4000), startedAt, completedAt?, input (default {}), outputSummary? (≤4000), cost? }`; `evidenceBundles` (EvidenceBundle[], default `[]`); `mounts` (ResourceMount[], default `[]`); `pathVersions` (array, default `[]`) `{ virtualPath (1–1000), version (1–512) }`; `sourceVersions` (array, default `[]`) `{ provider (1–120), providerResourceKey (1–1000), version (1–512) }`; `traceIds` (string[], default `[]`); `researchTaskJobId` (1–240, optional); `metadata` (object, default `{}`).
**Responses**:
- `201`: `AgentWorkspaceSnapshot` `{ id, tenantId, knowledgeSpaceId, fingerprint (/^snapshot-sha256:[a-f0-9]{64}$/), manifestVersion, commandLog, evidenceBundles, mounts, indexProjection, pathVersions, sourceVersions, permissionSnapshot: { subjectId, tenantId, scopes: string[] }, traceIds, researchTaskJobId?, metadata, createdAt }`.
- `400`; `404`; `401`/`403`.

### `GET /agent-workspace-snapshots/{id}`
**Description**: Fetch a previously created agent-workspace snapshot.
**Auth**: Bearer; scope `knowledge-spaces:read`.
**Path params**: `id` (string, 1–240).
**Responses**: `200` `AgentWorkspaceSnapshot`; `404`; `401`/`403`.

### `POST /agent-workspace-snapshots/{id}/replay`
**Description**: Re-execute a snapshot's recorded command log and report per-command drift.
**Auth**: Bearer; scope `knowledge-spaces:read` (this POST maps to `read`, unlike other POSTs).
**Path params**: `id` (string, 1–240). **Body**: None.
**Responses**:
- `200`: `AgentWorkspaceReplay` `{ id, snapshotId, tenantId, knowledgeSpaceId, startedAt, completedAt, traceId?, summary: { total, matched, changed, failed }, commands: [{ commandIndex, command, status: enum(matched|changed|failed), input, startedAt, completedAt, originalOutputSummary?, replayedOutputSummary?, error? }] }`.
- `404`; `409` replay failed; `401`/`403`.
