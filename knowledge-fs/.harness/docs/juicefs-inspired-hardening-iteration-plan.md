# JuiceFS-Inspired KnowledgeFS Hardening Iteration Plan

> Source design: `.harness/docs/juicefs-inspired-knowledgefs-hardening.md`
> Created: 2026-05-27
> Status: Implemented 2026-05-27
> Planning style: TDD-first, bounded changes, production-control-plane focus.

## Goal

Turn the JuiceFS design review into an executable KnowledgeFS hardening program.

The program strengthens KnowledgeFS as a production virtual knowledge filesystem by
adding:

- explicit KnowledgeSpace manifests;
- immutable-content publication semantics;
- staged commit recovery;
- artifact segmentation;
- consistency classes and cache key contracts;
- sessions and leases;
- `fsck`, `gc`, `status`, and `stats` operator surfaces;
- broader quota enforcement;
- atomic projection publication.

This plan does not introduce POSIX/FUSE as a core dependency.

## Program Guardrails

- Hono API remains the business boundary.
- Admin remains a thin human UI and BFF surface.
- TypeScript owns orchestration, IO, database, object storage, cache, jobs, and operator workflows.
- Pure bounded compute remains isolated in `packages/compute` and implemented in TypeScript.
- All list, scan, repair, and cleanup operations must have explicit limits and stable cursors.
- All new write paths must be idempotent.
- All new cache keys must include tenant, space, permission, version, and projection fingerprints where relevant.
- All operator repair tools must ship read-only or dry-run mode before mutation mode.
- Existing in-memory adapters remain test/dev fallbacks, not production defaults.

## Dependency Map

```text
JH.1 Manifest and commit ledger foundation
  -> JH.2 Immutable publication and artifact segmentation
      -> JH.3 Consistency and cache contracts
          -> JH.4 Sessions, leases, and active operation visibility
              -> JH.5 FSCK, GC, status, and stats
                  -> JH.6 Quota and projection publication hardening
                      -> JH.7 Admin/MCP/operator experience
```

## Track JH.1: Metadata Control Plane Foundation

**Goal**: Make KnowledgeSpace configuration and staged write state explicit and inspectable.

| # | Status | Task | TDD Focus | Done Criteria |
|---|---|---|---|---|
| JH.1.1 | Done 2026-05-27 | Add KnowledgeSpace manifest domain model | Core schema tests validate manifest defaults, version fields, storage provider, object prefix, parser/index versions, retention, quota, and consistency policy. | A manifest can be created, cloned, validated, and serialized without relying on runtime-only env wiring. |
| JH.1.2 | Done 2026-05-27 | Add manifest repository contract and in-memory implementation | Repository tests prove tenant/space scoping, clone isolation, update versioning, and bounded list behavior. | API internals can read and update a manifest through a repository abstraction. |
| JH.1.3 | Done 2026-05-27 | Add database schema and migration artifacts for manifests | Migration drift tests prove PostgreSQL and TiDB artifacts render the manifest table and required indexes. | Durable deployments persist manifest records with tenant/space lookup indexes. |
| JH.1.4 | Done 2026-05-27 | Create manifest bootstrap path for existing spaces | Gateway/repository tests prove new KnowledgeSpaces receive a default manifest and legacy spaces can lazily bootstrap one. | Existing flows continue to work while every durable space can expose a manifest. |
| JH.1.5 | Done 2026-05-27 | Add staged commit ledger domain model | Schema tests validate operation types, states, idempotency key, object key fields, checksum, size, error, and retention timestamps. | Partial ingestion or publication work can be represented as a durable state machine. |
| JH.1.6 | Done 2026-05-27 | Add staged commit repository contract and in-memory implementation | Repository tests prove idempotent create, state transition validation, tenant/space scoping, cursor listing, and clone isolation. | Workers and handlers can record recoverable ingestion state. |
| JH.1.7 | Done 2026-05-27 | Add database schema and migration artifacts for commit ledger | SQL tests prove status/idempotency/expiry indexes exist for bounded recovery and cleanup queries. | Durable deployments can recover failed or interrupted commit operations. |
| JH.1.8 | Done 2026-05-27 | Expose read-only manifest and commit diagnostics internally | API handler tests prove bounded internal/admin reads hide secrets and scope by tenant. | Operators can inspect manifest and recent failed commits without database access. |

### JH.1 Verification

- `pnpm --filter @knowledge/core test`
- `pnpm --filter @knowledge/database test`
- `pnpm --filter @knowledge/api test -- src/*manifest*.test.ts src/*commit*.test.ts`
- `pnpm check`
- `git diff --check`

## Track JH.2: Immutable Publication And Artifact Segmentation

**Goal**: Make published paths and retrieval evidence point only to verified immutable content.

| # | Status | Task | TDD Focus | Done Criteria |
|---|---|---|---|---|
| JH.2.1 | Done 2026-05-27 | Define immutable publication contract for document upload | Gateway upload tests prove raw object verification happens before document/path visibility and failed writes leave inspectable commit records. | Upload paths do not expose unverified objects or partially prepared artifacts. |
| JH.2.2 | Done 2026-05-27 | Add artifact segment domain model | Core/API tests validate segment type, object key, inline text bounds, checksums, offsets, source location, and metadata. | Large parser output has a bounded segment representation separate from KnowledgeNodes. |
| JH.2.3 | Done 2026-05-27 | Add artifact segment repository contract and in-memory implementation | Repository tests prove batch limits, stable pagination by artifact/index, hash lookup, and clone isolation. | Command handlers can read parse output in bounded segment pages. |
| JH.2.4 | Done 2026-05-27 | Add database schema and migration artifacts for artifact segments | Migration tests prove artifact/id/index uniqueness, source lookup, and hash indexes. | Durable deployments can store large parser output without one unbounded artifact row. |
| JH.2.5 | Done 2026-05-27 | Write parser output into segments for Markdown/HTML MVP path | Parser/ingestion tests prove existing parse artifacts still exist while segment rows are created with bounded content. | `cat` and document artifact inspection can begin using segments without breaking old reads. |
| JH.2.6 | Done 2026-05-27 | Add segment-backed `cat` for large artifacts | KnowledgeFS command tests prove `cat` reads segment pages with limits, cursors, truncation flags, and path permissions. | Large document reads avoid loading the full artifact JSON. |
| JH.2.7 | Done 2026-05-27 | Add segment-aware `grep` and `find` fallback | Command tests prove segment scanning is bounded and returns stable cursors before full artifact fallback. | Text inspection scales better for large parse artifacts. |
| JH.2.8 | Done 2026-05-27 | Add old artifact compatibility mode | Tests prove legacy parse artifacts without segments still read through existing bounded behavior. | Deployments can migrate gradually. |

### JH.2 Verification

- `pnpm --filter @knowledge/api test -- src/parse-artifact-repository.test.ts src/knowledge-fs*.test.ts`
- `pnpm --filter @knowledge/parsers test`
- `pnpm --filter @knowledge/database test`
- `pnpm check`
- `git diff --check`

## Track JH.3: Consistency And Cache Contracts

**Goal**: Make path resolution, agent sessions, and retrieval cache behavior explicit and version-safe.

| # | Status | Task | TDD Focus | Done Criteria |
|---|---|---|---|---|
| JH.3.1 | Done 2026-05-27 | Define consistency class types | Core/API tests validate `path-consistent`, `snapshot-consistent`, `cache-consistent`, and `eventual-preview` values. | Commands and sessions can declare consistency expectations. |
| JH.3.2 | Done 2026-05-27 | Extend KnowledgeFS command context with consistency options | Command registry tests prove handlers receive consistency class and reject unsupported preview/write modes. | API/MCP can request a supported consistency mode per command. |
| JH.3.3 | Done 2026-05-27 | Harden KnowledgePath resolution cache key | Cache tests prove keys include tenant, space, permission snapshot, manifest version, mount version, path, command, and target version where relevant. | Path cache cannot cross permission, version, or manifest boundaries. |
| JH.3.4 | Done 2026-05-27 | Add snapshot fingerprint builder | Tests prove a stable fingerprint is built from manifest version, permission snapshot, source versions, path versions, and projection fingerprint. | Agent workspace snapshots and evaluations can pin reproducible reads. |
| JH.3.5 | Done 2026-05-27 | Apply snapshot fingerprint to EvidenceBundle cache | Retrieval cache tests prove evidence cache misses across manifest/projection/source permission changes. | Retrieval cache remains fast without returning stale or unauthorized evidence. |
| JH.3.6 | Done 2026-05-27 | Add cache policy normalization for ResourceMounts | Resource mount tests prove `cache_policy` is validated, defaulted, bounded, and applied to path metadata cache. | Mount-level cache behavior becomes operationally visible and enforceable. |
| JH.3.7 | Done 2026-05-27 | Add no-cache and preview command behavior tests | KnowledgeFS/MCP tests prove sensitive mounts bypass caches and preview reads are clearly flagged. | Consistency tradeoffs are explicit to callers. |

### JH.3 Verification

- `pnpm --filter @knowledge/core test`
- `pnpm --filter @knowledge/api test -- src/knowledge-path-resolution-cache.test.ts src/retrieval-cache.test.ts src/knowledge-fs*.test.ts`
- `pnpm check`
- `git diff --check`

## Track JH.4: Sessions, Leases, And Active Operations

**Goal**: Add explicit runtime visibility for API, MCP, worker, and admin clients without overcommitting to POSIX locks.

| # | Status | Task | TDD Focus | Done Criteria |
|---|---|---|---|---|
| JH.4.1 | Done 2026-05-27 | Add FS session domain model | Schema tests validate client kind, version, subject, permission snapshot, consistency class, heartbeat, and expiry. | Runtime clients can be represented as bounded sessions. |
| JH.4.2 | Done 2026-05-27 | Add FS session repository contract and memory implementation | Repository tests prove heartbeat update, expiry listing, tenant scoping, and capacity bounds. | API/MCP/worker code can register and refresh sessions. |
| JH.4.3 | Done 2026-05-27 | Add database schema and migration artifacts for sessions | Migration tests prove indexes for active sessions by space and expiry. | Durable deployments can inspect active clients. |
| JH.4.4 | Done 2026-05-27 | Add FS lease domain model | Schema tests validate lease type, target, virtual path, version, status, expiry, and linked session. | Long-running publish/delete/reindex work can be advertised. |
| JH.4.5 | Done 2026-05-27 | Add lease repository contract and memory implementation | Tests prove acquire, release, expiry, conflict detection for publish/delete/reindex, and non-blocking read lease behavior. | Workers can avoid conflicting mutation operations. |
| JH.4.6 | Done 2026-05-27 | Add database schema and migration artifacts for leases | SQL tests prove active lease indexes and cleanup queries are bounded. | Durable deployments can recover and expire stale leases. |
| JH.4.7 | Done 2026-05-27 | Wire document compilation, delete, and reindex jobs to leases | Worker tests prove leases are acquired, heartbeated, released, and expired on failure. | Operators can see active operations and cleanup can respect them. |
| JH.4.8 | Done 2026-05-27 | Add session/lease cleanup worker | Cleanup tests prove expired sessions and leases are pruned with limits and stable cursors. | Runtime metadata does not grow without bound. |

### JH.4 Verification

- `pnpm --filter @knowledge/api test -- src/*session*.test.ts src/*lease*.test.ts src/document-compilation-worker.test.ts`
- `pnpm --filter @knowledge/database test`
- `pnpm check`
- `git diff --check`

## Track JH.5: Operator Repair And Observability

**Goal**: Give operators safe visibility and repair tools before adding aggressive cleanup.

| # | Status | Task | TDD Focus | Done Criteria |
|---|---|---|---|---|
| JH.5.1 | Done 2026-05-27 | Add `fsck` diagnostic contracts | Schema tests validate issue severity, issue type, target refs, repairability, cursor, and bounded summary fields. | FSCK output is stable for API/Admin/MCP. |
| JH.5.2 | Done 2026-05-27 | Implement raw object fsck checks | Adapter/repository tests prove document object existence, checksum, and size are checked with bounded object reads/heads. | Operators can detect missing or corrupted raw document objects. |
| JH.5.3 | Done 2026-05-27 | Implement artifact and segment fsck checks | Tests prove artifact/segment object keys and hashes are checked without unbounded artifact loading. | Parser output storage drift is visible. |
| JH.5.4 | Done 2026-05-27 | Implement path/node/projection fsck checks | Tests prove published paths, nodes, and projections point to existing targets and committed states. | Broken virtual paths or stale projection rows can be detected. |
| JH.5.5 | Done 2026-05-27 | Add GC dry-run contracts | Schema tests validate cleanup candidate types, counts, sizes, cursors, and idempotency keys. | Cleanup can be reviewed without deleting data. |
| JH.5.6 | Done 2026-05-27 | Implement staged object and failed commit GC dry-run | Tests prove expired staged objects are listed by prefix and commit state with bounds. | The riskiest orphan class is observable before deletion. |
| JH.5.7 | Done 2026-05-27 | Implement first mutation GC for staged objects | Tests prove deletion is idempotent, bounded, auditable, and respects active leases. | Expired staged objects can be safely removed. |
| JH.5.8 | Done 2026-05-27 | Add KnowledgeSpace `status` summary | Handler tests prove status returns manifest, storage, parser/index versions, active sessions/leases, failed commits, and projection state. | Operators get one bounded health snapshot per space. |
| JH.5.9 | Done 2026-05-27 | Add KnowledgeSpace `stats` summary | Tests prove counters are low-cardinality, bounded by time window, and safe when metrics are unavailable. | Operators can see usage and performance trends without raw logs. |
| JH.5.10 | Done 2026-05-27 | Add API routes for fsck/gc/status/stats | OpenAPI and auth tests prove routes are tenant-scoped, permission-gated, bounded, and documented. | Operator surfaces are available through the Hono API. |

### JH.5 Verification

- `pnpm --filter @knowledge/api test -- src/*fsck*.test.ts src/*gc*.test.ts src/*status*.test.ts src/*stats*.test.ts`
- `pnpm --filter @knowledge/adapters test -- src/object-storage.test.ts`
- `pnpm check`
- `git diff --check`

## Track JH.6: Quota And Projection Publication Hardening

**Goal**: Enforce resource budgets across the whole knowledge pipeline and make index publication atomic.

| # | Status | Task | TDD Focus | Done Criteria |
|---|---|---|---|---|
| JH.6.1 | Done 2026-05-27 | Expand quota policy model | Schema tests validate raw bytes, artifact bytes, segment count, node count, projection count, graph count, trace bytes, active jobs, sessions, and provider budget fields. | Quotas describe the pipeline, not only raw uploads. |
| JH.6.2 | Done 2026-05-27 | Add quota usage reader across assets/artifacts/nodes/projections | Repository tests prove usage reads are bounded and dialect-safe. | Admission control can reason about full space cost. |
| JH.6.3 | Done 2026-05-27 | Enforce quotas at commit and job admission | Upload/job tests prove over-quota operations fail before publication and record bounded diagnostics. | Expensive work is blocked before it creates unbounded derived data. |
| JH.6.4 | Done 2026-05-27 | Add projection set fingerprint domain model | Tests prove a projection set groups model, strategy, parser/chunker version, index version, and source snapshot. | Retrieval can target a coherent projection set. |
| JH.6.5 | Done 2026-05-27 | Add projection publication repository operations | Repository tests prove candidate, validate, publish, rollback, supersede, and inactive transitions. | Index publication is atomic from the retrieval caller's perspective. |
| JH.6.6 | Done 2026-05-27 | Update retrieval to read published projection set by fingerprint | Retrieval tests prove candidate projections are excluded unless preview/evaluation mode is requested. | Normal queries never blend old and new projection versions accidentally. |
| JH.6.7 | Done 2026-05-27 | Add projection rollback flow | Workflow tests prove rollback restores the prior published fingerprint without rebuilding. | Bad index upgrades can be reverted quickly. |
| JH.6.8 | Done 2026-05-27 | Add projection GC dry-run and mutation cleanup | Cleanup tests prove superseded projections are deleted only after retention and active session checks. | Projection storage remains bounded without breaking active snapshots. |

### JH.6 Verification

- `pnpm --filter @knowledge/api test -- src/storage-quota.test.ts src/index-projection*.test.ts src/retrieval*.test.ts`
- `pnpm --filter @knowledge/database test`
- `pnpm check`
- `git diff --check`

## Track JH.7: Admin, MCP, And Operator UX

**Goal**: Surface the new control-plane capabilities where humans and agents can use them safely.

| # | Status | Task | TDD Focus | Done Criteria |
|---|---|---|---|---|
| JH.7.1 | Done 2026-05-27 | Add Admin manifest/status panel | Admin tests prove the page loads bounded manifest and status data through BFF and handles unavailable states. | Operators can inspect a space without reading the database. |
| JH.7.2 | Done 2026-05-27 | Add Admin failed commit and active lease diagnostics | Admin/BFF tests prove failed commit and active lease lists are paginated and permission-scoped. | Ingestion and reindex failures become visible in the UI. |
| JH.7.3 | Done 2026-05-27 | Add Admin fsck dry-run surface | Tests prove fsck can be started/read with bounded results and no repair action hidden behind preview UI. | Operators can review consistency issues safely. |
| JH.7.4 | Done 2026-05-27 | Add Admin GC dry-run and staged-object cleanup controls | Tests prove dry-run must precede mutation and mutation requires explicit idempotency key. | Cleanup is safe and auditable from the UI. |
| JH.7.5 | Done 2026-05-27 | Add MCP tools for status and read-only fsck | MCP tests prove agents can inspect space health and consistency issues with strict output limits. | Agent workflows can self-diagnose stale or broken evidence safely. |
| JH.7.6 | Done 2026-05-27 | Add MCP snapshot consistency option | MCP tests prove multi-step commands can pin a snapshot fingerprint and replay against it. | Agent results become more reproducible. |
| JH.7.7 | Done 2026-05-27 | Document operator runbooks | Documentation checks prove production docs cover manifest, staged commits, fsck, gc, status, stats, consistency, and cache policy. | Operators have a clear playbook for common failure modes. |

### JH.7 Verification

- `pnpm --filter @knowledge/admin test`
- `pnpm --filter @knowledge/api test -- src/knowledge-mcp*.test.ts src/admin-bff-integration.test.ts`
- `pnpm --filter @knowledge/admin typecheck`
- `pnpm --filter @knowledge/api typecheck`
- `pnpm check` passed 2026-05-27 after JH.7 completion, including typecheck, tests, coverage, regression evaluation, Phase 4 evaluation, WASM checks, migration checks, compose checks, and Docker smoke gates.
- `git diff --check` passed 2026-05-27.

## Suggested Release Milestones

### Milestone A: Inspectable Control Plane

Includes:

- JH.1.1 through JH.1.8
- JH.3.1 through JH.3.4
- JH.5.8

Outcome: every KnowledgeSpace has an inspectable manifest, commit ledger, status summary,
and snapshot fingerprint foundation.

### Milestone B: Bounded Artifact Storage

Includes:

- JH.2.1 through JH.2.8
- JH.3.5 through JH.3.7

Outcome: large artifacts are segmented, KnowledgeFS reads are bounded by segment, and
cache semantics are explicit.

### Milestone C: Recoverable Operations

Includes:

- JH.4.1 through JH.4.8
- JH.5.1 through JH.5.7

Outcome: long-running operations are visible through sessions/leases, and operators can
diagnose and clean staged object drift.

### Milestone D: Atomic Retrieval Publication

Includes:

- JH.6.1 through JH.6.8
- JH.5.9 through JH.5.10

Outcome: quota covers derived data, retrieval sees coherent published projection sets,
and status/stats/fsck/gc are available through the API.

### Milestone E: Operator And Agent Experience

Includes:

- JH.7.1 through JH.7.7

Outcome: Admin and MCP expose the new control-plane capabilities safely.

## Open Questions

- Should `knowledge_space_manifests` be a separate table, or should the manifest be a versioned JSON document attached to `knowledge_spaces`?
- Should artifact segment content be inline for small segments and object-backed for large segments, or always object-backed?
- What is the first hard limit for artifact segment size: 256 KiB, 512 KiB, or 1 MiB?
- Which consistency class should be the default for MCP multi-tool sessions?
- Should sessions be registered for all API reads, or only MCP/workers/long-running operations?
- Which metrics backend should own durable `stats`: database rollups, OpenTelemetry export, or cache-backed recent counters?
- Should GC mutation be API-only at first, or should it also be exposed in MCP for trusted operator agents?

## Documentation Updates Required During Implementation

Each completed track should update:

- `docs/project-overview.md`
- `docs/operator-manual.md`
- `docs/api-reference.md`
- `.harness/docs/iteration-plan.md`
- a dated `.harness/changes/YYYY-MM-DD-*.md` record

The implementation should keep this plan as a planning artifact, not a replacement for
the main iteration plan.
