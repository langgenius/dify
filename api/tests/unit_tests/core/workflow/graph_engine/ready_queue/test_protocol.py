from __future__ import annotations

from core.workflow.graph_engine.ready_queue.protocol import ReadyQueue, ReadyQueueState


def test_ready_queue_state_defaults_items_to_empty_sequence() -> None:
    state = ReadyQueueState(type="InMemoryReadyQueue", version="1.0")

    assert list(state.items) == []


def test_ready_queue_protocol_stub_methods_are_callable() -> None:
    dummy = object()

    assert ReadyQueue.put(dummy, "node-1") is None
    assert ReadyQueue.get(dummy, timeout=0.01) is None
    assert ReadyQueue.task_done(dummy) is None
    assert ReadyQueue.empty(dummy) is None
    assert ReadyQueue.qsize(dummy) is None
    assert ReadyQueue.dumps(dummy) is None
    assert ReadyQueue.loads(dummy, "{}") is None
