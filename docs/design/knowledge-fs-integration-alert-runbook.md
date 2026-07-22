# Dify × KnowledgeFS integration alert runbook

This runbook covers the seven integration alerts defined by the execution plan. Alert thresholds,
notification routing, and production dashboard links are environment-owned; the response contract
below is repository-owned and must remain valid before a rollout.

## Safety rules

- Correlate requests with `trace_id` and hashed capability identifiers only. Never paste a bearer
  token, cookie, credential secret, presigned URL, document body, or raw provider payload into a
  query, ticket, or chat.
- Start with read-only status and dry-run commands. Do not edit ledgers, lifecycle rows, task rows,
  object prefixes, or authorization tables directly.
- A post-cutover Workspace must fail closed. Never restore the legacy KFS ACL as an availability
  workaround.
- Preserve database and object data during containment. Destructive cleanup is governed separately
  by the [P9 cleanup runbook](knowledge-fs-p9-cleanup-runbook.md) and requires its production
  evidence and approvals.
- Run Dify operator commands from the repository root as
  `uv run --project api flask knowledge-fs-control-space <command>`.

## 1. Capability verification failures increase

Impact: Dify may be unable to call KFS, or invalid/replayed capabilities may be probing the data
plane. Affected calls must remain denied.

Query:

1. Group `dify.knowledge_fs.capability_issuance` by bounded `outcome` and `reason`.
2. Group KFS `knowledge_fs.capability_v2.metric` events by `stage`, `outcome`, and stable `reason`.
3. Check KFS `/health` and `/ready`; inspect the deployed issuer, audience, and public current/
   previous `kid` set without exporting private key material.
4. Correlate a sample with `trace_id`; do not search for raw JWT text.

Containment:

- Stop new product traffic with Dify `KNOWLEDGE_FS_ENABLED=false` when the failure is broad.
- For a single Workspace before its rollback cutoff, use the reviewed cutover `rollback` command.
  After the cutoff, stop that Workspace's product traffic and roll forward.
- Keep KFS fail-closed. Do not enable dev auth, shared HMAC, anonymous access, or legacy ACL reads.

Rollback: roll back the issuer/verifier deployment only to a version that still validates the same
Capability v2 contract and Dify authorization source. Retain current and previous public keys until
the maximum token TTL has elapsed.

Repair: correct clock, issuer/audience, public JWKS distribution, or operation-manifest drift;
rerun `/ready`, the fixed auth vectors, and an authorized plus cross-resource smoke test before
restoring traffic.

## 2. Control-space provisioning or deletion is stuck

Impact: a product Space remains unavailable, deletion is delayed, or remote resources may be
orphaned. The lifecycle state must not be bypassed.

Query:

1. Inspect `dify.knowledge_fs.control_spaces` for `provisioning`, `deleting`, and `error`, then use
   `dify.knowledge_fs.control_space_state_duration` and lifecycle task status to find aging work.
   The gauge is the same global database snapshot from every API process: filter on
   `aggregation_scope=global_database_snapshot` and aggregate process/replica series with `max` by
   `state`, never `sum`.
2. Run `dry-run --tenant-id <workspace>` and `status --tenant-id <workspace>`.
3. Run `orphan-report --limit <bounded-limit>`; it is read-only.
4. Compare the control-space registration, stable operation/idempotency key, KFS Space revision,
   and outbox status. Do not infer a missing remote Space from one timed-out request.

Containment: keep the affected control-space hidden or deleting, stop new lifecycle dispatch with
`KNOWLEDGE_FS_LIFECYCLE_WORKER_ENABLED=false` if the worker is causing repeated harm, and leave the
cleanup/reconciliation path available.

Rollback: before an irreversible remote deletion point, revert only the faulty code and replay the
same durable operation. After that point, never mark the Space active; complete deletion or restore
through an approved import process.

Repair: replay the durable outbox/reconciler. Use `repair` only after an authoritative KFS lookup
proves the exact Space ID and monotonic revision, with the current control-space resource version.
Re-run the read-only reports and verify the current-state gauge returns to baseline.

## 3. Product-summary degradation stays elevated

Impact: authorized lists/details may show `technical_status=unavailable`; visibility must not
expand and cached/outbox metadata must not be presented as authoritative KFS metadata.

Query:

1. Group `dify.knowledge_fs.batch_status_requests` and
   `dify.knowledge_fs.batch_status_latency` by `outcome`.
2. Compare returned versus missing counts in `dify.knowledge_fs.batch_status_spaces`.
3. Check KFS readiness, database/object-store/plugin-daemon component health, response bounds, and
   one authorized explicit-ID batch request.
4. If summaries are healthy but retrieval is degraded, group `knowledge_fs.retrieval.metric` by
   `mode`, `resolvedMode`, and `zeroResult`, then compare candidate/filter/result counts and
   `rerankMs` without adding query or resource labels.

Containment: keep Dify's authorization-first pagination active, reduce rollout percentage or stop
the affected operation, and return only the documented unavailable placeholder. Never fetch all
KFS spaces and filter afterward.

Rollback: roll back the product-summary client/server contract together when their schema changed;
otherwise roll back the unhealthy dependency without changing Dify visibility data.

Repair: restore the dependency, reconcile registration for only the missing explicit IDs, run the
contract-lock check, and verify an unauthorized ID is still omitted before clearing the alert.

## 4. Upload orphan sessions or objects grow

Impact: quota remains reserved, multipart storage accumulates, or an uploaded object is not linked
to exactly one compilation job.

Query:

1. Group KFS `knowledge_fs.upload_session.metric` events by bounded `status` and `mode`; compare
   created, completed, aborted, expired, `checksum_failure`, and byte totals.
2. Use the approved read-only database console to count nonterminal `upload_sessions` past
   `expires_at`, grouped only by status. Compare with the object-store incomplete-multipart
   inventory and configured lifecycle age.
3. Inspect one session through its tenant + Space ownership and fixed object key; never log the
   presigned URL or checksum value.

Containment: set `KNOWLEDGE_DIRECT_UPLOAD_ENABLED=off` to stop new sessions. Keep complete/abort and
the bounded cleanup worker available for already issued sessions until their TTL expires.

Rollback: return small files to the explicit bounded BFF fallback; large files remain unavailable.
Do not silently proxy large bodies through Dify or KFS memory.

Repair: restore the cleanup worker and bucket incomplete-multipart lifecycle, run one bounded cleanup
tick, reconcile quota reservations, and retry complete only with the original idempotency key.
Object deletion requires ownership proof and the normal cleanup ledger.

## 5. SSE has no terminal event or active connections leak

Impact: clients reconnect indefinitely, resources remain held, or users see ambiguous Research
task completion.

Query:

1. Group KFS direct-stream open/close events by initial/reconnect and bounded close reason; compare
   active connections, terminal closes, timeout, error, `permission_revoked`, disconnect, and limit.
2. Check task state and cursor event history through the authorized BFF. Confirm the client did not
   put a token in the URL and that the configured exact origin still matches.
3. Correlate with `trace_id` and task status without adding task IDs as metric labels.

Containment: set `KNOWLEDGE_DIRECT_STREAM_ENABLED=off` for new connections, let existing bounded
connections terminate, and use the BFF/non-streaming status path. Revoke an unsafe task through the
durable revoke flow rather than killing database rows.

Rollback: roll back the direct-stream/client release together or keep streaming disabled. Do not
fall back to EventSource/query-string tokens.

Repair: fix cursor persistence, heartbeat/timeout, terminal ownership, or reader/iterator cleanup;
then test disconnect, reconnect, revoke, timeout, and exactly-one logical terminal before enabling
new connections.

## 6. Durable deletion is stuck at or after an irreversible phase

Impact: a tombstoned Space remains partially present, with tasks, derived rows, or objects awaiting
safe cleanup. It must never be reactivated after the irreversible fence.

Query:

1. On Dify, group `dify.knowledge_fs.lifecycle_tasks` with `operation=delete` by `status`, and inspect
   delete transition dwell time. `knowledge_fs.durable_task.metric` intentionally covers Research
   and document compilation only and is not a deletion-job signal.
2. Treat the KFS `deletion_jobs` ledger as authoritative. Through approved read-only tooling,
   inspect its checkpoint, run state, retry time, lease, item/outbox progress, tombstone, and
   publication fence.
3. On the Dify side run `dry-run --tenant-id <workspace>` and inspect the lifecycle operation ID.

Containment: stop new product traffic and new destructive work for the affected Space, pause the
faulty consumer if it is making progress unsafe, and preserve all rows/objects. Keep tombstone and
publication fences active.

Rollback: before the irreversible fence, replay or roll back the code while retaining the job. At
or after the fence, rollback means stopping traffic and rolling forward the same deletion ledger;
it never means clearing the tombstone or restoring legacy ACL.

Repair: correct the dependency, reconcile an expired lease only after proving the old worker is
stopped, and retry through the durable deletion API/operator path. Verify the repository's bounded
residue probes before accepting terminal completion.

## 7. Shadow authorization diff is nonzero

Impact: cutover could expand or unexpectedly remove access. No affected Workspace may enter P8B
while an unexplained diff remains.

Query:

1. Run `status --tenant-id <workspace>` and `legacy-check --tenant-id <workspace>`.
2. In the old-authority window, feed the bounded observations to `shadow-report` without `--apply`
   first. Inspect unresolved, expanded-access, and quarantined-subject counts.
3. Verify membership, Space ACL, external-access, credential, content-policy, and final-delta
   revision watermarks against the freeze/change-capture evidence.

Containment: do not sign new product traffic for that Workspace, do not run `cutover`, and keep the
old ACL write window frozen or change capture active according to the approved migration method.

Rollback: before P8B, discard/rebuild the additive backfill and remain on the old authority. After
P8B, never read the stale ACL; stop Dify product traffic and roll forward the Dify-owned decision.

Repair: fix the Dify registration or permission mapping, quarantine unknown principals, replay the
final delta, and rerun shadow. Only an approved fail-closed tightening may be recorded with
`shadow-approve`; expanded access must be resolved, not waived.

## Closeout evidence

For every alert, attach the bounded metric/query result, affected deployment and Workspace scope,
containment timestamp, command dry-run output, regression/smoke result, and the reason traffic was
restored. Production exercises must also prove notification routing, threshold tuning, dashboard
links, owner acknowledgement, and recovery timing; repository tests cannot substitute for those
environment-specific checks.
