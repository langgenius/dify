# Agenton user guide

Agenton composes shared `Layer` instances into a named graph. Treat layer
instances as reusable capability definitions: config and dependency declarations
belong on the layer class or instance, while per-session runtime values belong
on the `LayerControl` created for that layer in a `CompositorSession`.

## Config, runtime state, and runtime handles

- **Config** is serializable graph input. Config-constructible layers declare a
  `type_id` and a Pydantic `LayerConfig` schema; builders validate node config
  before calling `Layer.from_config(validated_config)`.
- **Runtime state** is serializable per-layer/per-session state. Layers declare a
  Pydantic `runtime_state_type`; session snapshots persist this model with
  `model_dump(mode="json")`.
- **Runtime handles** are live Python objects such as clients, open files, or
  process handles. Layers declare a Pydantic `runtime_handles_type` with
  `arbitrary_types_allowed=True`. Handles are never serialized; resume hooks
  should rehydrate them from runtime state. Register handles that need async
  cleanup with the control's entry resource stack rather than closing them
  manually in layer instances.

## Define a config-backed layer

Use a `LayerConfig` model for config and pass it through the typed layer family so
`Layer.__init_subclass__` can infer the schema:

```python {test="skip" lint="skip"}
class GreetingConfig(LayerConfig):
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

## Live resources

The base lifecycle creates a resource stack for each `LayerControl` entry before
`on_context_create` or `on_context_resume` runs. Enter async resources through the
control, store the live handle in `runtime_handles`, and clear the handle in
`on_context_suspend`/`on_context_delete`; the resource stack performs the actual
close after those hooks and also cleans up if create/resume or the context body
raises.

```python {test="skip" lint="skip"}
class ClientHandles(BaseModel):
    client: httpx.AsyncClient | None = None

    model_config = ConfigDict(arbitrary_types_allowed=True)


@dataclass
class ClientLayer(PlainLayer[NoLayerDeps, EmptyLayerConfig, EmptyRuntimeState, ClientHandles]):
    async def on_context_create(self, control: LayerControl[EmptyRuntimeState, ClientHandles]) -> None:
        control.runtime_handles.client = await control.enter_async_resource(httpx.AsyncClient())

    async def on_context_delete(self, control: LayerControl[EmptyRuntimeState, ClientHandles]) -> None:
        control.runtime_handles.client = None

    def make_client_user(self, control: LayerControl) -> ClientUser:
        control = self.require_control(control, active=True)
        if control.runtime_handles.client is None:
            raise RuntimeError("client is not available")
        return ClientUser(control.runtime_handles.client)
```

`Layer.require_control(control, active=True)` is the recommended first line for
capability methods that read runtime state or handles. It verifies that callers
passed this layer's own control from the current session and, when requested, that
the control is active.

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

## Dependency controls

Layer dependencies bind layer instances on `self.deps`. When a layer method also
needs the dependency's per-session state or handles, pass the current layer's
`LayerControl` into that method and resolve the dependency control from the same
session:

```python {test="skip" lint="skip"}
class ModelDeps(LayerDeps):
    plugin: PluginLayer


@dataclass
class ModelLayer(PlainLayer[ModelDeps]):
    def make_model(self, control: LayerControl) -> Model:
        plugin_control = control.control_for(self.deps.plugin)
        return self.deps.plugin.make_provider(plugin_control)
```

Use `control.control_for(dep_name, dep_layer)` when more than one dependency
field can point at the same layer instance. Optional dependencies that were not
bound have no control and raise `KeyError` if requested.

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
