# Upload completion concurrency and deletion graph closure

## What changed

- Made upload completion recovery reuse the existing `completing` claim instead of advancing the
  upload-session row version again. Concurrent retries can now converge on the same idempotent
  publication without fencing the original request out of its final commit.
- Made deferred document-compilation dispatch release idempotent and added bounded reconciliation
  when another caller advances the attempt concurrently.
- Replaced per-member, per-source-node correlated graph closure checks during deletion publication
  with set-based source expansion, visible-node joins, grouping, and endpoint joins.
- Reworked the residual graph closure validator to inspect invalid entity and relation members with
  set-based queries for PostgreSQL and TiDB.

## Why

The Console document-create request could time out after about ten seconds while the KnowledgeFS
request continued in the background. A retry of the same upload session then advanced the durable
row version a second time, so the original completion could no longer commit. Both callers also
attempted to release the same deferred compilation dispatch, leaving the upload session stuck in
`completing` even though the object had already been uploaded.

Separately, a deletion publication in another knowledge space used deeply correlated graph closure
subqueries for every graph member and source node. On a large publication this consumed database
CPU for minutes and amplified otherwise unrelated upload latency.

## Safety boundaries

- Upload recovery is only activated for an existing `completing` session whose completion parts
  exactly match the durable claim. Completed replay, integrity validation, quota release, and the
  publication idempotency key remain unchanged.
- Deferred dispatch is considered released only when the durable outbox is no longer at its
  sentinel availability time. An unchanged compare-and-set failure still fails closed.
- Graph members are copied only when their owner document is active, all source nodes have a ready
  index projection in the visible publication, and relation endpoints are present as copied graph
  entities. The post-copy validator enforces the same invariants.
- No production transaction, upload session, or deletion job was canceled or mutated during the
  investigation.

## Verification

- Red/green regressions cover overlapping upload completion, repeated deferred-dispatch release,
  compare-and-set races, and PostgreSQL/TiDB set-based SQL shape.
- `pnpm --dir knowledge-fs --filter @knowledge/api test` — 417 files passed, 1 skipped; 4,667 tests
  passed, 3 skipped.
- `pnpm --dir knowledge-fs --filter @knowledge/api typecheck` — passed.
- Focused Biome validation and `git diff --check` — passed.
- The full API coverage run executed all 4,667 tests successfully. Its global branch result was
  89.26%, below the repository's existing 90% threshold; statements/lines were 93.40% and functions
  were 96.08%. The threshold was not reduced.
- Read-only PostgreSQL measurements on the affected large publication: the previous correlated
  entity closure query exceeded a 12-second statement timeout; the equivalent set-based entity
  query completed in 14.095 ms for 1,583 entities, and the set-based relation query completed in
  19.553 ms for 1,325 relations. End-to-end Console latency still requires measurement after the
  fix is deployed.
