# Agent Run Lifecycle

This page explains, from a caller's perspective, how an `agent run` relates to a
`workflow run` and how callers control Agenton layer exit behavior with exit
signals.

## Relationship between agent runs and workflow runs

A `workflow run` is one full workflow execution. An `agent run` is one Agent
execution started by an Agent node while the workflow is running. They are not a
one-to-one mapping: one `workflow run` often contains multiple `agent run`s.

### First entry into an Agent node

When a `workflow run` first reaches an Agent node, the caller starts the first
`agent run` for that node.

The `agent run` enters the layers defined in its composition:

- If the request does not include `session_snapshot`, each layer enters with a
  fresh state and initializes its own runtime state.
- If the request includes a previously returned `session_snapshot`, each layer
  restores its runtime state from that snapshot and continues from there.

After entering layers, the Agent runs the LLM and tool calls until the current
`agent run` reaches a terminal result. This means the `agent run` has ended; it
does not necessarily mean the outer workflow has ended.

### Ending with a `final_output` tool call

If the Agent ends with a `final_output` tool call, the Agent node has produced
its final output for this pass. The caller should read the terminal output of the
current `agent run` and let the `workflow run` continue to downstream nodes.

The current `agent run` has ended, but the returned `session_snapshot` can still
be saved. If the same `workflow run` may enter the same Agent session again, the
caller should keep using that snapshot.

### Ending with a human tool call

If the Agent ends with a human tool call, the Agent needs human input before the
business process can continue. A common misconception is to treat this as a
paused agent run. **Agent runs do not have a pause state.** With a human tool, the
current `agent run` has ended; the outer `workflow run` is what should be paused.

The caller should handle this flow as follows:

1. Read the current `agent run` result and detect `deferred_tool_call` on the
   terminal `run_succeeded` event.
2. Enter workflow HITL handling and pause graphon.
3. Wait for the human input to be completed.
4. When resuming the workflow, start a second `agent run` on the same Agent node
   with the previous `session_snapshot`, matching composition, and
   `deferred_tool_results` keyed by the original tool call id.
5. Keep the history layer active so Dify Agent can match the result to the
   pending tool call stored in the previous run's message history.

In other words, a human tool does not mean “pause this agent run until it is
resumed.” It means “this agent run ended with a result that requires human
input.” After the caller completes HITL handling, it should create a new
`agent run` using the same history/session snapshot to continue.

### Entering another Agent node

When the same `workflow run` continues and reaches another Agent node, it starts
another `agent run`. That next Agent node may be a different Agent, or it may be
the same Agent reused by a roaster.

Therefore, callers should save and pass `session_snapshot` by Agent session, not
assume that one `workflow run` has only one `agent run`.

## Agent run exit signals

When an `agent run` ends, Dify Agent exits the layers that were entered by the
current run. Callers control whether each layer is suspended or deleted through
`CreateRunRequest.on_exit`.

Exit signals control the **layer lifecycle state**, not the execution state of an
`agent run`. The default policy is `suspend`, so a successful `agent run` returns
a reusable `session_snapshot`.

### Default: suspend layers

If a request does not explicitly set `on_exit`, it is equivalent to:

```json
{
  "on_exit": {
    "default": "suspend",
    "layers": {}
  }
}
```

This means every entered layer exits as `suspended` and is written into the
returned `session_snapshot`. The caller can submit that snapshot in the next
`agent run` to resume those layers.

For normal Agent execution inside a workflow, including both `final_output` and
human-tool endings, callers should keep the default suspend policy unless they
know the Agent session will never be resumed.

### Delete layers when the workflow run ends

When the whole `workflow run` has ended, the caller should start one more cleanup
`agent run`:

- Reuse the last available `session_snapshot`.
- Omit the LLM layer, because this run is only for entering and cleaning existing
  state; it does not need to call the model again.
- Exit layers with the `delete` signal.

The cleanup request should use an exit signal like this:

```json
{
  "on_exit": {
    "default": "delete",
    "layers": {}
  }
}
```

After this run, the corresponding layers exit through the delete path. A snapshot
returned after deletion should not be used to resume the Agent session again.

### Override selected layers

The caller can also suspend by default while deleting only selected layers:

```json
{
  "on_exit": {
    "default": "suspend",
    "layers": {
      "temporary_context": "delete"
    }
  }
}
```

Only `temporary_context` exits with `delete`; all other active layers exit with
the default `suspend` behavior.

## Exit signal API reference

Fields related to exit control in `CreateRunRequest`:

| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `session_snapshot` | `CompositorSessionSnapshot \| None` | no | The session snapshot returned by the previous `agent run`. It resumes the same Agent session. |
| `on_exit` | `LayerExitSignals` | no | The exit policy used when this `agent run` exits layers. If omitted, all active layers are suspended by default. |

`LayerExitSignals` has this structure:

| Field | Type | Default | Meaning |
| --- | --- | --- | --- |
| `default` | `"suspend" \| "delete"` | `"suspend"` | Exit intent for layers not explicitly listed in `layers`. |
| `layers` | `dict[str, "suspend" \| "delete"]` | `{}` | Per-layer exit intent overrides by layer name. Each key must refer to a layer name in the current composition. |

Exit intent semantics:

| Exit intent | Layer exit state | Effect |
| --- | --- | --- |
| `suspend` | `suspended` | Keep the layer runtime state and make the returned `session_snapshot` usable by a later `agent run`. |
| `delete` | `closed` | Delete/close the layer context. The corresponding layer snapshot should not be resumed again. |

Python DTO example:

```python {test="skip" lint="skip"}
from agenton.layers import ExitIntent
from dify_agent.protocol import CreateRunRequest, LayerExitSignals


request = CreateRunRequest(
    composition=composition,
    session_snapshot=previous_snapshot,
    on_exit=LayerExitSignals(
        default=ExitIntent.SUSPEND,
        layers={
            "temporary_context": ExitIntent.DELETE,
        },
    ),
)
```

Notes:

- `on_exit` only controls layer exit behavior; it does not cancel an `agent run`.
- Agent runs do not have a pause state. Human-tool waiting is handled by the
  outer workflow/HITL flow.
- Keys in `on_exit.layers` must refer to layer names in the current composition.
- Use `suspend` and save the returned `session_snapshot` when the same Agent
  session needs to continue later.
- After the whole `workflow run` ends, start one more cleanup run without an LLM
  layer and use `delete`.
