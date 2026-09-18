"""Reusable layer providers and fresh-instance validation.

Providers are construction plans, not live runtime owners. They validate raw
per-enter config into a layer's declared ``config_type`` and then construct a
fresh layer instance for one invocation. Provider factories receive only typed
config, never graph node data; node-specific construction belongs in named
``node_providers`` overrides on ``Compositor.from_config(...)``.

Fresh-instance enforcement is global by weak reference so ``Compositor`` can
stay stateless while still rejecting reused layer instances before dependency
binding or lifecycle hooks run.
"""

from collections.abc import Callable, Mapping
from typing import Any, Generic, cast
import weakref

from agenton.layers.base import Layer, LayerConfig, LayerConfigValue

from .schemas import _validate_config_model_input
from .types import LayerT

type LayerConfigInput = LayerConfigValue | Mapping[str, object] | str | bytes | None
type LayerFactory = Callable[[LayerConfig], Layer[Any, Any, Any, Any, Any, Any]]
type LayerProviderInput = type[Layer[Any, Any, Any, Any, Any, Any]] | "LayerProvider[Any]"


_USED_LAYER_INSTANCE_REFS: dict[int, weakref.ReferenceType[Layer[Any, Any, Any, Any, Any, Any]]] = {}


def _claim_fresh_layer_instance(layer: Layer[Any, Any, Any, Any, Any, Any]) -> None:
    """Reject provider factories that return a layer object used before.

    The registry stores weak references, not live resources or run state. It is
    intentionally global to keep ``Compositor`` stateless while still enforcing
    the fresh-instance boundary before dependencies are bound or hooks run.
    """
    layer_identity = id(layer)
    existing_ref = _USED_LAYER_INSTANCE_REFS.get(layer_identity)
    if existing_ref is not None:
        existing_layer = existing_ref()
        if existing_layer is not None:
            raise ValueError(
                "LayerProvider factories must return a fresh layer instance for each invocation; "
                f"got reused instance of '{type(layer).__name__}'."
            )
        _USED_LAYER_INSTANCE_REFS.pop(layer_identity, None)

    def remove_ref(ref: weakref.ReferenceType[Layer[Any, Any, Any, Any, Any, Any]]) -> None:
        if _USED_LAYER_INSTANCE_REFS.get(layer_identity) is ref:
            _USED_LAYER_INSTANCE_REFS.pop(layer_identity, None)

    _USED_LAYER_INSTANCE_REFS[layer_identity] = weakref.ref(layer, remove_ref)


class LayerProvider(Generic[LayerT]):
    """Validated layer factory for one concrete ``Layer`` class.

    Providers are reusable construction plans. They validate per-call config
    with ``layer_type.config_type`` before invoking either
    ``layer_type.from_config`` or a custom factory. The factory receives only
    typed config, never graph node data, and must return a fresh ``layer_type``
    instance; reused instances are rejected before dependencies are bound or
    hooks run.
    """

    __slots__ = ("_create", "layer_type")

    layer_type: type[LayerT]
    _create: Callable[[LayerConfig], LayerT]

    def __init__(self, *, layer_type: type[LayerT], create: Callable[[LayerConfig], LayerT]) -> None:
        self.layer_type = layer_type
        self._create = create

    @classmethod
    def from_layer_type(cls, layer_type: type[LayerT]) -> "LayerProvider[LayerT]":
        """Create a provider that constructs layers via ``layer_type.from_config``."""

        def create(config: LayerConfig) -> LayerT:
            return layer_type.from_config(cast(Any, config))

        return cls(layer_type=layer_type, create=create)

    @classmethod
    def from_factory(
        cls,
        *,
        layer_type: type[LayerT],
        create: Callable[[Any], LayerT],
    ) -> "LayerProvider[LayerT]":
        """Create a provider from a custom typed-config factory.

        ``create`` receives the validated instance of ``layer_type.config_type``.
        It does not receive the graph node; node-specific construction should use
        a dedicated provider in ``Compositor.from_config(node_providers=...)``.
        """
        return cls(layer_type=layer_type, create=cast(Callable[[LayerConfig], LayerT], create))

    @property
    def type_id(self) -> str | None:
        """Return the serializable registry type id declared by ``layer_type``."""
        return self.layer_type.type_id

    def create_layer(self, config: LayerConfigInput = None) -> LayerT:
        """Validate config, call the factory, and return a fresh layer instance."""
        typed_config = self.validate_config(config)
        return self.create_layer_from_config(typed_config)

    def validate_config(self, config: LayerConfigInput = None) -> LayerConfig:
        """Return typed config without invoking the layer factory.

        ``Compositor.enter`` calls this for every node before creating any layer
        so a later invalid node config cannot leave earlier factory side effects.
        """
        raw_config: LayerConfigValue | Mapping[str, object] | str | bytes = {} if config is None else config
        return _validate_config_model_input(self.layer_type.config_type, raw_config)

    def create_layer_from_config(self, config: LayerConfig) -> LayerT:
        """Call the factory with validated config and enforce fresh instances."""
        typed_config = self.validate_config(config)
        layer = self._create(typed_config)
        if not isinstance(layer, self.layer_type):
            raise TypeError(
                f"LayerProvider for '{self.layer_type.__name__}' returned '{type(layer).__name__}', "
                f"expected '{self.layer_type.__name__}'."
            )
        _claim_fresh_layer_instance(layer)
        layer.config = cast(Any, typed_config)
        return layer


def _as_layer_provider(implementation: LayerProviderInput) -> LayerProvider[Any]:
    if isinstance(implementation, LayerProvider):
        return implementation
    if isinstance(implementation, type) and issubclass(implementation, Layer):
        return LayerProvider.from_layer_type(implementation)
    raise TypeError("LayerNode implementation must be a Layer subclass or LayerProvider.")
