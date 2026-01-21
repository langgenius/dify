from core.workflow.graph_engine.layers.base import GraphEngineLayer
from core.workflow.graph_events.base import GraphEngineEvent
from core.workflow.graph_events.graph import GraphRunPausedEvent


class SuspendLayer(GraphEngineLayer):
    """ """

    def on_graph_start(self):
        pass

    def on_event(self, event: GraphEngineEvent):
        """
        Handle the paused event, stash runtime state into storage and wait for resume.
        """
        if isinstance(event, GraphRunPausedEvent):
            pass

    def on_graph_end(self, error: Exception | None):
        """ """
        pass
