"""Stateless compositor graph plans and run construction.

``Compositor`` stores only reusable graph nodes and optional aggregation
transformers. Each ``enter(...)`` call validates node-name keyed configs before
any provider factory runs, optionally validates and hydrates a session snapshot,
creates fresh layer instances, binds direct dependencies, and returns a new
``CompositorRun`` for that invocation only.

``Compositor.from_config(...)`` resolves serializable provider type ids rather
than import paths. Named ``node_providers`` override type-id providers for the
same graph node without passing graph node data into factories. Session
snapshots must list layer names in compositor order so runtime state can be
hydrated deterministically.
"""

from collections import OrderedDict
from collections.abc import AsyncIterator, Mapping, Sequence
from contextlib import asynccontextmanager
from dataclasses import dataclass
from typing import Any, Generic, cast

from pydantic import JsonValue

from agenton.layers.base import Layer, LayerConfig, LifecycleState

from .providers import LayerConfigInput, LayerProvider, LayerProviderInput, _as_layer_provider
from .run import CompositorRun, LayerRunSlot
from .schemas import (
    CompositorConfigValue,
    CompositorSessionSnapshot,
    CompositorSessionSnapshotValue,
    _validate_compositor_config_input,
    _validate_config_model_input,
)
from .types import (
    CompositorTransformer,
    LayerPromptT,
    LayerToolT,
    LayerUserPromptT,
    PromptT,
    ToolT,
    UserPromptT,
)


@dataclass(frozen=True, slots=True, init=False)
class LayerNode:
    """Stateless graph node plan for one named layer provider.

    ``implementation`` may be a layer class or an explicit ``LayerProvider``.
    ``deps`` maps dependency field names on this node's layer class to other
    compositor node names. ``metadata`` is graph description data only; it is
    not passed to provider factories and is never included in session snapshots.
    """

    name: str
    provider: LayerProvider[Any]
    deps: Mapping[str, str]
    metadata: Mapping[str, JsonValue]

    def __init__(
        self,
        name: str,
        implementation: LayerProviderInput,
        *,
        deps: Mapping[str, str] | None = None,
        metadata: Mapping[str, JsonValue] | None = None,
    ) -> None:
        if not name:
            raise ValueError("Layer node name must not be empty.")
        object.__setattr__(self, "name", name)
        object.__setattr__(self, "provider", _as_layer_provider(implementation))
        object.__setattr__(self, "deps", dict(deps or {}))
        object.__setattr__(self, "metadata", dict(metadata or {}))


class Compositor(Generic[PromptT, ToolT, LayerPromptT, LayerToolT, UserPromptT, LayerUserPromptT]):
    """Reusable, framework-neutral ordered layer graph plan.

    A compositor stores only immutable graph nodes and provider construction
    plans. It is safe to enter repeatedly or concurrently because every entry
    creates a separate ``CompositorRun`` with fresh layer instances, run slots,
    dependency bindings, and optional hydrated runtime state. Session
    continuity is explicit: pass the previous ``CompositorSessionSnapshot`` to
    the next ``enter`` call and read the next one from ``run.session_snapshot``
    after exit.

    ``prompt_transformer``, ``user_prompt_transformer``, and
    ``tool_transformer`` are post-aggregation hooks on each run. Use two type
    arguments for identity aggregation, four when prompt/tool layer item types
    differ from exposed item types, or all six when user prompt item types also
    differ.
    """

    __slots__ = ("_nodes", "prompt_transformer", "tool_transformer", "user_prompt_transformer")

    _nodes: tuple[LayerNode, ...]
    prompt_transformer: CompositorTransformer[LayerPromptT, PromptT] | None
    user_prompt_transformer: CompositorTransformer[LayerUserPromptT, UserPromptT] | None
    tool_transformer: CompositorTransformer[LayerToolT, ToolT] | None

    def __init__(
        self,
        nodes: Sequence[LayerNode],
        *,
        prompt_transformer: CompositorTransformer[LayerPromptT, PromptT] | None = None,
        user_prompt_transformer: CompositorTransformer[LayerUserPromptT, UserPromptT] | None = None,
        tool_transformer: CompositorTransformer[LayerToolT, ToolT] | None = None,
    ) -> None:
        self._nodes = tuple(nodes)
        self.prompt_transformer = prompt_transformer
        self.user_prompt_transformer = user_prompt_transformer
        self.tool_transformer = tool_transformer
        self._validate_nodes()

    @property
    def nodes(self) -> tuple[LayerNode, ...]:
        """Return the stateless graph plan nodes in compositor order."""
        return self._nodes

    @classmethod
    def from_config(
        cls,
        conf: CompositorConfigValue,
        *,
        providers: Sequence[LayerProviderInput],
        node_providers: Mapping[str, LayerProviderInput] | None = None,
        prompt_transformer: CompositorTransformer[LayerPromptT, PromptT] | None = None,
        user_prompt_transformer: CompositorTransformer[LayerUserPromptT, UserPromptT] | None = None,
        tool_transformer: CompositorTransformer[LayerToolT, ToolT] | None = None,
    ) -> "Compositor[PromptT, ToolT, LayerPromptT, LayerToolT, UserPromptT, LayerUserPromptT]":
        """Create a reusable compositor plan from serializable graph config.

        ``providers`` resolve graph node ``type`` ids. ``node_providers`` are
        keyed by graph node name and take precedence over the type-id provider,
        allowing node-specific construction without passing node data to factory
        callables.
        """
        graph_config = _validate_compositor_config_input(conf)
        if graph_config.schema_version != 1:
            raise ValueError(f"Unsupported compositor config schema_version: {graph_config.schema_version}.")

        provider_by_type = _build_provider_type_map(providers)
        provider_by_node = {name: _as_layer_provider(provider) for name, provider in (node_providers or {}).items()}
        graph_node_names = {node.name for node in graph_config.layers}
        unknown_node_providers = provider_by_node.keys() - graph_node_names
        if unknown_node_providers:
            names = ", ".join(sorted(unknown_node_providers))
            raise ValueError(f"node_providers contains unknown layer node names: {names}.")

        nodes: list[LayerNode] = []
        for node_config in graph_config.layers:
            provider = provider_by_node.get(node_config.name)
            if provider is None:
                try:
                    provider = provider_by_type[node_config.type]
                except KeyError as e:
                    raise KeyError(f"Layer type id '{node_config.type}' is not registered.") from e
            nodes.append(
                LayerNode(
                    node_config.name,
                    provider,
                    deps=node_config.deps,
                    metadata=node_config.metadata,
                )
            )

        return cls(
            nodes,
            prompt_transformer=prompt_transformer,
            user_prompt_transformer=user_prompt_transformer,
            tool_transformer=tool_transformer,
        )

    @asynccontextmanager
    async def enter(
        self,
        *,
        configs: Mapping[str, LayerConfigInput] | None = None,
        session_snapshot: CompositorSessionSnapshotValue | None = None,
    ) -> AsyncIterator[CompositorRun[PromptT, ToolT, LayerPromptT, LayerToolT, UserPromptT, LayerUserPromptT]]:
        """Create a fresh run, enter layers in graph order, and yield it.

        Configs are keyed by layer node name and validated before factories run.
        The optional session snapshot is validated and hydrated before any hook
        runs. Layers exit in reverse graph order, and ``run.session_snapshot``
        is populated after exit with the next non-active lifecycle states.
        """
        run = self._create_run(configs=configs, session_snapshot=session_snapshot)
        await run._enter_layers()
        try:
            yield run
        finally:
            await run._exit_layers()

    def _create_run(
        self,
        *,
        configs: Mapping[str, LayerConfigInput] | None,
        session_snapshot: CompositorSessionSnapshotValue | None,
    ) -> CompositorRun[PromptT, ToolT, LayerPromptT, LayerToolT, UserPromptT, LayerUserPromptT]:
        config_by_name = self._validate_run_configs(configs)
        typed_config_by_name = self._validate_layer_configs(config_by_name)
        snapshot = self._validate_session_snapshot(session_snapshot) if session_snapshot is not None else None
        layer_by_name = self._create_layers(typed_config_by_name)

        snapshot_by_name = (
            {layer_snapshot.name: layer_snapshot for layer_snapshot in snapshot.layers} if snapshot else {}
        )
        lifecycle_by_name: dict[str, LifecycleState] = {}
        for node in self._nodes:
            layer = layer_by_name[node.name]
            layer_snapshot = snapshot_by_name.get(node.name)
            if layer_snapshot is None:
                lifecycle_by_name[node.name] = LifecycleState.NEW
                continue
            layer.runtime_state = cast(Any, layer.runtime_state_type.model_validate(layer_snapshot.runtime_state))
            lifecycle_by_name[node.name] = layer_snapshot.lifecycle_state

        self._bind_deps(layer_by_name)
        return CompositorRun(
            slots=OrderedDict(
                (node.name, LayerRunSlot(layer=layer_by_name[node.name], lifecycle_state=lifecycle_by_name[node.name]))
                for node in self._nodes
            ),
            prompt_transformer=self.prompt_transformer,
            user_prompt_transformer=self.user_prompt_transformer,
            tool_transformer=self.tool_transformer,
        )

    def _create_layers(
        self,
        config_by_name: Mapping[str, LayerConfig],
    ) -> OrderedDict[str, Layer[Any, Any, Any, Any, Any, Any]]:
        return OrderedDict(
            (node.name, node.provider.create_layer_from_config(config_by_name[node.name])) for node in self._nodes
        )

    def _validate_layer_configs(self, config_by_name: Mapping[str, LayerConfigInput]) -> dict[str, LayerConfig]:
        """Validate every node config before any provider factory is invoked."""
        return {node.name: node.provider.validate_config(config_by_name.get(node.name)) for node in self._nodes}

    def _bind_deps(self, layer_by_name: Mapping[str, Layer[Any, Any, Any, Any, Any, Any]]) -> None:
        """Resolve dependency-name mappings and bind direct layer dependencies."""
        for node in self._nodes:
            layer = layer_by_name[node.name]
            resolved_deps = {dep_name: layer_by_name[target_name] for dep_name, target_name in node.deps.items()}
            layer.bind_deps(resolved_deps)

    def _validate_nodes(self) -> None:
        layer_names: set[str] = set()
        for node in self._nodes:
            if node.name in layer_names:
                raise ValueError(f"Duplicate layer name '{node.name}'.")
            layer_names.add(node.name)

        for node in self._nodes:
            declared_deps = node.provider.layer_type.dependency_names()
            unknown_dep_keys = set(node.deps) - declared_deps
            if unknown_dep_keys:
                names = ", ".join(sorted(unknown_dep_keys))
                raise ValueError(f"Layer '{node.name}' declares unknown dependency keys: {names}.")
            missing_targets = set(node.deps.values()) - layer_names
            if missing_targets:
                names = ", ".join(sorted(missing_targets))
                raise ValueError(f"Layer '{node.name}' depends on undefined layer names: {names}.")

    def _validate_run_configs(self, configs: Mapping[str, LayerConfigInput] | None) -> dict[str, LayerConfigInput]:
        config_by_name = dict(configs or {})
        known_names = {node.name for node in self._nodes}
        unknown_names = config_by_name.keys() - known_names
        if unknown_names:
            names = ", ".join(sorted(unknown_names))
            raise ValueError(f"Layer configs contain unknown layer node names: {names}.")
        return config_by_name

    def _validate_session_snapshot(
        self,
        snapshot: CompositorSessionSnapshotValue,
    ) -> CompositorSessionSnapshot:
        resolved_snapshot = _validate_config_model_input(CompositorSessionSnapshot, snapshot)
        if resolved_snapshot.schema_version != 1:
            raise ValueError(
                f"Unsupported compositor session snapshot schema_version: {resolved_snapshot.schema_version}."
            )
        expected_layer_names = tuple(node.name for node in self._nodes)
        actual_layer_names = tuple(layer.name for layer in resolved_snapshot.layers)
        if actual_layer_names != expected_layer_names:
            expected = ", ".join(expected_layer_names)
            actual = ", ".join(actual_layer_names)
            raise ValueError(
                "CompositorSessionSnapshot layer names must match compositor layers in order. "
                f"Expected [{expected}], got [{actual}]."
            )
        return resolved_snapshot


def _build_provider_type_map(providers: Sequence[LayerProviderInput]) -> dict[str, LayerProvider[Any]]:
    provider_by_type: dict[str, LayerProvider[Any]] = {}
    for provider_input in providers:
        provider = _as_layer_provider(provider_input)
        type_id = provider.type_id
        if type_id is None or not type_id:
            raise ValueError(f"Layer provider for '{provider.layer_type.__qualname__}' must declare a type_id.")
        if type_id in provider_by_type:
            raise ValueError(f"Layer type id '{type_id}' is already registered.")
        provider_by_type[type_id] = provider
    return provider_by_type
