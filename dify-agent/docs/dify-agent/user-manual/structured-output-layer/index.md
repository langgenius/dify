# Structured output layer

The structured output layer makes the final answer follow a caller-provided JSON
Schema. Add it when the client needs a JSON object instead of plain text.

When present, Dify Agent exposes the schema to the model as a structured-output
tool and validates the model response against the same schema.

## Layer contract

| Property | Value |
| --- | --- |
| Reserved layer name | `output` |
| Type id | `dify.output` |
| Config | `DifyOutputLayerConfig` |
| Dependencies | none |

Use at most one structured output layer. It must be named `output`.

## Config fields

| Field | Type | Meaning |
| --- | --- | --- |
| `json_schema` | `dict[str, JsonValue]` | Top-level object JSON Schema for the final answer. |
| `description` | `str \| None` | Optional model-facing tool description. |
| `strict` | `bool \| None` | Optional strictness flag passed to the output tool. |

The structured-output tool name is fixed to `final_output`.

## Basic usage

```python {test="skip" lint="skip"}
from dify_agent.layers.output import DIFY_OUTPUT_LAYER_TYPE_ID, DifyOutputLayerConfig
from dify_agent.protocol import DIFY_AGENT_OUTPUT_LAYER_ID, RunLayerSpec


output_layer = RunLayerSpec(
    name=DIFY_AGENT_OUTPUT_LAYER_ID,
    type=DIFY_OUTPUT_LAYER_TYPE_ID,
    config=DifyOutputLayerConfig(
        description="Structured incident summary returned by the agent.",
        strict=True,
        json_schema={
            "type": "object",
            "properties": {
                "title": {"type": "string"},
                "severity": {"type": "string", "enum": ["low", "medium", "high"]},
                "actions": {"type": "array", "items": {"type": "string"}},
            },
            "required": ["title", "severity", "actions"],
            "additionalProperties": False,
        },
    ),
)
```

On success, the terminal event contains the validated JSON-safe object:

```python {test="skip" lint="skip"}
async for event in client.stream_events(run_id):
    if event.type == "run_succeeded":
        structured_output = event.data.output
```

If the `output` layer is omitted, Dify Agent keeps the default plain text output
contract.

## Schema limits

The first structured-output version supports a practical subset of JSON Schema:

- the top-level schema must be an object (`"type": "object"`)
- the model-facing structured-output tool name is always `final_output`
- remote `$ref` values are not supported
- local refs are supported only under `#/$defs/...`
- recursive `$defs` refs are not supported
- `$ref` values inside ordinary literal keywords such as `const`, `enum`,
  `example`, and `examples` are treated as data, not schema refs

## Validation and retry behavior

The runtime builds a pydantic-ai output contract from the layer config. The same
contract exposes the model-facing schema and validates the returned object.

If the model returns an invalid object, pydantic-ai's normal output-validation
retry behavior applies. If retries are exhausted, the run ends with `run_failed`.

## Resuming runs with structured output

Session snapshots store layer runtime state, not output-layer config. If you
resume a run that uses structured output, include the same `output` layer again so
the runtime can rebuild the output contract.

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| `must use reserved layer name 'output'` | Rename the layer to `output`. |
| Structured output falls back to text | Confirm the `output` layer is present and has type `dify.output`. |
| Run fails before model resolution | Validate the JSON Schema and `$ref` usage. |
| Resume loses structured output | Resubmit the same output layer; snapshots do not store the schema. |
