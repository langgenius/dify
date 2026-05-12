"""Stateless layer graph composition facade for the Agenton core.

``agenton.compositor`` remains the stable import surface for reusable graph
composition. ``core.py`` defines the state-only ``Compositor`` graph plan and
``LayerNode`` orchestration, ``providers.py`` owns reusable construction plans
and fresh-instance validation, ``run.py`` owns active invocation lifecycle plus
prompt/tool aggregation, ``schemas.py`` owns serializable graph/snapshot DTOs
and boundary revalidation, and ``types.py`` holds shared generic transformer
types.

``Compositor`` itself stores no live layer instances, run lifecycle state,
session state, resources, or handles. Each ``enter(...)`` call creates a fresh
``CompositorRun`` with new layer instances, direct dependency binding, optional
snapshot hydration, and the next ``session_snapshot`` after exit.
``LifecycleState.ACTIVE`` remains internal-only and session snapshots contain
only ordered layer lifecycle state plus serializable ``runtime_state``.

The facade also keeps true module-level aliases for ``LayerConfigInput`` and
``LayerProviderInput`` so existing typed direct imports remain supported
without expanding ``__all__``.
"""

from .core import Compositor, LayerNode
from .providers import LayerConfigInput as _LayerConfigInput
from .providers import LayerFactory, LayerProvider, LayerProviderInput as _LayerProviderInput
from .run import CompositorRun, LayerRunSlot
from .schemas import (
    CompositorConfig,
    CompositorConfigValue,
    CompositorSessionSnapshot,
    CompositorSessionSnapshotValue,
    LayerNodeConfig,
    LayerSessionSnapshot,
)
from .types import CompositorTransformer, CompositorTransformerKwargs

type LayerConfigInput = _LayerConfigInput
type LayerProviderInput = _LayerProviderInput

__all__ = [
    "Compositor",
    "CompositorConfig",
    "CompositorConfigValue",
    "CompositorRun",
    "CompositorSessionSnapshot",
    "CompositorSessionSnapshotValue",
    "CompositorTransformer",
    "CompositorTransformerKwargs",
    "LayerFactory",
    "LayerNode",
    "LayerNodeConfig",
    "LayerProvider",
    "LayerRunSlot",
    "LayerSessionSnapshot",
]
