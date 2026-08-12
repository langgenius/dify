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

## Resume a conversation

Successful runs return a terminal event with both final output and a resumable
session snapshot:

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

1. Current system prompts are rendered into temporary `message_history` before
   stored history.
2. Stored history is then sent to the model.
3. Current user prompts are sent after the stored history.
4. Only newly produced pydantic-ai messages are appended after a successful run.
5. Current system prompts are not persisted into the history layer.
6. Failed runs emit `run_failed` and do not return a success snapshot to resume.

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
| Resume fails with snapshot lifecycle errors | Use the success snapshot from `run_succeeded` and keep layer names/order unchanged. |
| System prompts appear missing from saved memory | This is expected; current system prompts are temporary and are not persisted. |
