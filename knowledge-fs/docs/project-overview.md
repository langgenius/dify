# Summary

KnowledgeFS is a TypeScript knowledge platform for retrieval-augmented systems. It provides a Hono-based Knowledge API, a Next.js Admin Console, portable infrastructure adapters, virtual KnowledgeFS command surfaces, MCP tools, retrieval pipelines, parser routing, background jobs, traces, and bounded in-process compute primitives.

The project has two intended deployment shapes:

- SaaS: Cloudflare Workers, Cloudflare Pages, R2, KV, TiDB Cloud, and external parser services.
- Standalone/private deployment: Node.js API, Next.js Admin, PostgreSQL with pgvector, MinIO or S3-compatible object storage, Redis or bounded cache, and self-hosted parser services.

The system should be understood as a knowledge control plane and API server, not as a traditional L7 API gateway. The Admin Console remains a thin human-facing surface, while the Hono API owns auth, ingestion, retrieval, KnowledgeFS, MCP, jobs, provider orchestration, persistence, and observability.

# Intent

KnowledgeFS is intended to make enterprise knowledge assets usable by humans, applications, and agents through bounded, auditable, tenant-scoped APIs.

The core intent is to turn documents and external sources into structured, searchable, citation-ready knowledge:

- Ingest raw documents and external source objects.
- Parse documents into stable artifacts.
- Chunk artifacts into KnowledgeNodes.
- Build dense vector, full-text, metadata, graph, and semantic projections.
- Retrieve evidence with permission and freshness constraints.
- Expose evidence through API, Admin UI, MCP tools, and KnowledgeFS-like commands.
- Record traces, answer evidence, job history, and evaluation metrics for operations and debugging.

KnowledgeFS also aims to keep platform choices portable. Database, object storage, cache, job queue, parser, embedding, reranking, and generation providers should sit behind adapters so a deployment can choose SaaS infrastructure or a private enterprise stack without rewriting product logic.

# Goals

- Provide a tenant-scoped knowledge platform for document ingestion, retrieval, answer generation, evaluation, and agent access.
- Keep the Hono API as the main business boundary and keep the Admin Console thin.
- Support both SaaS and private/standalone deployment modes.
- Expose virtual filesystem-style knowledge inspection through bounded commands such as `ls`, `tree`, `cat`, `stat`, `grep`, `find`, `diff`, and `open_node`.
- Make KnowledgeFS virtual and storage-agnostic: the backing store may be object storage, PostgreSQL, TiDB, index projections, or other repositories.
- Keep chunking, token counting, RRF fusion, evidence packing, and text diff in the shared bounded TypeScript compute package.
- Keep IO, orchestration, provider calls, HTTP, database access, filesystem access, cache access, streaming, and business state machines in TypeScript.
- Ensure every list, search, queue, stream, parser response, cache entry, and object read is explicitly bounded.
- Keep all business access tenant-scoped and permission-aware.
- Make parser selection pluggable so Unstructured is one parser provider, not the only parsing strategy.
- Keep background work portable through `JobQueueAdapter` and explicit state machines, with a future Temporal-compatible boundary available if scale or workflow complexity requires it.
- Treat retrieval quality as a product correctness concern through golden questions, evaluation reports, regression gates, trace inspection, and citation checks.
- Treat graph, vector, FTS, semantic, and summary indexes as rebuildable projections rather than irreplaceable source-of-truth data.

# Non-goals

- KnowledgeFS is not a POSIX-compatible filesystem implementation.
- The project should not depend on FUSE as its core implementation.
- The virtual shell should not execute arbitrary host shell commands.
- The Hono Knowledge API is not meant to be a generic reverse proxy or traditional API gateway.
- Compute helpers must remain pure and must not host IO, network calls, database calls, or workflow orchestration.
- Unstructured should not be treated as a mandatory hard dependency for every parser path.
- Inline in-memory adapters are not production infrastructure; they are development and test fallbacks.
- PostgreSQL-backed queues are not assumed to be the right answer for every scale profile.
- Workflow history, traces, partial results, parser artifacts, and projections should not be retained forever.
- Database migration between PostgreSQL and TiDB is not assumed to be a trivial table copy.
- The Admin BFF should not become a second business API.

# Designs

## System Boundary

The system is split into an Admin Console, a Hono Knowledge API, shared core schemas, infrastructure adapters, parser adapters, compute runtime, retrieval/generation packages, and database migration artifacts.

The Hono API owns:

- Auth and tenant scope.
- KnowledgeSpace and document APIs.
- Upload, parse, chunk, and index orchestration.
- Retrieval, reranking, evidence assembly, answer generation, and traces.
- KnowledgeFS and SourceFS command surfaces.
- MCP tools and safe-shell execution.
- Job status, retention, cleanup, and background workflow state.

The Admin Console owns human workflows and diagnostics only. It should call the Hono API and avoid importing platform internals.

## Deployment Design

SaaS deployment targets Cloudflare Workers/Pages, R2, KV, TiDB Cloud, and hosted parser services.

Private deployment targets Docker Compose, Kubernetes, or equivalent orchestration with:

- Node.js Hono API service.
- Next.js Admin service.
- PostgreSQL with pgvector.
- MinIO or enterprise S3-compatible object storage.
- Redis or another bounded cache.
- Self-hosted parser service.

The same API contract should be preserved across both deployment shapes. Runtime-specific differences belong in adapters and deployment wiring.

## KnowledgeFS Design

KnowledgeFS is a virtual filesystem model and command API. It exposes filesystem-like paths and commands over knowledge resources, but it does not require the backing store to be POSIX compatible.

The virtual namespaces include:

- `/sources`
- `/knowledge`
- `/evidence`
- `/workspaces`

ResourceMount represents mounted external or internal resources. A mount records provider, resource type, virtual mount path, source pointer, capabilities, mode, freshness policy, cache policy, permission scope, and tenant scope.

Initial mount support should prioritize read-only inspection over mutation:

- Upload and object-storage mounts: `ls`, `cat`, `grep`, `stat`.
- Knowledge views over documents, nodes, artifacts, topics, entities, and semantic paths: `ls`, `tree`, `cat`, `stat`, `find`, `grep`, `diff`, `open_node`.
- Connector, web, database, `sync`, and `watch` capabilities should be added only after bounded read behavior is stable.

Safe-shell commands are parsed and mapped to command registries. They are not executed as arbitrary host shell commands. This keeps path isolation at the virtual API layer through tenant scope, permission scope, capability checks, allowlisted commands, explicit limits, object key prefixes, and bounded output.

## Compute Design

`packages/compute` provides bounded pure TypeScript implementations for:

- Parse artifact chunking.
- Token counting or approximation.
- Reciprocal-rank fusion.
- Evidence packing.
- Text diff.

All compute calls must have strict input/output validation, explicit limits, deterministic behavior, and CI coverage. Compute modules must not contain IO, networking, filesystem access, database calls, provider calls, streaming, or business state.

## Parser Design

Parser selection uses a router and adapter boundary. Native parsers should handle Markdown, HTML, and structured formats where possible. Complex layouts, OCR, and unsupported formats can route to an external parser provider.

Unstructured is one supported provider, but the architecture should allow replacements or fallbacks such as Docling, Apache Tika, MarkItDown, or an enterprise-owned parser service. Parser services should run out of process with request timeout, response size bounds, retry policy, circuit breaking, and failure isolation.

## Background Work Design

Background work uses `JobQueueAdapter` and explicit TypeScript state machines. Document compilation, research tasks, retention cleanup, bulk operations, reindexing, and model upgrade workflows should remain tenant-scoped, idempotent, observable, and bounded.

The current state-machine design includes terminal and non-happy-path states such as failed, canceled, paused, resumed, retry, and budget-exhausted cancellation. Documentation should show these transitions explicitly, not only the one-way happy path.

Temporal is not a current runtime dependency. If workflow complexity or operational requirements require it later, a Temporal-compatible adapter can project Temporal workflow state back into the same job and bulk progress APIs.

## Retention And Cleanup Design

Retention must be treated as part of the core design, not an operational afterthought.

Cleanup should cover:

- Answer traces.
- Evidence cache entries.
- Terminal document compilation jobs.
- Research task partial results.
- Old parse artifact versions.
- Inactive dense-vector and FTS projections.
- Bulk job and workflow history.

Cleanup jobs must use explicit limits, stable cursors, tenant/space scope, and idempotency keys. They must not perform full-space scans or unbounded deletes.

## Index And Graph Design

Dense vector, FTS, metadata, semantic path, summary, and graph indexes are projections built from source-of-truth records such as documents, parse artifacts, KnowledgeNodes, extraction metadata, and model versions.

Graph indexes store entities and relations with tenant scope, source node references, permission scope, confidence, extraction version, and metadata. Traversal must enforce explicit depth, fanout, max node, and timeout bounds.

Database-specific details should remain behind repositories and migration artifacts. PostgreSQL and TiDB differ in vector, full-text, JSON, recursive query, and index behavior, so migration between them should be treated as a rebuild/reindex project rather than a simple schema copy.

# Open Questions

- Should the external name "Knowledge Gateway" be changed to "Knowledge API" or "Knowledge Control Plane" to avoid confusion with traditional API gateways?
- Which private deployment target should be treated as the first production reference: Docker Compose, Kubernetes, or an enterprise PaaS profile?
- What is the first-class enterprise auth target after JWT secret auth: OIDC/JWKS, SAML, LDAP bridge, or a customer-specific identity proxy?
- Which parser provider should be the default for complex PDFs and Office files in private deployments?
- What timeout, memory, and isolation policy should parser workers use for OCR-heavy or malformed documents?
- Which ResourceMount providers should be supported first beyond upload and object storage?
- Should write-capable KnowledgeFS mounts be delayed until read-only inspection is fully stable?
- What retention defaults should be used for traces, partial results, job history, parser artifacts, raw documents, and inactive projections?
- At what queue volume should a deployment move from PostgreSQL-backed queueing to Redis, Cloudflare Queues, or Temporal?
- Should graph index traversal remain in the primary relational database, or should high-scale graph workloads move to a specialized graph/search backend later?
- What is the official migration playbook between PostgreSQL and TiDB deployments?
- How should legacy tools that require real filesystem paths be supported: optional FUSE, sidecar projection, temporary workspace materialization, or API-only access?

# Decisions

- TypeScript owns orchestration, IO, HTTP, MCP, database access, storage, cache, jobs, provider adapters, and Admin integration.
- Bounded compute is implemented in TypeScript and remains isolated from IO and business state.
- KnowledgeFS is a virtual command/API surface, not a POSIX filesystem.
- FUSE is not a core dependency; it may only be considered as an optional compatibility layer.
- Safe-shell runs an allowlisted virtual command planner/executor, not arbitrary shell execution.
- The Admin Console must stay thin and call the Hono API for business behavior.
- The Hono API is the knowledge platform control plane and should be described as such.
- Every route, repository query, queue lease, parser response, object read, and stream must have explicit bounds.
- Tenant id, subject id, permission scope, model version, strategy, and index version must be part of data access and cache boundaries where relevant.
- Parser providers are pluggable; Unstructured is not the only possible parser.
- Background jobs use adapter boundaries and explicit state machines first; Temporal remains a future compatibility path, not a current dependency.
- Retention and cleanup are required product behavior for production readiness.
- Graph, vector, FTS, semantic, and summary indexes are rebuildable projections.
- Cross-database migration should be handled through controlled migration plus reindex/rebuild flows.
- Private deployment should be supported without Cloudflare dependencies through Node.js, PostgreSQL, MinIO/S3, Redis/cache, and self-hosted parser services.
