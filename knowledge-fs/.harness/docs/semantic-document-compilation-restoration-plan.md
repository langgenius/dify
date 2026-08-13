# Semantic Document Compilation Restoration Plan

> Created: 2026-08-13
> Status: Implementation and local regression complete; production rollout verification active
> Owner boundary: KnowledgeFS TypeScript ingestion/compiler, Dify Admin integration
> Historical implementation reference: standalone KnowledgeFS commit `b3aa9ce`

## 1. Why this restoration exists

The product contract requires document compilation to parse the source, reconstruct a trustworthy
reading order, ask the knowledge-space reasoning model for semantic boundaries, and derive the
outline, summaries, vector/full-text projections, and Graph facts from the same immutable semantic
generation.

The monorepo currently persists the parser artifact and sends it directly to the deterministic
1,200-grapheme chunker. The reasoning model enriches an already-built outline and later extracts
Graph facts, so parser heading mistakes become hard chunk boundaries. The semantic chunking
implementation previously shipped in the standalone KnowledgeFS repository was not carried into
the monorepo migration. This track restores that behavior and extends it with layout recomposition
so forms, invoices, tables, and multi-column documents do not preserve false parser boundaries.

## 2. Non-negotiable invariants

1. Raw parser output remains immutable and auditable.
2. Normalized elements retain source element ids, pages, byte offsets, and bounding boxes.
3. The reasoning model selects source ranges; it never supplies authoritative chunk text.
4. Every eligible source unit is covered exactly once by leaf chunks. Gaps, overlap, reordering,
   invalid ids, and over-limit output fail closed.
5. Tables/images stay atomic unless a bounded deterministic safety split is unavoidable.
6. The model selection, capability identity, prompt version, input fingerprint, output fingerprint,
   and window manifest are frozen with the candidate publication.
7. A retry reuses or proves the complete generation; it cannot append duplicate nodes or Graph rows.
8. Outline, summary, PageIndex, dense/FTS projections, and Graph facts bind to one publication
   generation and publish atomically.
9. Provider/configuration failures remain actionable. No silent fallback to legacy character
   chunking is allowed for a profile that requires semantic compilation.
10. All model/network/memory/database work is bounded and batch-oriented.

## 3. Target pipeline

```text
source bytes
  -> immutable ParseArtifact
  -> deterministic LayoutRecompositionArtifact
  -> frozen reasoning-model SemanticSegmentationPlan
  -> fail-closed coverage/provenance validation
  -> immutable semantic KnowledgeNode generation + receipt
  -> outline/summary + PageIndex
  -> dense/FTS/metadata projections + Graph facts
  -> candidate evaluation
  -> atomic publication head CAS
```

## 4. Execution slices

| ID | Status | Slice | Required behavior | Regression gate |
|---|---|---|---|---|
| SSC.0 | Complete 2026-08-13 | Baseline and migration audit | Restore the historical design record, create redacted structured-document fixtures, map current compiler/publication contracts, and prove the existing deterministic path reproduces fragmented output. | Focused parser/chunker/compiler tests fail for the new semantic contract before implementation. |
| SSC.1 | Complete 2026-08-13 | Layout normalization and boundary recomposition | Reuse the parser's bounded coordinate normalization for vertical CJK/noise, keep canonical element order and tables, classify Unstructured heading confidence, and preserve complete source provenance without mutating the stored parse artifact. | Invoice/form, trusted/untrusted heading, native parser, table isolation, and bounded-element tests. Multi-column reading order remains the parser provider's responsibility and is not silently reordered downstream. |
| SSC.2 | Complete 2026-08-13 | LLM semantic plan | Restore the profile-aware semantic chunker, bounded windows/look-ahead, structured output, joint entity/relation extraction, terminal model identity verification, and deterministic text materialization. Extend its prompt input with normalized structural hints. | Provider-boundary tests for natural boundaries, Unicode, caps, invalid JSON, incomplete coverage, wrong model identity, response limits, and retry replay. |
| SSC.3 | Complete 2026-08-13 | Durable generation | Persist a compact immutable semantic generation receipt and complete node generation transactionally in bounded batches; add PostgreSQL/TiDB migration and schema/index guards. | Repository, migration replay, all-excluded, conflicting replay, batch, identity, and size-bound tests. |
| SSC.4 | Complete 2026-08-13 | Compiler integration | Freeze the reasoning profile at admission, run recomposition and segmentation before projections, resume safely from checkpoints, and keep the published generation readable until the candidate is complete. | Worker success/failure/resume, deletion fence, profile migration, publication CAS, and no-legacy-fallback tests. |
| SSC.5 | Complete 2026-08-13 | Unified derived artifacts | Build outline hierarchy/summaries, PageIndex, dense/FTS projections, and Graph facts from final semantic nodes. Joint facts are quality-controlled and replayed for embedding-only migrations without another LLM call. | Exact-generation outline/path/Graph tests, duplicate prevention, source-node provenance, and profile-migration regression fixtures. |
| SSC.6 | Complete 2026-08-13 | Product diagnostics | Preserve compilation stages and semantic provenance; expose actionable document failure text on status hover while keeping technical trace ids secondary. The document outline now consumes semantic-node section paths and summaries. | Existing Admin hover/component coverage plus API worker/outline provenance tests. |
| SSC.7 | Local automation complete; production execution pending | Rollout and cleanup | The semantic compiler and receipt are versioned and fail closed. Static migration evidence, read-only preflight, explicit-document canary, bounded backfill, task polling, outline verification, retrieval probing, and revision rollback are available through guarded operator commands. Rebuild existing documents through normal reindex/profile-migration candidate publication. Do not delete the legacy implementation until production comparison is accepted. | Full checks, contract lock, rollout-script tests, deployment smoke, sampled shadow comparison, reindex/rebuild idempotency, rollback, and mixed-version reads. |

## 4.1 Execution checkpoint and rollout order

The code path is implemented in dependency order. The remaining work is operational verification,
not an untracked compiler shortcut:

1. **Final local gates (complete 2026-08-13)** — formatting, typecheck, focused and full package
   tests, CI coverage, database migration registry, OpenAPI/contract lock, and build are complete.
   The unrelated repository-wide lint baseline and informational API branch-coverage gap are
   recorded in the change note.
2. **Deploy schema first** — apply `0043_semantic_generation_receipts` to PostgreSQL/TiDB before
   workers that can persist semantic receipts are started.
3. **Deploy API and workers together** — the runtime fails startup when semantic compilation is
   configured without the reasoning provider or synchronous Graph materializer. This prevents a
   mixed deployment from silently reverting to fixed-size chunking.
4. **Canary new imports** — compare chunk coherence, outline localization, Graph provenance,
   provider calls, latency, and retrieval recall on synthetic structured documents and redacted
   operator samples.
5. **Rebuild existing documents** — use the normal candidate reindex/profile-migration path.
   Embedding-only changes clone the immutable semantic node generation; reasoning changes build a
   new semantic generation. Publication remains an atomic head CAS.
6. **Rollback** — keep the previous published projection set readable until the candidate passes
   evaluation. Roll back the publication head; never mutate or partially append to the old node
   generation.
7. **Legacy cleanup** — remove deterministic final chunking only after production canaries,
   existing-document rebuilds, and rollback drills pass. Until then it remains readable for old
   generations but is not a fallback for newly admitted semantic profiles.

### Guarded rollout commands

Every mutating command requires both `SEMANTIC_ROLLOUT_APPLY=1` and an exact, space-scoped
confirmation string. Responses and polling are bounded. Tokens are read from the environment and
are never printed.

```bash
# Repository/migration-registry evidence only; no network or mutation.
pnpm --dir knowledge-fs semantic:rollout:static

# Read-only health, settings, document and failed-reindex baseline.
SEMANTIC_ROLLOUT_SPACE_ID=<space-uuid> \
SEMANTIC_ROLLOUT_API_BASE=<knowledge-fs-api> \
SEMANTIC_ROLLOUT_AUTH_TOKEN=<operator-token> \
pnpm --dir knowledge-fs semantic:rollout:preflight

# Explicit-document canary. Add SEMANTIC_ROLLOUT_QUERY for a Research retrieval assertion.
SEMANTIC_ROLLOUT_SPACE_ID=<space-uuid> \
SEMANTIC_ROLLOUT_DOCUMENT_IDS=<asset-uuid>[,<asset-uuid>...] \
SEMANTIC_ROLLOUT_APPLY=1 \
SEMANTIC_ROLLOUT_CONFIRM=semantic:canary:<space-uuid> \
pnpm --dir knowledge-fs semantic:rollout:canary

# Whole-space bounded backfill through the existing bulk-reindex/candidate publication path.
SEMANTIC_ROLLOUT_SPACE_ID=<space-uuid> \
SEMANTIC_ROLLOUT_APPLY=1 \
SEMANTIC_ROLLOUT_CONFIRM=semantic:backfill:<space-uuid> \
pnpm --dir knowledge-fs semantic:rollout:backfill

# Roll a logical document back to a known prior immutable revision and verify activation.
SEMANTIC_ROLLOUT_SPACE_ID=<space-uuid> \
SEMANTIC_ROLLOUT_ROLLBACK_DOCUMENT_ID=<logical-document-uuid> \
SEMANTIC_ROLLOUT_ROLLBACK_REVISION=<prior-revision> \
SEMANTIC_ROLLOUT_APPLY=1 \
SEMANTIC_ROLLOUT_CONFIRM=semantic:rollback:<space-uuid> \
pnpm --dir knowledge-fs semantic:rollout:rollback
```

Migration 0043 still must be applied by the deployment system before API/workers are rolled out;
the operator script verifies checked-in evidence but intentionally does not receive database
credentials or execute production DDL.

## 5. Redacted fixture matrix

The real customer invoice must never enter the repository. A generated fixture with equivalent
geometry and synthetic names/identifiers covers:

- one-page Chinese invoice/form with vertical labels and a line-item table;
- legitimate native headings versus low-confidence PDF title classifications;
- two-column reading order and cross-page continuation;
- a table larger than one model window;
- scanned/OCR text with repeated page noise;
- an empty document and a single over-limit atomic element;
- long CJK/emoji grapheme boundaries;
- model output with gaps, overlap, reordered ids, invented ids, and altered text attempts.

## 6. Acceptance thresholds

- Eligible source coverage: exactly 100%.
- Unproven generated source text: 0 bytes.
- Duplicate leaf coverage: 0.
- Orphan one-character CJK layout fragments in the invoice fixture: 0.
- Same immutable request retry: no new provider call after a complete receipt exists.
- Same generation retry: byte-identical node ids/text/offsets/ACL/provenance.
- Graph entity/relation rows: generation-scoped, source-linked, and duplicate-free.
- Failed candidate publication: previous published generation remains queryable.
- Every provider request/response, node count, window count, receipt size, and SQL batch is bounded.
- Every CI-enforced coverage package remains at or above its repository threshold. The semantic
  compilation change set is at 90.01% branch coverage. The API package is currently excluded from
  the repository CI coverage task; its informational full-suite historical baseline is now 89.48%
  and must reach 90% before legacy compiler cleanup.

## 7. Verification cadence

Each slice follows RED -> GREEN -> REFACTOR and records its result under `.harness/changes`.
Targeted package tests run after each behavior change. Before completion run:

```text
pnpm --dir knowledge-fs check
pnpm --dir knowledge-fs build
pnpm --dir knowledge-fs lint
pnpm --dir knowledge-fs db:migrations:check
```

The monorepo KnowledgeFS contract lock is regenerated only after all tracked KnowledgeFS changes
and generated artifacts are final and staged. Any skipped gate and its reason must be recorded in
the change summary.
