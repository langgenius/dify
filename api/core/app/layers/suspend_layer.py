from typing import override

from graphon.engine.layer import Layer
from graphon.engine_events import EngineEvent, GraphRunPausedEvent


class SuspendLayer(Layer):
    """ """

    def __init__(self) -> None:
        super().__init__()
        self._paused = False

    @override
    def on_graph_start(self):
        self._paused = False

    @override
    def on_event(self, event: EngineEvent):
        """
        Handle the paused event, stash runtime state into storage and wait for resume.
        """
        if isinstance(event, GraphRunPausedEvent):
            self._paused = True

    @override
    def on_graph_end(self, error: Exception | None):
        """ """
        self._paused = False

    def is_paused(self) -> bool:
        return self._paused
