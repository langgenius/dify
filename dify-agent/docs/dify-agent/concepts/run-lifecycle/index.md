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

## Agent App steering

Runs created with `agent_mode=agent_app` and a create-run request whose
`metadata.allow_steering` is `true` open a bounded per-run steering inbox for
human input when execution starts. The inbox lives only while the run is
live; human steering is not available for workflow or other agent modes, and
`allow_steering` metadata is never forwarded to the model.

Steering input is submitted through the private control-plane endpoint
`POST /runs/{run_id}/inputs`, which requires the same bearer token as the rest
of the control plane — unauthenticated deployments do not register the route at
all. The body is `{"input_id": "<uuid>", "text": "..."}` with nonblank text up
to 8000 characters. `input_id` makes retries safe: while the run is active,
resending the same id and text is a no-op; the same id with different text
conflicts.

A `202` response means the input was accepted into the run's inbox — it is not
a delivery guarantee. The endpoint returns `404` for unknown runs and `409`
when the run cannot accept the input: the inbox has not opened yet or is
already closed, the run finished or is being cancelled, the input id was
already used with different text, or the per-run input limit was reached.

Queued inputs are sent as user messages in the native agent loop. They are
drained at the next model-request boundary, or as an extra step after the model
produces what looked like final output — steering can therefore redirect a run
that was about to end. Redis inputs expire after the configured retention
period and are not replayed after a worker restart. This endpoint does not
interrupt an in-flight tool call.

The Console roster Agent App draft chats are the only callers: when the Dify
API is configured with a real Agent backend URL and API token and
`AGENT_APP_ASYNC_LOOP_ENABLED` is `true`, roster Preview and Build chat runs
(`InvokeFrom.DEBUGGER` on a draft or build-draft config for a roster-scoped
agent) opt into `allow_steering`, and the API binds the accepted run id to the
public task id.
Console chat does not opt into background shell jobs. If the agent is waiting
for a foreground tool, accepted input remains queued until the tool returns
and the next model request is prepared. Build-chat finalization, published
WebApp, workflow, and other agent modes never opt in. The UI offers queueing
and status only — no per-job stop action.

`GET /runs/{run_id}/queue` reports the inbox status: whether the run is
accepting human inputs, and the queued `input_queued` entry ids in order.
Entries are removed once the run drains them — a missing entry means it was
handed to the run, not that the model confirmed it. The snapshot exposes ids
only, never input text or other working data, and returns `404` for missing
runs.

Delivery is real, not queued-and-forgotten: a human input is enqueued as a
`ModelRequest` whose metadata carries the steering input id, so the native
`EnqueuedMessagesEvent` confirms which inputs landed in the run's history. The
Dify API persists each delivered input under `steering_inputs` on the parent
turn's message metadata and streams it back as an `agent_input_delivered`
frame — it lives on the parent turn, not as a separate assistant run or
conversation node.
