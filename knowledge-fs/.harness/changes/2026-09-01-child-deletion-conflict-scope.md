# Child Deletion Conflict Scope

## Problem

An active Source, logical-document, or document-asset deletion was still treated as a
knowledge-space-wide outage by several independent repositories. Unrelated KnowledgeFS leases,
sessions, quality history, Golden Questions, workspace snapshots, uploads, and retrieval-adjacent
history could therefore surface `KNOWLEDGE_FS_CONFLICT` even though they did not overlap the child
target. Child cleanup also canceled or removed several whole-space workers and histories.

The production symptom was a failed logical-document deletion whose durable job correctly retained
`active_slot = 1` and the target's deleting lifecycle, but consequently rejected every later query
in the same space as `RETRIEVAL_DELETION_IN_PROGRESS`. The failed target still needs an explicit
deletion retry; it must not make unrelated content unavailable indefinitely.

## Changes

- Kept the knowledge-space row as the canonical admission lock, but made child admission depend on
  exact resource overlap for retrieval, KnowledgeFS leases, document/object writes, Source
  workflows, overview activity, credentials, and Golden Question evidence. Whole-space deletion
  remains an exclusive fence.
- Registered `RETRIEVAL_DELETION_IN_PROGRESS` and `RETRIEVAL_EXECUTION_LEASE_LOST` in the public
  error contract, including safe Dify BFF messages. Query SSE now reports the lease-loss code rather
  than degrading both cases to the generic `KNOWLEDGE_FS_CONFLICT` message.
- Kept a fixed, database-clock deletion-admission fence for retrieval quiescence. Only leases that
  existed before a child deletion was accepted are drained; queries admitted after the target was
  made read-invisible do not starve the deletion. PostgreSQL and TiDB use the same space-row lock,
  current locking reads and a monotonic millisecond ordering, rather than application or worker
  clocks. Legacy jobs without the persisted fence fall back conservatively to their creation time.
- Explicitly typed the PostgreSQL derived lease-clock parameter as `timestamptz`; without the cast,
  PostgreSQL inferred the parameter as text and rejected the expiry expression with
  `operator does not exist: text + interval`. The TiDB lexical parameter order is unchanged.
- Made retrieval heartbeats tolerate an isolated database error while still aborting at the last
  durable expiry. A hung heartbeat cannot keep a query alive or make release wait forever, and the
  local deadline is derived from the database lease duration without assuming synchronized clocks.
- Kept generic KnowledgeFS sessions available during child deletion. Agent workspace snapshots are
  intentionally fail-closed for every active deletion: their opaque payload can contain evidence
  text, command output, mounts, and paths, so create/get/replay remain fenced until a target-aware
  tombstone projection exists. Whole-space deletion keeps the same fence.
- Restricted child cleanup and residue proof to target-owned KnowledgeFS leases, staged commits,
  document writers, Golden Questions, and quality evidence. Resource mounts, failed queries,
  Research history, Answer Traces, retrieval history, and unrelated quality reports remain intact.
  Evidence belonging to a deleted/deleting document is projected as a content-free unavailable
  tombstone on Answer Trace and Research reads; unrelated evidence and history remain visible.
  Child workers do not physically delete the knowledge-space-wide workspace snapshot table;
  synchronous invalidation plus the repository fence prevents stale snapshot disclosure.
- Preserved every Golden Question for Source `deleteMode=keep`. Cascade deletion still removes only
  questions whose frozen evidence resolves to the target hierarchy.
- Tombstoned matching quality replay items atomically (`canceled`, cleared result/trace/expected
  evidence). Replay completion remains guarded by `state = 'queued'`, so a late worker cannot
  restore a tombstoned result.
- Stopped child deletion from canceling whole-space legacy publication, page-index, TiDB FTS, and
  staged-commit work. Quiesce still waits for whole-space writers that started before the deletion
  fence, preventing a stale publication from reintroducing the target.
- Added PostgreSQL/TiDB reusable parameter binding for repeated target predicates. TiDB regression
  assertions require each anonymous `?` to have one parameter in lexical order.
- Normalized every SQL statement emitted by the durable-deletion capabilities layer before TiDB
  execution. Logical parameter positions are retained while building a statement, then expanded to
  one anonymous `?` value per lexical occurrence. This covers cancellation, quiescence probes,
  inventory, derived cleanup/proof, publication successors, and primary cleanup without relying on
  PostgreSQL-only `$n` reuse or parameter ordering. Whole-space cleanup removes every space-keyed
  Research partial, while orphan evidence bundles remain scoped through their cited document/node
  ownership so an unrelated space's unlinked bundle cannot be deleted.
- Serialized logical-document deletion admission when an active logical-document tombstone shares
  any revision asset with the requested document. This prevents two concurrent aggregate deletes
  from each treating the shared binary as externally owned and leaving it orphaned. Once the first
  tombstone completes and its revisions are gone, the retry re-evaluates ownership and freezes the
  now-exclusive asset normally; unrelated logical-document deletions remain concurrent.
- Propagated Source, logical-document and asset identifiers through single, bulk, manual and
  compilation write fences. An unrelated failed child deletion no longer blocks local uploads,
  Source imports, object materialization, sessions, space settings, profiles, or query activity.
  Whole-space publication/index/manifest migrations and metadata-field rename/delete intentionally
  retain the global fence because they rewrite or switch an aggregate for the entire space.
- Golden Question write admission joins the bounded candidate batch against every active deletion
  job in one locking query. It no longer assumes one active child job per space: an unrelated or
  Source-keep job cannot mask a later matching deletion, and create/update/import cannot repopulate
  target evidence after that deletion's cleanup page has drained. PostgreSQL/TiDB placeholder
  ordering is covered without per-candidate deletion-job reads.
- Applied the same target hierarchy to Golden Question get/list visibility before pagination. A
  matching active Source, logical-document, or asset deletion hides the whole question (including
  `metadata.evidenceText`), unrelated questions remain readable, Source `keep` remains visible, and
  whole-space deletion still hides every question. The correlated active-job predicate executes in
  the read statement, avoiding both an admission race and per-question database lookups; legacy
  null Source delete modes fail closed as cascade.
- Included bulk-import `metadata.evidenceMatch.documentAssetId/nodeId` in both read visibility and
  deletion cleanup. This closes the case where a later PATCH clears `expectedEvidenceIds` but
  retains the matched evidence metadata and original `evidenceText`.
- Moved Golden Question deletion admission/read SQL into a focused evidence-scope module so the
  repository no longer depends on the full durable-deletion capabilities module.

## Verification

- Focused PostgreSQL/TiDB tests cover retrieval admission and quiescence, query activity, Trace and
  Research tombstones, Snapshot privacy, Golden Question visibility, target cleanup/residue,
  sessions/leases, Source workflows, document/object writes, quality replay and all 122 exercised
  anonymous-parameter query shapes across every deletion target/mode.
- `@knowledge/api`: 422 test files passed and 1 skipped; 4,916 tests passed and 3 skipped; typecheck
  passed. The coverage run executed the same tests successfully and reported 93.37% statements,
  89.32% branches, 96.05% functions and 93.37% lines. Its command remains red on the package-wide
  90% branch threshold; this package is explicitly excluded from the repository CI coverage task,
  and closing that pre-existing aggregate branch gap remains a follow-up.
- `@knowledge/database`: 126 tests, typecheck and migration artifact verification passed.
  `@knowledge/adapters`: 117 tests and typecheck passed. `@knowledge/api-app`: 288 tests and
  typecheck passed.
- The focused Dify KnowledgeFS DTO suite passed 80 tests; Ruff check and format verification passed.
  Backend lint checked 1,102 files, OpenAPI export tests passed 2/2, and `git diff --check` passed.

Target-aware Snapshot tombstones remain a follow-up if child deletion should eventually permit safe
Snapshot replay instead of failing closed during the active deletion.

Migration `0048_deletion_active_scope_indexes` is required to keep active child-job and tombstone
lookups independent of the unbounded deletion-history size; it adds indexes only and needs no data
backfill. PostgreSQL uses ordinary (non-concurrent) index creation because migrations execute as a
single artifact; on a deployment with large deletion tables, schedule the migration window and
observe DDL lock duration before starting the new KnowledgeFS binary.
