# RAG Platform Redesign Technical Selection

> Updated: 2026-07-16
> Current execution index: `.harness/docs/consolidated-iteration-plan.md`
> This document remains the architecture source of truth. The consolidated plan is the
> current task-level roadmap and preserves links to the historical iteration plans.

> Compute decision (2026-07-16): project-owned chunking, token counting, RRF fusion, evidence
> packing, and text diff are implemented as bounded TypeScript in `packages/compute`. Any later
> Rust/WASM recommendations retained in historical design sections are superseded by this decision.

## 1. Executive Summary

This document proposes a complete redesign of the current RAG module as a new **Knowledge Platform** for both human users and AI agents.

The system should not be treated as a traditional "document upload + chunk + vector search + answer" feature. A modern RAG platform should be an **evidence infrastructure**:

- Humans need reliable answers, citations, diagnostics, and simple product interactions.
- Agents need structured evidence, composable tools, stable permissions, reproducible traces, and long-running research workflows.
- Operators need observability, evaluation, versioning, rollback, and cost control.

The recommended direction is:

```text
Human UI (React / Cloudflare Pages)
Agent API / MCP / OpenAPI / Experimental A2A
        |
Cloudflare Workers (SaaS) / Node.js Docker (Standalone)
        |
Knowledge Gateway (Hono + TypeScript)
        |
KnowledgeFS Virtual File System
        |
Retrieval Runtime (TypeScript orchestration + bounded TypeScript compute)
        |
Index Serving Layer (TiDB Cloud / PostgreSQL — vector + FTS + graph in one DB)
        |
Knowledge Compiler (Unstructured API + Embedding API + LLM API)
        |
R2/MinIO (Objects) + TiDB Cloud/PostgreSQL (Metadata + Vector + FTS + Graph) + KV/Redis (Cache)
```

The most important design decision is to make the system **latency-budget driven**:

- Default user queries should be fast.
- Advanced reasoning, query decomposition, GraphRAG, and multi-hop research should be triggered only when needed.
- Heavy computation should move to ingestion, indexing, precomputation, and background workflows.

Current implementation direction also includes two first-class structural contracts:

- **PageIndex-inspired `DocumentOutline`**: every parsed document should expose a
  citeable outline tree with TOC/heading source metadata, title location, page/offset
  ranges, section summaries, quality metadata, and links to raw parse elements and
  generated leaf nodes.
- **Native `DocumentMultimodalManifest`**: every parsed document should expose a
  table/image/code/page inventory with OCR, captions, bounding boxes, page/section
  locations, object-backed asset references, thumbnail variants, enrichment metadata,
  and visual embedding status.

These contracts do not replace leaf-level retrieval. Raw paragraphs, tables, images,
code blocks, and generated `KnowledgeNode`s remain indexed through dense embeddings,
full-text search, graph expansion, reranking, and evidence packing.

## 2. Design Goals

| Goal | Requirement |
|---|---|
| Low latency | Default retrieval should avoid complex agentic loops. Retrieval P95 target: 300-800ms before generation. |
| High answer quality | Use hybrid retrieval, reranking, evidence packing, and citation verification. |
| Human-friendly UX | Normal users should not tune chunk size, topK, thresholds, or embedding parameters. |
| Agent-friendly API | Agents should receive structured evidence, not only natural language answers. |
| Reproducibility | Every retrieval result should be traceable to document version, node id, index version, and artifact hash. |
| Evolvability | Parser, embedding model, vector store, reranker, and graph engine should be replaceable providers. |
| Enterprise readiness | Permissions, audit logs, data isolation, budget limits, cancellation, and rollback are first-class requirements. |
| Quality governance | Evaluation datasets, regression testing, online feedback, and A/B testing should be built into the platform. |

## 3. Product Principle

The product should expose complexity progressively.

### 3.1 Normal Users

Normal users should only choose high-level goals, or ideally choose nothing:

- Customer support Q&A
- Internal knowledge base
- Legal or policy search
- Technical documentation
- Reports and tables
- General enterprise documents

The system should automatically decide:

- Parser strategy
- OCR strategy
- Chunking strategy
- Index projections
- Reranker
- Retrieval mode
- Whether table/image understanding is needed
- Whether summary tree or graph index should be built

### 3.2 Advanced Users

Advanced users should see product-level controls:

- Faster / more accurate / cheaper
- Strict citations / more conversational answer
- Prefer newer documents / prefer authoritative documents
- Answer only when evidence exists
- Enable cross-document synthesis

These are user-facing quality controls, not raw retrieval parameters.

### 3.3 Expert Users

Expert users can access a Retrieval Studio:

- Chunking strategy
- Embedding model
- Dense/sparse/late-interaction index
- Hybrid fusion weights
- Reranker
- Metadata filters
- Graph expansion depth
- Summary tree
- Prompt templates
- Evaluation sets
- A/B experiments

Expert tuning should be saved as reusable strategy templates.

## 4. Core Architecture

## 4.1 High-Level Components

```text
Knowledge Gateway
  - Human API
  - Agent API
  - MCP Server
  - Experimental A2A Adapter
  - OpenAPI
  - Auth, policy, budget, audit

Knowledge Compiler
  - Source sync
  - Parser routing
  - Document normalization
  - Structure extraction
  - Knowledge node generation
  - Contextual enrichment
  - Entity/relation extraction
  - Index projection generation

Index Serving Layer
  - Dense vector index
  - Sparse/BM25 index
  - Multi-vector or late-interaction index
  - Metadata filter index
  - Structural tree / file-system index
  - Summary tree index
  - Optional graph index

KnowledgeFS
  - SourceFS mounted resources
  - Virtual paths
  - Command registry
  - Safe shell dispatcher
  - Physical and semantic directory views
  - Document outline trees
  - ls/cat/grep/find/stat/diff semantics
  - EvidenceFS query traces and evidence bundles
  - Workspace snapshots and replay
  - Agent-readable resources
  - Optional FUSE/WebDAV adapters

Retrieval Runtime
  - Query normalization
  - Fast/deep/research routing
  - KnowledgeFS navigation
  - Exact grep/BM25 search
  - Hybrid recall
  - Permission filtering
  - Reranking
  - Evidence compression
  - Citation packing

Evaluation & Observability
  - Retrieval trace
  - Answer trace
  - Golden question set
  - Online feedback
  - Regression tests
  - Metrics and dashboards
```

## 4.2 Recommended Default Stack

| Layer | Recommended Selection |
|---|---|
| Primary language | TypeScript (full-stack unified, including bounded compute) |
| SaaS runtime | Cloudflare Workers (edge-distributed) |
| Standalone runtime | Docker (Node.js / Bun) |
| API framework | Hono (runs on Workers and Node.js without modification) |
| Human application shell | Next.js / React for Admin Console and human-facing workflows |
| Internal job runtime | SaaS: Cloudflare Queues + Durable Objects; Standalone: pg-boss |
| Database (unified: metadata + vector + FTS + graph) | SaaS: TiDB Cloud (TiDB Vector + FULLTEXT + recursive CTE); Standalone: PostgreSQL (pgvector + tsvector + recursive CTE) |
| Object storage | SaaS: Cloudflare R2; Standalone: MinIO or local filesystem (both S3-compatible) |
| Edge cache | SaaS: Cloudflare KV + Cache API; Standalone: Redis or in-memory LRU |
| Document parsing | Self-hosted Unstructured API + native TypeScript parsers for Markdown/HTML/structured data |
| Embedding | API-only: OpenAI / Voyage / Cohere / other providers via unified gateway |
| Reranking | API-only: Cohere Rerank / Voyage Rerank / other providers |
| LLM generation | API-only: Claude / OpenAI / other providers via unified gateway |
| Agent protocol | MCP + OpenAPI first; A2A as experimental Phase 5 adapter |
| Knowledge file-system interface | KnowledgeFS virtual filesystem, MCP-first, optional WebDAV adapter |
| Admin Console | TypeScript (React/Next.js), hosted on Cloudflare Pages (SaaS) or bundled in Docker (Standalone) |
| Observability | OpenTelemetry (Workers Trace Workers / Node.js OTEL SDK) |
| Evaluation | Custom TypeScript evaluation runner + LLM-as-judge metrics |

## 4.3 Language and Deployment Strategy

The platform should use a **TypeScript-only** unified codebase that deploys to two targets: **Cloudflare Workers (SaaS)** and **Docker (Standalone)**.

### Why This Architecture

The core insight is that this platform's workload splits cleanly into two categories while sharing
one language and validation model:

- **Orchestration and IO**: API routing, permission checking, retrieval coordination, LLM streaming, caching, job management. These are IO-bound and fit TypeScript well.
- **Bounded pure logic**: Chunking, token counting, RRF fusion, context window packing, and text diff. These stay in `packages/compute`, use explicit limits, and avoid serialization/runtime boundaries.

### Hono and Next.js Boundary

Hono and Next.js should be used together, but with a strict ownership boundary:

```text
Next.js / React Admin Console
  - Human-facing UI
  - Upload workflow
  - Retrieval UI
  - Citation viewer
  - Trace viewer
  - Evaluation dashboard
  - Retrieval Studio
  - Optional thin UI BFF only

Hono Knowledge Gateway
  - OpenAPI
  - MCP tools
  - Auth, policy, budget, audit
  - KnowledgeFS / SourceFS / EvidenceFS commands
  - Retrieval Runtime
  - SSE generation
  - Job APIs
  - Provider adapters
```

Hono is the portable API and agent runtime because it runs cleanly on Cloudflare Workers and Node.js. Next.js is the human application shell because the Admin Console needs complex, stateful UI: upload progress, document health, citations, traces, graph views, semantic views, evaluation dashboards, and Retrieval Studio.

Rules:

- Core knowledge, retrieval, ingestion, job, MCP, provider, cache, and permission logic lives in Hono packages.
- Next.js routes or server actions may be used only as a thin UI BFF when it improves frontend ergonomics.
- Next.js must call Hono APIs for core platform behavior rather than importing or duplicating retrieval/runtime internals.
- Shared TypeScript SDK/client packages should be generated from the Hono OpenAPI contract so UI and API stay aligned.
- SaaS can deploy Next.js/React UI on Cloudflare Pages and Hono API on Cloudflare Workers.
- Standalone can bundle Next.js and Hono as separate Docker services or a single composed deployment, while preserving the API boundary.

All model inference (embedding, reranking, LLM generation) and document parsing (Unstructured) run as **external API calls**, not local computation. This eliminates the need for Python ML ecosystems and GPU infrastructure in the platform runtime.

TypeScript is chosen as the primary language because:

- **Full-stack unification**: Frontend (React), API (Hono), Workers, and Standalone Docker all use one language.
- **Cloudflare Workers native**: Workers run V8 isolates; TypeScript is the first-class language.
- **Portability**: Hono, Drizzle ORM, and S3 client libraries run identically on Workers and Node.js.
- **Ecosystem**: npm has mature libraries for HTTP, streaming, caching, queue management, and testing.
- **Team velocity**: One language across the entire stack reduces context switching and hiring friction.

The compute package remains separate because its algorithms need deterministic output, strict
resource ceilings, portable execution, and focused performance tests. Keeping it in TypeScript
removes the generated-artifact and JSON bridge overhead while preserving those boundaries.

### Recommended Language Boundaries

| Area | Language | Reason |
|---|---|---|
| API Gateway, auth, routing | TypeScript (Hono) | Workers-native, portable to Node.js. |
| Agent Gateway / MCP / OpenAPI | TypeScript | Tool execution, streaming, schema validation. |
| Retrieval Runtime orchestration | TypeScript | Parallel vector + FTS queries to DB, permission filtering, RRF fusion, result merging. |
| KnowledgeFS command handlers | TypeScript | `ls`, `cat`, `grep`, `find`, `stat`, `diff` — DB queries + cache lookups. |
| Generation layer | TypeScript | LLM API calls, SSE streaming, context window management. |
| Job queue management | TypeScript | Cloudflare Queues / pg-boss adapter. |
| Cache management | TypeScript | KV / Redis adapter. |
| Admin Console | TypeScript (React) | Full-stack language unification. |
| Chunking engine | TypeScript (`packages/compute`) | Section-aware segmentation, overlap, heading inheritance, cross-page repair. |
| Token counter | TypeScript (`packages/compute`) | Bounded approximate token counting for context budgets. |
| RRF fusion | TypeScript (`packages/compute`) | Reciprocal rank fusion scoring across multiple retrieval paths. |
| Context window packer | TypeScript (`packages/compute`) | Evidence ordering, token budget allocation, truncation. |
| Text diff | TypeScript (`packages/compute`) | Line-level and word-level diff for document version comparison. |

### Compute Module Design

`@knowledge/compute` exposes synchronous, validated TypeScript interfaces:

```text
chunkParseArtifact(input) -> KnowledgeNode[]
countApproxTokens(text) -> number
rrfFuse(rankedLists) -> RrfFusedItem[]
packEvidence(evidenceBundle, tokenBudget) -> PackedEvidence
diffText(oldText, newText) -> TextDiff
```

These modules have no IO, network access, filesystem dependency, provider calls, or mutable global
state. Input validation and explicit bounds make the same implementation portable across Workers
and Node.js without a generated runtime artifact.

### Platform Adapter Layer

The codebase uses a platform adapter interface so the same application code runs on both deployment targets:

```text
interface PlatformAdapter {
  // Storage
  objectStorage: S3Compatible       // R2 or MinIO
  cache: CacheStore                 // KV or Redis
  
  // Unified database (metadata + vector search + full-text search + graph)
  db: DatabaseAdapter               // TiDB (SaaS) or PostgreSQL (Standalone)
  
  // Jobs
  jobQueue: JobQueue                // Cloudflare Queues or pg-boss
  durableState: DurableStateStore   // Durable Objects or DB-backed state
  
  // External services
  embeddingProvider: EmbeddingAPI   // OpenAI / Voyage / Cohere
  rerankProvider: RerankAPI         // Cohere / Voyage
  llmProvider: LLMProvider          // Claude / OpenAI
  parserService: ParserAPI          // Self-hosted Unstructured
}
```

The `DatabaseAdapter` abstracts the unified database that handles metadata, vector search, full-text search, and graph queries:

```text
interface DatabaseAdapter {
  // Standard ORM operations (Drizzle)
  query: DrizzleInstance
  
  // Vector search
  vectorSearch(collection, vector, topK, filters?) -> ScoredResult[]
  
  // Full-text search
  fullTextSearch(collection, query, topK, filters?) -> ScoredResult[]
  
  // Graph traversal
  graphTraverse(entityId, depth, maxFanout, maxNodes) -> GraphResult
}
```

Two implementations:

| Adapter | SaaS (Cloudflare) | Standalone (Docker) |
|---|---|---|
| `objectStorage` | Cloudflare R2 (S3-compatible SDK) | MinIO or local filesystem (S3-compatible SDK) |
| `cache` | Cloudflare KV + Cache API | Redis or in-memory LRU (Map) |
| `db` | TiDB Cloud (TiDB Vector + FULLTEXT + recursive CTE) | PostgreSQL (pgvector + tsvector + recursive CTE) |
| `db.vectorSearch` | TiDB `VEC_COSINE_DISTANCE()` | pgvector `<=>` operator |
| `db.fullTextSearch` | TiDB `MATCH() AGAINST()` | PostgreSQL `tsvector` + `@@` + `ts_rank()` |
| `db.graphTraverse` | TiDB recursive CTE | PostgreSQL recursive CTE |
| `jobQueue` | Cloudflare Queues | pg-boss (PostgreSQL-backed) |
| `durableState` | Durable Objects | PostgreSQL-backed state tables |
| `embeddingProvider` | OpenAI / Voyage / Cohere API | Same APIs |
| `rerankProvider` | Cohere / Voyage API | Same APIs |
| `llmProvider` | Claude / OpenAI API | Same APIs |
| `parserService` | Self-hosted Unstructured API (HTTP) | Self-hosted Unstructured in same Docker Compose (HTTP) |

The adapter boundary is enforced at the module level. Application code imports `PlatformAdapter` and never uses platform-specific APIs directly.

### Database-as-Search-Engine

The most important simplification in this architecture is that **the database IS the search engine**. There is no separate vector database or search cluster.

| Capability | SaaS (TiDB Cloud) | Standalone (PostgreSQL) |
|---|---|---|
| Metadata storage | ✅ MySQL-compatible tables | ✅ PostgreSQL tables |
| Dense vector search | ✅ TiDB Vector (`VECTOR` column type) | ✅ pgvector (`vector` column type) |
| Full-text search (BM25-equivalent) | ✅ `FULLTEXT` index + `MATCH() AGAINST()` | ✅ `tsvector` + `ts_rank()` + GIN index |
| Metadata filtering | ✅ Standard SQL WHERE clauses | ✅ Standard SQL WHERE clauses |
| Graph index (recursive traversal) | ✅ Recursive CTE (since TiDB 5.1+) | ✅ Recursive CTE |
| CJK full-text support | ✅ Built-in CJK tokenizer | ✅ pg_jieba / pg_bigm for CJK |
| ACID transactions | ✅ | ✅ |
| Horizontal scaling | ✅ TiDB Cloud serverless auto-scale | ⚠️ Vertical scaling or read replicas |

Hybrid retrieval runs as two parallel database queries (vector + FTS) followed by application-level RRF fusion:

```text
query
  -> embedding API -> dense vector
  -> parallel:
       db.vectorSearch(vector, topK=100)    // dense semantic search
       db.fullTextSearch(query, topK=100)   // exact term search
  -> bounded TypeScript RRF fusion(dense_results, fts_results)
  -> rerank API(fused_candidates, topK=20)
  -> evidence packing
```

This eliminates Qdrant, Vespa, OpenSearch, and Tantivy from the architecture entirely. One database handles all storage and search needs.

**Scaling considerations**:

- **Standalone (PostgreSQL)**: pgvector with HNSW index performs well up to ~5M vectors. Beyond that, consider adding IVFFlat index or upgrading to TiDB.
- **SaaS (TiDB Cloud)**: TiDB Cloud serverless auto-scales storage and compute. TiDB Vector supports large-scale vector search with distributed execution.

### External Service Connections

All external services are connected via standard protocols:

```text
Workers / Docker runtime
  ├── TiDB Cloud ← MySQL wire protocol (SaaS)
  ├── PostgreSQL ← pg wire protocol (Standalone)
  ├── Unstructured ← HTTP REST API (self-hosted)
  ├── Embedding APIs ← HTTPS (OpenAI / Voyage / Cohere)
  ├── Rerank APIs ← HTTPS (Cohere / Voyage)
  ├── LLM APIs ← HTTPS + SSE (Claude / OpenAI)
  └── Object Storage ← S3 API (R2 or MinIO)
```

### Deployment Shape

**SaaS mode (Cloudflare)**:

```text
wrangler deploy
```

Deploys Workers + Pages. TiDB Cloud and Unstructured are managed separately.

**Standalone mode (Docker)**:

```text
docker compose up
```

One Docker Compose file starts:

- Knowledge Platform (Node.js/Bun container)
- PostgreSQL (with pgvector extension)
- Unstructured
- MinIO (optional, can use local volume)
- Redis (optional, can use in-memory cache)

No separate search engine container needed. PostgreSQL handles everything.

### Deployment Tiers

| Tier | Shape | Suitable For |
|---|---|---|
| SaaS Edge | Cloudflare Workers + R2 + KV + Queues + Durable Objects + TiDB Cloud + Unstructured API | Global SaaS product, multi-tenant, edge-distributed. |
| Standard Self-Hosted | Docker Compose: Node.js app + PostgreSQL (pgvector) + Unstructured + MinIO | On-premise enterprise, data sovereignty, private deployment. |
| Scale-out Self-Hosted | Kubernetes: Node.js app (replicas) + PostgreSQL cluster or TiDB self-hosted + Unstructured workers + S3 | Large enterprise, high concurrency, huge corpora. |

### TypeScript Stack

| Concern | Candidate |
|---|---|
| HTTP framework | Hono (Workers + Node.js portable) |
| Human UI framework | Next.js / React for Admin Console. Keep core API logic in Hono; use Next.js BFF routes only as thin UI adapters. |
| Validation | Zod |
| ORM / query builder | Drizzle ORM (`drizzle-orm/pg-core` for Standalone, `drizzle-orm/mysql-core` for SaaS TiDB) |
| Object storage | `@aws-sdk/client-s3` (works with R2 and MinIO) |
| OpenAPI generation | `@hono/zod-openapi` or `hono-openapi` |
| Pure compute | `@knowledge/compute` TypeScript package with explicit resource bounds |
| MCP server | `@modelcontextprotocol/sdk` |
| Job queue (Standalone) | `pg-boss` |
| Cache (Standalone) | `ioredis` or `lru-cache` |
| Testing | Vitest |
| Monorepo | Turborepo or pnpm workspaces |
| Linting | Biome |

### What Should Not Be In Compute

Avoid putting IO-dependent or stateful logic in `packages/compute`:

- Database queries — use TypeScript Drizzle ORM.
- HTTP calls to external APIs — use TypeScript fetch.
- Cache reads/writes — use TypeScript adapter.
- File/object storage access — use TypeScript S3 client.
- Streaming responses — use TypeScript SSE.

The principle is:

```text
TypeScript owns orchestration, IO, and platform integration.
The bounded TypeScript compute package owns deterministic pure computation.
External APIs own model inference and document parsing.
Cloudflare (SaaS) or Docker (Standalone) owns the deployment runtime.
```

## 5. Data Model

The old `Dataset -> Document -> Segment` model is too narrow. The new model should distinguish raw assets, parsed artifacts, knowledge units, index projections, evidence, and traces.

### 5.1 Core Entities

| Entity | Purpose |
|---|---|
| `KnowledgeSpace` | Tenant-aware knowledge scope. Defines permissions, policies, strategy templates, and publication status. |
| `KnowledgeSpaceManifest` | Operational manifest for a space. Defines storage provider, object prefix, parser/index versions, retention, quota, consistency, manifest version, and publication defaults. |
| `Source` | Data source connector, such as file upload, website, Notion, Google Drive, database, API, or MCP resource. |
| `ResourceMount` | A mounted external or internal resource exposed through SourceFS/KnowledgeFS commands. Includes mount path, resource type, capabilities, mode, freshness policy, cache policy, and permission scope. |
| `DocumentAsset` | Immutable raw document or source snapshot. Includes hash, version, origin, permission snapshot, and storage pointer. |
| `ParseArtifact` | Structured parse output: pages, blocks, headings, tables, figures, captions, OCR, layout boxes. |
| `ArtifactSegment` | Bounded segment representation of parser output or large resources. Enables paginated `cat`, bounded `grep`, and compatibility for large artifacts without loading full JSON rows. |
| `DocumentOutline` | PageIndex-inspired structural tree for one parsed document. Includes outline nodes, section paths, title locations, page/offset ranges, summaries, source element ids, source node ids, and quality metadata. |
| `DocumentMultimodalManifest` | Document-level inventory of multimodal resources: tables, images, code blocks, pages, OCR/captions, bounding boxes, object-backed assets, variants, enrichment status, and visual embedding metadata. |
| `KnowledgeNode` | Atomic knowledge unit. Can be paragraph, section, table, image, code block, FAQ, claim, definition, entity, or relation. |
| `IndexProjection` | A searchable projection of knowledge nodes: dense, sparse, BM25, multi-vector, graph, summary tree, etc. |
| `ProjectionSetFingerprint` | Coherent published projection-set identity built from model, strategy, parser/chunker version, index version, source snapshot, and permission/version context. |
| `KnowledgePath` | A virtual path that exposes documents, nodes, entities, topics, time ranges, traces, and evidence as filesystem-like resources. |
| `EvidenceBundle` | Structured evidence returned by retrieval. Includes evidence items, scores, citations, conflicts, freshness, and missing evidence. |
| `AnswerTrace` | Full trace of query routing, recall, filtering, reranking, evidence packing, and generation. |
| `AgentWorkspaceSnapshot` | A reproducible snapshot of an agent research workspace: mounted sources, source versions, permission snapshot, active index projection, command log, traces, and evidence bundles. |
| `StagedCommit` | Recoverable write/publication ledger entry for object writes, ingestion, publication, cleanup, and retry diagnostics. |
| `FSSession` / `FSLease` | Runtime visibility and non-POSIX coordination model for MCP/API/worker sessions and long-running publish/delete/reindex operations. |

### 5.2 Index Projection Versioning

`IndexProjection` must be versioned because parser, chunking, embedding, reranker, tokenizer, and backend schema changes can all alter retrieval behavior.

Each index projection should store:

- `index_projection_id`
- `knowledge_space_id`
- `projection_type`
- `source_artifact_version`
- `knowledge_node_version`
- `chunking_strategy_id`
- `chunking_strategy_version`
- `embedding_model_id`
- `embedding_model_version`
- `embedding_dimension`
- `distance_metric`
- `tokenizer_version`
- `index_schema_version`
- `backend_type`
- `backend_capability_descriptor_version`
- `build_status`
- `published_status`
- `created_from_artifact_hash`
- `created_at`
- `published_at`

Embedding model upgrades should never overwrite the active index in place. They should produce a new projection:

```text
active index projection
  -> build candidate projection with new embedding model
  -> run evaluation
  -> shadow traffic if needed
  -> blue-green publish
  -> rollback if quality or latency regresses
```

This supports multi-model coexistence during migration and avoids risky full-index replacement.

### 5.3 Knowledge Node Types

`KnowledgeNode` should not be limited to text chunks.

Recommended node types:

- `section`
- `paragraph`
- `table`
- `table_row`
- `figure`
- `caption`
- `code_block`
- `faq`
- `definition`
- `claim`
- `policy_clause`
- `entity`
- `relation`
- `summary`

Each node should store:

- `node_id`
- `knowledge_space_id`
- `document_asset_id`
- `parse_artifact_id`
- `node_type`
- `text`
- `structured_payload`
- `metadata`
- `source_location`
- `permission_scope`
- `valid_from`
- `valid_to`
- `created_at`
- `artifact_hash`

### 5.4 Source Location

Citations must be stable and precise.

Source location should support:

- Document id
- Document version
- Page number
- Section heading path
- Character offset
- Bounding box
- Table cell coordinate
- Image region coordinate
- Original source URL
- Artifact hash

### 5.5 Document Outline and Multimodal Manifest

The platform stores document structure and multimodal inventory as first-class
document-level facts.

`DocumentOutline` is separate from `SummaryTree`:

- `DocumentOutline` is a stable, citeable structure fact produced from parser headings,
  native TOC data, deterministic fallback rules, and optional summary enhancement.
- `SummaryTree` is a retrieval projection that may change with model, prompt,
  clustering, and projection versions.

`DocumentMultimodalManifest` is separate from raw leaf nodes:

- the manifest is an inspectable inventory of tables, images, code, pages, assets,
  variants, enrichment states, provider metadata, and visual embedding status;
- leaf `KnowledgeNode`s remain the search and evidence units for dense, full-text,
  graph, and rerank paths;
- manifest item ids, parse element ids, source node ids, object keys, page numbers,
  offsets, and bounding boxes must remain linkable for citations and Admin trace
  views.

## 6. Ingestion and Knowledge Compilation

## 6.1 Ingestion Pipeline

The ingestion system should behave like a compiler:

```text
Source Sync
  -> File Type Detection
  -> Parser Routing
  -> Parse
  -> Normalize
  -> Structure Detection
  -> Document Outline Build
  -> Multimodal Manifest Build
  -> Visual Asset Extraction / Variant Generation
  -> Knowledge Node Generation
  -> Contextual Enrichment
  -> Entity/Relation Extraction
  -> Index Projection Build
  -> Evaluation Smoke Test
  -> Publish
```

The pipeline should be:

- Idempotent
- Versioned
- Retryable
- Cancellable
- Observable
- Incremental
- Rollbackable

## 6.2 Internal Job and Workflow Runtime

The workflow layer here is not a user-facing application workflow builder. It is an internal runtime for durable background processes such as document compilation, index publication, deep research, evaluation, and rollback.

Do not start by implementing a custom durable workflow engine. A full workflow engine includes persistent state machines, retry policy, compensation, timeout, cancellation, worker heartbeat, failover, workflow history, and versioning. Building that too early would become a project of its own.

The recommended starting point depends on deployment mode:

**SaaS mode (Cloudflare)**:

```text
Cloudflare Queues (message delivery)
  + Durable Objects (state machine persistence per job)
  + PostgreSQL (job history, trace, audit log)
```

Cloudflare Queues handle message delivery and retry. Durable Objects hold per-job state machines (current step, accumulated results, cost tracking). PostgreSQL stores job history and trace data for operator inspection.

**Standalone mode (Docker)**:

```text
pg-boss (PostgreSQL-backed job queue)
  + job type and payload
  + retry policy
  + timeout and cancellation
  + state transitions
  + error history
  + trace id
```

pg-boss provides durable job management directly on PostgreSQL, matching the operating model of `graphile-worker`.

Both modes implement the same `JobQueue` interface from the platform adapter layer, so application code is deployment-agnostic.

Why:

- Document processing can be long-running.
- External parsing, OCR, embedding, and indexing can fail independently.
- The system needs retry, compensation, cancellation, timeout, and workflow history.
- Operators need to inspect where a document is stuck.
- Agents may trigger long-running research tasks that should survive process restarts.

Early implementation should model workflows as explicit job state machines rather than a general-purpose workflow DSL.

Example job state machines:

```text
DocumentCompilationJob
  queued
  -> file_detected
  -> parsed
  -> outline_built
  -> multimodal_manifest_built
  -> artifacts_built
  -> nodes_generated
  -> index_projection_built
  -> smoke_eval_passed
  -> published

ResearchTaskJob
  queued
  -> planned
  -> candidates_retrieved
  -> sources_compared
  -> conflicts_checked
  -> citations_verified
  -> report_generated
```

Short tasks can use the same job queue:

- Notifications
- Cleanup
- Lightweight async updates
- Cache refreshes

The key rule is: use a durable job queue first, add Temporal only after scale or workflow complexity proves it is necessary.

## 6.3 Parser Router

The system should not use one parser for all files.

Parser routing should inspect:

- File type
- File size
- Whether the document is scanned
- Number of pages
- Layout complexity
- Table density
- Image density
- Language
- Whether OCR is required
- Whether high-precision mode is requested

### Recommended Parser Stack

| Parser | Role | Deployment |
|---|---|---|
| Unstructured (self-hosted API) | Default high-quality document conversion for PDF, DOCX, PPTX, scanned documents, and complex layouts. | Self-hosted Docker container, called via HTTP API from Workers or Node.js. |
| Native TypeScript Markdown parser | Lightweight in-process parser for Markdown, reStructuredText, and AsciiDoc. | Runs in Workers or Node.js directly. No external service needed. |
| Native TypeScript HTML parser | Lightweight in-process HTML-to-structured-content extractor for web-crawled pages, online docs, and Confluence/Notion HTML exports. | Runs in Workers or Node.js directly. |
| Native TypeScript structured data parser | Direct loader for CSV, JSON, JSONL, YAML, and XML. Converts rows/records to knowledge nodes without document AI overhead. | Runs in Workers or Node.js directly. |
| Commercial OCR/document AI API | Optional for high-precision enterprise scenarios. | External API call. |

The parser router should prefer the lightest parser that fits the format. Markdown, HTML, and structured data should be parsed in-process (TypeScript). Only complex document formats (PDF, DOCX, scanned images) should invoke the external Unstructured API.

Workers memory limit (128MB) does not apply to document parsing because parsing runs in the external Unstructured service. Workers only receive the parsed `ParseArtifact` JSON result (typically 1-5MB for a 50-page document), which is well within memory limits.

## 6.4 Parse Artifact Format

Parse output should not be stored only as plain text or Markdown.

Recommended artifact:

```json
{
  "document_id": "...",
  "version": "...",
  "pages": [],
  "blocks": [],
  "headings": [],
  "paragraphs": [],
  "tables": [],
  "figures": [],
  "captions": [],
  "footnotes": [],
  "code_blocks": [],
  "layout_boxes": [],
  "ocr_tokens": [],
  "artifact_hash": "..."
}
```

This enables:

- Precise citation
- Page highlighting
- Table question answering
- Agent-readable structure
- Debugging parser quality
- Re-indexing without reparsing
- Deterministic document outline construction
- Multimodal manifest construction and visual asset extraction

## 7. Chunking and Knowledge Node Generation

## 7.1 Recommended Strategy

Chunking should be layout-aware and semantic.

The default strategy:

```text
Document structure
  -> section-aware segmentation
  -> cross-page sentence repair
  -> semantic boundary detection
  -> boundary-safe overlap
  -> small-section merge
  -> table/code/image-specific node generation
  -> parent-child relation creation
  -> contextual enrichment
```

Chunking must preserve meaning at boundaries. The strategy should define:

| Concern | Policy |
|---|---|
| Min token size | Merge tiny sections with nearby siblings when they are below the model-specific minimum. |
| Max token size | Split long sections by semantic boundary while staying below the embedding model context limit. |
| Overlap | Use boundary-aware overlap for adjacent text chunks, but avoid duplicating complete tables/code blocks unless necessary. |
| Cross-page sentences | Repair page breaks before segmentation so PDF pagination does not split a sentence into unrelated chunks. |
| Heading inheritance | Each child chunk should inherit its heading path and document-level context. |
| Table binding | Keep table title, caption, headers, footnotes, and nearby explanatory text linked to the table node. |
| Figure binding | Keep image OCR, caption, nearby references, and page location linked to the figure node. |
| Code blocks | Do not split code blocks in the middle of functions/classes unless they exceed model limits. |
| Parent-child retrieval | Store parent section nodes and child leaf nodes so retrieval can recall precise leaves while generation can see parent context. |

Chunking parameters must be tied to the selected embedding model:

```text
chunk_max_tokens <= embedding_model.max_input_tokens
chunk_overlap_tokens depends on model context, document type, and node type
```

This prevents silent regressions when changing embedding models or tokenizers.

## 7.2 Contextual Retrieval

For each text node, the compiler can generate a short contextual description using surrounding document context.

Example:

```text
Original node:
"The refund period is 30 days."

Contextualized node:
"In the customer subscription cancellation policy, the refund period for annual plans is 30 days."
```

This reduces the common failure mode where a chunk loses meaning after being separated from its document.

Contextual enrichment is an LLM-dependent step and can be expensive at scale. The compiler should apply cost-aware policies:

| Policy | Rule |
|---|---|
| Skip condition | Skip enrichment for nodes that already carry sufficient context: FAQ pairs, titled sections with clear heading paths, structured records, and standalone tables with captions. |
| Model selection | Use the cheapest model that produces acceptable quality. A small instruction-tuned model is usually sufficient for one-sentence contextual descriptions. |
| Batch optimization | Batch multiple nodes from the same document into a single LLM call with the shared document outline as context, rather than making one call per node. |
| Budget limit | Define a per-document and per-knowledge-space enrichment budget. Stop enrichment when budget is exhausted and mark remaining nodes as `enrichment_skipped`. |
| Incremental update | When a document is updated, only re-enrich nodes whose text or surrounding context changed. Reuse cached enrichment for unchanged nodes. |
| Quality threshold | If an enrichment result is too short, too generic, or a near-duplicate of the original text, discard it and use the original node text. |

## 7.3 Hierarchical Summary Index

For long documents and large knowledge spaces, build a tree:

```text
leaf nodes -> cluster summaries -> section summaries -> document summaries -> corpus summaries
```

This supports:

- Long-document Q&A
- Cross-document synthesis
- Research mode
- Fast high-level routing

RAPTOR-style tree-organized retrieval is a useful reference for this design.

Summary trees are expensive to build and must support incremental maintenance:

- When a new document is added, insert its document summary into the existing corpus tree without rebuilding all cluster and corpus summaries.
- When a section is updated, rebuild only the affected branch: leaf node → section summary → document summary. Propagate upward only if the document summary changes materially.
- When a document is deleted, remove its leaf nodes and rebalance the affected cluster. Defer full corpus summary rebuild to a background job.
- Mark each summary node with `generated_at`, `source_version`, and `stale_after` so retrieval can detect when a summary may be outdated.
- Full tree rebuild should be a scheduled background job, not triggered on every document change.

## 7.4 Entity and Relation Extraction

The compiler should extract:

- People
- Organizations
- Products
- Metrics
- Dates
- Events
- Policies
- Terms
- Definitions
- Dependencies
- Ownership relationships

This enables graph expansion, conflict detection, and entity-specific retrieval.

Entity and relation extraction is model-dependent and can produce noisy results at scale. The compiler should apply quality and cost controls:

| Control | Policy |
|---|---|
| Model selection | Use a purpose-trained NER/RE model or a small LLM with structured output, not a large general-purpose model. |
| Confidence threshold | Store all extractions but only index high-confidence entities (above a configurable threshold). Low-confidence extractions should be stored with a `confidence` field but excluded from graph index and semantic views until reviewed or confirmed. |
| Deduplication | Deduplicate entities across documents by normalized name, alias matching, and optional entity linking to a canonical entity registry. |
| Incremental extraction | When a document is updated, re-extract only from changed sections. Merge new extractions with existing entity records rather than replacing the full entity set. |
| Budget limit | Define a per-document extraction budget. For very large documents, extract from headings, summaries, and first paragraphs first; extract from body text only within budget. |
| Extraction scope | Not every document type benefits equally from extraction. Technical documentation and contracts are high-value targets. Chat logs and raw logs are low-value. The parser router should tag extraction priority by document type. |

## 8. Index Serving Layer

## 8.1 Index Projection Types

Each `KnowledgeNode` can produce multiple projections:

| Projection | Purpose | Storage |
|---|---|---|
| Dense vector | Semantic similarity | TiDB Vector / pgvector |
| Visual asset vector | Image/table/page visual similarity using object-backed image bytes or text-surrogate fallback | TiDB Vector / pgvector with multimodal projection metadata |
| Full-text index | Exact terms, identifiers, rare words, policy numbers | TiDB FULLTEXT / PostgreSQL tsvector |
| Metadata index | Tenant, permission, source, freshness, type filters | Standard SQL indexes |
| Summary tree | Long-document and corpus-level synthesis | KnowledgeNode rows (type=summary) |
| Graph index | Entity/relation expansion and cross-document reasoning | Entity/relation tables + recursive CTE |

## 8.2 Search Engine Selection: Database-as-Search-Engine

This platform does not use a separate search engine. The database itself provides vector search, full-text search, and metadata filtering. This eliminates an entire infrastructure layer.

### SaaS: TiDB Cloud

TiDB Cloud is the SaaS search backend because it provides vector search, full-text search, and relational queries in a single managed service.

Strengths:

- TiDB Vector: dense vector search with `VECTOR` column type and distance functions.
- FULLTEXT index: BM25-equivalent full-text search with built-in CJK tokenizer.
- Serverless auto-scaling: compute and storage scale independently.
- MySQL-compatible: broad ecosystem, familiar SQL.
- Distributed architecture: handles large-scale data without manual sharding.
- Recursive CTEs (since TiDB 5.1+): supports graph traversal queries.

Trade-offs:

- TiDB Vector is newer than dedicated vector databases; advanced features (multi-vector, late interaction) are not yet available.
- Ranking expressiveness is SQL-based, not as flexible as Vespa's custom ranking pipelines.

### Standalone: PostgreSQL + pgvector + FTS

PostgreSQL is the Standalone search backend because one database handles all storage and search needs with zero additional infrastructure.

Strengths:

- pgvector: mature dense vector search with HNSW and IVFFlat indexes.
- tsvector + GIN: mature full-text search with ranking.
- Recursive CTEs: graph traversal.
- Single database: minimal operational burden.
- Easy backup, migration, and disaster recovery.

Trade-offs:

- pgvector performance degrades beyond ~5M vectors on a single node. For larger scale, consider upgrading to TiDB or adding read replicas.
- CJK full-text search requires additional extensions (pg_jieba, pg_bigm).

### Why Not a Separate Search Engine

| Concern | Answer |
|---|---|
| "pgvector / TiDB Vector is slower than Qdrant/Vespa" | For knowledge platforms (not web-scale search), database-native vector search is fast enough. The latency budget (300-800ms) has headroom. Reranking via API dominates latency, not vector recall. |
| "No sparse vectors / BM25-equivalent in vector DB" | Not needed. The database's native full-text search (tsvector / FULLTEXT) handles exact term matching directly. Two parallel queries (vector + FTS) + RRF fusion achieves hybrid retrieval. |
| "What about metadata filtering during vector search?" | Both pgvector and TiDB Vector support SQL WHERE clauses alongside vector search. No need for a separate metadata index. |
| "What about scale?" | TiDB Cloud auto-scales. PostgreSQL handles 1-5M vectors well. Beyond that, upgrade the Standalone tier to TiDB. |

## 8.3 Database Capability Descriptor

Although the platform uses a single database per deployment mode, the `DatabaseAdapter` should declare its capabilities so the retrieval planner can adapt its strategy:

```json
{
  "type": "tidb" | "postgresql",
  "supports_dense_vector": true,
  "max_vector_dimensions": 16384,
  "supports_fulltext": true,
  "fulltext_cjk_native": true,
  "supports_recursive_cte": true,
  "supports_concurrent_vector_and_fts": true,
  "estimated_vector_search_p99_ms": 30,
  "estimated_fts_p99_ms": 20,
  "max_vectors": 50000000,
  "consistency": "strong",
  "supports_blue_green_table_swap": true
}
```

The retrieval planner uses this descriptor to:

- Decide whether to run vector and FTS queries in parallel or sequentially.
- Estimate total retrieval latency for agent budget calculations.
- Decide whether permission filtering can be a SQL WHERE clause (always yes for database-as-search-engine).
- Decide whether blue-green index publication uses table swap or a separate projection table.

## 8.4 Graph Index Design

The graph index is referenced throughout this document but should be treated as a Phase 4 capability, not a Phase 1 requirement. This section defines its scope, storage, and constraints.

### Purpose

The graph index supports:

- Entity-centric retrieval: "What documents mention Acme Corp?"
- Relation traversal: "What contracts reference this vendor, and what are their renewal terms?"
- Cross-document reasoning: "Do any policies conflict on this topic?"
- Context expansion: given a retrieved node, expand to related entities and their source documents.

### Graph Schema

The graph should model:

- **Entity nodes**: people, organizations, products, policies, terms, events, metrics.
- **Document nodes**: each `DocumentAsset` and `KnowledgeNode` is a graph node.
- **Relation edges**: `mentions`, `defines`, `references`, `depends_on`, `owned_by`, `contradicts`, `supersedes`, `co_occurs_with`.
- **Edge properties**: `confidence`, `source_node_id`, `extraction_model_version`, `extracted_at`.

### Storage Selection

| Option | When to Use |
|---|---|
| PostgreSQL with recursive CTEs + JSONB adjacency | Default for Phase 4. No new infrastructure. Good enough for moderate entity counts (< 10M entities, < 50M edges). |
| Dedicated graph database (Neo4j, Apache AGE) | Only if graph traversal latency or query complexity exceeds PostgreSQL capabilities at scale. |
| In-memory graph cache | For hot entity subgraphs that are frequently traversed during retrieval. Populated from PostgreSQL on demand. |

Do not introduce a dedicated graph database in Phase 1-3. Start with PostgreSQL and migrate only when profiling shows it is the bottleneck.

### Traversal Budget

Graph expansion during retrieval must be cost-controlled:

- Default max traversal depth: 2 hops.
- Default max fan-out per hop: 20 edges.
- Default max total expanded nodes: 50.
- Traversal must respect the query latency budget. If the budget is tight, skip graph expansion entirely.
- Each traversal should record its cost (nodes visited, edges traversed, time spent) in the retrieval trace.

### Incremental Maintenance

- New entity extractions should be merged into the existing graph, not rebuild it.
- Deleted documents should remove their entity mentions and edges, then prune orphan entities with no remaining mentions.
- Entity deduplication and merging should run as a background job, not inline during retrieval.

## 9. Embedding and Reranking

## 9.1 Embedding Strategy

All embedding is API-based. The platform does not run local model inference.

Recommended default:

- OpenAI `text-embedding-3-large` or `text-embedding-3-small` for general use.
- Voyage `voyage-3` for code and multilingual retrieval.
- Cohere `embed-v4` for multilingual and multi-modal support.
- Jina AI embedding API as an additional multilingual option.

The platform should implement a unified embedding provider interface:

```text
interface EmbeddingProvider {
  embed(texts: string[], model: string) -> { dense: float[][], sparse?: SparseVector[] }
  models() -> ModelInfo[]
}
```

Providers that support sparse output (Cohere, Jina) can produce both dense and sparse vectors in one call, enabling hybrid retrieval without a separate sparse indexing step.

## 9.2 Embedding Provider Selection

| Provider | Dense | Sparse | Multilingual | Max Tokens | Notes |
|---|---|---|---|---|---|
| OpenAI | ✅ | ❌ | ✅ (100+ languages) | 8,191 | Most widely available. Sparse must be generated separately. |
| Voyage | ✅ | ❌ | ✅ | 32,000 | Strong for code retrieval. Long context. |
| Cohere | ✅ | ✅ | ✅ (100+ languages) | 512 | Supports dense + sparse in one call. Lower max tokens. |
| Jina AI | ✅ | ✅ | ✅ | 8,192 | Supports dense + sparse. Good for Chinese/English. |

For Chinese/English mixed enterprise knowledge, Cohere or Jina with dense + sparse output is a strong default because it enables hybrid retrieval with a single API call.

## 9.3 Embedding Version and Resource Management

Embedding models are part of the index schema. Changing the model can change:

- Vector dimension.
- Distance metric.
- Tokenizer behavior.
- Multilingual quality.
- Sparse representation.
- Multi-vector representation.
- GPU memory requirements.
- Index storage size.

Therefore, embedding configuration should be versioned and tied to `IndexProjection`.

Recommended model registry fields:

- `embedding_model_id`
- `embedding_model_version`
- `provider`
- `dimension`
- `distance_metric`
- `max_input_tokens`
- `tokenizer_version`
- `supports_dense`
- `supports_sparse`
- `supports_multi_vector`
- `recommended_batch_size`
- `gpu_memory_profile`
- `quantization_profile`

Upgrade flow:

```text
register new embedding model version
-> build candidate index projection
-> run golden-set evaluation
-> compare latency, cost, recall, citation coverage
-> optionally shadow production traffic
-> blue-green publish
-> keep old projection for rollback
```

Self-hosted embedding should be treated as a capacity-managed service. The design must track:

- GPU type.
- batch size.
- tokens per second.
- queue depth.
- cache hit rate.
- quantization mode.
- fallback provider.

## 9.4 Reranking

Default retrieval should use:

```text
recall 50-200 candidates
-> cross-encoder rerank
-> select 5-20 evidence items
```

Reranking is API-based, matching the embedding strategy.

Reranker choices:

- Cohere Rerank API (default recommendation)
- Voyage Rerank API
- Jina Reranker API
- Other commercial rerank providers

The platform implements a unified reranker provider interface:

```text
interface RerankProvider {
  rerank(query: string, documents: string[], model: string, top_n: number) -> RankedResult[]
}
```

## 10. Retrieval Runtime

## 10.1 Latency-Budget Driven Retrieval

The system should not run query decomposition, graph search, and multi-step reasoning on every query.

Default fast path:

```text
query
  -> normalize
  -> lightweight route
  -> hybrid recall
  -> permission filter
  -> rerank
  -> evidence packing
  -> answer
```

## 10.2 Retrieval Modes

| Mode | Use Case | Runtime Behavior |
|---|---|---|
| Fast Retrieval | 80% of daily Q&A | Hybrid recall + rerank + evidence packing |
| Deep Retrieval | Complex questions | Query decomposition, multi-route retrieval, graph expansion, summary tree |
| Research Mode | Reports, legal, investment, compliance, high-risk work | Multi-step retrieval, conflict detection, source comparison, long-running workflow |

## 10.3 Routing

The first router must be cheap.

Use:

- Rules
- Query features
- Small classifier
- Embedding-based routing
- Historical query cache

Avoid:

- Calling a large model for every query
- Agentic planning on every query
- Graph traversal on every query

## 10.4 Progressive Retrieval UX

For humans, the UX should support progressive enhancement:

```text
1. Fast answer starts quickly.
2. Background deep retrieval continues if useful.
3. UI updates with better citations or conflict notes.
4. User can explicitly request deep research.
```

For agents, the same concept becomes:

```text
knowledge.search(mode="fast")
knowledge.create_research_task(...)
knowledge.get_task_status(...)
knowledge.fetch_evidence(...)
```

### 10.4.1 Session Context

Retrieval should support optional session context. Real users and agents often ask follow-up questions:

- "What about the monthly plan?"
- "Compare that document with the previous one."
- "Use the evidence we already found."

The request should allow:

```json
{
  "query": "What about the monthly plan?",
  "session_context": {
    "session_id": "sess_123",
    "previous_queries": [],
    "active_document_ids": [],
    "active_entity_ids": [],
    "accumulated_evidence_ids": [],
    "last_trace_id": "trace_123"
  }
}
```

Session context should be used for:

- Query rewrite.
- Coreference resolution.
- Active document/entity carry-over.
- Progressive evidence accumulation.
- Avoiding duplicate retrieval work.

It should not be blindly appended to every model prompt. The runtime should first normalize the query and decide which session fields are relevant. Session context must also respect permission changes and index version changes.

Session lifecycle:

| Concern | Policy |
|---|---|
| Storage | PostgreSQL for durable sessions; optional Redis for hot session cache with write-through. |
| TTL | Default session expiry: 30 minutes of inactivity. Configurable per tenant. |
| Max history | `previous_queries`: last 20 queries. `accumulated_evidence_ids`: last 200 evidence ids. Older entries are evicted FIFO. |
| Permission consistency | On each request, check whether the subject's permission snapshot has changed since the session was created. If it has, invalidate `accumulated_evidence_ids` that reference documents the subject can no longer access. |
| Index version consistency | If the active index projection has changed (blue-green publish), mark cached evidence from the old projection as stale. The runtime may re-retrieve if the query depends on stale evidence. |
| Cleanup | Expired sessions are deleted by a background cleanup job. Session data must not contain raw document content, only ids and metadata. |

## 10.5 KnowledgeFS Virtual File System

The platform should expose a **virtual filesystem** over the knowledge corpus. This does not mean the underlying storage must be POSIX. The underlying system uses object storage and a unified database (TiDB Cloud or PostgreSQL). The filesystem is an interface and an indexing view.

The goal is to make the knowledge base:

- Traversable by humans.
- Debuggable by operators.
- Composable by agents.
- Efficient for exact search.
- Compatible with shell-like workflows such as `ls`, `cat`, `grep`, `find`, `stat`, `tree`, and `diff`.

### 10.5.1 Why KnowledgeFS

Traditional RAG exposes one main operation:

```text
search(query) -> topK chunks -> answer
```

That is too opaque for both humans and agents.

Agents often work better like a careful researcher:

```text
ls -> tree -> grep -> cat -> compare -> cite
```

A virtual filesystem gives agents low-cost ways to inspect structure before calling expensive semantic retrieval or large models.

### 10.5.1.1 Agent Workspace, SourceFS, and EvidenceFS

Mirage-style virtual filesystem projects are useful because they show that agents benefit from a single tree where heterogeneous resources can be inspected with familiar commands. This platform should absorb that idea without becoming a generic VFS product.

KnowledgeFS should be presented as an **agent workspace surface** with three logical layers:

```text
SourceFS
  /sources
    /uploads
    /s3
    /r2
    /drive
    /notion
    /github
    /slack
    /postgres

KnowledgeFS
  /knowledge
    /spaces
    /docs
    /nodes
    /entities
    /topics
    /summaries

EvidenceFS
  /evidence
    /queries
    /traces
    /bundles
    /conflicts
    /missing
    /reports

Workspaces
  /workspaces
    /run_123
      snapshot.json
      commands.log
      evidence/
      report.md
```

The distinction matters:

- **SourceFS** exposes mounted raw data sources before or during compilation.
- **KnowledgeFS** exposes compiled knowledge artifacts such as nodes, summaries, entities, and semantic views.
- **EvidenceFS** exposes retrieval outputs, traces, conflict reports, missing evidence, and final research reports.
- **Workspaces** expose a reproducible view of an agent's research run.

The product should not force every agent workflow through semantic retrieval. Agents should be able to inspect mounted sources, compiled knowledge, and evidence traces using the same command vocabulary.

### 10.5.2 PageIndex Inspiration

PageIndex is useful as a design reference because it treats documents as navigable trees rather than flat chunk lists. Its approach suggests several important ideas:

- A document should expose a table-of-contents-like tree.
- Retrieval can navigate structure before opening leaf content.
- A large corpus can be organized through file-system-like tree layers.
- Virtual nodes can group documents by topic, entity, time, or query-specific needs.
- Not every retrieval problem requires vector search.

This platform should not copy PageIndex as a purely vectorless system. Instead, it should absorb the structural navigation idea into a broader hybrid retrieval platform:

```text
KnowledgeFS tree navigation
  + exact grep/BM25
  + dense vector search
  + sparse retrieval
  + multi-vector / late interaction
  + graph expansion
  + reranking
  + evidence verification
```

Current concrete contract:

```text
DocumentOutline
  id
  knowledgeSpaceId
  documentAssetId
  parseArtifactId
  artifactHash
  version
  outlineVersion
  nodes[]
  metadata
  createdAt
  updatedAt?

DocumentOutlineNode
  id
  title
  level
  sectionPath[]
  startPage?
  endPage?
  startOffset?
  endOffset?
  titleLocation?
  tocSource
  summary?
  sourceElementIds[]
  sourceNodeIds[]
  childNodeIds[]
  children[]
  metadata
```

`DocumentOutline` is built during document compilation and exposed through:

- `GET /knowledge-spaces/{id}/documents/{documentId}/outline`
- `/knowledge/docs/{document}/outline.json`
- `/knowledge/docs/{document}/sections/...`
- `knowledge.get_document_outline`

Research mode should inspect the outline before opening long-document content. The
trace must record inspected outline nodes, selected nodes, opened page/section ranges,
fallback hybrid candidates, final evidence ids, and deterministic reasoning. This is
the platform's PageIndex-inspired reasoning tree search path.

### 10.5.3 Virtual Path Model

The same document should be reachable through multiple virtual views.

Example:

```text
/knowledge
  /spaces
    /legal
    /customer-support
    /finance
  /by-source
  /by-type
  /by-entity
  /by-topic
  /by-time
  /by-owner
  /by-permission
  /queries
  /traces
  /evidence
```

One contract can appear in several paths:

```text
/knowledge/spaces/legal/docs/vendor-contract-2024.pdf
/knowledge/by-type/contract/vendor-contract-2024.pdf
/knowledge/by-entity/vendor/acme-corp/vendor-contract-2024.pdf
/knowledge/by-time/2024/contracts/vendor-contract-2024.pdf
/knowledge/by-topic/renewal-risk/vendor-contract-2024.pdf
```

These paths are not necessarily physical directories. They are generated from metadata, extracted entities, topics, permissions, document structure, and index projections.

### 10.5.3.1 Resource Mount Model

External and internal resources should be mounted through a `ResourceMount` abstraction rather than hardcoded as one-off connectors.

Recommended fields:

- `mount_id`
- `tenant_id`
- `knowledge_space_id`
- `mount_path`
- `resource_type`
- `provider`
- `mode`: `read`, `write`, `exec`
- `capabilities`: `ls`, `tree`, `cat`, `grep`, `find`, `stat`, `diff`, `sync`, `watch`
- `source_pointer`
- `permission_scope`
- `permission_snapshot_version`
- `freshness_policy`
- `cache_policy`
- `created_at`
- `last_synced_at`

Example mounts:

```text
/sources/uploads
/sources/s3/acme-legal
/sources/drive/legal-team
/sources/github/product-docs
/sources/slack/customer-support
/sources/postgres/analytics
```

`Source` remains the business concept for a data source. `ResourceMount` is the operational interface that makes the source browsable, searchable, cacheable, and permission-aware.

### 10.5.4 Physical and Semantic Views

KnowledgeFS views should be split into two classes.

| View Type | Examples | Freshness Model |
|---|---|---|
| Physical views | `/by-source`, `/by-time`, `/by-owner`, `/by-type` | Derived from source metadata and should be near-real-time. |
| Semantic views | `/by-topic`, `/by-entity`, `/by-risk`, `/by-claim` | Derived from NLP/model extraction and may update asynchronously. Must expose freshness. |

Semantic views should include:

- `freshness`
- `generated_from_artifact_version`
- `generated_at`
- `stale_after`
- `build_status`

This prevents users and agents from assuming a semantic directory is fully current immediately after document upload.

### 10.5.5 Resource Layout

Each document can expose a structured virtual directory:

```text
/knowledge/docs/doc_123
  /raw
    original.pdf
  /versions
    v1.md
    v2.md
  /outline.json
  /outline.md
  /multimodal.json
  /pages
    001.md
    002.md
    001-thumbnail.json
  /sections
    refund-policy.md
    cancellation.md
  /tables
    table_001.json
    table_001.html
    table_001-asset.json
  /figures
    figure_001.md
    figure_001.json
  /assets
    item_001.json
    item_002.json
  /nodes
    node_abc.md
    node_def.md
  /metadata.json
  /permissions.json
  /health.json
```

Agents can inspect only what they need. Human UI can render the same resources as document preview, citation viewer, or diagnostics.

Multimodal document resources follow the same rule: the manifest is the inventory,
descriptor JSON files expose object-backed asset metadata, and binary reads stay behind
tenant-scoped API routes. A figure/table/page item should preserve:

- manifest item id;
- parse element id;
- source `KnowledgeNode` id when available;
- page, section path, text offsets, and bounding box;
- caption, OCR text, table HTML/structure, or code preview;
- original asset route and optional thumbnail variant route;
- provider/model/prompt/status metadata for enrichment;
- visual embedding projection status.

### 10.5.6 Command Semantics

| Command | KnowledgeFS Meaning |
|---|---|
| `ls` | List spaces, virtual directories, documents, sections, nodes, traces, or evidence bundles. |
| `tree` | Show document outline, corpus hierarchy, or query-dependent virtual tree. |
| `cat` | Read normalized Markdown, page text, section text, table JSON/HTML, OCR text, or metadata. |
| `grep` | Exact keyword search through text, headings, tables, OCR, code blocks, and metadata. |
| `find` | Metadata search by type, owner, time, source, permission, language, freshness, or tag. |
| `stat` | Return version, hash, parser, index status, source, permissions, and freshness. |
| `diff` | Compare document versions or parse artifacts (Phase 2: text-level line diff; Phase 4: semantic diff with change summary). |
| `head` / `tail` | Preview large resources cheaply. |
| `open_node` | Fetch one citation-ready knowledge node with source location. |

These commands should be first-class MCP tools and OpenAPI operations. A POSIX FUSE adapter can be added later, but the product should not depend on FUSE as the core implementation.

### 10.5.6.1 Command Registry

KnowledgeFS should implement commands through an internal `CommandRegistry`, not scattered route-specific handlers.

Each command definition should include:

- Command name and schema.
- Supported resource types.
- Default handler.
- Resource-specific overrides.
- Node-type-specific overrides.
- Permission check.
- Cost estimator.
- Trace hook.
- Cache policy.
- Degradation behavior.

Examples:

| Command | Override |
|---|---|
| `cat` on table node | Return table as JSON or HTML with source cell coordinates. |
| `cat` on figure node | Return OCR text, caption, image region metadata, and source location. |
| `grep` on KnowledgeFS | Use database-native FTS plus permission filtering. |
| `grep` on SourceFS mount | Use source-specific search when available, otherwise scoped cached text. |
| `diff` on document versions | Use bounded TypeScript text diff, then optional semantic diff in deep mode. |
| `stat` on semantic view | Return freshness, source artifact version, generated_at, and build_status. |

This keeps MCP, OpenAPI, and any future WebDAV/FUSE adapters backed by the same command semantics.

### 10.5.6.2 Safe Agent Shell

Agents often compose filesystem operations more naturally as short shell-like pipelines. The platform may expose a safe shell endpoint, but it must not execute host shell commands.

Allowed model:

```text
knowledge.shell.plan(command, scope, budget)
knowledge.shell.execute(command, scope, budget)
```

The shell is a parser and command dispatcher over `CommandRegistry`. It should support only an allowlisted subset:

```text
ls, tree, cat, grep, find, stat, diff, head, tail, wc, jq
```

Safety rules:

- No arbitrary process execution.
- No host filesystem access.
- No network access except through registered resource mounts.
- Every path resolves through SourceFS/KnowledgeFS/EvidenceFS.
- Every command is permission-filtered and trace-recorded.
- Pipelines have latency, scan, result, and cost budgets.
- Large outputs are paginated or truncated with explicit signals.

The structured MCP tools remain canonical. The safe shell is an ergonomic composition layer for agents and expert users.

### 10.5.7 Exact Search as a First-Class Capability

Many enterprise questions are better served by exact search than vector search:

- Contract numbers
- Error codes
- API names
- Function names
- Policy clause numbers
- Legal phrases
- Product SKUs
- Dates and amounts
- Person and company names

KnowledgeFS should make `grep` cheap, deterministic, permission-aware, and traceable.

Exact search uses the database's native full-text search capabilities:

- **SaaS (TiDB Cloud)**: `FULLTEXT` index with `MATCH() AGAINST()`. Built-in CJK tokenizer handles Chinese/English mixed content natively.
- **Standalone (PostgreSQL)**: `tsvector` with GIN index and `ts_rank()`. CJK support via `pg_jieba` or `pg_bigm` extensions.
- **N-gram indexes**: For partial matching and substring search on identifiers, error codes, and SKUs.

At scale, `grep` and `find` must have explicit scope and result limits:

| Constraint | Default | Configurable |
|---|---|---|
| Default search scope | Current virtual directory (not entire knowledge space) | Yes, via `scope` parameter. |
| Max scan documents | 10,000 documents per query | Yes, per tenant/agent policy. |
| Max results returned | 100 matches per query | Yes, via `limit` parameter. |
| Timeout | 5 seconds | Yes, via `timeout_ms` parameter. |
| Truncation signal | When results are truncated, return `truncated: true` and `total_estimate` in the response. | — |
| Required scope for space-wide grep | Agent must explicitly pass `scope: "space"` to grep across the entire knowledge space. Default scope is the current path. | — |

This prevents runaway scans when agents issue broad queries against large corpora.

This exact search layer uses:

- TiDB FULLTEXT index (SaaS) or PostgreSQL tsvector (Standalone) as the primary full-text search backend
- N-gram indexes for CJK and partial matching
- SQL WHERE clauses for metadata-constrained exact search

### 10.5.8 Query-Dependent Virtual Trees

For deep or research mode, the system can generate a temporary query-specific tree:

```text
/queries/trace_123
  /candidate-sources
  /entities
  /topics
  /evidence
  /conflicts
  /missing
```

This gives both humans and agents a readable view of the retrieval process.

Example:

```text
/queries/trace_123/evidence
  01-contract-section-8-2.md
  02-renewal-policy.md
  03-pricing-faq.md
```

### 10.5.8.1 Workspace Snapshot and Replay

Agent research should be reproducible at the workspace level, not only at the answer level.

An `AgentWorkspaceSnapshot` should capture:

- Mounted sources and mount versions.
- Active knowledge space.
- Active index projection.
- Permission snapshot.
- Query trace ids.
- Evidence bundle ids.
- Research task id.
- Command log.
- Cache manifest.
- Generated report pointers.

Example:

```json
{
  "workspace_id": "run_123",
  "knowledge_space_id": "ks_legal",
  "active_index_projection_id": "idx_v9",
  "permission_snapshot_version": "perm_2026_05_07_001",
  "mounts": ["/sources/drive/legal-team", "/knowledge/spaces/legal"],
  "commands_log_object": "s3://traces/run_123/commands.log",
  "trace_ids": ["trace_1", "trace_2"],
  "evidence_bundle_ids": ["ev_1", "ev_2"],
  "created_at": "2026-05-07T10:00:00Z"
}
```

This enables:

- Replaying an agent research run.
- Auditing which sources and index versions were visible.
- Debugging failed research.
- Sharing a stable workspace with another agent or human reviewer.
- Re-running the same task after index or permission changes to compare behavior.

### 10.5.9 KnowledgeFS and Retrieval Runtime

KnowledgeFS is not a replacement for hybrid retrieval. It is a structural and operational layer that retrieval can use.

Recommended retrieval composition:

```text
Fast path:
  grep/BM25 + metadata + dense vector + rerank

Structure path:
  KnowledgeFS tree navigation + outline search + open_node

Deep path:
  query-dependent virtual tree + graph expansion + summary tree + evidence verification
```

The runtime can choose the cheapest reliable path based on latency budget and query type.

Current mode expectations:

| Mode | Structural Use | Multimodal Use | Leaf Evidence Use |
|---|---|---|---|
| `fast` | Attach outline metadata to cited leaves when cheaply available. | Search textualized OCR/caption/table summaries through dense + full-text projections. | Dense + FTS + metadata filters over raw paragraph/table/image/code nodes. |
| `deep` | Use outline metadata and summary/tree paths to broaden or constrain recall. | Add table/image/OCR retrieval paths, visual projection candidates, and multimodal candidate metrics. | Larger hybrid fanout, graph expansion, rerank, evidence verification. |
| `research` | Inspect `DocumentOutline` first, run deterministic outline-guided reasoning tree search, and open selected page/section ranges. | Inspect `DocumentMultimodalManifest` before opening figures, tables, page thumbnails, or visual assets. | Complete the selected structural ranges with hybrid retrieval, graph search, reranking, and cited evidence packing. |

### 10.5.10 Consistency and Performance

KnowledgeFS must be designed for large corpora and high-concurrency agent access.

Key policies:

- Directory listing must be paginated.
- Large directories should support lazy loading and continuation tokens.
- Virtual path resolution should be cached.
- Semantic view materialization should run asynchronously.
- Permission filtering should use precomputed permission snapshots or ACL bitmaps where possible.
- `ls` should expose `stale` or `freshness` metadata for semantic views.
- Directory fanout should have limits and grouping rules.
- Path aliases should resolve to stable ids so links do not break after display-name changes.

Permission filtering is part of the path semantics:

```text
same path + different subject = different visible entries
```

Therefore, cache keys for KnowledgeFS must include subject scope or a permission snapshot version.

### 10.5.11 Implementation Strategy

Do not start with a real mounted filesystem.

Recommended order:

1. Implement KnowledgeFS resource model.
2. Implement MCP tools and OpenAPI endpoints for `ls`, `cat`, `grep`, `find`, `stat`, `tree`, and `diff`.
3. Back commands with metadata DB, object store, and search indexes.
4. Add UI views for tree browsing and query trace filesystem.
5. Add optional WebDAV or FUSE adapter for power users and local debugging.

This keeps the architecture portable and avoids early coupling to OS-specific filesystem behavior.

## 10.6 Caching Architecture

Caching is required to meet the default retrieval latency target. The cache design must be permission-aware and version-aware.

Recommended caches:

| Cache | Purpose |
|---|---|
| Query normalization cache | Reuse normalized query and routing result for repeated or near-identical queries. |
| EvidenceBundle cache | Return previously computed evidence when query, permissions, strategy, and index versions match. |
| Embedding cache | Avoid repeated embedding calls for identical text and model version. |
| Rerank cache | Avoid reranking the same candidate set with the same reranker version. |
| Listing cache | Cache SourceFS/KnowledgeFS/EvidenceFS path resolution, `ls`, `find`, and `stat` metadata. |
| Content cache | Cache hot `cat`, `open_node`, page, table, figure, and artifact payloads. |
| KnowledgeFS path cache | Cache virtual path resolution and paginated directory listings. Kept as the compatibility term for listing cache. |
| Permission-filtered listing cache | Cache `ls` results under a subject permission snapshot. |
| Artifact cache | Cache hot parse artifacts, outlines, pages, and node payloads. |

Cache keys must include:

- `knowledge_space_id`
- `mount_id` when the request targets SourceFS or a mounted resource
- `subject_scope` or `permission_snapshot_version`
- `query_normalization_version`
- `retrieval_strategy_version`
- `index_projection_id`
- `embedding_model_version`
- `reranker_version`
- `document_artifact_version`

Invalidation rules:

- New document version invalidates artifact, KnowledgeFS, and affected evidence caches.
- New index projection invalidates retrieval caches tied to the old projection only after publish.
- Permission changes invalidate subject-scoped listing and evidence caches.
- Embedding/reranker upgrades create new cache namespaces rather than mutating old entries.

Core cache metrics:

- Query cache hit rate.
- EvidenceBundle cache hit rate.
- Embedding cache hit rate.
- Rerank cache hit rate.
- KnowledgeFS path cache hit rate.
- Cache freshness violation count.
- Permission-cache invalidation count.

## 11. Evidence Bundle

The core output of retrieval should be `EvidenceBundle`, not plain text.

Example:

```json
{
  "query": "What is the refund period for annual subscriptions?",
  "answerability": "answerable",
  "confidence": "high",
  "evidence": [
    {
      "source_id": "src_123",
      "document_id": "doc_456",
      "document_version": "v7",
      "node_id": "node_789",
      "node_type": "policy_clause",
      "quote": "Annual subscriptions may be refunded within 30 days of purchase.",
      "page": 12,
      "section": "Refund Policy > Annual Plans",
      "score": 0.91,
      "freshness": "2026-05-01",
      "artifact_hash": "sha256:..."
    }
  ],
  "conflicts": [],
  "missing_evidence": [],
  "suggested_next_actions": []
}
```

## 12. Generation Layer

Generation should be evidence-driven. The generation layer sits between the retrieval runtime and the user/agent response. It is responsible for transforming structured evidence into cited, faithful answers.

### 12.1 Generation Pipeline

```text
EvidenceBundle
  -> evidence sufficiency check
  -> context window packing
  -> claim planning
  -> cited answer generation (streaming)
  -> post-processing: citation normalization, claim-evidence alignment verification
  -> answer delivery
```

### 12.2 LLM Routing

Different retrieval modes should use different generation strategies:

| Mode | LLM Strategy |
|---|---|
| Fast Retrieval | Small, fast model (e.g., Claude Haiku, GPT-4o-mini, or equivalent). Optimized for low TTFT and cost. |
| Deep Retrieval | Mid-tier model with longer context. More careful claim planning. |
| Research Mode | Large, high-quality model (e.g., Claude Sonnet/Opus, GPT-4o). Multi-step generation with intermediate verification. |
| Simple factoid questions | Consider skipping generation entirely and returning the top evidence quote directly. |

LLM selection should be provider-based, matching the embedding/reranker provider abstraction:

- Model id + version.
- Max context window.
- Cost per input/output token.
- Streaming support.
- Structured output support.
- Fallback model if primary is unavailable.

### 12.3 Context Window Packing

When the EvidenceBundle contains more content than the model context window can hold, the generation layer must decide what to include:

- Prioritize higher-scored evidence items.
- Include parent section context for leaf nodes that lack standalone meaning.
- Include conflicting evidence if conflicts exist.
- Reserve a fixed portion of the context window for the system prompt and claim planning instructions.
- Track context utilization rate as a metric.

Recommended budget split:

```text
System prompt + instructions: 10-15%
Evidence items: 70-80%
Generation output headroom: 10-15%
```

### 12.4 Streaming

Generation should stream tokens to the client as they are produced:

- Human UI: stream answer tokens with SSE. Append citation metadata after generation completes.
- Agent API: stream structured chunks via SSE or return the complete response. Agent callers should be able to choose.
- TTFT (time to first token) target: < 500ms after evidence packing completes.

### 12.5 Cost Allocation

The `max_cost` field in the search request covers the entire pipeline. The generation layer must respect its share of the budget:

```text
Total budget = retrieval budget + generation budget
Retrieval budget: embedding + search + rerank
Generation budget: LLM input tokens + output tokens
```

If the remaining budget after retrieval is insufficient for the selected model, the generation layer should:

1. Downgrade to a cheaper model.
2. Reduce evidence items to fit a shorter context.
3. If still insufficient, return the EvidenceBundle without generation and set `generation_skipped: true` with reason `budget_exhausted`.

The response should break down cost:

```json
{
  "cost": {
    "currency": "USD",
    "total": 0.004,
    "retrieval": 0.001,
    "generation": 0.003
  }
}
```

### 12.6 Generation Cache

If the same EvidenceBundle (same evidence ids, same versions, same order) is used with the same prompt template and model version, the generation result can be cached:

- Cache key: `hash(evidence_ids + evidence_versions + prompt_template_version + model_version + generation_parameters)`.
- Cache TTL: same as EvidenceBundle cache TTL.
- Cache should not be used when the query includes session context that modifies the prompt.

### 12.7 Post-Processing

After generation, apply:

- **Citation format normalization**: ensure every `[1]`, `[2]` reference maps to an evidence item in the bundle. Remove orphan citations. Flag uncited claims.
- **Claim-evidence alignment check**: lightweight verification that generated claims are supported by the cited evidence. This can be a rule-based check (quote overlap, entity match) for fast mode, or a small model judge for deep/research mode.
- **Hallucination flag**: if a generated claim references a fact not present in any evidence item, flag it in the response metadata as `ungrounded_claim`.
- **Freshness warning injection**: if any cited evidence is older than the knowledge space freshness threshold, append a freshness warning.
- **Permission redaction check**: verify that the generated answer does not leak content from evidence items that were filtered by permissions.

### 12.8 Generation Rules

- Every important claim should map to evidence.
- If evidence is insufficient, say so.
- If sources conflict, surface the conflict.
- If sources are outdated, show freshness warnings.
- If permissions hide evidence, do not reveal hidden content.
- If generation is skipped due to budget or model unavailability, return the EvidenceBundle directly.

## 13. Agent-Facing Platform

## 13.1 Agent Entry Points

| Entry Point | Purpose |
|---|---|
| MCP Server | Tool and resource access for agents. |
| OpenAPI 3.1 | Stable HTTP API for traditional applications and SDKs. |
| SSE/Webhook/Async Jobs | Long-running task progress and completion notifications. |
| Experimental A2A Adapter | Phase 5 experiment for agent-to-agent collaboration; keep isolated from core contracts. |

MCP and OpenAPI should be the Phase 1-3 priorities. A2A is promising but still early and should remain an adapter layer until its ecosystem and compatibility story are more stable.

## 13.2 MCP Tools

Do not expose only one `search(query)` tool. Agents need composable primitives.

Recommended tools:

```text
knowledge.fs.ls
knowledge.fs.tree
knowledge.fs.cat
knowledge.fs.grep
knowledge.fs.find
knowledge.fs.stat
knowledge.fs.diff
knowledge.fs.open_node
knowledge.source.mount
knowledge.source.ls
knowledge.source.cat
knowledge.source.grep
knowledge.shell.plan
knowledge.shell.execute
knowledge.search
knowledge.fetch_evidence
knowledge.get_document_outline
knowledge.get_node
knowledge.get_source_location
knowledge.compare_sources
knowledge.find_conflicts
knowledge.check_freshness
knowledge.plan_research_task
knowledge.create_research_task
knowledge.get_task_status
knowledge.cancel_task
knowledge.create_workspace_snapshot
knowledge.get_workspace_snapshot
knowledge.replay_workspace
knowledge.subscribe_index_status
knowledge.submit_feedback
knowledge.create_eval_case
```

The `knowledge.fs.*` and `knowledge.source.*` tools should be deterministic and cheap. They are the agent equivalent of shell inspection commands. Expensive semantic retrieval and long-running research should remain separate tools.

The `knowledge.shell.*` tools are optional ergonomic wrappers over the same command registry. They must never execute arbitrary host shell commands.

## 13.3 Agent Result Contracts

Agent APIs should return structured data:

```json
{
  "answer": "...",
  "confidence": "high",
  "evidence": [],
  "conflicts": [],
  "missing_evidence": [],
  "tool_trace_id": "...",
  "suggested_next_actions": [
    {
      "tool": "knowledge.create_research_task",
      "reason": "The query requires cross-document verification."
    }
  ]
}
```

## 13.4 Agent-Readable Resources

Agents should be able to fetch:

- Source mount listing
- Source mount metadata
- Document outline
- Table as JSON
- Table as HTML
- Figure caption
- OCR text
- Claim list
- Entity list
- Relation list
- Section summary
- Source provenance
- Virtual directory listing
- Query trace filesystem
- Evidence bundle filesystem
- Workspace snapshot
- Command log

This prevents agents from repeatedly parsing long chunks themselves.

## 13.5 Research Task Lifecycle

Research tasks are long-running, multi-step knowledge workflows triggered by agents or advanced users. They require a dedicated lifecycle design.

### State Machine

```text
queued
  -> planning        (understanding the question, decomposing sub-queries)
  -> retrieving      (executing retrieval steps, accumulating evidence)
  -> analyzing       (comparing sources, detecting conflicts, verifying citations)
  -> generating      (producing the research report)
  -> completed       (final report and evidence bundle available)

At any point:
  -> cancelled       (by user/agent or by budget exhaustion)
  -> failed          (unrecoverable error)
  -> expired         (TTL reached before completion)
```

### Partial Results

Research tasks should expose partial results as they progress:

- After `retrieving`: the accumulated evidence so far is available via `knowledge.fetch_evidence(task_id=...)`.
- After `analyzing`: conflict and freshness reports are available.
- If the task is cancelled or expires, all partial results collected up to that point are preserved and returned.

### Defaults and Limits

| Parameter | Default | Configurable |
|---|---|---|
| Task timeout | 10 minutes | Yes, per request. Max: 60 minutes. |
| Result TTL | 24 hours after completion | Yes, per tenant policy. |
| Max concurrent tasks per agent | 5 | Yes, per agent policy. |
| Max concurrent tasks per tenant | 50 | Yes, per tenant policy. |
| Max retrieval steps | 20 | Yes, per request. |
| Max documents scanned | 1,000 | Yes, per request. |
| Max tool calls | 50 | Yes, per request. |

### Cost Tracking

Each research task should track cumulative cost:

- Embedding cost.
- Search cost.
- Rerank cost.
- LLM generation cost.
- Total cost.

Cost is checked after each step. If `max_cost` is exceeded, the task transitions to `cancelled` with reason `budget_exhausted` and returns partial results.

### Dry-Run Planning

Before starting expensive shell commands or research tasks, agents should be able to ask the platform for an execution plan:

```text
knowledge.shell.plan(...)
knowledge.plan_research_task(...)
```

The plan should estimate:

- Documents or resources scanned.
- Expected tool calls.
- Expected embedding/rerank/LLM tokens.
- Estimated latency.
- Estimated model cost.
- Cache hit probability.
- Permission or scope risks.
- Degradation risks.

Planning does not guarantee exact cost, but it gives agents and humans a chance to narrow scope before launching expensive workflows.

### Persistence

Research tasks are backed by the durable job queue. They survive process restarts. Each state transition is persisted as a job state change with a trace id, so operators can inspect progress.

### Resumability

If a research task is interrupted by a process restart, it should resume from the last completed state rather than restarting from `queued`. This requires that each state transition writes its intermediate artifacts (evidence ids, conflict reports, sub-query results) to durable storage before advancing.

## 14. Security and Permission Model

Agent access increases risk. Security must be part of the retrieval runtime, not an afterthought.

## 14.1 Core Principles

- Every request has a subject.
- Every subject has scopes.
- Every retrieval is permission-filtered before generation.
- Document content is untrusted input.
- Tool output is not system instruction.
- Citations cannot be fabricated.
- Long tasks must have budgets and cancellation.

## 14.2 Risks and Controls

| Risk | Control |
|---|---|
| Agent reads unauthorized data | Subject-scoped permission filtering at retrieval time. |
| Prompt injection from documents | Treat document text as untrusted data; separate instructions from retrieved content. |
| Tool abuse | Tool allowlist, scope checks, rate limits, approval policies. |
| Data exfiltration | Redaction, tenant boundary, egress policy, audit log. |
| Citation fabrication | Citation must resolve to node id + document version + artifact hash. |
| Expensive long-running tasks | Budget, timeout, max tool calls, max documents, cancel token. |
| Cross-tenant leakage | Physical or logical tenant isolation in metadata and index layers. |

## 14.3 Policy Engine

Consider a policy engine such as OPA or Cedar-style policy modeling for:

- Tenant policy
- Knowledge space access
- Document-level ACL
- Field-level redaction
- Tool authorization
- Agent-specific scopes

## 14.4 Rate Limiting

Rate limiting protects the platform from abuse and ensures fair resource sharing across tenants and agents. It is separate from budget control: budget limits cost, rate limiting limits throughput.

### Granularity

| Level | What is limited | Algorithm |
|---|---|---|
| Per-tenant | Total queries per second across all users and agents in the tenant. | Token bucket. |
| Per-agent | Queries per second for a specific agent identity. | Token bucket. |
| Per-tool | Calls per second for expensive tools like `knowledge.search`, `knowledge.create_research_task`. | Token bucket. |
| Per-KnowledgeFS command | Calls per second for `grep`, `find`, and other scan-heavy commands. | Sliding window. |

### Response

When a rate limit is exceeded:

- Return HTTP 429 with `Retry-After` header.
- Include `X-RateLimit-Limit`, `X-RateLimit-Remaining`, and `X-RateLimit-Reset` headers on every response.
- For MCP tool calls, return a structured error with `retry_after_seconds`.

### Defaults

| Scope | Default Limit |
|---|---|
| Tenant query rate | 100 QPS |
| Agent query rate | 20 QPS |
| Research task creation | 5 per minute per agent |
| KnowledgeFS grep (space-wide) | 10 per minute per agent |
| Bulk operations | 5 concurrent per tenant |

Defaults should be configurable per tenant and per agent policy.

## 14.5 Data Lifecycle Management

The platform must manage document and artifact lifecycles to control storage growth, meet compliance requirements, and support data deletion.

### Retention Policies

| Entity | Default Retention | Configurable |
|---|---|---|
| `DocumentAsset` (raw) | Indefinite | Yes, per knowledge space. |
| `ParseArtifact` | Keep current + 2 previous versions | Yes, per knowledge space. |
| `KnowledgeNode` | Tied to document lifecycle | — |
| `IndexProjection` (inactive) | 30 days after blue-green replacement | Yes, per tenant. |
| `EvidenceBundle` cache | 7 days | Yes, per tenant. |
| `AnswerTrace` | 90 days | Yes, per tenant. |
| Research task results | 24 hours after completion (default) | Yes, per request. |
| Session data | 30 minutes of inactivity | Yes, per tenant. |

### Storage Quotas

- Per-tenant storage quota for raw document assets.
- Per-knowledge-space storage quota.
- When a quota is reached, new document uploads are rejected with a clear error. Existing documents remain accessible.

### Document Deletion

Deleting a document must cascade through all derived artifacts:

```text
Delete DocumentAsset
  -> delete all ParseArtifacts
  -> delete all KnowledgeNodes
  -> remove from all IndexProjections
  -> invalidate affected caches (evidence, KnowledgeFS path, permission-filtered listings)
  -> remove entity/relation edges sourced from this document
  -> remove from summary tree (mark affected summaries as stale)
  -> record deletion in audit log
```

For GDPR-style deletion requests, the system must verify that no residual content remains in caches, traces, or generated summaries. Traces that reference deleted documents should redact the document content but retain the trace structure for audit purposes.

### Archival

Knowledge spaces should support an `archived` status:

- Archived spaces are not queryable by default.
- Index projections for archived spaces can be offloaded to cold storage.
- Archived spaces can be restored to active status.

### Cleanup Jobs

A background cleanup job should run periodically to:

- Delete expired parse artifact versions.
- Delete inactive index projections past their retention period.
- Delete expired session data.
- Delete expired research task results.
- Delete expired answer traces.
- Prune orphan entities with no remaining document mentions.

## 14.6 Degradation and Backpressure

Production systems will experience partial failures. The platform must define explicit degradation paths rather than failing entirely.

### Degradation Matrix

| Component Failure | Degradation Path | User-Visible Signal |
|---|---|---|
| Database overloaded | Reduce vector topK and FTS topK. Skip FTS and use vector-only if under extreme load. Return results with `degraded: true`. | "Results may be less comprehensive than usual." |
| Embedding service unavailable | Use cached embeddings if available. Fall back to BM25-only retrieval. Return results with `degraded: true`. | "Semantic search temporarily unavailable. Using keyword search." |
| Reranker unavailable | Skip reranking. Return recall results ordered by raw score. Flag `reranker_skipped: true`. | "Results may be less precisely ranked." |
| Python compiler workers unavailable | New document ingestion is queued but not processed. Existing index remains queryable. | Upload UI shows "Processing delayed" status. |
| LLM generation service unavailable | Return the EvidenceBundle without a generated answer. Set `generation_skipped: true`. | "Here is the evidence we found. Answer generation is temporarily unavailable." |
| PostgreSQL unavailable | Platform is fully unavailable. Return 503. | — |
| Object storage unavailable | Raw document download fails. Retrieval from index still works. `cat` for raw files returns an error. | "Original document temporarily unavailable." |

### Backpressure

When the system is under heavy load:

- The retrieval runtime should monitor queue depth and response latency.
- If latency exceeds 2x the P95 target, automatically downgrade deep/research queries to fast mode and return `downgraded: true`.
- If queue depth exceeds a threshold, return HTTP 503 with `Retry-After` for new requests rather than accepting work that will timeout.
- Research tasks should pause and resume rather than consuming resources during load spikes.

### Health Endpoint

The platform should expose a `/health` endpoint that reports:

- Overall status: `healthy`, `degraded`, `unavailable`.
- Per-component status: search engine, embedding service, reranker, compiler workers, LLM service, metadata DB, object store.
- Current degradation flags.

## 15. Evaluation and Observability

## 15.1 Observability

Recommended standard: OpenTelemetry.

Every retrieval should record:

```text
query
-> normalized query
-> route decision
-> index projections used
-> recall candidates
-> permission-filtered candidates
-> reranked candidates
-> evidence bundle
-> generated answer
-> citations
-> latency and cost
```

## 15.2 Core Metrics

| Metric | Meaning |
|---|---|
| Retrieval latency P50/P95/P99 | User experience and system health |
| Time to first token | Perceived responsiveness |
| Recall proxy | Whether relevant documents are being retrieved |
| Rerank drop rate | Whether recall and rerank disagree heavily |
| Citation coverage | Percentage of answer claims with citations |
| No-answer rate | How often the system refuses or cannot answer |
| Conflict rate | How often sources disagree |
| Freshness warning rate | How often answers depend on stale sources |
| Cost per query | Model and serving cost |
| Index build time | Operational cost of ingestion |
| Parser failure rate | Source quality and parser quality |
| Query cache hit rate | Whether repeated requests are benefiting from normalization/evidence caching |
| Embedding cache hit rate | Whether embedding cost is controlled |
| KnowledgeFS path cache hit rate | Whether filesystem-like navigation can meet low-latency goals |
| Cache freshness violations | Whether cache invalidation is safe |

## 15.3 Evaluation

Evaluation must start in Phase 1. RAG quality can regress whenever parser, chunking, embedding, reranker, prompt, or retrieval strategy changes. Without an early evaluation loop, the team cannot tell whether a technical change improves or harms the product.

Evaluation should include:

- Golden question set
- Auto-generated questions from documents
- Human-labeled expected evidence
- Retrieval recall
- Context precision
- Context relevance
- Faithfulness
- Citation accuracy
- Answer correctness
- Latency and cost

Bad cases from production should be added to evaluation sets with one click.

Minimum Phase 1 evaluation:

- Golden question set.
- Expected evidence ids.
- Retrieval recall.
- Citation hit rate.
- No-answer rate.
- Basic dashboard.

Phase 2 evaluation:

- CI regression tests for parser, chunking, embedding, reranking, and retrieval strategy changes.
- Threshold-based blocking for severe recall or citation regressions.

Advanced evaluation can come later:

- Automatic question generation.
- Online A/B experiments.
- Human annotation workflow.
- Advanced Ragas-style metrics.

## 15.4 Regression Testing

Any change to these should trigger regression evaluation:

- Parser
- Chunking strategy
- Embedding model
- Sparse index
- Reranker
- Hybrid weights
- Query router
- Prompt template
- Summary tree
- Graph expansion

## 16. Human UX

## 16.1 Upload Experience

After upload, users should see a knowledge health report:

- Parse success rate
- OCR status
- Table detection
- Image detection
- Heading structure
- Generated knowledge node count
- Potential quality risks
- Suggested test questions
- Estimated retrieval quality
- Publish readiness

## 16.2 Retrieval Experience

The answer UI should show:

- Answer
- Citations
- Confidence
- Source freshness
- Conflicting evidence if any
- Missing evidence if any
- "Why this answer?"
- "Why did it not find my document?"
- "Run deep search"
- "Add this as eval case"

## 16.3 Retrieval Studio

Expert-facing workspace:

- Query trace viewer
- Recall candidate viewer
- Rerank comparison
- Evidence bundle viewer
- Side-by-side strategy comparison
- A/B experiment setup
- Golden question dashboard
- Failed query diagnostics

## 17. Agent UX

Agents need reliability more than visual polish.

The agent-facing experience should provide:

- Stable tool schemas
- Structured results
- Explicit confidence
- Evidence ids
- Reproducible trace ids
- Async research tasks
- Budget controls
- Dry-run planning for expensive commands and research tasks
- Workspace snapshots and replay
- Clear error types
- Clear answerability status

Recommended answerability states:

```text
answerable
partially_answerable
not_enough_evidence
conflicting_evidence
permission_limited
outdated_sources
requires_deep_research
```

## 18. API Design

## 18.1 Human API

Example endpoints:

```text
POST /knowledge-spaces
POST /knowledge-spaces/{id}/sources
POST /knowledge-spaces/{id}/documents
GET  /knowledge-spaces/{id}/health-report
POST /knowledge-spaces/{id}/publish
POST /knowledge-spaces/{id}/query
GET  /queries/{trace_id}
POST /queries/{trace_id}/feedback
```

## 18.2 Agent API

Example endpoints:

```text
POST /agent/knowledge/search
POST /agent/knowledge/fetch-evidence
GET  /agent/knowledge/fs/ls?path=...
GET  /agent/knowledge/fs/tree?path=...
GET  /agent/knowledge/fs/cat?path=...
GET  /agent/knowledge/fs/grep?path=...&q=...
GET  /agent/knowledge/fs/find?path=...&type=...
GET  /agent/knowledge/fs/stat?path=...
POST /agent/knowledge/fs/diff
POST /agent/knowledge/source-mounts
GET  /agent/knowledge/source/fs/ls?path=...
GET  /agent/knowledge/source/fs/cat?path=...
GET  /agent/knowledge/source/fs/grep?path=...&q=...
POST /agent/knowledge/shell/plan
POST /agent/knowledge/shell/execute
GET  /agent/knowledge/documents/{id}/outline
GET  /agent/knowledge/nodes/{id}
POST /agent/knowledge/compare-sources
POST /agent/knowledge/research-tasks/plan
POST /agent/knowledge/research-tasks
GET  /agent/knowledge/research-tasks/{id}
DELETE /agent/knowledge/research-tasks/{id}
POST /agent/knowledge/workspaces/snapshots
GET  /agent/knowledge/workspaces/snapshots/{id}
POST /agent/knowledge/workspaces/snapshots/{id}/replay
```

## 18.3 Bulk Operations API

Enterprise customers need bulk operations for large-scale management. Bulk operations are asynchronous and backed by the durable job queue.

```text
POST /knowledge-spaces/{id}/documents/bulk-upload
POST /knowledge-spaces/{id}/documents/bulk-delete
POST /knowledge-spaces/{id}/documents/bulk-reindex
POST /knowledge-spaces/{id}/permissions/bulk-update
GET  /bulk-jobs/{job_id}
DELETE /bulk-jobs/{job_id}
```

Each bulk operation returns a job id. The caller polls `GET /bulk-jobs/{job_id}` for progress:

```json
{
  "job_id": "bulk_123",
  "type": "bulk_reindex",
  "status": "running",
  "total_items": 5000,
  "completed_items": 2340,
  "failed_items": 3,
  "failed_item_ids": ["doc_45", "doc_89", "doc_102"],
  "created_at": "2026-05-07T10:00:00Z",
  "estimated_completion": "2026-05-07T10:15:00Z"
}
```

Bulk operations respect tenant rate limits and can be cancelled via `DELETE /bulk-jobs/{job_id}`.

## 18.4 Search Request

```json
{
  "knowledge_space_id": "ks_123",
  "query": "Compare refund rules for annual and monthly plans.",
  "mode": "auto",
  "subject": {
    "type": "agent",
    "id": "agent_abc",
    "scopes": ["knowledge:read"]
  },
  "filters": {
    "document_types": ["contract", "policy"],
    "sources": ["legal-drive"],
    "date_range": {
      "from": "2025-01-01",
      "to": "2026-05-07"
    },
    "entities": ["acme-corp"],
    "tags": ["reviewed"],
    "languages": ["en", "zh"],
    "freshness": "last_90_days",
    "node_types": ["policy_clause", "section"],
    "exclude_document_ids": []
  },
  "latency_budget_ms": 800,
  "max_cost": {
    "currency": "USD",
    "amount": 0.02
  },
  "session_context": {
    "session_id": "sess_123",
    "previous_queries": [],
    "active_document_ids": [],
    "active_entity_ids": [],
    "accumulated_evidence_ids": [],
    "last_trace_id": "trace_prev"
  },
  "workspace_context": {
    "workspace_id": "run_123",
    "mounted_paths": ["/sources/drive/legal-team", "/knowledge/spaces/legal"],
    "snapshot_id": "snap_456"
  },
  "cache_policy": {
    "allow_cached_evidence": true,
    "max_staleness_seconds": 300
  },
  "require_citations": true
}
```

## 18.5 Search Response

```json
{
  "trace_id": "trace_123",
  "mode_used": "fast",
  "answerability": "answerable",
  "answer": "...",
  "confidence": "high",
  "evidence_bundle": {},
  "latency_ms": 642,
  "cost": {
    "currency": "USD",
    "total": 0.004,
    "retrieval": 0.001,
    "generation": 0.003
  },
  "degraded": false,
  "degradation_reasons": [],
  "generation_skipped": false,
  "ungrounded_claims": [],
  "suggested_next_actions": []
}
```

## 19. Avoided Designs

| Avoid | Reason |
|---|---|
| Pure vector retrieval | Bad for exact terms, policy numbers, IDs, names, and rare words. |
| Always-on agentic retrieval | Latency and cost become unacceptable for normal usage. |
| User-facing raw parameters | Poor product experience and high support burden. |
| Plain text-only parsing | Breaks citations, tables, layout, page highlighting, and agent-readable artifacts. |
| Vendor-specific logic in business code | Hard to maintain and migrate. |
| Putting core platform logic in Next.js routes | Next.js is the human UI shell. Retrieval, KnowledgeFS, MCP, jobs, permissions, and provider orchestration should live in Hono so SaaS and Standalone share one portable runtime. |
| No evaluation system | RAG quality silently regresses. |
| No index versioning | Results become unreproducible and rollback is hard. |
| Answer-only API for agents | Agents need evidence and actions, not only prose. |
| Search-box-only knowledge base | Humans and agents need inspectable structure, exact search, traces, and filesystem-like navigation. |
| Building core storage directly on FUSE | FUSE is useful as an adapter, but core semantics should be API-first and portable. |
| Exposing a real host shell to agents | Agents need composable shell-like workflows, but execution must be an allowlisted command dispatcher over SourceFS/KnowledgeFS/EvidenceFS, never arbitrary host process execution. |
| Treating connectors only as ingestion jobs | Sources should also be mountable, inspectable resources so agents can navigate raw sources, compiled knowledge, and evidence traces in one workspace. |

## 20. Migration-Free Implementation Plan

This plan assumes a clean rebuild, without constraints from the current code architecture.

Current task-level execution is tracked in
`.harness/docs/consolidated-iteration-plan.md`. The original phase plan below remains
the architectural rollout model; the consolidated plan records which local MVP,
hardening, PageIndex, multimodal, Admin, and code-health tracks are done or still
active.

### Phase 1: Foundation

- Initialize TypeScript monorepo (Turborepo/pnpm workspaces) with Hono API skeleton.
- Define Hono/Next.js boundary: Hono owns platform APIs and Next.js owns human UI.
- Initialize `packages/compute` with bounded chunker and tokenizer modules.
- Implement platform adapter interface and Cloudflare adapter + Docker adapter.
- Define core data model.
- Build Knowledge Gateway (Hono).
- Implement PostgreSQL metadata schema (Drizzle ORM, Hyperdrive-compatible).
- Implement object storage layout (S3-compatible, R2/MinIO).
- Implement trace model.
- Implement basic OpenAPI (`@hono/zod-openapi`).
- Implement basic MCP server (`@modelcontextprotocol/sdk`).
- Define KnowledgeFS resource model and virtual path semantics.
- Define SourceFS, EvidenceFS, ResourceMount, and CommandRegistry contracts.
- Integrate self-hosted Unstructured API for document parsing.
- Integrate embedding provider API (OpenAI/Voyage/Cohere).
- Implement the TypeScript chunker (section-aware, heading inheritance, overlap).
- Implement minimum evaluation: golden questions, expected evidence ids, retrieval recall, citation hit rate.
- Implement basic cache namespaces (KV/Redis adapter) and cache key versioning.
- Verify deployment on both Cloudflare Workers and Docker.

Deliverable:

- Upload document.
- Parse document (via Unstructured API).
- Create knowledge nodes through the bounded TypeScript compute package.
- Build dense vector index + FTS index (in database).
- Search with citations.
- Browse documents and evidence through virtual paths.
- Mount initial internal sources through ResourceMount.
- Measure whether retrieval changes improve or regress quality.
- Deploy to Cloudflare Workers (SaaS) and Docker Compose (Standalone).

### Phase 2: Production Retrieval

- Add hybrid retrieval.
- Add reranker.
- Add permission filtering.
- Add evidence bundle.
- Add answerability states.
- Add retrieval trace viewer.
- Add quality health report.
- Add Next.js Admin Console as a human-facing app that consumes Hono OpenAPI/SSE clients.
- Add KnowledgeFS MCP tools: `ls`, `tree`, `cat`, `grep`, `find`, `stat`, `open_node`.
- Add SourceFS mount inspection tools and CommandRegistry-backed command execution.
- Add safe shell planning/execution as an allowlisted dispatcher over filesystem commands.
- Add CI regression evaluation for parser, chunking, embedding, reranking, and retrieval strategy changes.
- Add query, EvidenceBundle, embedding, rerank, and KnowledgeFS path caches.
- Add generation layer: LLM routing, context window packing, streaming, cost allocation, citation normalization.
- Add text-level `diff` for document versions.
- Add `grep`/`find` scope limits and truncation signals.
- Add rate limiting (per-tenant, per-agent, per-tool).
- Add degradation flags in retrieval and generation responses.
- Add `/health` endpoint with per-component status.

Deliverable:

- Fast retrieval production path.
- Human UI for citations and diagnostics.
- Agent API with structured evidence.
- Agent API with filesystem-like inspection tools.
- Agent API with safe shell-style command composition.
- Quality regression checks before retrieval changes ship.
- Evidence-driven generation with streaming, cost tracking, and citation verification.

### Phase 3: Durable Ingestion

- Implement durable job queue: Cloudflare Queues + Durable Objects (SaaS), pg-boss (Standalone).
- Make ingestion fully versioned.
- Add index projection versioning.
- Add blue-green index publication.
- Add embedding model/index projection version management.
- Add incremental re-indexing.
- Add parser router with native TypeScript parsers for Markdown, HTML, CSV, JSON, YAML.
- Add bulk operations API (bulk upload, bulk delete, bulk reindex).
- Add data lifecycle management: retention policies, storage quotas, cascading deletion, cleanup jobs.

Deliverable:

- Reliable large-document ingestion.
- Rollback and publish workflow.
- Enterprise-ready bulk operations and data lifecycle controls.

### Phase 4: Advanced Knowledge Compiler

- Add contextual enrichment with cost-aware policies (skip conditions, budget limits, batch optimization).
- Add hierarchical summary tree with incremental maintenance.
- Add PageIndex-inspired `DocumentOutline` during compilation, including TOC/heading
  hierarchy, title locations, page/offset ranges, summaries, source element/node
  links, and quality metadata.
- Add outline-guided reasoning tree search for research mode.
- Add `DocumentMultimodalManifest` during compilation, including tables, images,
  code blocks, pages, OCR, captions, bounding boxes, object-backed visual assets,
  thumbnail variants, enrichment metadata, and visual embedding status.
- Add entity/relation extraction with confidence thresholds, deduplication, and extraction budgets.
- Add graph index backed by PostgreSQL (recursive CTEs + JSONB adjacency).
- Add table-specific retrieval.
- Add image/OCR-aware retrieval.
- Add image-byte visual embedding projections and visual late-fusion metrics.
- Add VLM-capable answer provider support with text fallback for non-vision models.
- Add virtual semantic views: by entity, topic, time, owner, type, permission.
- Add query-dependent virtual trees for deep/research mode.
- Add semantic `diff` for document version comparison.
- Add generation post-processing: claim-evidence alignment, hallucination flagging.

Deliverable:

- Stronger long-document and structured-document retrieval.
- First-class document outlines and multimodal manifests.
- Human-debuggable and agent-readable corpus navigation.
- Visual assets, table/image/page citations, and VLM-ready answer generation.
- Graph-expanded retrieval for entity-centric and cross-document queries.

### Phase 5: Agent-Native Research

- Add research task API with full lifecycle: state machine, partial results, cost tracking, resumability.
- Add experimental A2A adapter behind an isolated integration layer.
- Add workspace snapshot, clone, and replay for reproducible agent runs.
- Add dry-run planning for expensive shell commands and research tasks.
- Add source comparison.
- Add conflict detection.
- Add freshness checking.
- Add budgeted multi-step research workflow.
- Add backpressure and degradation automation (auto-downgrade under load, pause/resume for research tasks).

Deliverable:

- Agents can perform reliable, auditable, long-running knowledge tasks.
- Agent research environments can be snapshotted and replayed.
- Platform self-protects under load with graceful degradation.

### Phase 6: Evaluation Platform

- Expand golden question management.
- Add automatic question generation.
- Add advanced retrieval and answer quality metrics.
- Add A/B strategy comparison.
- Add production bad-case capture.
- Add human annotation workflows.

Deliverable:

- Advanced quality governance beyond the minimum Phase 1-2 evaluation loop.

## 21. Final Recommended Architecture

If the system is designed from scratch for both humans and agents, the final recommendation is:

```text
Primary Language: TypeScript (full-stack, including bounded compute)
SaaS Runtime: Cloudflare Workers (edge-distributed, V8 isolates)
Standalone Runtime: Docker (Node.js / Bun)
API Framework: Hono (portable across Workers and Node.js)
Human UI Framework: Next.js / React for Admin Console and Retrieval Studio
Platform Adapter: Abstraction layer for storage, cache, jobs, DB across deployment targets
Gateway: Hono middleware with policy, auth, budget, rate limiting, trace
Jobs: SaaS: Cloudflare Queues + Durable Objects; Standalone: pg-boss
Metadata: PostgreSQL (Hyperdrive in SaaS, direct in Standalone)
Object Store: SaaS: Cloudflare R2; Standalone: MinIO (both S3-compatible)
Cache: SaaS: Cloudflare KV + Cache API; Standalone: Redis or in-memory LRU
Database (unified): SaaS: TiDB Cloud (Vector + FULLTEXT + recursive CTE); Standalone: PostgreSQL (pgvector + tsvector + recursive CTE)
Hybrid Search: Two parallel DB queries (vector + FTS) + bounded TypeScript RRF fusion — no separate search engine
KnowledgeFS: Virtual filesystem API, MCP-first, optional WebDAV
Document Outline: PageIndex-inspired DocumentOutline for TOC trees, title locations, page/offset ranges, summaries, quality metadata, and research tree search
Multimodal Manifest: DocumentMultimodalManifest for tables, images, code, pages, OCR/captions, bounding boxes, object-backed assets, thumbnails, enrichment state, and visual embedding linkage
Agent Workspace: SourceFS + KnowledgeFS + EvidenceFS + workspace snapshots/replay
Resource Mounts: Mount external and internal sources under typed, permission-aware paths
Command Registry: Shared command semantics for MCP, OpenAPI, safe shell, and optional adapters
Safe Shell: Allowlisted shell-like command dispatcher over registered filesystem commands, never host shell execution
Parser: Self-hosted Unstructured API + native TypeScript parsers for Markdown/HTML/structured data
Embedding: API-only — OpenAI / Voyage / Cohere / Jina via unified provider interface
Visual Embedding: API/provider-backed visual vectors over object-backed image/table/page assets, with text-surrogate fallback
Rerank: API-only — Cohere / Voyage via unified provider interface
Generation: API-only — Claude / OpenAI; LLM-routed with streaming, cost allocation, citation verification, and VLM-capable visual evidence attachments where supported
Graph Index: PostgreSQL-backed (recursive CTE + JSONB)
Compute Package: chunker, tokenizer, RRF fusion, context packer, text diff (pure TypeScript, no IO)
Agent Protocol: MCP + OpenAPI first, experimental A2A adapter in Phase 5
Admin UI: TypeScript (React/Next.js), Cloudflare Pages (SaaS) or bundled in Docker (Standalone)
UI/API Boundary: Next.js may use thin BFF routes for UI ergonomics, but all core knowledge platform logic lives behind Hono APIs
Rate Limiting: Per-tenant, per-agent, per-tool token bucket
Degradation: Explicit degradation paths for each component; backpressure with auto-downgrade
Data Lifecycle: Retention policies, storage quotas, cascading deletion, archival, cleanup jobs
Observability: OpenTelemetry (Workers Trace Workers / Node.js OTEL SDK)
Evaluation: TypeScript evaluation runner + LLM-as-judge; golden set in Phase 1, CI regression in Phase 2
```

## 22. Key References

- Cloudflare Workers: https://developers.cloudflare.com/workers/
- Cloudflare R2: https://developers.cloudflare.com/r2/
- Cloudflare KV: https://developers.cloudflare.com/kv/
- Cloudflare Queues: https://developers.cloudflare.com/queues/
- Cloudflare Durable Objects: https://developers.cloudflare.com/durable-objects/
- Cloudflare Hyperdrive: https://developers.cloudflare.com/hyperdrive/
- Hono Framework: https://hono.dev/
- Drizzle ORM: https://orm.drizzle.team/
- pg-boss: https://github.com/timgit/pg-boss
- MCP Tools: https://modelcontextprotocol.io/specification/2025-06-18/server/tools
- A2A Specification: https://google-a2a.github.io/A2A/specification/
- OpenAPI 3.1: https://spec.openapis.org/oas/v3.1.0
- PageIndex GitHub: https://github.com/VectifyAI/PageIndex
- Qdrant Hybrid Queries: https://qdrant.tech/documentation/concepts/hybrid-queries/
- OpenSearch Neural Sparse / Hybrid Search: https://docs.opensearch.org/latest/vector-search/ai-search/neural-sparse-search/
- Unstructured API: https://docs.unstructured.io/
- RAPTOR Paper: https://arxiv.org/abs/2401.18059
- Microsoft GraphRAG: https://www.microsoft.com/en-us/research/project/graphrag/
- OpenTelemetry: https://opentelemetry.io/docs/what-is-opentelemetry/

## 23. One-Sentence Product Definition

This platform should be positioned as:

> Evidence Infrastructure for Humans and Agents.

Not merely a knowledge base, not merely vector search, and not merely RAG. It is a trusted evidence operating layer that humans can understand and agents can safely compose.
