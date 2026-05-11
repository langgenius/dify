# Agenton API reference

This page summarizes the public Agenton API. Import paths are shown for the
symbols commonly used by layer authors and compositor callers.

## Layers: `agenton.layers`

### `Layer[DepsT, PromptT, UserPromptT, ToolT, ConfigT, RuntimeStateT, RuntimeHandlesT]`

Framework-neutral base class for prompt/tool layers.

Class attributes:

- `type_id: str | None`: registry id for config-backed plugin layers.
- `config_type: type[BaseModel]`: Pydantic schema for serialized layer config.
- `runtime_state_type: type[BaseModel]`: Pydantic schema for snapshot-safe
  per-session state.
- `runtime_handles_type: type[BaseModel]`: Pydantic schema for live runtime
  handles; use `arbitrary_types_allowed=True` for client/process objects.
- `deps_type: type[LayerDeps]`: inferred from the layer generic base or declared
  explicitly.

Construction and dependency APIs:

- `from_config(config: ConfigT) -> Self`: create a layer from schema-validated
  config. The default implementation raises `TypeError`.
- `dependency_names() -> frozenset[str]`: dependency fields declared by
  `deps_type`.
- `bind_deps(deps: Mapping[str, Layer | None]) -> None`: bind graph dependencies.
- `new_control(state=LifecycleState.NEW, runtime_state=None) -> LayerControl`: create
  a schema-validated per-session control.

Lifecycle hooks:

- `on_context_create(control)`
- `on_context_resume(control)`
- `on_context_suspend(control)`
- `on_context_delete(control)`
- `enter(control)` / `lifecycle_enter(control)`: async context manager entry
  surface. Override `enter()` only when a layer needs to wrap extra resources.

Prompt/tool authoring surfaces:

- `prefix_prompts -> Sequence[PromptT]`
- `suffix_prompts -> Sequence[PromptT]`
- `user_prompts -> Sequence[UserPromptT]`
- `tools -> Sequence[ToolT]`

Aggregation adapters implemented by typed layer families:

- `wrap_prompt(prompt: PromptT) -> object`
- `wrap_user_prompt(prompt: UserPromptT) -> object`
- `wrap_tool(tool: ToolT) -> object`

### `LayerControl[RuntimeStateT, RuntimeHandlesT]`

Per-layer, per-session lifecycle control.

Fields:

- `state: LifecycleState`
- `exit_intent: ExitIntent`
- `runtime_state: RuntimeStateT`
- `runtime_handles: RuntimeHandlesT`

Methods:

- `suspend_on_exit() -> None`
- `delete_on_exit() -> None`

`runtime_state` is serialized in session snapshots. `runtime_handles` is never
serialized and should be rehydrated from runtime state in resume hooks.

### Schema defaults and lifecycle enums

- `EmptyLayerConfig`
- `EmptyRuntimeState`
- `EmptyRuntimeHandles`
- `LifecycleState`: `NEW`, `ACTIVE`, `SUSPENDED`, `CLOSED`
- `ExitIntent`: `DELETE`, `SUSPEND`

### Typed layer families: `agenton.layers.types`

- `PlainLayer[DepsT, ConfigT, RuntimeStateT, RuntimeHandlesT]`
- `PydanticAILayer[DepsT, AgentDepsT, ConfigT, RuntimeStateT, RuntimeHandlesT]`

Tagged aggregate item types:

- `PlainPromptType`, `PlainUserPromptType`, `PlainToolType`
- `PydanticAIPromptType`, `PydanticAIUserPromptType`, `PydanticAIToolType`
- `AllPromptTypes`, `AllUserPromptTypes`, `AllToolTypes`

## Compositor: `agenton.compositor`

### Config models

- `LayerNodeConfig`: `name`, `type`, `config`, `deps`, `metadata`
- `CompositorConfig`: `schema_version`, `layers`

Config nodes are pure serializable graph input. Use live instances for Python
objects and callables.

### Registry

`LayerRegistry` manually registers config-backed layer classes.

- `register_layer(layer_type, type_id=None) -> None`
- `resolve(type_id) -> LayerDescriptor`
- `descriptors() -> Mapping[str, LayerDescriptor]`

`LayerDescriptor` exposes `type_id`, `layer_type`, `config_type`,
`runtime_state_type`, and `runtime_handles_type`.

### Builder

`CompositorBuilder(registry)` mixes config-backed nodes and live instances.

- `add_config(config) -> Self`
- `add_config_layer(name, type, config=None, deps=None) -> Self`
- `add_instance(name, layer, deps=None) -> Self`
- `build(prompt_transformer=None, user_prompt_transformer=None, tool_transformer=None) -> Compositor`

### Compositor

`Compositor[PromptT, ToolT, LayerPromptT, LayerToolT, UserPromptT, LayerUserPromptT]`
owns the ordered layer graph.

Construction:

- `Compositor(layers=..., deps_name_mapping=..., ...)`
- `Compositor.from_config(conf, registry=..., ...)`

Aggregation properties:

- `prompts -> list[PromptT]`: prefix prompts in layer order, suffix prompts in
  reverse layer order, then optional `prompt_transformer`.
- `user_prompts -> list[UserPromptT]`: user prompts in layer order, then optional
  `user_prompt_transformer`.
- `tools -> list[ToolT]`: tools in layer order, then optional `tool_transformer`.

Session APIs:

- `new_session() -> CompositorSession`
- `enter(session=None) -> AsyncIterator[CompositorSession]`
- `snapshot_session(session) -> CompositorSessionSnapshot`
- `session_from_snapshot(snapshot) -> CompositorSession`

### Sessions and snapshots

`CompositorSession` owns ordered layer controls.

- `suspend_on_exit() -> None`
- `delete_on_exit() -> None`
- `layer(name) -> LayerControl`

Snapshot models:

- `LayerSessionSnapshot`: `name`, `state`, `runtime_state`
- `CompositorSessionSnapshot`: `schema_version`, `layers`

Snapshots reject active sessions and exclude `runtime_handles` and `exit_intent`.

## Collection layers and transformers

### Plain layers: `agenton_collections.layers.plain`

- `PromptLayer`: config-backed layer with `PromptLayerConfig(prefix, user,
  suffix)` and `type_id = "plain.prompt"`.
- `ObjectLayer`: instance-only layer for Python objects.
- `ToolsLayer`: instance-only layer for callables.
- `DynamicToolsLayer`: instance-only layer for object-bound callables.

### Pydantic AI bridge

`agenton_collections.layers.pydantic_ai.PydanticAIBridgeLayer` exposes
pydantic-ai system prompts, user prompts, and tools while depending on an
`ObjectLayer` for `RunContext.deps`.

`agenton_collections.transformers.PYDANTIC_AI_TRANSFORMERS` provides:

- `prompt_transformer`: maps `compositor.prompts` to pydantic-ai system prompt functions.
- `user_prompt_transformer`: maps `compositor.user_prompts` to pydantic-ai `UserContent`.
- `tool_transformer`: maps `compositor.tools` to pydantic-ai tools.
