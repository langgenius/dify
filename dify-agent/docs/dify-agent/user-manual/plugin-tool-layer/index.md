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

The HTTP server stores reservations inside the existing Redis run record using
one Lua transaction, including run/cancellation checks and duplicate-call
rejection. Reservations share the run's retention and survive reconstruction
of the storage adapter. Missing storage or uncertain admission fails closed.
A reservation is never refunded, including a process interruption before the
HTTP dispatch is confirmed; this is a conservative invocation limit, not a
guarantee of exactly-once business execution. Native in-process callers use an
event-loop-local store by default and must supply a durable store themselves
if they implement recovery.

Current scheduling has no public pause/resume or crash-recovery endpoint.
The quota store preserves usage for the same retained run ID; passing a
session history snapshot into a newly created run gives that new run its own
quota. Session snapshots do not carry counters across user messages.

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
`tool_call_limits` summary. Redis copies it from the run record in the same
atomic transaction that seals the event stream. Each summary contains the
operation identity, frozen limit, total usage and a map from hashed native
call IDs to reservation ordinals. Original event JSON, including empty snapshot
objects, is preserved. Callers cannot override this authoritative summary.
The API retains it in Agent run metadata and fills missing usage on existing
unfinished tool records. Such records use `execution_status: "unconfirmed"`;
their reservation consumed allowance, but no external execution is claimed.
This covers cancellation between reservation and a tool result without adding
an independently written event or refunding uncertain dispatch.

Deploy the updated Agent server fleet before sending the new configuration
field from the API. Older tool DTOs reject unknown fields, and older server
record DTOs do not read records with private quota state. Drain retained
limited runs before rolling the Agent server back. There is no database schema
migration; missing limits and old run records retain their previous behavior.
