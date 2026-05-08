from __future__ import annotations

import logging
from typing import final, override

from graphon.graph_engine.layers import GraphEngineLayer
from graphon.graph_events import GraphEngineEvent
from graphon.graph_events.node import NodeRunVariableUpdatedEvent
from graphon.runtime.variable_pool import VariablePool

logger = logging.getLogger(__name__)


@final
class IterationVariableSyncLayer(GraphEngineLayer):
    """Eagerly propagate variable mutations from a child engine to the parent pool."""

    def __init__(self, parent_variable_pool: VariablePool) -> None:
        super().__init__()
        self._parent_variable_pool = parent_variable_pool

    @override
    def on_event(self, event: GraphEngineEvent) -> None:
        if isinstance(event, NodeRunVariableUpdatedEvent):
            self._parent_variable_pool.add(event.variable.selector, event.variable)

    @override
    def on_graph_start(self) -> None:
        pass

    @override
    def on_graph_end(self, error: Exception | None) -> None:
        pass
