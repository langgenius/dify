# Plugin tool module

`dify_agent.layers.dify_plugin.tools_layer` declares Config, State and native
Toolset. The `tools` registry name accepts API-prepared declarations, parameters,
runtime values and model-facing schema, plus `execution_context` and optional
`shell` Config references. Hidden/default parameter merging, loose schemas and
observation mapping preserve the API-prepared contract. Sandbox paths use the
referenced live shell session to upload files; file mappings resolve signed URLs
through the borrowed Dify API client. Config and credentials are never snapshotted.

Media output is a lightweight file-handle summary. Blob outputs are uploaded as
ToolFiles using the current caller identity; upload failures produce text hints
without blob data. `DIFY_AGENT_STUB_UPLOAD_FILE_SIZE_LIMIT` limits both Agent Stub
uploads and plugin `BLOB` persistence (default: 50 MiB). Oversized blobs produce
a text hint before requesting an upload URL. The model can call `read_media(file=<summary object>)` when
it needs to inspect content. File inputs supplied as workspace paths use
`dify-agent file upload --no-download-link` through the shell session.

Each prepared tool includes `plugin_unique_identifier` (version and checksum)
alongside `plugin_id`. The daemon receives it as `X-Plugin-Unique-Identifier`
and executes that exact plugin package, even if the installed version changes
during the run. Tool clients are shared only within the same complete identifier.
Older configurations can omit the identifier and retain plugin-ID dispatch.

## Per-operation call limits

Native toolset execution requires the `dify-agent[server]` extra. Schema
validation libraries remain server dependencies; configuration DTOs and the
HTTP client can still be installed with the package's default dependencies.

Prepared plugin and core-tool declarations accept `max_calls_per_run`, a strict
positive integer or `null`. An absent value or `null` is unlimited. The Agent
Soul configuration uses the same field on a concrete `dify_tools` operation;
provider-wide selections cannot have a limit. For example, configure
`{"tool_name": "search", "max_calls_per_run": 3}` alongside the operation's
existing provider fields. Save, publish and DSL export/import preserve it.

One backend run and stable provider operation own the quota. Model-visible
aliases, credentials, plugin package versions and repeated declarations do not
create extra allowance; the smallest explicit limit applies to all equivalent
declarations. Other operations and new runs have independent allowance.
Composition is fixed for an admitted run; editing a draft affects later runs.

The transport owner validates prepared arguments and atomically reserves a
slot immediately before dispatch. Rejected arguments and denied reservations
do not consume quota. Once dispatched, failures, timeouts and a model-initiated
retry consume allowance. Internal HTTP retries and nested Workflow operations
are not counted separately. Exhausted operations disappear from subsequent
model requests, but every call already generated in a batch still reserves
individually. Other tools and the final response remain available.

Here dispatch means invoking the configured tool transport: the plugin daemon
or the core-tools inner API. Parameter errors caught by prepared-schema/default
validation before that call are free. A downstream provider may perform further
validation after receiving a dispatched call; such failures remain charged,
just like other provider failures. The runtime cannot prove that an arbitrary
provider's validation error occurred before any provider-side effect and never
refunds uncertain execution.

Each native run owns an independent in-memory counter store through its Deps
and runner. Checking allowance, deduplicating native call IDs and reserving a
slot contain no await, so parallel tool tasks on the same event loop cannot
overbook the final slot. Counters are not kept in server-lifespan Services,
Redis quota keys or live run-record fields. Borrowing the same clients or
restoring a session snapshot does not share allowance with a new run.

The scheduler closes tool admission as soon as its local owner observes a
cancellation intent, observer failure or server shutdown. The same owner closes
admission at its run timeout deadline, even if a tool suppresses cancellation. Cleanup cannot reserve
another slot even if a tool catches cancellation. Already admitted calls remain
charged. Cancellation intents still use the normal Redis channel: a remote
cancel has a propagation interval before the owner observes it, so admission is
not atomic with writing that Redis marker. After native cleanup the owner seals
a detached reservation snapshot and drops its live state before writing a
terminal event. Late tasks cannot reserve or mutate the sealed summary.

Redis continues to persist ordinary run status, event streams, cancellation
intents and idempotent admission. Repeating an accepted create-run key returns
the original run and never starts a second runner or reconstructs counters.
Current scheduling has no pause/resume, cross-process handoff or crash recovery;
a process crash loses its active run and in-memory counters. A reservation is a
conservative invocation limit, not an exactly-once external execution guarantee.
Session snapshots carry conversation state, never counters across user messages.

Existing native `function_tool_result` records carry application metadata:

```json
{
  "dify_tool_call_limit": {
    "tool_identity": "[\"plugin\",\"langgenius/github/github\",\"search\"]",
    "limit": 3,
    "used": 3,
    "execution_status": "not_executed",
    "reason": "call_limit_reached"
  }
}
```

Admitted requests use `execution_status: "executed"` and `reason: null`;
`executed` means dispatched, independently of the tool's success or failure.
Handled transport failures also carry `dify_tool_execution_failed: true`, so
their existing log record remains failed while retaining the charged usage.
Local parameter validation failures carry `dify_tool_validation_failed: true`
and remain failed records without creating a reservation.
Denied results include the same decision and an explicit model-readable
instruction to continue with available results or other tools. Repeated native
call IDs are conservatively rejected with `duplicate_tool_call` and never
redispatched. The API projects these annotations into the existing Agent log
record's `data.call_limit`, with `status: "not_executed"` for rejections. Counts
remain `3/3` on the fourth request. Neither the projector nor the runtime
infers execution from model-written text.

Successful, failed and cancelled terminal events also carry a top-level
`tool_call_limits` summary. The run owner supplies its sealed in-memory
snapshot to the existing terminal compare-and-set write. Each summary contains
the operation identity, frozen limit, total usage and a map from hashed native
call IDs to reservation ordinals. Storage preserves the original typed event
JSON, including empty snapshot objects and exact large integers; it does not
read or calculate live quota. The terminal transition and event remain atomic.
The API retains it in Agent run metadata and fills missing usage on existing
unfinished tool records. Such records use `execution_status: "unconfirmed"`;
their reservation consumed allowance, but no external execution is claimed.
This covers cancellation between reservation and a tool result without adding
an independently written event or refunding uncertain dispatch.

### Agent App Preview and persisted history

Agent App tool thoughts expose the same structured `tool_activity` value in
three existing Console APIs:

- `POST /console/api/agent/{agent_id}/chat-messages`: the `agent_thought` SSE
  event has an optional top-level `tool_activity` alongside the SQL thought `id`.
- `GET /console/api/agent/{agent_id}/chat-messages`: each message's
  `agent_thoughts[]` contains the same optional field.
- `GET /console/api/agent/{agent_id}/logs/{conversation_id}/messages`: each App
  message includes `agent_thoughts[]` with that field. Existing source filters
  still apply; Preview runs require the `debugger` source when reading Logs.

```json
{
  "id": "<runtime-run-id>:<native-call-id>",
  "run_id": "<runtime-run-id>",
  "tool_call_id": "<native-call-id>",
  "tool_name": "search",
  "status": "not_executed",
  "error": "Call limit reached (3 per run). This request was not executed.",
  "call_limit": {
    "tool_identity": "<stable-operation-identity>",
    "limit": 3,
    "used": 3,
    "execution_status": "not_executed",
    "reason": "call_limit_reached"
  }
}
```

The enclosing thought ID remains its persistent SQL row ID; the sidecar ID is
the native run/call identity. Sequential replays reuse that tool row and cannot
regress a completed tool. New turns have fresh native run IDs and quota.
Thinking and answer thoughts, legacy records and invalid historical sidecars
omit `tool_activity`; observations are never parsed to invent it. Unlimited
native tools can have activity status with `call_limit: null`.

The recorder stores only validated activity under `agent_v2_tool_activity` in
the existing thought metadata column and commits before publishing a snapshot.
The APIs return this allowlisted value, not the raw metadata or provider config.
No schema migration or Tracing configuration is required. Agent Logs loads all
thoughts for the current page in one App/tenant/conversation-scoped query.

Stop may close the SSE consumer before its final snapshot is delivered. Cleanup
still applies the authoritative terminal reservations and persists unfinished
calls as `cancelled`/`failed` with `execution_status: "unconfirmed"`; clients can
refresh history or Logs. A pending answer-text flush cannot bypass that cleanup.
Completed tool outcomes and their original frozen limits remain unchanged.

Workflow live tool records retain their existing `agent_log.data.data.call_limit`
path. This App thought projection does not synthesize thought rows for the
Workflow-source Agent Logs entries, which remain separate execution records.

Deploy the updated Agent server fleet before sending the new configuration
field from the API: older tool DTOs reject unknown fields. Drain active runs
before replacing a process, because running tasks and counters are process-local.
Retained old run records drop the obsolete private quota field on reads without
restarting execution; historical terminal snapshots remain readable, including
legacy decimal-text limits. There is no database migration. Missing limits
retain unlimited dispatch, and empty terminal summaries are omitted.
