# KnowledgeFS P9 irreversible cleanup runbook

This runbook authorizes the removal of the legacy KnowledgeFS authorization domain and records its externally
verified completion. Dify persists reviewed production evidence, four-eyes approval, the global irreversible
cleanup fence, and a strict completion receipt. It never connects to the KFS database or executes DDL itself.

## Hard safety boundary

Cleanup remains denied unless all of the following are persisted and current for the complete KFS Workspace
cohort:

- P8 phase is `ready_for_cleanup`.
- Cutover smoke checks passed, the full observation window elapsed, and maximum legacy task TTL elapsed.
- Rollback cutoff and maximum Capability/token TTL elapsed.
- Legacy access/member/API-key route calls stayed at zero for at least one full rollback window.
- The legacy snapshot/FK dashboard is ready, with no open migration issue or shadow authorization diff.
- Capability v2, integrated mode, product routes, and legacy-ACL read-only state remain enabled.
- Every Workspace has an exact, internally consistent durable KFS freeze ACK and activation ACK bound to its
  source/final revision and task watermarks.
- The sorted Workspace tenant list, count, canonical digest, and immutable inventory reference exactly match all
  cutover ledgers in Dify. One omitted or additional ledger blocks the shared-schema cleanup.
- A production backup was verified, a restore drill was verified after observation, and a change window was approved.
- The cleanup plan contains all six P9 targets and is bound to a reviewed `sha256:` digest.
- A second account approves the request for no more than 24 hours.

Operator-supplied production references are stored as attestations. Dify cannot prove that a metrics URL,
backup, restore drill, or CAB record exists; the on-call operator and database owner must verify them externally.

## Procedure

1. Run `knowledge-fs-control-space status --tenant-id <workspace>` for every KFS Workspace and verify the P8
   ledger. Do not edit the database to manufacture `ready_for_cleanup`.
2. Run `legacy-dashboard --apply` with the authoritative KFS snapshot/FK report, followed by `legacy-check`.
3. Capture production route metrics covering at least the complete rollback window. Access, member, and API-key
   route counts must each be exactly zero; retain the query/reference used for all three bounded metric kinds.
4. Wait for maximum token TTL in addition to the persisted observation and maximum task TTL.
5. Take the production database backup and complete a restore drill. Record immutable references and timestamps.
6. Export a strict `catalog.json` from the target KFS database and the production evidence store. It must contain:
   database engine/name and capture time; the global Workspace cohort digest; exact access/member/API-key zero-call
   window and counts; active legacy key/snapshot and nonterminal legacy-task counts (all zero); exact row counts for
   the six legacy tables; and every catalog FK touching those tables, including child/reference columns and actions.
7. Build the engine-specific, request-bound archive and recovery SQL outside the application migration runner:

   ```text
   cd knowledge-fs
   pnpm p9:bundle \
     --catalog /reviewed/catalog.json \
     --output /reviewed/p9-bundle \
     --request-id <cleanup-request-uuid>
   ```

   The command rejects missing known profile/source/compilation/research/quality FK consumers, nonzero legacy
   traffic/keys/snapshots/tasks, unsafe identifiers, duplicate constraints, and incomplete table counts. It emits
   `remove-legacy-authorization.sql`, `recover-legacy-authorization-data.sql`, and `bundle-manifest.json`.
   Use `removalSqlDigest`—the exact generated removal SQL hash—as the Dify `plan_digest`; do not hash an editable
   directory or branch name. Review both SQL files and perform the recovery SQL against the restored backup before
   approval.
8. Prepare one strict `knowledge-fs-p9-cleanup/v1` JSONL record. It must include the sorted complete
   `workspace_tenant_ids`, matching count/digest/inventory reference, and the three route-kind counts. First run:

   ```text
   knowledge-fs-control-space cleanup-request --input readiness.jsonl
   ```

   Resolve every reported reason. Persist only after external evidence has been verified:

   ```text
   knowledge-fs-control-space cleanup-request --input readiness.jsonl --apply
   ```

9. A different account prepares a `knowledge-fs-p9-cleanup-approval/v1` JSONL record using the same request ID,
   ledger CAS version, and plan digest. Dry-run it, then persist with `cleanup-approve --apply`.
10. During the approved change window, prepare a `knowledge-fs-p9-cleanup-start/v1` record containing the exact
   confirmation `START-KNOWLEDGE-FS-IRREVERSIBLE-CLEANUP`. Dry-run first. To close rollback atomically:

   ```text
   knowledge-fs-control-space cleanup-start \
     --input cleanup-start.jsonl \
     --apply \
     --acknowledge-irreversible
   ```

   This transaction CAS-fences every ledger in the exact Workspace cohort with the same
   `irreversible_cleanup_at` and consumes the approval. It still does not remove schema or data.
11. Deploy the reviewed P9 application version. KFS must set
    `KNOWLEDGE_LEGACY_AUTHORIZATION_REMOVED=true`, which refuses partial configuration, accepts Capability v2 only,
    and does not register legacy access/member/API-key routes. Dify must use the version with the raw Console proxy
    removed. Verify that the final exported OpenAPI contains no legacy ACL/API-key paths.
12. Immediately recompute the generated removal SQL SHA-256 and compare it byte-for-byte with the authorized
    `plan_digest`. Set the engine-specific session request guard, then execute only that SQL through the separately
    controlled DBA procedure. PostgreSQL archives the six tables into `knowledge_fs_p9_archive`; TiDB renames them
    with the `knowledge_fs_p9_archive__` prefix. Both remove catalog-discovered legacy FKs first and record exact row
    counts. Stop on any drift or partial TiDB DDL failure and use the reviewed recovery/backup procedure.
13. Run catalog checks proving zero live legacy tables/FKs, confirm the removed routes/auth/proxy cannot be reached,
    and execute the complete authorization/list/create/query/upload/SSE/delete smoke suite.
14. Prepare `knowledge-fs-p9-cleanup-completion/v1` with the same approved digest, database engine/revision, six
    archived row counts, zero postconditions, smoke result, catalog/metrics/archive references, and recovery-material
    reference. Dry-run, then persist the external execution receipt:

    ```text
    knowledge-fs-control-space cleanup-complete --input completion.jsonl
    knowledge-fs-control-space cleanup-complete \
      --input completion.jsonl \
      --apply \
      --acknowledge-executed
    ```

    `cleanup-status` reports `destructive_actions_executed=true` only after this strict, replay-safe completion CAS.

## Rollback and incident handling

- Before `cleanup-start --apply`, rollback is possible only while the recorded rollback cutoff has not elapsed.
- Once the global `irreversible_cleanup_at` exists, the old ACL must never become authoritative again. Fail closed and
  roll forward; restoring a database backup is a disaster-recovery action, not permission to re-enable legacy ACL.
- If approval expires or the ledger/evidence changes, generate a new request and obtain new four-eyes approval.
- If any legacy route call appears, stop before the irreversible fence, investigate the caller, and restart the
  complete zero-call window.

## External completion blockers

| Item | Code can validate | Production evidence still required |
| --- | --- | --- |
| P9-01 zero-call window | Count/window schema and persisted gate | Production metrics query and caller investigation |
| P9-02 legacy FK removal | Strict catalog input, known-consumer completeness, deterministic SQL | Target catalog capture and DBA execution |
| P9-03–05 route/verifier/proxy removal | Capability-only KFS profile, final OpenAPI, removed Dify proxy/HS256 contract | Deployment rollout and traffic validation |
| P9-07 table removal | Global fence, deterministic archive/recovery SQL, strict completion receipt | Backup, successful restore drill, DBA execution |
| Final acceptance | Completed audit state and no rollback | Full production authorization/task/upload/SSE regression |
