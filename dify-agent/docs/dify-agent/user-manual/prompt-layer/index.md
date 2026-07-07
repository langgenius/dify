# Prompt layer

The prompt layer provides the current run's system and user prompt fragments. In
Dify Agent request bodies it is a regular `RunLayerSpec` with type id
`plain.prompt`.

Use it for:

- system instructions that should be sent on this run
- the current user input
- optional suffix system instructions

## Config fields

| Field | Type | Meaning |
| --- | --- | --- |
| `prefix` | `str` or `list[str]` | System prompt fragments collected before other prompt content. |
| `user` | `str` or `list[str]` | Current user-message fragments for the run. |
| `suffix` | `str` or `list[str]` | System prompt fragments collected after prefix content. |

All fields default to an empty list. Dify Agent rejects a create-run request when
the effective user prompt is empty or whitespace-only.

## Basic usage

```python {test="skip" lint="skip"}
from agenton_collections.layers.plain import PLAIN_PROMPT_LAYER_TYPE_ID, PromptLayerConfig
from dify_agent.protocol import RunLayerSpec


prompt_layer = RunLayerSpec(
    name="prompt",
    type=PLAIN_PROMPT_LAYER_TYPE_ID,
    config=PromptLayerConfig(
        prefix="You are a concise assistant.",
        user="Summarize the incident in one paragraph.",
    ),
)
```

## Multiple prompt fragments

Use lists when the caller wants to keep fragments separate while still sending one
run:

```python {test="skip" lint="skip"}
prompt_layer = RunLayerSpec(
    name="prompt",
    type=PLAIN_PROMPT_LAYER_TYPE_ID,
    config=PromptLayerConfig(
        prefix=[
            "You are an incident response assistant.",
            "Prefer concrete mitigation steps.",
        ],
        user=[
            "Database latency is elevated.",
            "Return the likely severity and next actions.",
        ],
        suffix="Do not invent metrics that are not provided.",
    ),
)
```

## Notes

- The run API does not accept a top-level `user_prompt`; submit user input through
  a prompt layer.
- Prompt layer names are not reserved by the runtime, but `prompt` is the
  recommended conventional name.
- When a [history layer](../history-layer/index.md) is present, current system
  prompts are sent as a temporary prefix before stored history and are not saved
  into memory.
