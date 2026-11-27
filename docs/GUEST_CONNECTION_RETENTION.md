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

For OAuth, the sweep captures the grant's encrypted credentials and its original
Client and plugin artifact references inside the deleting transaction, then
attempts best-effort revocation after that transaction commits. Unsupported,
failed and unavailable outcomes are logged and never retry the Provider or restore
the Connection. A worker interrupted between the commit and the attempt loses only
that attempt; the Connection stays deleted and a later sweep does not repeat or
resurrect it. Cleanup logs contain Connection IDs and credential types, never
credentials or provider error text.

API keys are deleted locally without calling the Provider. If the Connection
response has `manual_revocation_required_on_expiry: true`, callers can explain
before expiry that the key must be revoked directly at the Provider to invalidate
it. This field is advisory and does not mean cleanup has run or is enabled.

## Deployment

Deploy the activity writers to all API and worker processes before enabling the
task; no schema change is required. Older Connections retain their recorded
`last_active_at` (old versions did not record renames or dispatch), so review the
initial cutoff before enabling cleanup on an existing deployment.

| Setting | Default | Purpose |
| --- | --- | --- |
| `ENABLE_GUEST_CONNECTION_CLEANUP_TASK` | `false` | Opt in on Beat and workers after deployment. |
| `GUEST_CONNECTION_INACTIVITY_DAYS` | `30` | Time since the last qualifying activity; the sweep uses a strict cutoff in UTC. |
| `GUEST_CONNECTION_CLEANUP_INTERVAL_MINUTES` | `60` | Interval between sweeps. |
| `GUEST_CONNECTION_CLEANUP_BATCH_SIZE` | `100` | Page size for candidate scans. Each deletion is its own transaction. |

Workers with custom queue lists must subscribe to `retention`. A failed row does
not block later pages; the next sweep retries rows that are still eligible.
Disabling the task pauses expiry, and a downgrade never restores deleted Connections.
