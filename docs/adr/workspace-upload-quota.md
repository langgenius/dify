# Workspace quotas for end-user uploads

Status: proposed for upstream review. Refs #38515. Maintainers have not approved this design.

## Scope and invariants

Self-hosted operators may opt into a byte limit and/or a file-count limit, applied independently to each workspace. Zero disables that dimension; both zero preserve unlimited accumulation. Cloud billing entitlements are separate. This first change does not implement retention, delete referenced files, add a management UI, or close the entire issue.

Count persisted `upload_files` created by end users, including historical rows, local and remote API/Web/Human Input uploads, regardless of `used`. Account/dataset-key uploads, tool-produced files, externally referenced URLs, and physical objects without metadata are outside this policy. Historical `end-user` and current `end_user` role spellings both count. Internal workflow execution offloads are excluded by a persistent `purpose` field: new internal writes set `workflow_offload`; the migration marks existing files using same-tenant offload links. Classification does not change when a cleanup later deletes a link. Unclassified historical orphan records count conservatively. The trusted internal source marker is not accepted by public upload gateways. Reusing an upload ID does not consume additional quota.

Workspace and creator come from admitted identities, never multipart form fields. Check the end-user/workspace/application owner chain before creating a reservation. Existing callers that explicitly supply a different end-user workspace are rejected. Migrate the end-user upload use case into a pure application service and repository; the legacy staff/knowledge upload use case remains separate. The identity gateway maps legacy admitted models to plain inputs and selects the staff capability, without retaining a second end-user persistence path.

Admission must commit before writing an object. A rejected request creates neither an object nor an upload record. Committed uploads plus durable reservations must fit both enabled limits. Reservations and finalization serialize on the workspace row with a no-op UPDATE in short transactions; storage I/O never runs in those transactions. Aggregate reads start after acquiring the lock, including at MySQL REPEATABLE READ. All workers must run the same policy and implementation; drain writers before enabling/changing configuration or downgrading.

## Accounting and lifecycle

Use exact COUNT/SUM over current tenant-scoped metadata and pending reservations, not the cloud billing service, Redis TTLs, or a counter that existing deletion paths can leave stale. A covering index on tenant, creator role, purpose and size replaces the tenant-only index. This avoids a separate usage-counter backfill and immediately reflects metadata deletions, but each admission scans that workspace's end-user index entries. Large-workspace throughput needs upstream performance review; this design prioritizes correctness and does not claim constant-time admission.

An admitted upload has one generated ID, key, size, checksum, and immutable metadata. Store these in a durable reservation before object I/O. On success, insert `UploadFile` and remove the reservation in the same locked transaction. Finalization is idempotent and validates immutable identity. A failed/uncertain storage call or DB commit keeps the reservation: an exception does not prove no side effect occurred. Never blindly retry storage writes, release by timeout, or delete an object after an uncertain commit.

A bounded, tenant-scoped recovery command defaults to dry-run and supports selecting an individual reservation ID so unresolved early entries cannot starve later recovery. With explicit apply, a complete object with the expected length/checksum can be finalized idempotently, even if the original writer is still finishing. Missing objects remain reserved unless the operator explicitly attests that all upload writers are stopped. Recheck missing-object reservations under the workspace lock before releasing. Mismatching objects remain reserved for operator investigation; the command never deletes objects or committed uploads. Recovery uses the current storage backend only and refuses reservations for a different backend. Never run orphan cleanup against in-flight upload keys. No automated TTL release is introduced.

Reservations are capacity reservations, not evidence of API delivery. A recovered upload may have committed despite a failed HTTP response; clients must not assume retrying creates no additional file. The existing upload API has no idempotency key, and this change does not invent one.

## Compatibility and validation

Defaults leave quotas off. Existing per-file extension/size checks and response fields stay intact. Quota rejection is a documented 413 `file_too_large` response, with a workspace-quota-specific message, avoiding a new public error schema. Do not expose enforcement configuration through public system features.

The additive reservation table, stable purpose classification/backfill and portable index migration support PostgreSQL/MySQL. The historical offload classification backfill runs during a maintenance window with writers drained. New models inherit `TypeBase`. Repository tests use real SQLite sessions and substitute only external storage. Check exact thresholds, historical usage, owner scoping, two tenants, failed writes, uncertain commits, idempotent finalization, and recovery. PostgreSQL/MySQL concurrent admission and finalization belong to CI-owned integration tests; SQLite results do not prove production locking behavior. Record actual test results separately from this proposed design.
