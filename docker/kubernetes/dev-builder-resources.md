# Dev API resource profile

`dev-builder-resources.yaml` records the reviewed four-role memory profile
for ENG-1311 in the Dify repository. It is an environment-specific Helm values
overlay, not a general default or evidence that the current Helm release uses it.
The API affinity is also consumed by the WebSocket chart template.

The worker reservation is 2 GiB, above its observed 1.63 GiB working-set peak;
the 3 GiB limit leaves room for initialization and task execution. Other
reservations cover observed steady-state usage. API's existing 2 GiB limit is
preserved, not certified as sufficient for arbitrary load. Requests improve
scheduling and eviction priority; they do not reduce actual memory usage.
Preferred anti-affinity encourages distributing these four roles and does not
guarantee placement or capacity. No CPU limit is introduced.

## Applying the profile

1. Capture current Deployment UID, full template, replica count, referenced
   configuration hashes and images for the four named roles. Record the database
   schema and existing unknown operation identities without reading arguments or
   credential values. Check all-namespace Pod requests, init containers, taints,
   architecture, readiness, actual memory use and placement capacity.
2. Derive candidate templates from the captured live templates. Change only the
   target container's resources and the reviewed affinity. Reject any other
   structural difference. Preserve existing unrelated affinity restrictions.
3. Require a quiet Builder and worker, stop API/WebSocket/Beat producers, close
   the exact main worker queue definitions with individually acknowledged
   consumer controls, and drain active/reserved/scheduled/unacked work. Do not
   clear broker queues or replay unknown operations.
4. Stop the drained worker. With all four roles at zero, apply each candidate
   through JSON Patch tests of Deployment UID, complete old template and replica
   count. Server dry-run must pass first. Do not use a rolling surge on a
   memory-constrained node.
5. Start worker, WebSocket, API and Beat serially. At each step verify capacity,
   one Ready replacement, unchanged image/configuration, worker registered tasks
   and exact queue definitions. If scheduling or acknowledgement is unknown,
   inspect state before taking another action; do not blindly repeat mutations.
6. Verify `/health`, role source identity, no new OOM/eviction, ordinary queue
   operation, unchanged schema and historical unknown identities. Keep raw
   manifests and queue/task details private; publish only sanitized evidence.

Rollback uses the same admission/drain and UID/template checks and restores
only the captured resources/affinity. It does not roll back images or schema.

## Persistence boundary

The known Dev Helm record differs from approved live images and plugin
configuration. A full `helm upgrade --reuse-values` can restore those stale
values and is not a safe way to apply this resource fix. Reconcile the intended
release baseline and include this overlay before a future full Helm upgrade;
render and compare the complete release, preserving Trigger Worker image
fallback and unrelated deployments. A resource-only live patch is an operational
mitigation until that desired-state integration is complete. Keep ENG-1311 open
for that integration and representative load observations.
