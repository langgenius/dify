# Agenton user guide

Agenton composes reusable graph plans from `LayerNode`s and `LayerProvider`s.
The core is state-only: a `Compositor` stores no live layer instances, clients,
cleanup stacks, or run state. Each `Compositor.enter(...)` call creates a fresh
`CompositorRun` with new layer instances, direct dependency bindings, lifecycle
state, and an optional hydrated session snapshot.

## Config and runtime state

- **Graph config** is serializable topology: node `name`, provider `type`,
  dependency mappings, and metadata. `LayerNodeConfig` deliberately contains no
  layer config.
- **Per-run layer config** is passed to `Compositor.enter(configs=...)` as a
  mapping keyed by node name. Providers validate each value with the layer's
  `config_type` before any factory runs.
- **Runtime state** is serializable per-layer invocation state on
  `layer.runtime_state`. Session snapshots persist only lifecycle state and this
  model's JSON-safe data.
- **Live Python resources** such as clients, files, sockets, or process handles
  stay outside Agenton core. Own them in application code or integration-specific
  context managers that wrap compositor entry.

## Define a config-backed layer

Use a `LayerConfig` model for per-run config and inherit from a typed layer family
so `Layer.__init_subclass__` can infer schemas:

```python {test="skip" lint="skip"}
from dataclasses import dataclass

from pydantic import ConfigDict
from typing_extensions import Self, override

from agenton.layers import LayerConfig, NoLayerDeps, PlainLayer


class GreetingConfig(LayerConfig):
    prefix: str

    model_config = ConfigDict(extra="forbid")


@dataclass(slots=True)
class GreetingLayer(PlainLayer[NoLayerDeps, GreetingConfig]):
    type_id = "example.greeting"

    prefix: str

    @classmethod
    @override
    def from_config(cls, config: GreetingConfig) -> Self:
        return cls(prefix=config.prefix)

    @property
    @override
    def prefix_prompts(self) -> list[str]:
        return [self.prefix]
```

Omitted schema slots default to `EmptyLayerConfig` and `EmptyRuntimeState`.
Lifecycle hooks are no-argument methods on the layer instance; use `self.deps`
for dependencies and `self.runtime_state` for serializable mutable state.

## Live resources

Agenton does not own resource cleanup. Keep live resources in the surrounding
application and pass them to capability methods explicitly:

```python {test="skip" lint="skip"}
@dataclass(slots=True)
class ClientUserLayer(PlainLayer[NoLayerDeps]):
    def make_client_user(self, *, http_client: httpx.AsyncClient) -> ClientUser:
        return ClientUser(http_client)


compositor = Compositor([LayerNode("client_user", ClientUserLayer)])
async with httpx.AsyncClient() as http_client:
    async with compositor.enter() as run:
        layer = run.get_layer("client_user", ClientUserLayer)
        user = layer.make_client_user(http_client=http_client)
```

This keeps deterministic cleanup at the integration boundary and leaves Agenton
snapshots limited to serializable runtime state.

## Build a compositor

Use providers for config-backed layers and pass per-run config at entry time:

```python {test="skip" lint="skip"}
from agenton.compositor import Compositor, CompositorConfig, LayerNodeConfig, LayerProvider
from agenton_collections.layers.plain import PromptLayer, PromptLayerConfig


providers = (
    LayerProvider.from_layer_type(PromptLayer),
    LayerProvider.from_layer_type(GreetingLayer),
)
compositor = Compositor.from_config(
    CompositorConfig(
        layers=[
            LayerNodeConfig(name="prompt", type="plain.prompt"),
            LayerNodeConfig(name="greeting", type="example.greeting"),
        ]
    ),
    providers=providers,
)

async with compositor.enter(
    configs={
        "prompt": PromptLayerConfig(user="Answer with examples."),
        "greeting": GreetingConfig(prefix="Hi"),
    }
) as run:
    prompts = run.prompts
```

Use `LayerProvider.from_factory(...)` when construction needs Python objects or
callables. Provider factories receive only validated config and must return a
fresh layer instance for every invocation. For node-specific construction with
`Compositor.from_config`, pass a `node_providers={"node_name": provider}` mapping
to override the provider selected by type id for that node.

## Dependencies

Layer dependencies bind direct layer instances onto `self.deps` for one run.
Dependency mappings use dependency field names as keys and compositor node names
as values:

```python {test="skip" lint="skip"}
class ModelDeps(LayerDeps):
    plugin: PluginLayer


@dataclass(slots=True)
class ModelLayer(PlainLayer[ModelDeps]):
    def make_model(self) -> Model:
        return self.deps.plugin.make_provider()
```

Optional dependencies are assigned `None` when absent. Missing required
dependencies, unknown dependency keys, and dependency targets with the wrong layer
type fail before lifecycle hooks run.

## System prompts, user prompts, and tools

Layers expose four authoring surfaces:

- `prefix_prompts`: system prompt fragments collected in layer order.
- `suffix_prompts`: system prompt fragments collected in reverse layer order.
- `user_prompts`: user-message fragments collected in layer order.
- `tools`: tool entries collected in layer order.

`PromptLayer` accepts `prefix`, `user`, and `suffix` config fields. Aggregation is
available on the active `CompositorRun` as `run.prompts`, `run.user_prompts`, and
`run.tools`. For pydantic-ai, import
`agenton_collections.transformers.pydantic_ai.PYDANTIC_AI_TRANSFORMERS` and pass
it to `Compositor(...)` or `Compositor.from_config(...)` so tagged layer items are
converted to Pydantic AI prompt, user prompt, and tool values.

## Session snapshot and restore

Core Agenton run slots default to delete-on-exit. Call `run.suspend_on_exit()` or
`run.suspend_layer_on_exit(name)` inside the active context when the next snapshot
should be resumable:

```python {test="skip" lint="skip"}
async with compositor.enter(configs=configs) as run:
    run.suspend_on_exit()

snapshot = run.session_snapshot
async with compositor.enter(configs=configs, session_snapshot=snapshot) as restored_run:
    restored_layer = restored_run.get_layer("stateful", StatefulLayer)
```

`run.session_snapshot` is populated after context exit. Snapshots include ordered
layer names, non-active lifecycle states, and JSON-safe runtime state only. Active
state is rejected at the DTO boundary, and closed layers cannot be entered again.
To resume, pass the snapshot to a later `Compositor.enter(...)` call with the same
layer names and order.

See also:

- `examples/agenton/agenton_examples/basics.py`
- `examples/agenton/agenton_examples/pydantic_ai_bridge.py`
- `examples/agenton/agenton_examples/session_snapshot.py`
