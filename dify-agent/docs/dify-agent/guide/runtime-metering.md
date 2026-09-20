# E2B runtime metering

Sandbox usage is independent of LLM tokens and message latency. One ledger row
represents one E2B `sandboxExecutionId`, from start/resume to pause/kill.
Repeated connects, retries, file access and overlapping leases must not multiply
the same execution's metered duration.

## Ownership and data flow

The Dify API owns `agent_sandbox_usage_events` and `agent_sandbox_executions`.
The agent backend has no SQL connection. It observes control-plane operations,
directly awaits the inner API once for each diagnostic event, and polls the E2B
lifecycle API with its existing project key. The authenticated Dify inner API
commits events and projects provider execution usage atomically.

Before creating a binding, the API independently commits an allocation owner
snapshot. `allocation_id` is the already allocated binding UUID; there is no
new create-binding request field. The E2B adapter includes this ID in sandbox
metadata. Accounting evidence survives the caller's business transaction rolling
back or the business resource being deleted. Existing bindings are registered on
their next verified lookup, without importing their historical usage.

Physical identity is `(provider, provider_project_id, provider_execution_id)`.
Environments have separate databases, so neither table has an environment field.
The project setting is also an ingestion allowlist, not a credential.

## Configuration and activation

Apply the database migrations before enabling metering. Configure every Dify API
or worker process that creates or resolves Agent bindings:

```dotenv
AGENT_SANDBOX_METERING_ENABLED=true
AGENT_SANDBOX_METERING_PROJECT_ID=<E2B project/team ID>
AGENT_SANDBOX_METERING_START_AT=<whole-second UTC instant, e.g. 2026-10-01T00:00:00Z>
```

Configure the agent backend:

```dotenv
DIFY_AGENT_SANDBOX_METERING_ENABLED=true
DIFY_AGENT_E2B_PROJECT_ID=<same E2B project/team ID>
DIFY_AGENT_SANDBOX_METERING_POLL_INTERVAL_SECONDS=60
DIFY_AGENT_SANDBOX_METERING_OVERLAP_SECONDS=900
DIFY_AGENT_SANDBOX_METERING_FULL_SCAN_INTERVAL_SECONDS=3600
DIFY_AGENT_SANDBOX_METERING_MAX_PAGES=1000
```

The backend must use `DIFY_AGENT_RUNTIME_BACKEND=e2b` and already have its E2B
key, inner API URL and inner API key configured. Do not copy the E2B key into
the API or into either usage table. The backend validates its settings at startup.
Both feature flags default to false.

The API persists T0 and rejects changing it after activation. Restarts must not
reset the lower bound. Only executions whose provider start time is at or after
T0 are metered; an execution that began earlier is excluded even if its terminal
event arrives later. A previously existing sandbox resumed after T0 produces a
new execution and is included. There is no historical backfill.

`GET /inner/api/agent/sandbox-usage/state?project_id=...` reports activation and
completed scans. `POST /inner/api/agent/sandbox-usage/events` accepts at most 100
events and acknowledges only a committed batch. Both use `agent_inner_api_only`
and `X-Inner-Api-Key`.

## Failure semantics

- Only E2B terminal execution data populates `metered_duration_ms`; a local
  `finally`, RPC duration or SDK expiration deadline is never a billing clock.
- A start/resume can create a pending execution without completed usage. A late
  start cannot reopen a metered execution. Missing terminal fields remain
  unresolved rather than becoming zero usage.
- Provider event IDs deduplicate repeated delivery. Conflicting facts are
  retained and flagged; duplicate durations are never added together.
- Each operation observation directly awaits one inner API request with a
  one-second overall deadline and a 64 KiB event limit. There is no operation-log
  queue, background sender, batch buffer, shutdown drain, persistent outbox or
  delivery retry. HTTP errors, timeout, invalid payloads and invalid ACKs produce
  a warning containing only the error class, then normal business work continues.
- This reporting adds a short wait to the calling operation: requested and
  observed events can add up to roughly two seconds per lifecycle attempt if the
  API is unresponsive. Waits while the sandbox is running are part of its actual
  provider-metered lifetime. Cancellation or process exit can lose observations.
- Business cancellation propagates. Reporting is skipped when the current task
  is already cancelling, so optional diagnostics do not delay cancellation
  cleanup or clear its cancellation count. E2B callers keep the created or
  connected handle before awaiting result reporting, and still attempt required
  pause/kill if cancellation arrives during its request observation.
- Provider execution events and independently registered allocation ownership
  remain the metering inputs. Local RPC/reporting duration is never used as a
  replacement for provider execution time.
- Pollers share a project-scoped renewable Redis leader lease. Lease loss cancels
  an in-progress scan. Database idempotency remains the final duplicate defense.
- Every scan restarts provider offset pagination from zero and overlaps prior
  coverage. A bounded or failed scan never commits a checkpoint. Periodic full
  scans remain limited by T0 and the provider retention window.
- E2B's documented default event retention is seven days. A larger ingestion gap
  is recorded and logged; the service cannot reconstruct events already removed
  by E2B. This is not silently reported as complete coverage.
- Resource cleanup and lifecycle concurrency behavior are unchanged. Metering
  does not itself kill or pause resources while reconciling them.

## Querying usage

For fully covered, closed `quality='metered'` executions:

```text
sandbox_hours = sum(metered_duration_ms) / 3600000
vcpu_hours = sum(metered_duration_ms * vcpu_count) / 3600000
ram_gib_hours = sum(metered_duration_ms * memory_mib) / (3600000 * 1024)
```

Use each execution's resource snapshot. Report pending/conflicting/unattributed
records separately. For arbitrary UTC windows, clip each execution to `[A, B)`;
the derived bucketing end is `started_at + metered_duration_ms`. E2B start time
may have second precision, while its duration is milliseconds, so cross-boundary
allocation is not claimed to be millisecond-accurate. Splitting a complete
execution across windows must conserve its original duration.

## Rollout checks

1. Validate provider events access and the configured project with the backend's
   existing key without logging it.
2. Run migrations with metering disabled, then restart the relevant API/worker
   and backend processes with a fixed T0.
3. Verify state, a completed checkpoint, direct operation reporting and the
   collector leader lease. Only the provider collector has a metering background
   task; there is no observation queue, sender task or outbox.
4. Exercise binding initialization, file list/read/download, snapshot creation
   and restoration, successful/failed/cancelled Agent runs and cleanup.
5. Compare the test allocations' ledger rows to their actual E2B execution
   events. Replay events and confirm totals do not increase.
6. Check late/missing terminal events, project rejection, start-time immutability,
   and partial-scan failures. Do not test faults by stopping shared services.
7. With an isolated observer and controlled HTTP endpoint, verify that reporting
   waits for one request, failure is not retried, the deadline is bounded, later
   observations still send, and cancellation propagates. Exercise cancellation
   around create/connect/pause/kill reporting without stopping shared services.

Upgrading from the outbox implementation does not migrate or replay its pending
operation logs. After the new image is running, an operator may remove only the
old `<redis-prefix>:sandbox-usage:<project-id>:outbox` key. Keep the collector
leader key and the existing Agent run-store keys. No new environment variable or
database migration is required for this delivery change.

Rollback by disabling the two feature flags and restarting affected processes.
Keep the accounting tables and the original T0; do not downgrade away collected
usage. Table retention is unchanged; no automatic deletion is enabled by this
implementation. Configuring a retention policy is a separate change.
