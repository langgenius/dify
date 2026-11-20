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

Limited Dify operations keep live reservation counters in the owning native
run's Deps. Reserving and deduplicating a native call ID never yields on the
owner's event loop. The scheduler closes admission before cancelling the native
runner when it observes user cancellation, an observer error or shutdown. This
happens after any propagation delay from a remote Redis cancellation request.
After cleanup the runner seals a detached final reservation summary; success,
failure, timeout and cancellation persist it in their normal terminal event.
A missing tool result leaves its reservation unconfirmed rather than refunded.
Late tasks cannot change the sealed summary or reserve again.

The supervisor releases its runner and counter store on exit; there is no
server-wide counter registry. A new run receives fresh counters even when it
restores conversation history. Redis retains normal run status, events, cancel
intents and idempotent create-run claims. A replay returns the existing record
without restarting execution. Process crashes do not recover active runs or
counters, and rolling deployment must drain active runs first.
