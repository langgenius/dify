from graphon.graph_events import GraphRunPausedEvent

from core.app.layers.suspend_layer import SuspendLayer


class TestSuspendLayer:
    def test_on_event_accepts_paused_event(self):
        layer = SuspendLayer()
        assert layer.is_paused() is False
        layer.on_graph_start()
        assert layer.is_paused() is False
        layer.on_event(GraphRunPausedEvent())
        assert layer.is_paused() is True

    def test_on_event_ignores_other_events(self):
        layer = SuspendLayer()
        layer.on_graph_start()
        initial_state = layer.is_paused()
        layer.on_event(object())
        assert layer.is_paused() is initial_state
