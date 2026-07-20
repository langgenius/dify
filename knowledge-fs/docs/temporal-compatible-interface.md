# Temporal-Compatible Workflow Boundary

KnowledgeFS currently uses `JobQueueAdapter` plus explicit TypeScript state machines for durable background work. This document records the boundary that future Temporal support must implement without changing API, ingestion, or cleanup business code.

Temporal is not a dependency in the current runtime. The active rule from the architecture notes still applies: use the durable job queue first, and add Temporal only when workflow complexity, scale, or operational requirements prove it is needed.

## Goals

- Keep application code deployment-agnostic across Cloudflare Queues, pg-boss, inline local queues, and a future Temporal runtime.
- Preserve tenant-scoped, idempotent, observable background work.
- Make long-running document compilation, reindexing, retention cleanup, and model upgrade jobs portable to Temporal workflows.
- Avoid a custom workflow DSL or Temporal-specific imports inside Hono routes, repositories, parser adapters, compute runtime, storage adapters, or retrieval code.

## Non-Goals

- Do not add Temporal SDK packages yet.
- Do not replace `JobQueueAdapter`.
- Do not move database, object storage, parser, embedding, cache, or network calls into deterministic workflow code.
- Do not put raw files, parse text, embeddings, JWTs, or large evidence bundles into workflow history.

## Existing Runtime Mapping

| Current boundary | Temporal-compatible role | Notes |
|---|---|---|
| `JobQueueAdapter.enqueue()` | `WorkflowClient.start()` or `signalWithStart()` | Use existing idempotency keys as Temporal workflow ids where possible. |
| `JobQueueAdapter.lease()` / worker polling | Temporal worker task polling | Temporal owns leasing; KnowledgeFS workers keep the same process entrypoints. |
| `DocumentCompilationJobStateMachine` | Workflow status facade | API status/cancel routes should keep reading this facade or a compatible projection. |
| `createDocumentCompilationWorker().process()` | Workflow orchestration + activities | Pure orchestration steps may become workflow code; IO-heavy steps must stay activities. |
| Repository methods | Activities | All database access remains outside deterministic workflow code. |
| Object storage, parser, embeddings, retrieval evaluation | Activities | Activities receive ids/object keys/bounded config, not raw unbounded payloads. |
| `TraceRecorder` | Workflow/activity trace bridge | Propagate `traceId` through workflow input and activity attributes. |

## Future Adapter Shape

The future Temporal adapter should sit beside existing queue adapters and expose a small workflow runtime boundary. The interface below is documentation only; it is not implemented in this slice.

```ts
export interface WorkflowRuntimeAdapter {
  readonly kind: "temporal";

  start(input: StartWorkflowInput): Promise<WorkflowHandle>;
  signal(input: SignalWorkflowInput): Promise<WorkflowHandle>;
  cancel(input: CancelWorkflowInput): Promise<WorkflowHandle>;
  get(input: WorkflowLookupInput): Promise<WorkflowHandle | null>;
}

export interface StartWorkflowInput {
  readonly workflowId: string;
  readonly workflowType: WorkflowType;
  readonly taskQueue: string;
  readonly payload: JsonObject;
  readonly idempotencyKey: string;
  readonly traceId: string;
  readonly tenantId: string;
  readonly searchAttributes?: Readonly<Record<string, string | number | boolean>>;
}

export type WorkflowType =
  | "document.compile"
  | "retention.cleanup.knowledge-space"
  | "retention.cleanup.parse-artifacts"
  | "embedding-model.upgrade"
  | "bulk.document-upload"
  | "bulk.document-delete"
  | "bulk.document-reindex";
```

The adapter must translate Temporal handles back into the same status semantics already exposed by `GET /jobs/{id}` and bulk progress APIs: queued/running terminal state, cancellation state, retry/error detail, timestamps, tenant id, and trace id.

## Determinism Rules

Workflow code must be deterministic:

- No direct database, cache, object storage, parser, embedding, reranker, LLM, filesystem, or network calls.
- No `Date.now()`, `new Date()`, random UUID generation, crypto hashing, environment reads, or process-global mutable state inside workflow functions.
- Generate ids, timestamps, hashes, and provider calls inside activities, then return compact results.
- Use explicit workflow versioning when changing step order, retry behavior, payload shape, or compensation logic.
- Keep workflow decisions based on JSON-serializable inputs and activity outputs only.

## Payload Rules

Workflow payloads must stay compact and stable:

- Include `tenantId`, `knowledgeSpaceId`, `traceId`, job ids, document ids, version numbers, object keys, and bounded numeric limits.
- Exclude raw file bytes, parse text, chunk text, embeddings, prompt text, evidence bundles, JWTs, and stack traces.
- Prefer references over copies: object key, parse artifact id, node ids, projection version, model id.
- Validate payloads with Zod or equivalent schema before starting workflows and before processing activity inputs.
- Preserve existing idempotency keys for safe retries and duplicate submit handling.

## Activities

Each IO or compute boundary should be an activity with explicit timeout, retry, heartbeat, and cancellation behavior.

| Activity group | Examples | Retry stance |
|---|---|---|
| Object storage | head/get/put/delete raw document object | Retry transient errors; avoid duplicate writes through deterministic object keys. |
| Parser | native parse, Unstructured partition call | Retry transient provider errors; fail closed on unsupported formats. |
| Compute | Bounded TypeScript chunk/token/pack/diff calls | Do not retry deterministic validation or resource-limit failures. |
| Database | repository create/update/list/prune | Retry only safe transactional operations; keep parameterized SQL and explicit limits. |
| Projection | embedding, FTS, dense index writes | Retry provider/network errors with bounded batch sizes. |
| Evaluation | smoke evaluation and regression gates | Retry transient retrieval/provider failures; block publication on metric failure. |
| Cleanup | retention, cascade deletion, trace redaction | Use bounded batch limits and continuation cursors. |

Activities that can run longer than one worker heartbeat interval must heartbeat with low-cardinality progress such as `documentsScanned`, `nodesWritten`, or `projectionVersion`. Heartbeats must not include raw text or large arrays.

## Cancellation And Compensation

Temporal cancellation must map to existing cancellation semantics:

- `DELETE /jobs/{id}` should request cancellation, not silently delete history.
- Canceled document compilation should leave raw document assets queryable unless explicit deletion was requested.
- Failed asset persistence after object upload must keep existing best-effort object cleanup behavior.
- Failed parse/artifact/index steps should mark the `DocumentAsset` or `DocumentCompilationJob` failed with bounded error detail.
- Publication workflows must keep blue-green behavior: build candidate projections, evaluate, then publish atomically or leave active projection unchanged.
- Cleanup workflows must be resumable by cursor and must never assume a full-space scan is safe.

## Workflow Types

### `document.compile`

Input:

- `tenantId`
- `knowledgeSpaceId`
- `documentAssetId`
- `version`
- `traceId`

Expected sequence:

1. Load document asset metadata.
2. Read raw object by key.
3. Parse document.
4. Persist parse artifact.
5. Chunk into knowledge nodes.
6. Build candidate index projections.
7. Run smoke evaluation when configured.
8. Publish or mark failed.

All heavy steps are activities. The workflow records only ids, counts, versions, stage names, and trace correlation.

### `retention.cleanup.knowledge-space`

Input:

- `tenantId`
- `knowledgeSpaceId`
- `requestedAt`
- `maxTraceDeletes`
- `maxProjectionDeletes`
- `projectionRetainVersions`

Expected sequence:

1. Load retention policy.
2. Delete old answer traces under `maxTraceDeletes`.
3. Prune stale dense-vector projections under `maxProjectionDeletes`.
4. Prune stale FTS projections under `maxProjectionDeletes`.
5. Report effective session TTL without scanning generic cache keys.

### `retention.cleanup.parse-artifacts`

Input:

- `tenantId`
- `knowledgeSpaceId`
- `cursorId`
- `requestedAt`
- `maxDocuments`
- `maxArtifactsPerDocument`

Expected sequence:

1. Load retention policy.
2. List document assets by stable cursor with `limit = maxDocuments`.
3. Prune old parse artifact versions per document under `maxArtifactsPerDocument`.
4. Return `nextCursorId` for continuation.

### Bulk Workflows

Bulk upload, delete, and reindex workflows should remain orchestration shells over per-document activities/jobs. They must keep existing progress semantics: total/completed/failed counts, failed item ids, timestamps, and tenant-scoped status.

## Observability

Every workflow start must include `traceId`, `tenantId`, workflow type, and low-cardinality route/job labels. Temporal search attributes may include:

- `TenantId`
- `KnowledgeSpaceId`
- `WorkflowType`
- `DocumentAssetId`
- `TraceId`

Do not include filenames when they may contain user data, raw text, JWTs, object bodies, prompt text, or provider responses in workflow history, logs, or search attributes.

## Performance Guardrails

- Workflow starts must be idempotent.
- Activity payloads must be bounded; large content stays in object storage or database rows referenced by id.
- Batch activities must accept explicit `limit` values and stable cursors.
- Repository activities must use parameterized SQL and existing indexes.
- Avoid per-row activity waterfalls. Prefer batch repository methods such as `getMany`, bounded list pages, and projection batch writes.
- Cleanup workflows must continue through cursor-based pages instead of loading all documents/artifacts/projections.

## Migration Plan

1. Keep the current `JobQueueAdapter` and state-machine implementations as the production path.
2. Add a `WorkflowRuntimeAdapter` package only when Temporal is selected for a deployment target.
3. Mirror existing worker payload schemas as Temporal workflow input schemas.
4. Implement Temporal activities by delegating to existing repositories/adapters.
5. Project Temporal workflow state into existing job status and bulk progress APIs.
6. Run both runtimes behind the same conformance tests before enabling Temporal in production.

The migration is complete only when Hono routes, Admin UI, and MCP tools remain unchanged while the background runtime can switch between JobQueue-backed workers and Temporal workers by configuration.
