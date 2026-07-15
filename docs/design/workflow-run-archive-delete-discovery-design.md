# Workflow Run Archive Delete Discovery

## Status

Implemented for V2 archive bundles.

## Decision

`workflow_run_archive_bundles` is the only normal discovery catalog for V2 delete and restore. A maintenance run does
not enumerate R2 and does not create a checkpoint table.

The catalog stores the immutable bundle identity:

```text
tenant_id, year, month, shard, bundle_id
```

The maintenance service deterministically derives:

```text
workflow-runs/v2/
  tenant_prefix={tenant_id[0].lower()}/
  tenant_id={tenant_id}/
  year={year:04d}/
  month={month:02d}/
  shard={shard}/
  bundle={bundle_id}/
  manifest.json
```

The manifest and Parquet files remain the recoverable content source of truth. The catalog supplies only a bounded
candidate list and the identity used to locate each bundle.

## Batch Contract

V2 commands select a complete UTC month:

```text
flask delete-archived-workflow-runs --target-month YYYY-MM --limit N
flask restore-workflow-runs --target-month YYYY-MM --limit N
```

The caller can resume a successful batch with the returned external cursor:

```text
--after-catalog-id <next_catalog_id>
```

The cursor is scoped to the operation, target month, and optional tenant set. It must not be reused across those
scopes. Delete normally receives its `M-1` month from the external scheduler; archive/backfill keeps its own window
and cursor policy.

Each run issues one keyset query:

```sql
SELECT ...
FROM workflow_run_archive_bundles
WHERE year = :year
  AND month = :month
  AND id > :after_catalog_id -- when supplied
ORDER BY id ASC
LIMIT :limit;
```

The optional tenant filter is applied in the same query. `(year, month, id)` supports the all-tenant case; the
existing `(tenant_id, year, month)` index remains for tenant-scoped readers.

`limit` bounds catalog candidates before any R2 I/O. A candidate performs deterministic GET requests only; normal
delete/restore has zero R2 LIST calls.

## Cursor and Failure Rules

- Commands process candidates serially and stop at the first failure.
- `next_catalog_id` advances only after a candidate is successfully handled, including a terminal marker skip.
- A failed candidate returns a non-zero command status and is not passed by the cursor.
- Dry-runs emit `preview_next_catalog_id` instead. It is informational and must not be persisted for a destructive
  run.
- V2 delete rejects `--skip-bad-archives`; continuing beyond a failure would make the stateless cursor unsafe.

No application-side campaign, lease, generation, or checkpoint state is introduced. Scheduler persistence is outside
this service.

## Validation and Idempotency

Before a destructive operation, the service validates the catalog identity against the manifest, then preserves the
existing manifest, Parquet size/checksum/row-count, and live-data checks.

- A catalog/manifest/path mismatch, missing object, or storage error fails closed.
- Only explicit object-not-found responses are treated as missing; authorization, throttling, and network failures are
  errors.
- Existing `.deleted` markers are successful terminal skips for delete after live rows are confirmed absent.
- Missing `.deleted` markers are successful terminal skips for restore.

Existing marker files remain the cross-system idempotency mechanism. Delete and restore are separate operations and
must be scheduled serially for the same scope.

## Archive and Backfill Boundary

Historical archive bundles and their catalog backfill are a rollout precondition. This change does not rerun archive,
backfill, or rewrite historical R2 objects.

For future bundles, archive success requires the catalog upsert to commit. The archive path commits that catalog row
before publishing the shard idempotency index. When a known manifest already exists, retry reconciles that one manifest
key and fails the archive attempt if catalog publication fails. It does not re-scan or re-publish the whole historical
shard.
