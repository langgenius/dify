# E2B runtime metering

One ledger row represents one E2B `sandboxExecutionId`, from start/resume to
pause/kill. Provider execution time and resource sizes determine compute usage;
LLM token usage, message latency and local SDK-call duration do not.

## Scheduled collection and boundaries

The Dify API's existing Celery Beat schedule dispatches
`schedule.collect_agent_sandbox_usage.collect_agent_sandbox_usage` every 60 seconds
by default, through the existing `ops_trace` worker queue. The job calls
`POST /internal/e2b/usage/collect` on the Agent backend using its existing Bearer
service token and a `project_id` body. The E2B key stays in the Agent backend.

The provider-specific endpoint performs one bounded scan, using request-scoped
HTTP clients. It reads E2B lifecycle events and posts them to the Dify API's
idempotent usage ingestion endpoint. It returns `{"completed": true}` only after
all scanned pages and the checkpoint have been acknowledged. Partial scans return
`completed=false`; provider/API errors fail this accounting request only.

There is no Agent-process polling loop, Redis leader election, log outbox,
observation worker, or requested/observed operation reporting. Generic leases,
Agent runs, files, snapshots and binding lookups do not participate in metering.
Their timing, cancellation handling and SDK retries retain their normal behavior.
Metering misconfiguration is checked when collection is invoked, rather than
becoming a prerequisite for business runtime startup or binding operations.

The endpoint has a 240-second deadline. The scheduled HTTP caller has a
260-second timeout, and the Celery task configures 270/300-second soft/hard limits.
Pool support differs: gevent workers do not implement soft time limits, and
blocking work cannot rely on their hard limit. The collection and HTTP deadlines
are the primary bounds; verify the deployed worker pool before relying on Celery
limits. See the [Celery time-limit documentation](https://docs.celeryq.dev/en/stable/userguide/workers.html#time-limits).
Scheduled messages expire after one collection interval to avoid stale backlog.
There is no automatic HTTP retry; future scheduled scans can redeliver provider
IDs safely. Overlapping tasks may duplicate reads, but cannot multiply usage.

## Data and attribution

The API owns `agent_sandbox_usage_events` and `agent_sandbox_executions`.
Ingestion persists provider facts and projects execution rows atomically; the
execution key is `(provider, provider_project_id, provider_execution_id)`.
A short project transaction lock protects ingestion. Binding creation/lookups do
not register allocations, write accounting rows or acquire that lock.
Steady-state usage-state reads do not take a project `FOR UPDATE` lock; activation
can be initialized once when first needed.

E2B's existing sandbox metadata contains binding, tenant, Agent and workspace
identifiers. During background ingestion, optional attribution checks those IDs
against the existing Binding → Workspace → App/Agent tenant-owned chain and the
physical sandbox reference. It never trusts labels alone. Missing, malformed or
already-deleted business records leave attribution unresolved while preserving
complete project-level provider usage. A previously verified ownership snapshot
survives later business deletion. Conflicting ownership is not silently reassigned.

No accounting callback or transaction is added to the business path. There is no
pre-create allocation journal. Older diagnostic/allocation columns and records
are not destructively migrated in this revision; new accounting accepts only
provider events and collector checkpoint/coverage-gap control records. Table
retention is unchanged, with no new automatic cleanup policy.

## Configuration

Apply the existing usage-table migration before first enabling metering.
Configure Dify API, Beat and the workers consuming `ops_trace` consistently:

```dotenv
AGENT_SANDBOX_METERING_ENABLED=true
AGENT_SANDBOX_METERING_PROJECT_ID=<E2B project/team ID>
AGENT_SANDBOX_METERING_START_AT=<whole-second UTC instant>
AGENT_SANDBOX_METERING_INTERVAL_SECONDS=60
```

The task reuses `AGENT_BACKEND_BASE_URL` and `AGENT_BACKEND_API_TOKEN`; the
existing SSRF-safe HTTP policy must permit that internal service. No E2B key is
copied into API or worker configuration.

Configure the Agent backend's one-shot endpoint:

```dotenv
DIFY_AGENT_SANDBOX_METERING_ENABLED=true
DIFY_AGENT_E2B_PROJECT_ID=<same E2B project/team ID>
DIFY_AGENT_SANDBOX_METERING_OVERLAP_SECONDS=900
DIFY_AGENT_SANDBOX_METERING_FULL_SCAN_INTERVAL_SECONDS=3600
DIFY_AGENT_SANDBOX_METERING_MAX_PAGES=1000
```

It reuses the existing E2B key, `DIFY_AGENT_API_TOKEN`, inner API URL and inner API
key. The new endpoint requires a nonempty Bearer-token configuration even when
legacy control-plane routes permit unauthenticated local development.
`DIFY_AGENT_SANDBOX_METERING_POLL_INTERVAL_SECONDS` is no longer used: the interval
belongs to Celery Beat on the API side. Both metering feature flags default off.

Activation T0 is persisted and immutable. Only provider executions started at or
after T0 are metered; starting before T0 and ending after it does not include an
old execution. Resuming an older sandbox after T0 creates a new execution and is
included. There is no historical backfill and no environment column; databases
separate environments. A project ID also scopes and allowlists ingestion.

## Failure semantics

- Only complete provider terminal execution data populates metered duration. A
  local `finally`, SDK expiry deadline or business success is not a billing clock.
- Missing terminal fields remain pending; conflicts remain visible. Late starts
  cannot reopen closed executions, and duplicate facts do not add duration twice.
- Every scan starts provider offset pagination from zero, overlaps prior coverage
  and periodically rescans the retained window. Failed, cancelled or page-bounded
  scans never claim a completed checkpoint. SQL idempotency protects redelivery.
- The assumed default provider event retention is seven days. Older uncovered
  intervals are recorded as gaps rather than reconstructed or counted as zero.
- A failed scheduled task affects accounting only. No accounting network request
  is added to create/connect/pause/kill, lease helpers, runner or file operations.

The API's private ingestion endpoints remain:
`GET /inner/api/agent/sandbox-usage/state?project_id=...` and
`POST /inner/api/agent/sandbox-usage/events`, authenticated with `X-Inner-Api-Key`.
Event batches are limited to 100 records and 1 MiB, acknowledged after commit.
They are for the isolated collector, not business-operation logging.

## Querying usage

For complete `quality='metered'` executions:

```text
sandbox_hours = sum(metered_duration_ms) / 3600000
vcpu_hours = sum(metered_duration_ms * vcpu_count) / 3600000
ram_gib_hours = sum(metered_duration_ms * memory_mib) / (3600000 * 1024)
```

Project totals include complete executions with unresolved attribution; report
that count separately. Tenant/app reports require verified resolved attribution.
For UTC windows `[A, B)`, clip execution intervals using start plus provider
duration. Start time can have second precision, so cross-boundary allocation is
not claimed to be millisecond-accurate; complete-window totals conserve duration.

## Rollout checks

1. Verify Beat's schedule, task registration and an existing worker consuming
   `ops_trace`, along with image revisions, flags, project and immutable T0.
2. Verify the authenticated one-shot endpoint, real scheduled execution and
   advancing checkpoints. The Agent must not start a metering poller or leader.
3. Keep a real business binding until collection resolves its owner, then retire
   it and confirm previously copied accounting remains. Also verify complete
   project usage for test sandboxes without business records.
4. Exercise model success/failure/cancellation, files/list/read/download/errors,
   snapshots/restoration and resource cleanup. Isolated bad accounting settings
   or failing accounting-service stubs must not make business lookups fail.
5. Compare physical execution IDs, duration and resources against actual E2B
   events; replay scans/events and confirm totals do not increase.
6. Verify old outbox and collector-leader keys are absent after deployment. Do
   not alter run-store keys or stop shared services to inject accounting faults.

Disable the metering flags and restart the relevant processes to stop collection;
business runtime behavior remains the same. Keep the ledger and original T0.
The independent stdout-only sandbox file-error fix is tracked separately from
this accounting integration.
