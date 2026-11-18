# Guest Connection inactivity cleanup

Guest Connections have a separate inactivity policy. Creating a Connection,
successfully updating it (including a rename), completing an OAuth reauthorization,
and dispatching a tool with the selected Guest credential advance `last_active_at`.
Listing Connections, reading configuration, saving choices, credential checks,
preflight and automatic OAuth refresh do not advance it. Resolving a tool runtime
without invoking the tool also does not count. A dispatch attempt counts even if
the tool later fails at the Provider.

Only Connections still owned by an App-scoped browser EndUser without an Account
are eligible. Service API identities, unresolvable owners, and Account-owned
Connections (including successfully claimed Connections) are not swept. Crossing
the inactivity cutoff makes a Connection eligible for the next sweep; it does not
immediately hide it or prevent use or Claim before cleanup commits.

The sweep and Claim share the EndUser lock. The sweep rechecks ownership and
activity under a Connection row lock, then deletes the row and live App defaults
and Session selections in one transaction. Whichever operation commits first
wins: a successful Claim prevents any later expiry or revocation, and a committed
expiry cannot be claimed. No replacement Connection is selected. Run history and
its fixed selection IDs are untouched; a later attempt to dispatch with a deleted
ID fails instead of resolving a new default.

For OAuth, that transaction saves only the encrypted grant and its original Client
and plugin artifact references in a revocation job. The worker calls the Provider
only after committing a short job lease. Unsupported, failed and unavailable
revocations are logged and retire the job without restoring the Connection. A worker
interrupted before settling the job can be retried after its five-minute lease;
this may repeat a revoke request for the already-deleted grant. Cleanup logs contain
Connection IDs and normalized outcomes, never credentials or provider error text.

API keys are deleted locally without calling the Provider. If the Connection
response has `manual_revocation_required_on_expiry: true`, callers can explain
before expiry that the key must be revoked directly at the Provider to invalidate
it. This field is advisory and does not mean cleanup has run or is enabled.

## Deployment

Apply database migrations and deploy the activity writers to all API and worker
processes before enabling the task. Older Connections retain their recorded
`last_active_at` (old versions did not record renames or dispatch), so review the
initial cutoff before enabling cleanup on an existing deployment.

| Setting | Default | Purpose |
| --- | --- | --- |
| `ENABLE_GUEST_CONNECTION_CLEANUP_TASK` | `false` | Opt in on Beat and workers after deployment. |
| `GUEST_CONNECTION_INACTIVITY_DAYS` | `30` | Time since the last qualifying activity; the sweep uses a strict cutoff in UTC. |
| `GUEST_CONNECTION_CLEANUP_INTERVAL_MINUTES` | `5` | Interval between sweeps. |
| `GUEST_CONNECTION_CLEANUP_BATCH_SIZE` | `100` | Page size for candidate and revocation-job scans. Each deletion is its own transaction. |

Workers with custom queue lists must subscribe to `retention`. A failed row does
not block later pages; the next sweep retries rows that are still eligible.
Disabling the task pauses both expiry and pending revocation delivery. Drain pending
revocations before downgrading; downgrade discards any remaining jobs and does not
restore deleted Connections.
