from graphon.graph_engine.layers import GraphEngineLayer
from graphon.graph_events import GraphEngineEvent, GraphRunPausedEvent


class SuspendLayer(GraphEngineLayer):
    """ """

    def __init__(self) -> None:
        super().__init__()
        self._paused = False

    def on_graph_start(self):
        self._paused = False

    def on_event(self, event: GraphEngineEvent):
        """
        Handle the paused event, stash runtime state into storage and wait for resume.
        """
        if isinstance(event, GraphRunPausedEvent):
            self._paused = True

    def on_graph_end(self, error: Exception | None):
        """ """
        self._paused = False

    def is_paused(self) -> bool:
        return self._paused
