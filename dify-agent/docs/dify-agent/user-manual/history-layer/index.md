# History layer

The history layer stores pydantic-ai conversation history in the Agenton session
snapshot. Add it when a later run should resume the previous conversation.

The history layer is state-only: it contributes no prompt text, user prompt, or
tools, and it owns no live resources.

## Layer contract

| Property | Value |
| --- | --- |
| Reserved layer name | `history` |
| Type id | `pydantic_ai.history` |
| Config | none |
| Dependencies | none |

Use at most one history layer. It must be named `history` and must not declare
dependencies.

## Basic usage

```python {test="skip" lint="skip"}
from agenton_collections.layers.pydantic_ai import PYDANTIC_AI_HISTORY_LAYER_TYPE_ID
from dify_agent.protocol import DIFY_AGENT_HISTORY_LAYER_ID, RunLayerSpec


history_layer = RunLayerSpec(
    name=DIFY_AGENT_HISTORY_LAYER_ID,
    type=PYDANTIC_AI_HISTORY_LAYER_TYPE_ID,
)
```

Include this layer in the same composition as your prompt, plugin, and LLM
layers.

## Compaction and persistence

When the LLM layer supplies `context_window_tokens`, Dify Agent sets the Harness
target to `min(floor(window * 0.8), window - max_tokens)` for a positive
`model_settings.max_tokens`; otherwise it uses `floor(window * 0.8)`. A target
that is not positive rejects the run before model invocation.

Harness estimates and, when needed, rewrites history immediately before model
requests. It clears older tool results first, retaining the latest three
tool-call/result pairs and their inputs. If the history is still over target, the
same current model incrementally summarizes older messages while retaining the
latest twenty messages and the first user message.

With a history layer, once pydantic-ai binds and builds messages in the run
capture, the captured, possibly rewritten history replaces the stored messages
in the terminal session snapshot. This applies to successful, failed, and
cancelled runs. A failure or cancellation before the capture contains any
messages preserves the previously restored history. An interrupted capture can
include a partial response or tool-return request marked `state="interrupted"`;
pydantic-ai repairs that state when the snapshot is used by a later independent
run. Without this layer, compaction and interrupted messages affect only the
current run.

## Resume a conversation

Successful runs return a terminal event with both final output and a resumable
session snapshot. Failed and cancelled terminal events can also carry a session
snapshot that checkpoints current history, but they do not change the interrupted
run's terminal status into success.

```python {test="skip" lint="skip"}
accepted = await client.create_run(request)

async for event in client.stream_events(accepted.run_id):
    if event.type == "run_succeeded":
        output = event.data.output
        snapshot = event.data.session_snapshot
        break
```

Pass `snapshot` to the next request and keep the same layer names and order:

```python {test="skip" lint="skip"}
next_request = CreateRunRequest(
    composition=composition_with_the_same_layer_names_and_order,
    session_snapshot=snapshot,
)
```

`CreateRunRequest.on_exit` defaults to suspending layers, which makes the
terminal snapshot resumable. Keep that default for normal memory flows.

## What gets stored

Dify Agent handles memory conservatively:

1. Current system prompts are passed as run-level pydantic-ai instructions.
2. Stored history is sent to the model before the current user prompt.
3. When the LLM layer includes `context_window_tokens`, Harness may rewrite
   over-target history immediately before a model request as described above.
4. Once pydantic-ai binds and builds messages in the run capture, the complete
   captured and possibly compacted history is written back to the layer on
   success, failure, timeout, or cancellation.
5. If failure or cancellation occurs before the capture contains any messages,
   the previously restored history remains unchanged.
6. Run-level system instructions are removed before history is persisted.
7. Interrupted partial messages retain pydantic-ai's `state="interrupted"` marker
   so a later independent run can repair and continue from the checkpoint.
8. Failed and cancelled runs keep their terminal status; their snapshot is a
   checkpoint, not a successful continuation of the interrupted run.

## Persist snapshots outside the client process

Session snapshots are Pydantic models and can be saved as JSON:

```python {test="skip" lint="skip"}
from pathlib import Path

from agenton.compositor import CompositorSessionSnapshot


snapshot_path = Path("session_snapshot.json")
snapshot_path.write_text(snapshot.model_dump_json(), encoding="utf-8")

restored_snapshot = CompositorSessionSnapshot.model_validate_json(
    snapshot_path.read_text(encoding="utf-8")
)
```

Always restore snapshots with the same layer names and order that produced them.

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| `must use reserved layer name 'history'` | Rename the layer to `history`. |
| `does not support dependencies` | Remove `deps` from the history layer. |
| Resume fails with snapshot lifecycle errors | Use a terminal snapshot whose layers were suspended, and keep layer names/order unchanged. |
| System prompts appear missing from saved memory | This is expected; current system prompts are temporary and are not persisted. |
