# Agenton configuration and sessions

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

`Layer.__init_subclass__` infers `deps_type`, `config_type`,
`runtime_state_type`, and `runtime_handles_type` from generic base arguments
when possible. For example, `PlainLayer[NoLayerDeps, MyConfig, MyState,
MyHandles]` automatically installs those Pydantic schemas. Omitted schema slots
default to `EmptyLayerConfig`, `EmptyRuntimeState`, and `EmptyRuntimeHandles`.
Lifecycle hooks can annotate controls as `LayerControl[MyState, MyHandles]` to
get static checking and IDE completion for runtime state and handles.

## Registry and builder

Register config-constructible layers manually:

```python
registry = LayerRegistry()
registry.register_layer(PromptLayer)  # uses PromptLayer.type_id == "plain.prompt"
```

Use `CompositorBuilder` to mix serializable config nodes with live instances:

```python
compositor = (
    CompositorBuilder(registry)
    .add_config({"layers": [{"name": "prompt", "type": "plain.prompt", "config": {"prefix": "Hi"}}]})
    .add_instance(name="profile", layer=ObjectLayer(profile))
    .build()
)
```

Use `.add_instance()` for layers that require Python objects or callables, such
as `ObjectLayer`, `ToolsLayer`, and dynamic tool layers.

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
