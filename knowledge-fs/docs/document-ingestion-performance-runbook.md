# KnowledgeFS document-ingestion performance runbook

This runbook covers the bounded-concurrency, batched, resumable document-compilation pipeline.
KnowledgeFS remains a Dify-dependent service: every model request is routed through Dify's model
runtime and plugin-daemon; KnowledgeFS does not own provider credentials.

## Runtime shape

The searchable publication path is:

1. parse and normalize the source;
2. build the deterministic outline;
3. generate bottom-up outline summaries in bounded batches;
4. chunk and build FTS/dense/PageIndex projections;
5. durably admit optional graph work and publish the searchable generation;
6. after the exact outline generation is published, extract entities/relations asynchronously and
   attach graph rows to that generation.

Outline summaries, embeddings, entity extraction, and relation extraction share one process-wide
model-request gate. Outline and semantic extraction also retain smaller per-document bounds.
Graph failure therefore degrades graph retrieval only; it cannot roll back an already searchable
dense/FTS/PageIndex generation.

Graph entity and relation upserts are physically separate database operations. Published graph
reads therefore use the durable semantic-job success state as a visibility barrier: no new async
graph row is queryable while its job is pending, running, retrying, failed, or superseded. A jobless
legacy synchronous graph generation remains readable for backward compatibility.

## Capacity settings

| Variable | Default | Valid range | Meaning |
| --- | ---: | ---: | --- |
| `KNOWLEDGE_MODEL_RUNTIME_GLOBAL_CONCURRENCY` | 16 | 1–128 | Total concurrent ingestion-time Dify model requests per KnowledgeFS API replica, including embedding transport requests. |
| `KNOWLEDGE_OUTLINE_SUMMARY_MAX_CONCURRENCY` | 8 | 1–32 | Maximum outline-summary provider batches scheduled by one document. |
| `KNOWLEDGE_OUTLINE_SUMMARY_BATCH_SIZE` | 8 | 1–32 | Maximum outline nodes in one structured summary request. |
| `KNOWLEDGE_OUTLINE_SUMMARY_BATCH_MAX_INPUT_CHARS` | 32000 | 1–200000 | Maximum aggregate prompt material in one outline-summary batch. |
| `KNOWLEDGE_SEMANTIC_EXTRACTION_BATCH_SIZE` | 8 | 1–32 | Maximum nodes in one entity or relation extraction request. |
| `KNOWLEDGE_SEMANTIC_EXTRACTION_MAX_CONCURRENCY` | 4 | 1–32 | Maximum semantic batches scheduled by one graph-enrichment job. |
| `KNOWLEDGE_EMBEDDING_REQUEST_CONCURRENCY` | 2 | 1–8 | Maximum 16-text embedding transport requests scheduled by one embedding call. |

The effective process limit is always the global limit, even when the sum of per-document limits is
higher. Across `R` API replicas, the theoretical provider pressure is `R × global concurrency`, so
scale replicas and the global value together. Start with defaults. Increase one step at a time only
when queue wait is sustained, provider 429/timeout rates remain flat, plugin-daemon CPU/memory is
healthy, and database connections have headroom.

Do not raise `KNOWLEDGE_EMBEDDING_REQUEST_CONCURRENCY` to compensate for slow individual provider
requests. It improves multi-batch documents but also increases high-dimensional response memory.

## Progress contract

Document processing task responses retain the existing durable `stage` and `progressPercent` fields
and add:

- `phase`: the work expected after the last durable checkpoint;
- `activeOperations`: bounded operation names such as `outline_summary`, `chunk`, `fts_index`, and
  `embedding`;
- `semanticEnrichment`: optional graph state (`not_scheduled`, `pending`, `running`, `ready`,
  `failed`, or `disabled`) plus safe completion counters when available.

The chunk/FTS/embedding work remains one durable `chunking_indexing` phase because the current
reindexer publishes those projections atomically. `activeOperations` names its components without
pretending that a partial projection is a resumable publication checkpoint. SSE progress events and
the unified background-task response expose the same additive metadata.

## Structured metrics

The API emits aggregation-only JSON lines. They intentionally contain no tenant, space, document,
model credential, URL, object key, prompt, source text, or free-form provider error.

| Event | Important dimensions |
| --- | --- |
| `knowledge_fs.ingestion_model_concurrency.metric` | lifecycle, active/queued requests, limit, queue wait milliseconds |
| `knowledge_fs.outline_summary.metric` | outcome, duration, node count, provider calls, checkpoint hits, bounded failure kind |
| `knowledge_fs.embedding_request.metric` | outcome, duration, text count, concurrency limit, bounded failure kind |
| `knowledge_fs.semantic_enrichment.metric` | outcome, duration, queue wait, execution attempt, provider calls, nodes scanned, degraded flag, bounded failure kind |
| `knowledge_fs.durable_task.metric` | compilation/research lifecycle and terminal outcome |

Alert on a sustained increase in `queueWaitMs`, `failureKind=rate_limited`,
`failureKind=timeout`, terminal document compilation failures, or
`semantic_enrichment.metric degraded=true`. A failed semantic-enrichment job means ordinary search
is available but graph-derived retrieval may be incomplete.

## Retry and recovery

- Outline checkpoints are scoped by tenant, space, document generation, node, input fingerprint,
  model route, and prompt version. A retry reuses exact successful nodes and recomputes only misses.
- Semantic entity/relation checkpoints are generation- and fingerprint-scoped. Relation extraction
  is skipped for nodes with fewer than two eligible entities.
- Embedding batches preserve input order and abort sibling transport work after the first failure.
  A document retry reuses exact generation-scoped ready projections through the compilation
  repositories.
- Semantic jobs wait for their generation to become published without consuming a model execution
  attempt. An unrelated document advancing the Space head does not invalidate an in-flight job;
  only a failed/canceled/superseded compilation or a successful generation absent from the current
  publication supersedes it.

Do not delete checkpoint rows to retry a normal transient provider failure. Use the existing task
retry operation; immutable-key mismatches are evidence of a code/schema defect and should be
investigated before data is changed.

## Rollout

1. Apply KnowledgeFS migrations before starting the new API image. Migrations 0038 and 0039 add
   outline-summary checkpoints and durable semantic-enrichment jobs/checkpoints.
2. Start one API replica with the default values and verify readiness/migration checks.
3. Import a representative small and large document. Confirm searchable publication completes
   before semantic enrichment reaches `ready`.
4. Observe the four ingestion metric families for at least one normal workload window.
5. Roll out remaining replicas. Remember that the global limit is per process.
6. Increase concurrency only after comparing provider request latency, 429/timeout rate,
   plugin-daemon memory, and database pool saturation with the previous window.

## Rollback

Prefer a configuration rollback before a code rollback:

1. set outline, semantic, and embedding concurrency to `1` to serialize new provider work;
2. leave the global gate enabled and lower it if the provider is overloaded;
3. disable graph in the affected document/space settings when graph enrichment must stop; dense,
   FTS, and PageIndex publication remains available;
4. deploy the prior application image only after confirming it tolerates migrations 0038/0039.

The new tables are additive. Do not drop them during an application rollback: retained checkpoints
and queued jobs are required for a safe forward recovery. If an old image cannot understand the
additive task response fields, its clients may ignore them; existing fields are unchanged.
