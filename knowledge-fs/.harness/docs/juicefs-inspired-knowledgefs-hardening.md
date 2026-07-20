# JuiceFS-Inspired KnowledgeFS Hardening Design

> Source review: `juicedata/juicefs` main branch, commit `1674ad7`, reviewed on 2026-05-27.
> Status: Draft architecture supplement.
> Related local source of truth: `.harness/docs/rag-platform-redesign-technical-selection.md` and `.harness/docs/iteration-plan.md`.

## Purpose

This document records the design lessons worth absorbing from JuiceFS into KnowledgeFS.
The goal is not to turn KnowledgeFS into a POSIX filesystem. KnowledgeFS remains a
virtual knowledge filesystem and control plane for documents, evidence, retrieval,
agents, and operators.

JuiceFS is useful as a reference because it cleanly separates:

- a metadata control plane that owns namespace, sessions, locks, lifecycle, and object mappings;
- an object storage data plane that stores immutable content blocks;
- client-side cache behavior with explicit consistency tradeoffs;
- operator tools for status, statistics, filesystem checks, and garbage collection.

KnowledgeFS should absorb these production-grade patterns while keeping its existing
TypeScript-first, API/MCP-first, non-FUSE architecture.

## Non-Adopted JuiceFS Ideas

The following JuiceFS design choices should not become KnowledgeFS core behavior:

- POSIX compatibility as a hard requirement.
- FUSE as a mandatory runtime dependency.
- inode, hard-link, rename, kernel cache, and POSIX lock semantics as product-level obligations.
- byte-level random write support for knowledge artifacts.
- default writeback behavior where metadata can become visible before object persistence is complete.

KnowledgeFS may later expose optional compatibility adapters such as WebDAV, temporary
workspace materialization, or FUSE-like sidecars, but those must stay adapters over the
virtual API rather than the source of truth.

## Current KnowledgeFS Baseline

The current system already has the right broad shape:

- `knowledge_spaces` define tenant-scoped namespaces.
- `sources` and `resource_mounts` model external/internal resources and virtual mount roots.
- `document_assets` persist raw uploaded document object references.
- `parse_artifacts` hold parser output versions.
- `knowledge_nodes` represent chunked citation-ready units.
- `index_projections` store rebuildable retrieval projections.
- `knowledge_paths` map virtual paths to physical or semantic views.
- `resource_mounts.cache_policy`, permission scopes, version fields, and projection versions already provide hooks for future consistency and cache control.

The missing pieces are mostly production-control-plane concepts: manifests, immutable
content identity, staged publication, session/lease visibility, cache consistency
classes, artifact segmentation, and operator repair workflows.

## Design Principle 1: Treat Metadata As The Control Plane

JuiceFS is effective because metadata is not incidental. It is the system's operational
control plane. KnowledgeFS should make the same move.

### Target Concept: KnowledgeSpace Manifest

Add a first-class manifest per KnowledgeSpace. This can be a table such as
`knowledge_space_manifests`, an extension of `knowledge_spaces`, or a versioned settings
record, but it should be addressed as a product concept.

Suggested manifest fields:

| Field | Purpose |
|---|---|
| `knowledge_space_id` | Scope. |
| `manifest_version` | Version of this settings schema. |
| `storage_provider` | Logical object storage provider, such as `r2`, `s3-compatible`, or `memory-dev`. |
| `object_key_prefix` | Isolated prefix for raw documents, artifacts, segments, and staging objects. |
| `metadata_dialect` | PostgreSQL, TiDB, or future adapter family. |
| `parser_policy_version` | Parser routing and extraction policy version. |
| `node_schema_version` | KnowledgeNode schema/chunking contract version. |
| `projection_set_version` | Published projection strategy set. |
| `min_client_version` | Minimum API/MCP/Admin client version allowed for write or advanced operations. |
| `retention_policy_id` | Link to retention defaults for traces, artifacts, projections, and raw data. |
| `quota_policy_id` | Link to raw, artifact, node, projection, and trace quotas. |
| `consistency_policy` | Default path/cache/snapshot consistency behavior. |
| `encryption_policy` | Optional future data encryption and key policy metadata. |
| `created_at` / `updated_at` | Operational audit. |

### Why This Matters

Today, many choices are implied by runtime wiring or repository behavior. A manifest
makes a KnowledgeSpace inspectable, migratable, and upgradeable. It also gives future
operator tooling a stable place to answer questions such as:

- Which parser/index versions created this evidence?
- Which object prefix should `fsck` scan?
- Which caches must be invalidated when a space is upgraded?
- Can this MCP client safely write to this space?
- Which retention and quota policies apply to old artifacts and projections?

## Design Principle 2: Immutable Content, Mutable Pointers

JuiceFS keeps data blocks immutable and changes the metadata view. KnowledgeFS should
apply the same idea at the knowledge-object level.

### Immutable Records

The following should be treated as immutable after publication:

- raw document object bytes identified by `sha256`;
- parse artifact payload or artifact segments identified by `artifact_hash`;
- KnowledgeNode text and source offsets for a specific artifact version;
- dense, FTS, graph, summary, and semantic projections for a specific model/strategy version;
- EvidenceBundle records tied to a trace and projection fingerprint.

### Mutable Records

The following may change:

- latest document version pointers;
- `knowledge_paths` entries that map a virtual path to the current target;
- projection publication status, such as `building`, `candidate`, `published`, `inactive`, `failed`;
- resource mount freshness and cache policies;
- manifest settings and compatibility gates;
- retention and cleanup state.

### Publication Rule

Default behavior should be upload-first and publish-last:

1. Store raw object or artifact segment.
2. Verify checksum and size.
3. Persist immutable metadata.
4. Build parse artifacts, nodes, and projections.
5. Publish path and query visibility in one bounded commit step.

This prevents users and agents from seeing a virtual path, citation, or evidence item
whose backing object cannot be read.

## Design Principle 3: Add A Staged Commit Ledger

KnowledgeFS needs a durable record of partially completed writes and ingestion
operations. This is the API-native analogue of JuiceFS tracking async cleanup and
session-held resources.

Suggested table: `ingestion_commits` or `object_commit_ledger`.

Suggested fields:

| Field | Purpose |
|---|---|
| `id` | Commit id. |
| `tenant_id` / `knowledge_space_id` | Scope. |
| `operation_type` | `document_upload`, `artifact_segment_write`, `bulk_reindex`, `projection_publish`, etc. |
| `idempotency_key` | Retry-safe external key. |
| `status` | State machine status. |
| `raw_object_key` | Staged raw object key, when applicable. |
| `published_object_key` | Final object key, when applicable. |
| `document_asset_id` | Optional linked document. |
| `parse_artifact_id` | Optional linked artifact. |
| `projection_fingerprint` | Optional index publication target. |
| `checksum` / `size_bytes` | Data integrity. |
| `error_code` / `error_message` | Bounded failure detail. |
| `created_at` / `updated_at` / `expires_at` | Lifecycle and cleanup. |

Suggested states:

```text
received
  -> object_staged
  -> object_verified
  -> metadata_prepared
  -> artifacts_built
  -> nodes_built
  -> projections_built
  -> published

received|object_staged|object_verified|metadata_prepared|artifacts_built|nodes_built|projections_built
  -> failed_retryable
  -> failed_terminal
  -> canceled
  -> gc_pending
  -> gc_complete
```

Rules:

- State transitions must be idempotent.
- All lists and repair scans must use explicit limits and stable cursors.
- Staged objects must have an expiry and cleanup path.
- A published path must never point at a commit that has not reached `published`.
- Failed commits must remain inspectable until retention cleanup.

## Design Principle 4: Segment Large Artifacts

JuiceFS splits file data into chunk/slice/block structures for performance and
repairability. KnowledgeFS does not need byte-level POSIX chunks, but it does need
bounded artifact segments.

### Target Concept: Artifact Segments

Suggested table: `artifact_segments`.

Suggested fields:

| Field | Purpose |
|---|---|
| `id` | Segment id. |
| `document_asset_id` | Parent document. |
| `parse_artifact_id` | Parent artifact version. |
| `segment_index` | Stable order. |
| `segment_type` | `text`, `page`, `table`, `image_ocr`, `html`, `metadata`, etc. |
| `content_object_key` | Optional object key if stored outside the row. |
| `text` | Optional bounded inline text for small segments. |
| `sha256` | Segment content hash. |
| `size_bytes` | Segment payload size. |
| `start_offset` / `end_offset` | Source offset range when text-like. |
| `source_location` | Page, section, table, bounding box, or heading path. |
| `metadata` | Parser-specific bounded details. |
| `created_at` | Audit. |

### Benefits

- `cat` can read bounded ranges rather than entire artifacts.
- `grep` and `find` can operate over segment indexes.
- parser artifacts can be pruned or compacted without deleting raw documents.
- large Office/PDF/OCR artifacts avoid unbounded JSON rows.
- `fsck` can verify object keys and hashes per segment.
- future warmup can target only useful segments.

### Segment-to-Node Relationship

KnowledgeNodes should continue to be citation-ready retrieval units. Segments are
storage and inspection units. A node may reference one or more segments through
source location metadata. This keeps retrieval semantics independent from storage
chunking.

## Design Principle 5: Define Consistency Classes

JuiceFS documents consistency tradeoffs between metadata, object storage, and local
cache. KnowledgeFS should make equivalent guarantees explicit for API and MCP clients.

### Proposed Classes

| Class | Behavior | Use Cases |
|---|---|---|
| `path-consistent` | Every command resolves virtual path against current published metadata. | Admin UI, normal user reads, post-upload inspection. |
| `snapshot-consistent` | A command group pins manifest version, permission snapshot, source versions, path fingerprint, and projection fingerprint. | Agent workspace replay, multi-step MCP tools, evaluation, audit. |
| `cache-consistent` | Reads may use TTL caches if keys include permission, version, manifest, and projection fingerprints. | Fast repeated `ls`, `stat`, `open_node`, retrieval previews. |
| `eventual-preview` | Preview-only state may be shown before full projection publication, but must be labeled and excluded from citation-ready retrieval. | Admin ingestion progress, diagnostics. |

### Cache Key Requirements

Any KnowledgeFS or retrieval cache key must include the relevant subset of:

- `tenant_id`;
- `knowledge_space_id`;
- subject or permission snapshot;
- manifest version;
- mount id and mount version;
- virtual path or stable target id;
- source/document/artifact version;
- parser/chunker/projection/model strategy version;
- projection fingerprint;
- command name and normalized arguments;
- cache policy version.

If any of these values change, cached results must be invalidated or naturally missed.

## Design Principle 6: Add Sessions And Leases

KnowledgeFS already has session context concepts for agent workspaces, but filesystem-like
operations need a more explicit runtime view once write-capable mounts, sync, watch, and
bulk operations mature.

### Suggested Session Model

Suggested table: `fs_sessions`.

Fields:

- `id`;
- `tenant_id`;
- `knowledge_space_id`;
- `subject_id`;
- `client_kind`: `admin`, `api`, `mcp`, `worker`, `automation`;
- `client_version`;
- `permission_snapshot_version`;
- `consistency_class`;
- `metadata`;
- `created_at`;
- `last_heartbeat_at`;
- `expires_at`.

### Suggested Lease Model

Suggested table: `fs_leases`.

Fields:

- `id`;
- `tenant_id`;
- `knowledge_space_id`;
- `session_id`;
- `resource_type`;
- `target_id`;
- `virtual_path`;
- `version`;
- `lease_type`: `read`, `write`, `publish`, `delete`, `reindex`;
- `status`: `active`, `released`, `expired`, `revoked`;
- `created_at`;
- `expires_at`.

### Initial Scope

Do not block read-only commands on leases in the first implementation. Start with:

- worker and bulk operation leases for delete/reindex/publish;
- admin/operator visibility into active long-running operations;
- cleanup logic that respects active publish/delete/reindex leases.

## Design Principle 7: Productize FSCK, GC, Status, And Stats

JuiceFS has explicit operational commands to inspect, repair, and observe filesystem
state. KnowledgeFS should expose equivalent API/MCP/Admin capabilities.

### `fsck`

Checks consistency between metadata and object storage.

Initial checks:

- `document_assets.object_key` exists and matches `sha256` / `size_bytes`;
- parse artifact or artifact segment object keys exist;
- KnowledgeNodes point to existing document and parse artifact ids;
- published `knowledge_paths` point to existing targets;
- published index projections point to existing nodes;
- no published path points to failed or uncommitted ingestion state.

Output must be bounded and cursor-based.

### `gc`

Cleans unreachable or expired data.

Initial cleanup targets:

- staged objects from expired failed commits;
- raw objects no longer referenced by any document asset;
- old parse artifact versions outside retention;
- inactive projections outside retention;
- old trace/evidence caches outside retention;
- terminal jobs and bulk operations outside retention.

GC must support dry-run, per-space limits, idempotency keys, and resumable cursors.

### `status`

Shows the current operational health of a KnowledgeSpace.

Initial sections:

- manifest summary;
- storage health and object prefix;
- parser/index policy versions;
- active sessions and leases;
- ingestion backlog;
- failed commits;
- projection publication state;
- retention/cleanup lag;
- cache policy summary.

### `stats`

Shows quantitative behavior over a time window.

Initial metrics:

- object read/write bytes and counts;
- metadata query counts and latency;
- parser calls, failures, and latency;
- node/projection build counts;
- KnowledgeFS command latency and output truncation counts;
- cache hit/miss/eviction counts;
- retrieval recall path latency and candidate counts.

## Design Principle 8: Cache By Access Pattern

JuiceFS distinguishes metadata cache, read cache, readahead, prefetch, partial-only
cache, and writeback cache. KnowledgeFS should use similar vocabulary adapted to
knowledge workloads.

### Proposed Cache Modes

| Mode | Meaning |
|---|---|
| `path-metadata-cache` | Cache `ls`, `tree`, `stat`, and path resolution outputs with short TTL and strict version keys. |
| `artifact-segment-cache` | Cache bounded segment reads for `cat`, `open_node`, and parse artifact inspection. |
| `projection-cache` | Cache projection fingerprints and ready projection lists. |
| `evidence-cache` | Cache EvidenceBundles with permission and projection fingerprints. |
| `warmup` | Preload path metadata, artifact segments, node lists, or projections for a source/space. |
| `partial-only` | Cache small/range reads but do not cache full artifacts. |
| `no-cache` | Required for sensitive or highly mutable mounts. |

### Writeback Policy

KnowledgeFS should not default to writeback. If added later, writeback must be explicit
and constrained to:

- temporary workspaces;
- drafts not visible to citation-ready retrieval;
- local-only or single-session agent scratch resources;
- data with clear loss-risk labeling.

## Design Principle 9: Quota Should Cover More Than Raw Bytes

The current storage quota guard focuses on raw document bytes. Production KnowledgeFS
needs quota categories that match the knowledge pipeline.

Suggested quota dimensions:

- raw document bytes;
- artifact bytes;
- segment count;
- KnowledgeNode count;
- projection bytes or vector count;
- graph entity/relation count;
- trace and evidence history bytes;
- active job count;
- active session/lease count;
- parser/embedding/generation budget.

Quota enforcement should happen at staged commit boundaries and job admission, not only
at upload request parsing.

## Design Principle 10: Keep Indexes Rebuildable, But Make Publications Atomic

The existing design correctly treats graph, vector, FTS, semantic, and summary indexes as
rebuildable projections. JuiceFS reinforces the need for clear metadata publication.

Recommended projection lifecycle:

```text
inactive
  -> building
  -> candidate
  -> validating
  -> published
  -> superseded
  -> gc_pending
  -> gc_complete

building|candidate|validating
  -> failed_retryable
  -> failed_terminal
```

Rules:

- Retrieval should only read `published` projection sets unless explicitly asked for preview/evaluation.
- Publication should be per projection set fingerprint, not one row at a time.
- Rollback should restore the previous published fingerprint without rebuilding.
- Cleanup should delete superseded projection rows only after retention and active session checks.

## First Implementation Boundary

The first implementation should be deliberately small:

- add manifest and commit ledger repository contracts;
- add docs and tests around consistency/cache key rules;
- add `fsck` read-only diagnostics before repair;
- add GC dry-run before deletion;
- add artifact segment data model before moving all artifact storage to segments;
- add sessions/leases for worker visibility before enforcing broad concurrency rules.

This order gives operators observability before mutation and repair power before
aggressive cleanup.

