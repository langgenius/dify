# Agent run lifecycle

The server validates current Config, restored State and module references before
external operations. It creates fresh native Capability/Toolset instances and
runs Pydantic AI with a per-run Deps object. Current prompts and instructions are
built from that run's config.

Native `wrap_run` scopes acquire operation resources and clean them in `finally`.
Runtime acquires a lease; Shell bootstraps once and removes tracked jobs on exit;
Config pulls mentioned assets on successful first initialization. Initialization
flags are written only after successful setup, so failures can retry. The API's
workflow terminal events own Workspace retirement and physical resource collection.

The runner saves captured conversation history in its outer `finally`, strips
transient instructions and marks unexecuted trailing tool calls interrupted.
If no messages were captured, restored history remains intact. Compaction rewrites
are included. A terminal state snapshot is built after capability cleanup for
success, failure and cancellation.

Snapshot v2 stores only JSON state:

```json
{"schema_version": 2, "layers": {"history": {"messages": []}}}
```

Configurations, clients, lease handles, tokens, models and lifecycle enums are
excluded. State is keyed by name, so instruction order does not constrain resume;
known optional modules can be added or removed. The API resubmits current Config
and retains session ownership through `AgentWorkspaceBinding.session_snapshot`.
All snapshot readers use `SessionSnapshot` validation. Its `migrate_snapshot`
validator dispatches v1 (including unversioned legacy lists) to the data-only
`migrate_snapshot_v1_to_v2` helper. V2 is validated directly; unknown explicit
versions are rejected. Reading converts data in memory without updating stored
JSON; the API saves the terminal v2 snapshot through its existing session owner.
Known legacy names map to their meaningful State and removed AskHuman slots are
discarded. Their unanswered tool calls are marked interrupted so native history
repair closes them before the first new user turn. All runs use the native runner.
Unknown legacy names and malformed state are rejected.


## Native testing protocol v1

Native tests use `execution_mode="builder_test"`, `native_test_ref` and
`native_test_protocol_version=1`. All three must agree. This wire version is
independent of composition and session snapshot v2. An ordinary request keeps
its existing execution and migration behavior.

The private, bearer-authenticated `GET /runs/capabilities` endpoint reports
installed features. The default `native_test_profile="isolated"` retains
the existing requirements:
`pending-call-v1`, `policy-gate-v1`, `test-scope-v1` and
`child-continuation-v1`. Explicit `native_test_profile="confirmed"` instead
requires `pending-call-v1`, `policy-gate-v1` and `create-idempotency-v1`, plus a
bounded nonempty create idempotency key. It uses ordinary execution and makes no
test-scope or hidden child-continuation claim. The client fetches fresh capabilities for every native
request and never falls back after missing endpoints, malformed responses or
version mismatch. The scheduler and runner independently reject an unsupported
native request before loading modules or acquiring resources. Anonymous migration
mode advertises only `pending-call-v1` and cannot admit confirmed execution.
A3/A4/A5 must install and qualify their owners before enabling the complete set.
The stable refusal code is `native_test_protocol_unsupported`.

Native continuation has its own protected `AgentCheckpoint`, separate from the
ordinary state-only snapshot. It pins the trusted reference, generation,
immutable configuration reference/digest, native message history, exact pending
call IDs, original native arguments, final typed effect intent, operation cursor,
completed result references and shell job references. Pending actions retain
`approval`, `configuration` or `interaction` independently. The pending action
owner resolves the durable configuration or form reference; only approval waits
can be satisfied by an approval decision. No configuration, credentials, clients
or live lease are serialized into a checkpoint.

`NativeContinuation.capture(result=..., deps=...)` captures genuine Pydantic AI
`DeferredToolRequests`. The native pre-tool boundary uses `defer_native_call`
to retain typed pending action metadata in `ApprovalRequired` or `CallDeferred`.
The checkpoint preserves the native deferral kind separately from the wait reason;
continuation cannot relabel an approval call as an external result. Pending tool
history remains complete, so the native runtime can resume the same calls using
`DeferredToolResults`. Stage waits raise `NativeApprovalSuspended` and preserve
their explicit model/eager/configuration/bootstrap/shell/interaction stage.
A resumed stage uses captured history without adding a second user turn.
Denial raises `NativePolicyStopped`; it never becomes `ToolDenied`, `False`, or
retryable model feedback.

`RedisRunStore.persist_waiting` atomically commits checkpoint, `run_waiting`
event and waiting status. A persistence failure publishes no resumable waiting.
The public waiting event contains only generation and pending action IDs/reasons;
protected execution payloads are not exposed in events or status responses.
`POST /runs/{run_id}/continue` accepts only the same reference, expected generation
and scheduling idempotency key. Its durable claim is shared by duplicate delivery.
The claim-to-running CAS emits `run_resumed` and can dispatch only once.
Cancellation prevents both claiming and starting a continuation and finalizes a
waiting run even when its original worker no longer exists.

A claim persisted before scheduling can be recovered after an application crash
or lost enqueue acknowledgement by delivering the same continuation request.
A claim already consumed before an ambiguous process failure is not automatically
retried: it remains running/unavailable for the API lifecycle owner to reconcile.
Redis is still not a general job queue. Real Redis atomicity and process-restart
coverage belongs to provisioned CI; in-memory fixtures do not prove Lua behavior.

The server integration seam is `create_app(native_owner=...)` /
`RunScheduler(native_owner=...)`. The injected `NativeContinuationOwner` provides
`capabilities`, `prepare(run_id=..., request=...)` and
`restore(checkpoint=...) -> PreparedContinuation`. Prepare stores bounded current
request/config under a protected immutable server reference; restore verifies its
content and owner against the pinned digest, restores the exact checkpoint state,
and resolves pending actions through the API authority before constructing any
native `ToolApproved` object. A reference alone never authorizes execution.
The returned `NativeContinuation.capabilities` contains fresh native capability
instances, assembled by the existing runner and Agent factory. With a configured
service bearer, the application installs `ConfirmedNativeContinuationOwner`.
It prepares immutable configuration through the API, restores exact SDK pending
calls/history and reads protected API-owned results. Denial and unknown outcomes
remain control errors. A restored call revalidates its final arguments and owned
resource identity before executing; a completed result bypasses the handler.

Confirmed execution borrows a separate run-bound API client. Ordinary runs retain
their existing legacy service clients and keys. Confirmed plugin/core tools use
the API tool service with the native dispatch envelope; direct plugin-daemon
dispatch has no marked-run fallback. The ordinary-confirmed owner does not
implement shell lineage or claim isolated runtime support. SDK callers use
`continue_run(..., profile="confirmed")` (or its synchronous variant); the
server independently selects the durable checkpoint profile.

`RedisAgentResultStore` binds protected payloads to the full native reference and
operation key, limits each payload to 1 MiB and refuses conflicting writes.
Its references are separate from redacted audit receipts. Checkpoints also have
a 1 MiB bound and share run-record retention. The API owner must treat expired
or unavailable state as unavailable rather than reissuing an effect.


### Private selected checkpoint readback

With a configured `DIFY_AGENT_API_TOKEN`, the control plane additionally mounts
`POST /runs/{run_id}/native-checkpoint`. It requires the same service bearer and
an exact `ReadNativeCheckpointRequest`: full native ref, backend generation,
waiting Redis event ID, protected config reference and digest. Anonymous
migration mode omits this route; ordinary run routes keep their existing behavior.
The body limit is 4 KiB; the private response limit is 2 MiB. Errors exclude
checkpoint/history bytes. The SDK provides bounded async/sync
`read_native_checkpoint` / `read_native_checkpoint_sync` methods without retries.

The existing wait Lua CAS now retains its actual XADD event ID in the same record
write. A read atomically selects that current waiting record, cancellation state
and exact stream entry; missing/pruned/expired events, changed config/ref/backend
generation and already-started continuations refuse. A pending but unstarted
continuation claim does not change that generation. This is a read of backend
state at one linearization point, not a lease against subsequent cancellation.

The API must derive the selected Run/config/ref from its own protected full
parent/node/input/pin/workspace association and recheck that owner before storing
the returned checkpoint. A bearer is service authentication, not tenant or human
authority. Readback does not prove C02 approval, outer C03 checkpoint ACK, terminal
completion, current resume authority or physical cleanup. No native continuation
owner, node wiring or full native capability is enabled by this read interface.

### Create acknowledgement recovery

A create with an `idempotency_key` (1–256 characters) binds that key to the SHA256
fingerprint of the complete validated request, excluding only the key. Use
`dify_agent.protocol.create_run_fingerprint` before submitting it. This create
fingerprint includes metadata and native ownership/profile fields; the existing
native executable-request digest keeps its separate meaning.

The server maps a hashed key to a versioned private UUIDv5 namespace and writes
one RunRecord with `SET NX EX`. Only the inserted claim schedules an initial
supervisor. Repeating an identical retained create returns its current acceptance;
changed request content returns 409. Unkeyed creates keep fresh UUID4 identities.
Keys and configuration are not exposed by lookup or stored as create payloads;
only private key/request digests join the existing record.

With service bearer authentication configured, `POST /runs/lookup` accepts only
`LookupRunRequest(idempotency_key=..., request_digest=...)` and returns the same
`CreateRunResponse` fields with `Cache-Control: no-store`. It returns 404 for a
missing/expired record and 409 for conflicting or corrupt retained identity. The
SDK's `lookup_run` and `lookup_run_sync` each make one lookup POST and never
create, enqueue, retry or fall back. Lookup does not retrieve execution
configuration or refresh retention. Anonymous migration mode omits this route.

The caller must durably save the create key and fingerprint before its first
create POST. If that acknowledgement is lost, recovery uses only that saved
selection and status reads. It must never allocate another attempt or re-POST
create, including after a 404. A retained running record does not prove that a
worker is live: a crash after persistence and before scheduling remains unknown.
Deduplication lasts only for the existing Redis retention window and does not
claim exactly-once external effects.
