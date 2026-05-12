# Agenton API reference

This page summarizes the public Agenton API. Import paths are shown for symbols
commonly used by layer authors and compositor callers.

## Layers: `agenton.layers`

### `Layer[DepsT, PromptT, UserPromptT, ToolT, ConfigT, RuntimeStateT]`

Framework-neutral base class for invocation-scoped prompt/tool layers.

Class attributes:

- `type_id: str | None`: provider id for config-backed graph nodes.
- `config_type: type[LayerConfig]`: Pydantic schema for per-run layer config.
- `runtime_state_type: type[BaseModel]`: Pydantic schema for snapshot-safe
  per-layer state.
- `deps_type: type[LayerDeps]`: inferred from the layer generic base or declared
  explicitly.

Invocation attributes assigned by `CompositorRun`:

- `config: ConfigT`
- `deps: DepsT`
- `runtime_state: RuntimeStateT`

Construction and dependency APIs:

- `from_config(config: ConfigT) -> Self`: create a fresh layer from
  schema-validated config. The default implementation supports only empty config.
- `dependency_names() -> frozenset[str]`: dependency fields declared by
  `deps_type`.
- `bind_deps(deps: Mapping[str, Layer | None]) -> None`: bind direct layer
  instance dependencies for one invocation.

Lifecycle hooks:

- `on_context_create() -> None`
- `on_context_resume() -> None`
- `on_context_suspend() -> None`
- `on_context_delete() -> None`

Prompt/tool authoring surfaces:

- `prefix_prompts -> Sequence[PromptT]`
- `suffix_prompts -> Sequence[PromptT]`
- `user_prompts -> Sequence[UserPromptT]`
- `tools -> Sequence[ToolT]`

Aggregation adapters implemented by typed layer families:

- `wrap_prompt(prompt: PromptT) -> object`
- `wrap_user_prompt(prompt: UserPromptT) -> object`
- `wrap_tool(tool: ToolT) -> object`

### Schema defaults and lifecycle enums

- `LayerConfig`: base DTO for serializable layer config schemas.
- `LayerConfigValue`: JSON value or concrete `LayerConfig` DTO.
- `EmptyLayerConfig`: default config schema for layers without config.
- `EmptyRuntimeState`: default serializable runtime-state schema.
- `LayerDeps`: typed dependency container base.
- `NoLayerDeps`: dependency container for layers with no dependencies.
- `LifecycleState`: `NEW`, `ACTIVE`, `SUSPENDED`, `CLOSED`.
- `ExitIntent`: `DELETE`, `SUSPEND`.

`ACTIVE` is internal to an entered run and is rejected in external snapshots.

### Typed layer families: `agenton.layers.types`

- `PlainLayer[DepsT, ConfigT, RuntimeStateT]`
- `PydanticAILayer[DepsT, AgentDepsT, ConfigT, RuntimeStateT]`

Tagged aggregate item types:

- `PlainPromptType`, `PlainUserPromptType`, `PlainToolType`
- `PydanticAIPromptType`, `PydanticAIUserPromptType`, `PydanticAIToolType`
- `AllPromptTypes`, `AllUserPromptTypes`, `AllToolTypes`

## Compositor: `agenton.compositor`

### Config models

- `LayerNodeConfig`: `name`, `type`, `deps`, `metadata`.
- `CompositorConfig`: `schema_version`, `layers`.
- `LayerConfigInput`: accepted per-run config input for one node.

Config nodes are pure serializable graph topology. Per-run layer config is passed
separately to `Compositor.enter(configs=...)` keyed by node name.

### Providers and graph nodes

`LayerProvider[LayerT]` is a reusable validated factory for one concrete layer
class.

- `LayerProvider.from_layer_type(layer_type) -> LayerProvider`: construct through
  `layer_type.from_config`.
- `LayerProvider.from_factory(layer_type=..., create=...) -> LayerProvider`:
  construct through a custom typed-config factory.
- `type_id -> str | None`: provider id declared by the layer type.
- `validate_config(config=None) -> LayerConfig`: validate config without invoking
  the factory.
- `create_layer(config=None) -> LayerT`: validate config and create a fresh layer.
- `create_layer_from_config(config) -> LayerT`: create from already validated
  config and enforce fresh-instance semantics.

`LayerNode(name, implementation, deps=None, metadata=None)` creates a stateless
graph node from a `Layer` subclass or `LayerProvider`. `deps` maps dependency
field names on the node's layer class to other node names.

### `Compositor`

`Compositor[PromptT, ToolT, LayerPromptT, LayerToolT, UserPromptT, LayerUserPromptT]`
owns the ordered graph plan and provider construction plans.

Construction:

- `Compositor(nodes, prompt_transformer=None, user_prompt_transformer=None, tool_transformer=None)`.
- `Compositor.from_config(conf, providers=..., node_providers=None, prompt_transformer=None, user_prompt_transformer=None, tool_transformer=None)`.

Public properties and entry API:

- `nodes -> tuple[LayerNode, ...]`: stateless graph plan in order.
- `enter(configs=None, session_snapshot=None) -> AsyncIterator[CompositorRun]`:
  validate per-run configs and optional snapshot, create fresh layers, bind direct
  dependencies, enter hooks in graph order, and exit hooks in reverse order.

`providers` resolve graph node `type` ids. `node_providers` are keyed by node name
and override type-id providers for node-specific construction.

### `CompositorRun`

`CompositorRun` is the single-invocation runtime object yielded by
`Compositor.enter(...)`.

Fields:

- `slots: OrderedDict[str, LayerRunSlot]`
- `session_snapshot: CompositorSessionSnapshot | None`

Layer access and exit intent:

- `get_layer(name) -> Layer`
- `get_layer(name, layer_type) -> LayerT`
- `suspend_on_exit() -> None`
- `delete_on_exit() -> None`
- `suspend_layer_on_exit(name) -> None`
- `delete_layer_on_exit(name) -> None`

Aggregation properties:

- `prompts -> list[PromptT]`: prefix prompts in layer order, suffix prompts in
  reverse layer order, then optional `prompt_transformer`.
- `user_prompts -> list[UserPromptT]`: user prompts in layer order, then optional
  `user_prompt_transformer`.
- `tools -> list[ToolT]`: tools in layer order, then optional `tool_transformer`.

Snapshot API:

- `snapshot_session() -> CompositorSessionSnapshot`: snapshot non-active layer
  lifecycle state and runtime state.

`session_snapshot` is populated after context exit. Core run slots default to
delete-on-exit; request suspend before exit when the next snapshot must be
resumable.

### Run slots and snapshots

- `LayerRunSlot`: `layer`, `lifecycle_state`, `exit_intent`.
- `LayerSessionSnapshot`: `name`, `lifecycle_state`, `runtime_state`.
- `CompositorSessionSnapshot`: `schema_version`, `layers`.

Snapshots include ordered layer lifecycle state and JSON-safe runtime state only.
They exclude live resources, dependencies, prompts, tools, per-run config, and
exit intent.

## Collection layers and transformers

### Plain layers: `agenton_collections.layers.plain`

- `PromptLayer`: config-backed layer with `PromptLayerConfig(prefix, user,
  suffix)` and `type_id = "plain.prompt"`.
- `ObjectLayer`: factory-backed layer for Python objects.
- `ToolsLayer`: factory-backed layer for plain callables.
- `DynamicToolsLayer`: factory-backed layer for object-bound callables.
- `with_object`: decorator for dynamic tools whose first argument is supplied by
  an `ObjectLayer` dependency.

### Pydantic AI bridge

`agenton_collections.layers.pydantic_ai.PydanticAIBridgeLayer` exposes
pydantic-ai system prompts, user prompts, and tools while depending on an
`ObjectLayer` for `RunContext.deps`.

`agenton_collections.transformers.pydantic_ai.PYDANTIC_AI_TRANSFORMERS` provides:

- `prompt_transformer`: maps tagged Agenton prompt items to pydantic-ai system
  prompt functions.
- `user_prompt_transformer`: maps tagged Agenton user prompt items to pydantic-ai
  `UserContent` values.
- `tool_transformer`: maps tagged Agenton tool items to pydantic-ai tools.
