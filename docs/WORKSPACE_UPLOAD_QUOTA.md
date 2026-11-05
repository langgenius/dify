# Workspace upload quotas (self-hosted)

Set `WORKSPACE_UPLOAD_QUOTA_BYTES` and/or `WORKSPACE_UPLOAD_QUOTA_FILES` to positive integers to limit accumulated end-user uploads in each workspace. Both default to zero (disabled). These settings do not change Cloud billing entitlements. Existing per-file limits still apply.

Stop and drain all upload writers before applying the purpose-classification migration, then configure the same values in every API/worker process that can upload files. Restart them together. Example: `WORKSPACE_UPLOAD_QUOTA_BYTES=10737418240` and `WORKSPACE_UPLOAD_QUOTA_FILES=10000` permit at most 10 GiB and 10,000 files per workspace, including pending reservations. Optional environment examples are in `docker/envs/core-services/upload-quota.env.example`; copy them into the applicable service environment files, not just one API process.

Counts include historical `upload_files` rows owned by end users, including local/remote API, Web and Human Input uploads. Account/knowledge/dataset-key uploads, tool-produced files and internal workflow execution offloads are excluded. Offload purpose is stored durably; the migration classifies historical files from same-tenant application/offload references. Unclassified old orphan rows count conservatively. Reusing a stored upload ID adds no usage. The `used` flag is not a reliable reference indicator and does not affect quota. Removing a metadata row reduces the next admission's usage; object deletion alone does not. This policy controls metadata-backed end-user uploads, not every byte on disk or historical orphan objects.

Uploads that would exceed either enabled limit receive the existing HTTP 413 `file_too_large` error with a workspace-quota message before an object is written. Existing files remain readable when limits are lowered below current usage. No retention policy or automatic deletion of referenced files is introduced.

## Failed uploads and recovery

An upload reserves capacity durably before object storage I/O. It settles that reservation atomically with its metadata insert. Storage or DB errors may occur after a side effect, so reservations are **not automatically released by failure responses or elapsed time**. Retrying an HTTP upload may create another file; the existing API does not have an idempotency-key contract.

Inspect at most 100 reservations for a workspace (default dry-run):

```bash
uv run --project api flask recover-upload-quota --tenant-id <workspace-uuid>
```

Add `--apply` to finalize objects whose bytes and checksum match the original reservation. This never rewrites storage objects. A missing object stays reserved. A checksum mismatch or a changed storage backend also stays reserved and requires operator investigation. Permission/network errors fail the command; they are not treated as absence. The command does not delete any objects or committed uploads.

To release missing-object reservations, first stop and drain **all** upload writers, including queued and remote/Human Input work. Then run with `--apply --release-missing --writers-stopped`. The flag attests to an operational precondition; it does not stop processes for you. Never release missing objects while a delayed writer can still create them. Do not run orphan-object cleanup on active reservation keys. Repeat bounded batches as needed. If early entries remain unresolved, select a later known ID with `--reservation-id <upload-uuid>`; the query still requires the selected workspace, so early missing/mismatched entries do not block recovery of later objects. Recover all reservations and drain writers before downgrading; the online downgrade refuses to discard unresolved reservations.

## Performance and deployment limits

Each admission scans the workspace's end-user entries in a covering index and pending reservations under a short workspace-row lock. It does not hold a transaction during storage I/O, and needs no historical counter backfill. This exact accounting reflects existing deletion paths, but admission is not constant-time for workspaces with millions of files. Benchmark the target database/workload before production rollout. PostgreSQL/MySQL concurrency checks run in the repository's CI-owned integration suite; SQLite unit tests do not establish production lock behavior.

The design and alternatives are recorded in [the ADR](adr/workspace-upload-quota.md). This is the quota portion of #38515; retention and administration UI remain separate work.
