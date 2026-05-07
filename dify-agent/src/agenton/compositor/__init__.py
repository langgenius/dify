"""Layer composition primitives.

The compositor owns a named, ordered set of layers. ``Compositor[PromptT,
ToolT, LayerPromptT, LayerToolT]`` is framework-neutral; callers choose layer and
exposed prompt/tool item types by annotating construction or assignment sites.
When only the first two type arguments are supplied, ``LayerPromptT`` and
``LayerToolT`` default to the corresponding exposed item types.

Layer instances are shared graph/capability definitions owned by the compositor.
Per-session runtime state belongs to each session's ``LayerControl`` objects,
not to the shared layer instances, so different sessions can enter the same
compositor without leaking generated ids or handles through ``self``.

Dependency mappings use layer-local dependency names as keys and compositor
layer names as values. Prompt aggregation depends on insertion order: prefix
prompts are collected from first to last layer, while suffix prompts are
collected in reverse.

``Compositor.enter`` enters layers in compositor order and exits them in reverse
order through ``AsyncExitStack``. It accepts an optional ``CompositorSession``
whose layer controls must match the compositor layer names and order. When
omitted, a fresh session is created. Reusing a suspended session resumes its
layer contexts; closed sessions must be replaced.

Optional prompt and tool transformers run after layer aggregation. The
compositor asks each layer to ``wrap_prompt`` and ``wrap_tool`` its native
values, so typed layer families can tag prompt/tool values without changing
their authoring contracts. When transformers are omitted, the compositor
returns those wrapped items unchanged.
"""

from collections import OrderedDict
from collections.abc import AsyncIterator, Callable, Iterable, Sequence
from contextlib import AsyncExitStack, asynccontextmanager
from dataclasses import dataclass, field
from importlib import import_module
from typing import TYPE_CHECKING, Annotated, Any, Generic, Mapping, TypedDict, cast

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, JsonValue
from typing_extensions import Self, TypeVar

from agenton.layers.base import Layer, LayerControl, LifecycleState
from agenton.layers.types import AllPromptTypes, AllToolTypes

PromptT = TypeVar("PromptT", default=AllPromptTypes)
ToolT = TypeVar("ToolT", default=AllToolTypes)
LayerPromptT = TypeVar("LayerPromptT", default=AllPromptTypes)
LayerToolT = TypeVar("LayerToolT", default=AllToolTypes)


class ImportedLayerConfig(BaseModel):
    """Config for constructing one layer from an import path."""

    import_path: str
    config: Any = None

    model_config = ConfigDict(arbitrary_types_allowed=True)

    def create_layer(self) -> Layer[Any, Any, Any]:
        """Import the target layer class and create it from config."""
        try:
            import_module_name, import_target = self.import_path.rsplit(":", 1)
        except ValueError as e:
            raise ValueError(
                f"Invalid import string '{self.import_path}'. "
                "It should be in the format 'module:ClassName'."
            ) from e

        layer_t = getattr(import_module(import_module_name), import_target)
        if not isinstance(layer_t, type) or not issubclass(layer_t, Layer):
            raise TypeError(f"Imported target '{self.import_path}' must be a Layer subclass.")
        return layer_t.from_config(config=self.config)


LayerSpec = Layer[Any, Any, Any] | ImportedLayerConfig
type CompositorTransformer[InputT, OutputT] = Callable[[Sequence[InputT]], Sequence[OutputT]]


class CompositorTransformerKwargs[PromptT, ToolT, LayerPromptT, LayerToolT](TypedDict):
    """Keyword arguments that install prompt and tool transformers together."""

    prompt_transformer: CompositorTransformer[LayerPromptT, PromptT]
    tool_transformer: CompositorTransformer[LayerToolT, ToolT]


type _ConfigModelValue[ModelT: BaseModel] = ModelT | JsonValue | str | bytes


def _validate_config_model_input[ModelT: BaseModel](
    model_type: type[ModelT],
    value: _ConfigModelValue[ModelT] | Mapping[str, object],
) -> ModelT:
    if isinstance(value, model_type):
        return value
    if isinstance(value, str | bytes):
        return model_type.model_validate_json(value)

    return model_type.model_validate(value)


class CompositorLayerConfig(BaseModel):
    """Config entry for one named layer in a compositor.

    ``layer`` may be either an already constructed layer instance or an
    ``ImportedLayerConfig``. Direct instances are already initialized, so config
    for imported layers lives inside ``ImportedLayerConfig`` instead of beside
    the graph node fields.
    """

    name: str
    deps: Mapping[str, str] = Field(default_factory=dict)
    layer: LayerSpec

    model_config = ConfigDict(arbitrary_types_allowed=True)

    def create_layer(self) -> Layer[Any, Any, Any]:
        """Create or return the configured layer instance."""
        if isinstance(self.layer, Layer):
            return self.layer
        return self.layer.create_layer()


type CompositorLayerConfigValue = _ConfigModelValue[CompositorLayerConfig]


def _validate_layer_config_input(value: CompositorLayerConfigValue) -> CompositorLayerConfig:
    return _validate_config_model_input(CompositorLayerConfig, value)


type CompositorLayerConfigInput = Annotated[
    CompositorLayerConfigValue,
    AfterValidator(_validate_layer_config_input),
]


class CompositorConfig(BaseModel):
    """Serializable config for constructing a compositor graph.

    ``layers`` accepts ready-made ``CompositorLayerConfig`` instances, raw JSON
    values, or JSON-encoded strings/bytes. After validation, callers always see
    normalized ``CompositorLayerConfig`` objects.
    """

    if TYPE_CHECKING:
        layers: list[CompositorLayerConfig]
    else:
        layers: list[CompositorLayerConfigInput]


type CompositorConfigValue = _ConfigModelValue[CompositorConfig] | Mapping[str, object]


def _validate_compositor_config_input(value: CompositorConfigValue) -> CompositorConfig:
    return _validate_config_model_input(CompositorConfig, value)


class CompositorSession:
    """External lifecycle session for layer contexts entered by a compositor.

    A session owns one ``LayerControl`` per compositor layer name, preserving
    compositor order. Broadcast methods are convenience APIs for setting every
    layer's per-entry exit intent; ``layer`` allows explicit per-layer control
    when callers need partial suspend/delete behavior. A mixed session with any
    closed layer cannot be entered again because compositor entry is all-or-none.
    """

    __slots__ = ("layer_controls",)

    layer_controls: OrderedDict[str, LayerControl]

    def __init__(self, layer_names: Iterable[str]) -> None:
        self.layer_controls = OrderedDict(
            (layer_name, LayerControl()) for layer_name in layer_names
        )

    def suspend_on_exit(self) -> None:
        """Request suspend behavior for every layer when this entry exits."""
        for control in self.layer_controls.values():
            control.suspend_on_exit()

    def delete_on_exit(self) -> None:
        """Request delete behavior for every layer when this entry exits."""
        for control in self.layer_controls.values():
            control.delete_on_exit()

    def layer(self, name: str) -> LayerControl:
        """Return the layer control for ``name`` or raise ``KeyError``."""
        return self.layer_controls[name]


@dataclass(kw_only=True)
class Compositor(Generic[PromptT, ToolT, LayerPromptT, LayerToolT]):
    """Framework-neutral ordered layer graph with lifecycle and aggregation.

    ``prompt_transformer`` and ``tool_transformer`` are post-aggregation hooks:
    they run whenever ``prompts`` or ``tools`` is read, after layer
    contributions have been collected in compositor order. Use two type
    arguments for identity aggregation, or all four when layer item types differ
    from exposed item types.
    """

    layers: OrderedDict[str, Layer[Any, Any, Any]]
    deps_name_mapping: Mapping[str, Mapping[str, str]] = field(default_factory=dict)
    prompt_transformer: CompositorTransformer[LayerPromptT, PromptT] | None = None
    tool_transformer: CompositorTransformer[LayerToolT, ToolT] | None = None
    _deps_bound: bool = field(default=False, init=False)

    def __post_init__(self) -> None:
        self._bind_deps(self.deps_name_mapping)

    @classmethod
    def from_config(
        cls,
        conf: CompositorConfigValue,
        *,
        prompt_transformer: CompositorTransformer[LayerPromptT, PromptT] | None = None,
        tool_transformer: CompositorTransformer[LayerToolT, ToolT] | None = None,
    ) -> Self:
        """Create layers from config-like input and bind named dependencies."""
        conf = _validate_compositor_config_input(conf)
        layers: OrderedDict[str, Layer[Any, Any, Any]] = OrderedDict()
        for layer_conf in conf.layers:
            layers[layer_conf.name] = layer_conf.create_layer()

        deps_name_mapping = {layer_conf.name: layer_conf.deps for layer_conf in conf.layers}
        return cls(
            layers=layers,
            deps_name_mapping=deps_name_mapping,
            prompt_transformer=prompt_transformer,
            tool_transformer=tool_transformer,
        )

    def _bind_deps(self, deps_name_mapping: Mapping[str, Mapping[str, str]]) -> None:
        """Resolve dependency-name mappings and bind dependencies on each layer.

        The outer mapping key is the layer being bound. The inner mapping key is
        the dependency field declared by that layer's deps type, and the value is
        the target layer name in this compositor.
        """
        if self._deps_bound:
            raise RuntimeError("Compositor deps are already bound.")

        for layer_name, layer in self.layers.items():
            layer_deps = deps_name_mapping.get(layer_name, {})
            try:
                deps = {
                    dep_name: self.layers[target_layer_name]
                    for dep_name, target_layer_name in layer_deps.items()
                }
            except KeyError as e:
                raise ValueError(
                    f"Layer '{layer_name}' has a dependency on layer '{e.args[0]}', "
                    "which is not defined in the builder."
                ) from e
            layer.bind_deps({**self.layers, **deps})
        self._deps_bound = True

    def new_session(self) -> CompositorSession:
        """Create a fresh lifecycle session matching this compositor's layer order."""
        return CompositorSession(self.layers)

    @asynccontextmanager
    async def enter(
        self,
        session: CompositorSession | None = None,
    ) -> AsyncIterator[CompositorSession]:
        """Enter each layer context in order and yield the active session."""
        if not self._deps_bound:
            raise RuntimeError("Compositor deps must be bound before entering context.")

        if session is None:
            session = self.new_session()
        self._validate_session(session)
        self._ensure_session_can_enter(session)

        async with AsyncExitStack() as stack:
            for layer_name, layer in self.layers.items():
                await stack.enter_async_context(layer.enter(session.layer_controls[layer_name]))
            yield session

    def _validate_session(self, session: CompositorSession) -> None:
        expected_layer_names = tuple(self.layers)
        actual_layer_names = tuple(session.layer_controls)
        if actual_layer_names != expected_layer_names:
            expected = ", ".join(expected_layer_names)
            actual = ", ".join(actual_layer_names)
            raise ValueError(
                "CompositorSession layer names must match compositor layers in order. "
                f"Expected [{expected}], got [{actual}]."
            )

    def _ensure_session_can_enter(self, session: CompositorSession) -> None:
        """Reject active or closed layer controls before any layer side effects."""
        for control in session.layer_controls.values():
            if control.state is LifecycleState.ACTIVE:
                raise RuntimeError(
                    "LayerControl is already active; duplicate or nested enter is not allowed."
                )
            if control.state is LifecycleState.CLOSED:
                raise RuntimeError(
                    "LayerControl is closed; create a new compositor session before entering again."
                )

    @property
    def prompts(self) -> list[PromptT]:
        result: list[LayerPromptT] = []
        for layer in self.layers.values():
            result.extend(
                cast(LayerPromptT, layer.wrap_prompt(prompt))
                for prompt in layer.prefix_prompts
            )
        for layer in reversed(self.layers.values()):
            result.extend(
                cast(LayerPromptT, layer.wrap_prompt(prompt))
                for prompt in layer.suffix_prompts
            )
        if self.prompt_transformer is None:
            return cast(list[PromptT], result)
        return list(self.prompt_transformer(result))

    @property
    def tools(self) -> list[ToolT]:
        result: list[LayerToolT] = []
        for layer in self.layers.values():
            result.extend(cast(LayerToolT, layer.wrap_tool(tool)) for tool in layer.tools)
        if self.tool_transformer is None:
            return cast(list[ToolT], result)
        return list(self.tool_transformer(result))


__all__ = [
    "Compositor",
    "CompositorConfig",
    "CompositorConfigValue",
    "CompositorLayerConfigInput",
    "CompositorSession",
    "CompositorTransformer",
    "CompositorTransformerKwargs",
    "CompositorLayerConfig",
    "CompositorLayerConfigValue",
    "ImportedLayerConfig",
    "LayerSpec",
]
