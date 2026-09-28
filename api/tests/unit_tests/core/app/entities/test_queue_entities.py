from core.app.entities.queue_entities import QueueEvent, QueueReasoningChunkEvent, QueueStopEvent


class TestQueueEntities:
    def test_get_stop_reason_for_known_stop_by(self):
        event = QueueStopEvent(stopped_by=QueueStopEvent.StopBy.USER_MANUAL)
        assert event.get_stop_reason() == "Stopped by user."

    def test_get_stop_reason_prefers_explicit_reason(self):
        event = QueueStopEvent(
            stopped_by=QueueStopEvent.StopBy.USER_MANUAL,
            reason="Workflow execution timed out",
        )
        assert event.get_stop_reason() == "Workflow execution timed out"

    def test_get_stop_reason_for_unknown_stop_by(self):
        event = QueueStopEvent(stopped_by=QueueStopEvent.StopBy.USER_MANUAL)
        event.stopped_by = "unknown"
        assert event.get_stop_reason() == "Stopped by unknown reason."

    def test_reasoning_chunk_event_defaults(self):
        event = QueueReasoningChunkEvent(reasoning="thinking", from_node_id="llm")
        assert event.event == QueueEvent.REASONING_CHUNK
        assert event.reasoning == "thinking"
        assert event.from_node_id == "llm"
        assert event.is_final is False
        assert event.in_iteration_id is None
        assert event.in_loop_id is None

    def test_reasoning_chunk_event_terminal_marker_allows_empty_reasoning(self):
        event = QueueReasoningChunkEvent(reasoning="", from_node_id="llm", is_final=True)
        assert event.reasoning == ""
        assert event.is_final is True
