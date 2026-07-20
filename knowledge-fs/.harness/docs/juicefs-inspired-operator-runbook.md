# JuiceFS-Inspired KnowledgeFS Operator Runbook

> Created: 2026-05-27
> Scope: KnowledgeSpace control plane, repair diagnostics, cleanup, consistency, and cache policy.

## Daily Control-Plane Check

1. Read `GET /knowledge-spaces/{id}/manifest`.
2. Confirm `manifestVersion`, `storageProvider`, `objectKeyPrefix`, `parserPolicyVersion`, `projectionSetVersion`, quota policy, retention policy, and consistency policy match the intended environment.
3. Read `GET /knowledge-spaces/{id}/status`.
4. Confirm storage health, parser kind, index projection summaries, active sessions, active leases, and failed commit samples are bounded and expected.
5. Read `GET /knowledge-spaces/{id}/stats?windowMinutes=60`.
6. Confirm raw document bytes, document count, failed commit counts, active runtime samples, cache availability, and projection summaries are moving within expected ranges.

## Manifest

The KnowledgeSpace manifest is the operational control plane. Operators should treat object storage as the immutable data plane and the manifest as the source of truth for:

- object key prefix ownership;
- storage provider and metadata dialect;
- parser, node schema, and projection set versions;
- retention and quota policy;
- default consistency class and cache TTL policy.

Manifest reads are safe for humans and agents. Manifest writes should remain controlled by deployment or migration workflows because a manifest change can invalidate path caches, evidence caches, projection publication, and quota admission.

## Staged Commits

Staged commits describe recoverable write progress for document upload, artifact segment write, bulk reindex, and projection publish operations.

Use `GET /knowledge-spaces/{id}/staged-commits?limit=N&status=failed-retryable` for retryable failures and `status=failed-terminal` for terminal failures. Keep `limit` explicit. Use `nextCursor` for stable pagination.

When investigating a failed commit:

1. Record `id`, `idempotencyKey`, `operationType`, `status`, `errorCode`, `errorMessage`, `rawObjectKey`, `publishedObjectKey`, and `expiresAt`.
2. Check whether an active lease references the same staged commit or virtual path.
3. Prefer retrying through the original idempotency key when the failure is retryable.
4. Let GC handle expired terminal failures after the retention window.

## Active Sessions And Leases

Sessions identify active API, MCP, worker, and Admin clients. Leases identify active publish, delete, and reindex operations.

Use status summaries for a quick bounded sample, then use `GET /knowledge-spaces/{id}/leases/active?limit=N` when you need paginated active lease diagnostics.

Do not force cleanup while a matching active lease exists. Expired sessions and leases should be removed through the runtime cleanup worker with explicit limits.

## FSCK

FSCK is a read-only consistency diagnostic. It does not repair or delete data.

Use:

- `GET /knowledge-spaces/{id}/fsck?check=raw-objects` to detect missing raw objects, checksum mismatch, and size mismatch.
- `GET /knowledge-spaces/{id}/fsck?check=artifact-segments` to inspect parse artifact and segment object drift.
- `GET /knowledge-spaces/{id}/fsck?check=references` to inspect path, node, and projection references.

Review severity, repairability, target type, object key, document asset id, parse artifact id, and virtual path. Use `cursor` to continue bounded scans. Agents should use the MCP `knowledge.fsck` tool with strict output limits before attempting broader diagnosis.

## GC

GC must start with a dry-run.

Use `GET /knowledge-spaces/{id}/gc/staged-objects` to produce staged-object and expired failed-commit candidates. Review `dryRunId`, `summary`, `candidateType`, `estimatedBytes`, target object keys, and candidate `idempotencyKey`.

Mutation requires an explicit candidate idempotency key. From Admin, execute only candidates returned by a dry-run. From API automation, send only reviewed candidates to `POST /knowledge-spaces/{id}/gc/staged-objects/execute`.

If a candidate is skipped because of an active lease, leave it for a later dry-run after the lease is released or expired.

## Status And Stats

`status` answers "is this space healthy right now?" It should stay low latency and bounded.

`stats` answers "what changed in the selected time window?" It should stay low-cardinality and safe when metrics backends are unavailable.

Use both before and after cleanup, reindex, manifest changes, or projection publication. Capture the generated time, window, projection summaries, failed commit samples, and runtime sample counts in incident notes.

## Consistency

KnowledgeFS supports explicit consistency classes:

- `path-consistent`: default operator view for current published paths.
- `snapshot-consistent`: use when replaying or evaluating a pinned workspace state.
- `cache-consistent`: use only when cache policy permits stale-but-authorized reads.
- `eventual-preview`: use for preview or candidate data, not normal production retrieval.

Agents should pin a workspace snapshot fingerprint for multi-step work when reproducibility matters. MCP read commands and workspace replay accept `snapshotFingerprint` so later commands can stay tied to the same snapshot.

## Cache Policy

Cache keys must include tenant, KnowledgeSpace, permission snapshot, manifest version, command, path, target version, and projection fingerprint where relevant.

Use mount cache policy to decide TTL and no-cache behavior. Sensitive mounts should bypass caches. After manifest, permission, source, path, or projection publication changes, expect cache misses. Treat unexpected cache hits across any of those boundaries as a correctness issue.

## Incident Checklist

1. Capture manifest, status, and stats.
2. List failed staged commits and active leases with explicit limits.
3. Run fsck dry-runs for the relevant check class.
4. Review GC dry-run candidates without mutation.
5. Confirm no active lease protects the target.
6. Execute only reviewed GC candidates with explicit idempotency keys.
7. Re-read status and stats.
8. Record snapshot fingerprint, trace id, dry-run id, candidate idempotency keys, and operator identity.
