# External Agents (BYOA) backend

Implementation of [DIFY-3025](https://linear.app/dify/issue/DIFY-3025/byoa-后端), following the
[frozen backend design](https://langgenius.feishu.cn/wiki/Wu0swoWfriGEoQkPyDTcN3Sfnyf).
This document describes the code and operational contract. Deployment and end-to-end acceptance must be recorded
separately for the image actually tested.

Execution supports Workflow, Chatflow, Loop and Iteration frames. Cross-App Workflow-as-Tool delegation returns
`unsupported_profile` before dispatch; it requires a separate trusted root-App/source-Workflow ownership contract.

## Layers and persistence

`services/external_agents` contains application services, typed records and ports. It does not import ORM models,
Flask, Celery, deployment configuration or provider implementations. `repositories/external_agents` implements SQL
ownership, transactions, leases and fences; `providers/a2a` implements the A2A transport. Controllers validate Console
requests and present response models. `extensions/application_services/external_agents.py` is the composition root.

The feature migration creates 17 tables. These are independent records with explicit owner checks; deleting an asset
does not cascade into historical App runs.

| Tables | Responsibility |
| --- | --- |
| `external_agent_heads`, `external_agent_connection_revisions` | Mutable asset head and immutable, verified connection identity; encrypted credentials are reclaimable independently of history. |
| `external_agent_verifications`, `external_agent_operations` | Short-lived Verify evidence and idempotent management operation receipts. |
| `external_agent_invocations`, `external_agent_commands` | One row per business dispatch attempt and durable, fenced send/query/cancel/wake intents. Polling does not create Calls. |
| `external_agent_context_slots`, `external_workflow_budgets` | Scoped Busy/Unresolved identity and durable logical run deadlines. Log expiration alone does not unlock a remote task. |
| `external_agent_file_leases` | Temporary-copy ownership, shared references, upload write intents and retryable storage cleanup. |
| `external_agent_trace_records`, `external_agent_trace_receipts`, `external_agent_trace_steps` | Nullable internal Trace read model, bounded deduplication receipts and sanitized steps. |
| `external_agent_trace_usage_summaries` | Proven call-level usage and its revision; zero is known usage, null is unreported. |
| `external_agent_tracing_configs`, `external_agent_trace_targets`, `external_agent_trace_deliveries` | Asset-owned provider configuration, dispatch-time target/policy snapshots and immutable payload-revision export intents. |
| `external_agent_data_tombstones` | Parent deletion fences preventing late callbacks, materialization and export from reviving removed data. |

Existing `workflow_agent_node_bindings` gains `binding_epoch`, `external_job_config` and `original_reference`.
The native workflow log and App permission structures remain the source of caller identity and visibility.

## Protocol, runtime and recovery

The initial profile is A2A 1.0 HTTP+JSON with None/Bearer authentication. Verify reads the Card and permitted
capability evidence; it never sends a business request. Initial SSE consumption is bounded; known Tasks subsequently
use GetTask. There is no generic automatic business POST retry. A message-only response is a valid call result.
Cancel-and-retry creates a new Invocation only after an authoritative canceled state; command redelivery cannot
replay a previously admitted business send.

`local_wait_state`, remote task state, cancel outcome, Trace, usage and exporter acknowledgement are separate facts.
An unknown submission without a Task ID stays unknown. A stopped local wait does not establish remote completion.
Context reservation includes tenant, App, conversation, logical node, binding epoch, asset, connection revision and
execution frame. Rebinding creates a new epoch, including A → B → A. Overview tests use a separate context.

The Caller node pauses with an identity-only external wait reason. Its durable wake command completes only after the
exact Caller node execution or its run is terminal. Publishing uses a 120-second publication lease and is retried from
SQL; a wake arriving before the checkpoint is visible remains recoverable. The existing native resume path claims a
run with a SQL CAS before execution and has no general resume lease. If a process disappears after that claim, this
implementation does not replay the old checkpoint and its native side effects. It checks until the original logical
deadline, then fails the Run/Caller and requests stop. Invocation history remains available. This is a safe failure
path, not an exactly-once guarantee for the complete workflow graph.

## Queues and feature flag

`EXTERNAL_AGENTS_ENABLED` defaults to `false` and controls admission. Disabling it rejects new starts, new business
Send operations and retry dispatches. Already admitted poll/cancel/deadline/wake/reconcile operations, trace exports
and cleanup continue, so a feature switch cannot freeze the logical deadline or strand existing work.

| Work | Queue and recovery |
| --- | --- |
| Durable command scan | Always scheduled on `retention`; once per second while enabled, every five seconds while disabled. It publishes admitted commands to `EXTERNAL_AGENTS_QUEUE` (default `external_agents`). |
| Send/GetTask/Cancel/Wake | Dedicated prefork external-agent workers, default concurrency 4 and prefetch 1; SQL command and query leases fence redelivery. |
| Maintenance | Existing `retention` queue, every 60 seconds by default, including when the feature is disabled. Runs bounded GC before scheduling exports. |
| Third-party trace delivery | Existing `OPS_TRACE_QUEUE` (default `ops_trace_v2`), separate from runtime and GC. Soft/hard task limits are 40/45 seconds. |

Trace publication also has a 120-second SQL lease. A worker can claim a published intent immediately; publication
does not count as an export attempt. A stale `exporting` intent becomes `uncertain`, not an automatic resend. Unknown
transport outcomes require an explicit acknowledgement of possible duplicates before a user-triggered retry.

Setting the flag to false closes new admission; it does not cancel remote Tasks. To drain safely, close admission and
retain beat, the external-agent worker and the tracing worker until admitted operations and exports settle or reach
their fixed deadlines. Preserve unresolved Task/context identities for diagnosis and deliberate recovery. Stopping
those workers as part of disabling the feature can strand old work. GC remains scheduled independently.

## Configuration and Docker enablement

Configuration lives in `configs/feature/external_agents.py`; deployment may tighten the limits of the frozen profile.

| Controls | Defaults |
| --- | --- |
| HTTP connect / request / initial SSE | 5 / 30 / 30 seconds |
| Logical run / cancel window | 3,600 / 30 seconds; the Caller wait is 600 seconds unless configured otherwise within the design bounds. |
| Post-wait tracking | At most 86,400 seconds from local wait end; background query delay 60 → 300 seconds, at most 300 attempts. |
| Background query concurrency | Workspace 20; workspace plus endpoint 5. |
| Worker batch / maintenance | 100 rows / 60 seconds. |
| Files per direction / raw total | 5 / 30 MiB. Document 15 MiB, image 10 MiB; PDF, TXT, MD, PNG and JPEG input profile. |

Build the API image from this PR's repository root. The Dockerfile copies the managed Graphon package as well as
`api`; a historical released API image does not contain this implementation. Use a Compose override to point `api`,
`worker`, `worker_beat` and `worker_external_agents` at the same built image. With the existing database, Redis,
storage and SSRF proxy configured:

```bash
cd docker
# Set EXTERNAL_AGENTS_ENABLED=true in envs/core-services/api-worker.env after migration.
docker compose --profile external-agents up -d api worker worker_beat worker_external_agents
```

The `external-agents` profile starts the dedicated runtime worker. The regular worker must also consume `retention`
and `OPS_TRACE_QUEUE`; custom worker queue lists must preserve those consumers. All these processes need the same
database, Redis namespace, encryption setup and shared storage. Existing provider network egress policy applies to
tracing. Never put credentials, signed URLs or private deployment access details into this README or task messages.

Put `EXTERNAL_AGENTS_ENABLED` and a custom `EXTERNAL_AGENTS_QUEUE` in the common
`docker/envs/core-services/api-worker.env`, or use the deployment's root `.env` override. API, Beat and both workers
read the same merged container environment. The dedicated service uses `MODE=external_agent_worker`; its entrypoint
selects `EXTERNAL_AGENTS_QUEUE` at container startup and then enters the ordinary worker path with prefork and
prefetch 1. It does not resolve the queue or override the admission flag through Compose interpolation. Generic
`CELERY_QUEUES`/`CELERY_WORKER_QUEUES` settings do not redirect this dedicated worker away from the producer queue.

## Console API overview

Routes below are relative to the existing Console API prefix (`/console/api`). They use workspace membership, asset
visibility and current App permissions. Owner/Admin manage connections, display information and tracing; eligible
Editors can use Overview/Test. Normal members receive only the permitted aggregate monitoring view.

| Route family | Purpose |
| --- | --- |
| `GET/POST /external-agents`, `POST /external-agents/verify` | List/create assets and obtain Verify evidence. |
| `/external-agents/{id}`, `/{id}/info`, `/{id}/connection`, `/{id}/enabled`, `/{id}/tracing` | Detail/delete and versioned management mutations. |
| `GET /external-agent-operations/{id}` | Idempotent operation receipt. |
| `GET /external-agents/capabilities` | Backend profile and file capability envelope. |
| `/external-agents/{id}/tests`, `/tests/{invocation}`, `/tests/{invocation}/cancel` | Start, read and cancel an Overview test. |
| `/external-agents/{id}/test-files`, `/test-files/paste-link`, `/test-files/{lease}` | Owned test input creation and lease access. |
| `POST /external-agent-tests/leave-page` | Revoke the leaving page's display and temporary-file ownership; closing a panel is not page leave. |
| `POST /apps/{id}/workflows/draft/external-agent-bindings/{node}/rebind` | Explicit binding epoch and context boundary. |
| `GET /external-agents/{id}/monitoring` | Calls, Avg Duration, Reported Tokens and token-reporting Coverage over one authorized App scope. |
| `GET /external-agent-invocations/{id}/trace`, `/trace/steps/{key}` | Owned internal Trace and sanitized Raw Data, with revision-pinned pagination. |
| `/external-agents/{id}/tracing-config/{provider}` | Asset-owned existing-provider configuration, without a hidden App. |
| `/external-agent-invocations/{id}/trace-deliveries`, `/{delivery}/retry` | Separate export acknowledgement and explicit retry. |

Traceability recognizes the exact declared A2A Traceability carrier. The v1 specification and Python sample dialect
are normalized explicitly, including their different timestamp representations; neither is accepted as the private
AgentTraceBatch or native OTLP. Parseable incomplete steps remain visible. Raw data is bounded and redacted before
persistence. Call-level usage requires a trusted profile proof and is never inferred by summing arbitrary steps.
Monitoring uses SQL additive daily aggregates and the same permission range for all four metrics. A known zero
contributes to coverage; all-unreported tokens stay null. Failed, canceled and unknown dispatched attempts count as
Calls, including each confirmed cancel-and-retry dispatch. Polls and blocked pre-dispatch work do not.

Targets and content policy freeze before dispatch. App and asset targets receive distinct payloads and delivery keys;
their effective content policy is the intersection of source and destination policy. Late Trace or usage produces a
new immutable payload revision without rewriting an already queued delivery. A provider's accepted state is separate
from the business result and from internal Trace availability.

## Retention and deletion

Production Invocation bodies, Trace, files and monitoring facts follow the source App/run/message retention and
archive ownership. The existing exporter seven-day buffer is not the Console history TTL. Hot-log archival alone
does not delete BYOA history; permanent archive deletion fences its manifest-validated run identities first.

| Resource | Boundary |
| --- | --- |
| Post-wait remote observation | Fixed local wait end + 24 hours, clamped by parent deletion/retention and bounded query budget. No Task ID means no guessed query or business resend. |
| Unsubmitted test input | Page leave or original upload + 1 hour. |
| Submitted test input | Authoritative remote end or original upload + 24 hours, whichever applies first. Reuse does not renew upload age. |
| Test output | Page leave or original output creation + 24 hours, also clamped by test/parent expiry. |
| Test body/result/Trace | Local test end + 24 hours; late data does not extend the deadline. No test-history UI. |
| Old connection secrets | Reclaim only after legitimate dispatch/query/cancel/file leases have drained and references are terminal or the fixed tracking window has ended. Active connection credentials are not subject to a blanket 24-hour TTL. |
| Verify credentials | Consumed evidence is cleared; expired or consumed proof rows are reclaimed in bounded maintenance batches. |
| Unresolved context | Minimal nonsecret identity/state survives log expiration while the conversation/binding scope exists. Tracking exhaustion does not release Busy. |

App, run, message, conversation and workspace deletion write tombstones before destructive effects. Pending exports,
new Trace/usage ingestion and file materialization recheck the owner chain. Retention clears business content from
both dedicated columns and the durable runtime snapshot. Necessary audit metadata follows the existing audit policy.
Asset deletion does not cascade historical App facts. No automatic remote Task or third-party provider deletion is
claimed by this cleanup.

File cleanup deletes only owned temporary copies. It checks every active lease referencing the same stored file
before deleting bytes, so one completed test cannot remove a shared input of another in-flight test. Storage writes
are preceded by a server-reserved file ID and storage-key intent. A crash while a write is `planned` keeps a minimal
revoked cleanup intent: GC repeatedly removes that exact key, even if the upload row was never committed or bytes
arrive after a prior delete. Time alone does not prove the writer drained. Completed/aborted writes can release their
lease after cleanup; unfinished planned intents remain auditable. `cleanup_after` postpones attempted cleanup by
60 seconds to avoid starving later expired leases.

## Migration, validation and rollback

Alembic revision `c3025a2a1109` merges the two base heads and creates the static schema. Upgrade applies explicit DDL,
not imports of mutable application models. Existing bindings are backfilled with an empty external job configuration.
SQLite tests exercise upgrade/backfill/downgrade and column parity; PostgreSQL/MySQL DDL compilation is also covered.

Run targeted checks from the repository root with the installed API environment:

```bash
uv run --project api --no-sync python -m pytest -c api/pytest.ini -o addopts='' \
  api/tests/unit_tests/services/external_agents \
  api/tests/unit_tests/repositories/external_agents \
  api/tests/unit_tests/migrations/test_external_agent_backend.py \
  api/tests/unit_tests/extensions/test_external_agents_celery.py
uv run --project api --no-sync python -m ruff check \
  api/services/external_agents api/repositories/external_agents api/providers/a2a
```

Provider and workflow E2E tests live in `api/tests/e2e_tests/external_agents`. They must be run against the actual
deployment and its explicit test provider; passing local unit tests does not establish dev acceptance.

Schema downgrade deletes all BYOA records. Before rolling back, close admission, keep beat and the external-agent,
tracing and cleanup workers running long enough to drain legitimate work, and preserve a restricted operational
inventory of unresolved remote Task identity and state. Stop workers before downgrading. Retaining a remote Task
inventory does not authorize business replay.
Prefer a forward fix while nonterminal tasks exist; never downgrade and infer that remote work was canceled. Back up
the database according to the deployment's normal procedure, then run the reviewed downgrade only when destructive
loss is acceptable. The three added native binding columns are also removed by downgrade.

## Managed Graphon source in the single PR

`packages/graphon` is managed source from [langgenius/graphon at
4fa22141774dff80e90e4dfa98ea3e6fbf0421bb](https://github.com/langgenius/graphon/tree/4fa22141774dff80e90e4dfa98ea3e6fbf0421bb)
(0.8.0), preserving its license and provenance. `UPSTREAM.md` lists the identity-only `ExternalWaitReason` and generic
Boolean/ArrayBoolean default-value patches and their tests. API dependencies resolve this package through the uv
workspace path; the API image includes it. This delivers the coordinated change in one PR without requiring an
unpublished Graphon release or runtime monkey-patching.
