# Agenton user guide

Agenton composes shared `Layer` instances into a named graph. Treat layer
instances as reusable capability definitions: config and dependency declarations
belong on the layer class or instance, while per-session runtime values belong
on the `LayerControl` created for that layer in a `CompositorSession`.

## Config, runtime state, and runtime handles

- **Config** is serializable graph input. Config-constructible layers declare a
  `type_id` and a Pydantic `config_type`; builders validate node config before
  calling `Layer.from_config(validated_config)`.
- **Runtime state** is serializable per-layer/per-session state. Layers declare a
  Pydantic `runtime_state_type`; session snapshots persist this model with
  `model_dump(mode="json")`.
- **Runtime handles** are live Python objects such as clients, open files, or
  process handles. Layers declare a Pydantic `runtime_handles_type` with
  `arbitrary_types_allowed=True`. Handles are never serialized; resume hooks
  should rehydrate them from runtime state.

## Define a config-backed layer

Use a Pydantic model for config and pass it through the typed layer family so
`Layer.__init_subclass__` can infer the schema:

```python {test="skip" lint="skip"}
class GreetingConfig(BaseModel):
    prefix: str

    model_config = ConfigDict(extra="forbid")


@dataclass
class GreetingLayer(PlainLayer[NoLayerDeps, GreetingConfig]):
    type_id = "example.greeting"
    prefix: str

    @classmethod
    def from_config(cls, config: GreetingConfig) -> Self:
        return cls(prefix=config.prefix)

    @property
    def prefix_prompts(self) -> list[str]:
        return [self.prefix]
```

Omitted schema slots default to `EmptyLayerConfig`, `EmptyRuntimeState`, and
`EmptyRuntimeHandles`. Lifecycle hooks can annotate controls as
`LayerControl[MyState, MyHandles]` to get static checking and IDE completion for
runtime state and handles.

## Register layers and build a compositor

Register config-constructible layers manually:

```python {test="skip" lint="skip"}
registry = LayerRegistry()
registry.register_layer(PromptLayer)  # uses PromptLayer.type_id == "plain.prompt"
```

Use `CompositorBuilder` to mix serializable config nodes with live instances:

```python {test="skip" lint="skip"}
compositor = (
    CompositorBuilder(registry)
    .add_config(
        {
            "layers": [
                {
                    "name": "prompt",
                    "type": "plain.prompt",
                    "config": {"prefix": "Hi", "user": "Answer with examples."},
                }
            ]
        }
    )
    .add_instance(name="profile", layer=ObjectLayer(profile))
    .build()
)
```

Use `.add_instance()` for layers that require Python objects or callables, such
as `ObjectLayer`, `ToolsLayer`, and dynamic tool layers.

## System prompts and user prompts

Layers expose three prompt surfaces:

- `prefix_prompts`: system prompt fragments collected in layer order.
- `suffix_prompts`: system prompt fragments collected in reverse layer order.
- `user_prompts`: user-message fragments collected in layer order.

`PromptLayer` accepts `prefix`, `user`, and `suffix` config fields. For
pydantic-ai, `PYDANTIC_AI_TRANSFORMERS` maps `compositor.prompts` to system
prompt functions and `compositor.user_prompts` to values suitable for
`Agent.run(user_prompt=...)`.

## Session snapshot and restore

`Compositor.snapshot_session(session)` serializes non-active sessions, including
layer lifecycle state and runtime state. It rejects active sessions because live
handles cannot be snapshotted safely. Restore with
`Compositor.session_from_snapshot(snapshot)`; restored controls validate runtime
state with each layer schema and initialize empty runtime handles. Suspended
sessions resume through `on_context_resume`, where handles should be hydrated
from the restored runtime state.

Create sessions with `Compositor.new_session()` or
`Compositor.session_from_snapshot()`. `Compositor.enter()` validates that every
session control uses the target layer's runtime state and handle schemas before
any lifecycle hook runs.

See also:

- `examples/agenton/agenton_examples/basics.py`
- `examples/agenton/agenton_examples/pydantic_ai_bridge.py`
- `examples/agenton/agenton_examples/session_snapshot.py`
