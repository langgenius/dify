"""Layer composition primitives.

The compositor owns a named, ordered set of layers. ``Compositor[PromptT,
ToolT]`` is framework-neutral; callers choose prompt/tool item types by
annotating construction or assignment sites. Use
``agenton.compositor.helpers.make_compositor`` when type inference from layer
arguments is useful; it lives in a child module so the core compositor does not
depend on its helper overloads.

Dependency mappings use layer-local dependency names as keys and compositor
layer names as values. Prompt aggregation depends on insertion order: prefix
prompts are collected from first to last layer, while suffix prompts are
collected in reverse.

``Compositor.context`` enters layer contexts in compositor order and exits them
in reverse order through ``AsyncExitStack``. It yields per-layer lifecycle
signals so callers can mark individual layers, or all layers, as temporarily
leaving.
"""

from collections import OrderedDict
from collections.abc import AsyncIterator
from contextlib import AsyncExitStack, asynccontextmanager
from dataclasses import dataclass, field
from importlib import import_module
from typing import TYPE_CHECKING, Annotated, Any, Mapping, cast

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, JsonValue
from typing_extensions import Self

from agenton.layers.base import Layer, LayerContextSignal


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


@dataclass(slots=True)
class CompositorContext:
    """Signal slots for layer contexts entered by a compositor."""

    signals: OrderedDict[str, LayerContextSignal]

    @property
    def temporary_leave(self) -> bool:
        """Whether any entered layer is currently marked for temporary leave."""
        return any(signal.temporary_leave for signal in self.signals.values())

    @temporary_leave.setter
    def temporary_leave(self, value: bool) -> None:
        for signal in self.signals.values():
            signal.temporary_leave = value


@dataclass(kw_only=True)
class Compositor[PromptT, ToolT]:
    """Framework-neutral ordered layer graph with lifecycle and aggregation."""

    layers: OrderedDict[str, Layer[Any, PromptT, ToolT]]
    deps_name_mapping: Mapping[str, Mapping[str, str]] = field(default_factory=dict)
    _deps_bound: bool = field(default=False, init=False)

    def __post_init__(self) -> None:
        self._bind_deps(self.deps_name_mapping)

    @classmethod
    def from_config(cls, conf: CompositorConfigValue) -> Self:
        """Create layers from config-like input and bind named dependencies."""
        conf = _validate_compositor_config_input(conf)
        layers: OrderedDict[str, Layer[Any, PromptT, ToolT]] = OrderedDict()
        for layer_conf in conf.layers:
            layers[layer_conf.name] = cast(Layer[Any, PromptT, ToolT], layer_conf.create_layer())

        deps_name_mapping = {layer_conf.name: layer_conf.deps for layer_conf in conf.layers}
        return cls(layers=layers, deps_name_mapping=deps_name_mapping)

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

    @asynccontextmanager
    async def context(self) -> AsyncIterator[CompositorContext]:
        """Enter each layer context in order and yield their signal slots."""
        if not self._deps_bound:
            raise RuntimeError("Compositor deps must be bound before entering context.")
        signals: OrderedDict[str, LayerContextSignal] = OrderedDict()
        async with AsyncExitStack() as stack:
            for layer_name, layer in self.layers.items():
                signals[layer_name] = await stack.enter_async_context(layer.context())
            yield CompositorContext(signals=signals)

    @property
    def prompts(self) -> list[PromptT]:
        result: list[PromptT] = []
        for layer in self.layers.values():
            result.extend(layer.prefix_prompts)
        for layer in reversed(self.layers.values()):
            result.extend(layer.suffix_prompts)
        return result

    @property
    def tools(self) -> list[ToolT]:
        result: list[ToolT] = []
        for layer in self.layers.values():
            result.extend(layer.tools)
        return result


__all__ = [
    "Compositor",
    "CompositorConfig",
    "CompositorConfigValue",
    "CompositorLayerConfigInput",
    "CompositorContext",
    "CompositorLayerConfig",
    "CompositorLayerConfigValue",
    "ImportedLayerConfig",
    "LayerSpec",
]
