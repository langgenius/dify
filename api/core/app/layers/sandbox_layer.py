import logging

from core.sandbox import Sandbox
from dify_graph.graph_engine.layers.base import GraphEngineLayer
from dify_graph.graph_events.base import GraphEngineEvent

logger = logging.getLogger(__name__)


class SandboxLayer(GraphEngineLayer):
    def __init__(self, sandbox: Sandbox) -> None:
        super().__init__()
        self._sandbox = sandbox

    def on_graph_start(self) -> None:
        pass

    def on_event(self, event: GraphEngineEvent) -> None:
        pass

    def on_graph_end(self, error: Exception | None) -> None:
        self._sandbox.release()
