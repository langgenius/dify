from core.workflow.graph_engine.layers.base import GraphEngineLayer
from core.workflow.graph_events.base import GraphEngineEvent


class SuspendLayer(GraphEngineLayer):
    """ """

    def on_graph_start(self):
        pass

    def on_event(self, event: GraphEngineEvent):
        pass

    def on_graph_end(self, error: Exception | None):
        pass
