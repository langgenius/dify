from core.app.entities.queue_entities import QueueStopEvent


class TestQueueEntities:
    def test_get_stop_reason_for_known_stop_by(self):
        event = QueueStopEvent(stopped_by=QueueStopEvent.StopBy.USER_MANUAL)
        assert event.get_stop_reason() == "Stopped by user."

    def test_get_stop_reason_for_unknown_stop_by(self):
        event = QueueStopEvent(stopped_by=QueueStopEvent.StopBy.USER_MANUAL)
        event.stopped_by = "unknown"
        assert event.get_stop_reason() == "Stopped by unknown reason."
