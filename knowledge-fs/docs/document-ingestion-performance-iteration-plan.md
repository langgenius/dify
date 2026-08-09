# KnowledgeFS document-ingestion performance iteration plan

Status: completed  
Owner: KnowledgeFS backend  
Scope: document compilation from parsed artifact through searchable publication and optional semantic enrichment  
Baseline fixture: `/Users/jyong/Downloads/权责蓝图.html`

## 1. Problem statement and measured baseline

The baseline HTML is about 100 KiB and produces:

- 171 parse elements: 68 headings, 96 paragraphs, and 7 tables;
- 68 outline nodes;
- 80 knowledge nodes containing 10,613 characters;
- 5 Dify text-embedding runtime requests at the current 16-text transport batch size;
- 68 per-node outline-summary LLM requests;
- when graph indexing is enabled, 80 entity-extraction plus 80 relation-extraction LLM requests.

The deterministic local work is not the bottleneck. Across 20 local runs, P95 parsing, outline construction, and chunking were 4.04 ms, 6.35 ms, and 4.08 ms respectively. The critical-path model fan-out is therefore the target of this iteration.

## 2. Goals

1. Make model concurrency bounded, configurable, fair across simultaneous document compilations, and observable.
2. Reduce outline-summary requests from one request per node to bounded multi-node batches without changing the resulting tree contract.
3. Persist generation-scoped intermediate results so retries resume completed work instead of replaying the entire stage.
4. Publish a document as searchable before optional graph enrichment completes.
5. Batch graph extraction and avoid relation-model calls for nodes without enough entities.
6. Run Dify embedding transport sub-batches with bounded concurrency and reuse completed generation-scoped results on retry.
7. Expose honest compilation substages and counters so the UI/API does not describe all processing as embedding.

## 3. Non-goals

- Do not flatten or remove meaningful HTML headings to hide backend fan-out.
- Do not change PageIndex retrieval from layered traversal to whole-tree-only retrieval.
- Do not copy or manage model credentials in KnowledgeFS.
- Do not increase concurrency without a process-wide safety bound.
- Do not make graph enrichment a prerequisite for dense/FTS/PageIndex retrieval readiness.

## 4. Work breakdown

### ING-PERF-01 — Regression fixture and request-accounting tests

Status: completed

- Add deterministic tests covering a 68-node outline and an 80-node compilation fixture.
- Assert request counts, ordering, cancellation, and retry behavior without calling an external provider.
- Record stage durations and request counters through test metrics.

Acceptance:

- Tests fail against the old per-node/replay behavior and pass after subsequent tasks.
- No test depends on the developer's Downloads directory.

### ING-PERF-02 — Configurable per-document and global model concurrency

Status: completed

- Add `KNOWLEDGE_OUTLINE_SUMMARY_MAX_CONCURRENCY`, default `8`, allowed range `1..32`.
- Add `KNOWLEDGE_MODEL_RUNTIME_GLOBAL_CONCURRENCY`, default `16`, allowed range `1..128`.
- Apply a fair FIFO process-wide gate to ingestion-time outline and semantic model calls.
- Preserve a smaller per-document gate so one document cannot monopolize all global slots.
- Document both settings in the KnowledgeFS service-specific environment example.

Acceptance:

- One document never exceeds its configured outline concurrency.
- Multiple documents together never exceed the global concurrency.
- Invalid values fail startup with the environment-variable name in the error.

### ING-PERF-03 — Batched outline summaries

Status: completed

- Extend the summary provider contract with a multi-node request and strict node-ID keyed response.
- Batch ready nodes bottom-up while preserving child-before-parent semantics.
- Bound each batch by node count and total prompt characters.
- Add `KNOWLEDGE_OUTLINE_SUMMARY_BATCH_SIZE` and
  `KNOWLEDGE_OUTLINE_SUMMARY_BATCH_MAX_INPUT_CHARS`.
- Keep a compatibility adapter for single-node test/custom providers during the transition.

Acceptance:

- The 68-node regression tree completes in no more than 10 provider calls with defaults.
- Every persisted node retains its original ID, hierarchy, title, source range, and a non-empty bounded summary.
- A missing, duplicate, or unexpected provider result fails with a stable contract error.

### ING-PERF-04 — Generation-scoped outline checkpointing

Status: completed

- Persist each completed summary batch with generation ID, node ID, content digest, model route, and prompt version.
- Reuse only exact digest/model/prompt matches.
- Resume unfinished batches after retry; never mix results across generations or model-profile revisions.
- Delete candidate checkpoints through the existing durable deletion/GC ownership model.

Acceptance:

- A failure in the final batch does not re-call successful earlier batches.
- A changed node, model, or prompt invalidates only the affected checkpoint.
- Concurrent retries remain idempotent.

### ING-PERF-05 — Searchable publication before graph enrichment

Status: completed

- Remove entity/relation extraction from the document publication critical path.
- Publish dense, FTS, PageIndex, paths, and multimodal components first.
- Durably admit a generation-scoped semantic-enrichment job before publication, then execute it
  only after the exact outline generation is present in the published snapshot. This closes the
  process-crash gap between publication and queue admission.
- Make graph availability explicit (`pending`, `ready`, `failed`, or `disabled`) without making ordinary retrieval unavailable.
- Ensure a newer publication supersedes stale enrichment work.

Acceptance:

- A document becomes searchable without waiting for graph LLM calls.
- Process restart cannot lose admitted enrichment work.
- Graph failure does not roll back an otherwise valid searchable publication.
- Retrieval never reads graph rows from an unpublished or stale generation.
- Async graph rows remain hidden until the job succeeds, so entity and relation writes appear as
  one logical unit; legacy synchronous graph generations remain readable.

### ING-PERF-06 — Batched, resumable semantic extraction

Status: completed

- Extract multiple nodes per structured LLM request, keyed by node ID.
- Combine entity and relation extraction when the provider contract supports it; otherwise preserve two bounded batch phases.
- Skip relation extraction for nodes with fewer than two eligible entities.
- Persist batch checkpoints and resume only missing/invalid nodes.
- Use the shared fair-FIFO global model gate across simultaneous documents and tenants.

Acceptance:

- The 80-node fixture requires no more than 20 semantic provider calls with defaults.
- Zero/one-entity nodes produce no relation-provider request.
- A late provider failure does not replay completed batches.

### ING-PERF-07 — Embedding transport concurrency and retry reuse

Status: completed

- Add bounded concurrency for the existing 16-text Dify transport batches.
- Add `KNOWLEDGE_EMBEDDING_REQUEST_CONCURRENCY`, default `2`, allowed range `1..8`.
- Preserve output ordering and fail/cancel deterministically.
- Reuse exact generation/content/vector-space projections on retry instead of regenerating them.

Acceptance:

- The 80-node fixture still makes five transport calls but can run up to the configured safe concurrency.
- Returned vectors remain aligned with their input nodes.
- Retrying graph enrichment does not invoke embedding again.

### ING-PERF-08 — Honest progress, metrics, and operational documentation

Status: completed

- Add substages for outline summary, chunking, FTS, embedding, graph admission, and publication.
- Report completed/total counters for batched model work.
- Emit duration, queue wait, active concurrency, retry, timeout, 429, and degraded-enrichment metrics.
- Keep existing public checkpoint compatibility while extending task metadata/SSE additively.
- Add rollout, rollback, and capacity guidance.

Acceptance:

- Operators can attribute total latency to a specific stage.
- Existing clients continue to parse task responses.
- The UI can distinguish embedding from outline and graph work using backend data.

### ING-PERF-09 — Verification and rollout gate

Status: completed

- Run package unit tests, type checks, OpenAPI/capability contract checks, migration tests, and production build.
- Verify PostgreSQL/TiDB-compatible migrations and recovery behavior.
- Compare request counts and searchable-ready latency against the baseline fixture.
- Update this document with final results and any intentionally deferred items.

Acceptance:

- All affected CI-equivalent checks pass.
- No unclassified KnowledgeFS production file or contract-lock drift remains.
- Rollback can disable batching/enrichment without losing the published searchable generation.

## 5. Target request budget for the baseline fixture

| Stage | Before | Target |
| --- | ---: | ---: |
| Outline summaries | 68 | <= 10 |
| Text embedding transport | 5 sequential | 5, concurrency <= configured bound |
| Entity and relation extraction | up to 160 | <= 20, asynchronous |
| Critical-path model requests | up to 233 | <= 15 |

## 6. Execution order and dependency rules

1. Implement ING-PERF-01 and ING-PERF-02 first; all later work uses the shared gates and request accounting.
2. Complete ING-PERF-03 before ING-PERF-04 so checkpoint schema stores the final batch contract.
3. Complete ING-PERF-05 before changing semantic extraction; this removes graph work from the user-visible readiness path independently of batching gains.
4. Complete ING-PERF-06 and ING-PERF-07 against durable generation identities.
5. Finish with ING-PERF-08 and ING-PERF-09, then mark this plan complete.

## 7. Progress log

- 2026-08-09: baseline measured and root cause confirmed; plan created.
- 2026-08-09: added per-document and process-wide FIFO model concurrency controls. Production
  defaults are outline `8`, global `16`, and embedding transport `2`; all values are bounded and
  startup validation names the invalid variable.
- 2026-08-09: replaced 68 per-node Outline calls with bottom-up, node-keyed batches. The 68-node
  fixture now uses 9 requests at the default batch size.
- 2026-08-09: added generation-scoped Outline checkpoints. A final-batch timeout resumes only
  unfinished nodes and never replays completed batches.
- 2026-08-09: moved entity/relation extraction behind searchable publication. Durable graph jobs
  wait for the exact publication, survive restart, and supersede stale generations.
- 2026-08-09: batched semantic extraction and added node-level generation checkpoints. The 80-node
  fixture uses 10 entity plus 10 relation requests; retries reuse completed batches and one-entity
  nodes skip relation calls.
- 2026-08-09: made five 16-text embedding transports execute with bounded concurrency while
  preserving result order and fail-fast cancellation. Embedding calls also use the shared global
  ingestion gate.
- 2026-08-09: extended document-task, SSE, and background-task data with additive phase,
  operation, and graph availability fields. Added structured concurrency, Outline, embedding, and
  semantic-enrichment metrics plus the rollout/rollback runbook.
- 2026-08-09: verified the real baseline HTML still parses into 171 elements and a 68-node tree
  with depth counts `1 / 32 / 35`. Its default node-bounded Outline request budget is exactly 10,
  and the matching regression fixture now enforces that value without reading a developer file.
- 2026-08-09: closed two asynchronous graph races found during final review. A different document
  advancing the shared Space head no longer supersedes an in-flight generation, and graph reads
  now wait for the semantic job's success barrier instead of observing entity/relation partials.
- 2026-08-09: completed the affected CI-equivalent verification: KnowledgeFS full check, production
  build, backend lint, dependency audit, secret scan, PostgreSQL/TiDB migration checks, and Dify
  contract generation/check all pass. The live-provider wall-clock result remains an operational
  rollout measurement rather than a deterministic repository test; the emitted metrics and this
  plan's request/wave budgets provide its acceptance signal.

## 8. Final verification result

| Signal | Baseline | Final deterministic result |
| --- | ---: | ---: |
| Outline provider calls for `权责蓝图.html` shape | 68 | 10 |
| Outline serial dependency waves at concurrency 8 | up to 17 at concurrency 4 | 3 bottom-up levels |
| Embedding transports for 80 nodes | 5 sequential | 5 in 3 waves at default concurrency 2 |
| Entity/relation calls | up to 160 on the publication path | at most 20, resumable and asynchronous |
| Searchable-path model calls | up to 233 | at most 15 |

The repository does not call a real tenant model during CI, so it does not claim a provider-specific
millisecond improvement. Instead it proves the exact request count, dependency waves, concurrency
bounds, ordering, cancellation, checkpoint reuse, and publication barrier. Production comparison
uses `knowledge_fs.outline_summary.metric`, `knowledge_fs.embedding_request.metric`, and
`knowledge_fs.semantic_enrichment.metric` during rollout.
