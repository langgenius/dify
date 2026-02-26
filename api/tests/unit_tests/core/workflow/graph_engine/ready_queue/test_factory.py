from __future__ import annotations

import pytest

from core.workflow.graph_engine.ready_queue.factory import create_ready_queue_from_state
from core.workflow.graph_engine.ready_queue.protocol import ReadyQueueState


def test_create_ready_queue_from_state_restores_in_memory_queue_contents() -> None:
    state = ReadyQueueState(type="InMemoryReadyQueue", version="1.0", items=["n1", "n2"])

    queue = create_ready_queue_from_state(state)

    assert queue.qsize() == 2
    assert queue.get(timeout=0.01) == "n1"
    assert queue.get(timeout=0.01) == "n2"


def test_create_ready_queue_from_state_rejects_unsupported_version() -> None:
    state = ReadyQueueState(type="InMemoryReadyQueue", version="2.0", items=[])

    with pytest.raises(ValueError, match="Unsupported InMemoryReadyQueue version"):
        create_ready_queue_from_state(state)


def test_create_ready_queue_from_state_rejects_unknown_queue_type() -> None:
    state = ReadyQueueState(type="UnknownQueue", version="1.0", items=[])

    with pytest.raises(ValueError, match="Unknown ready queue type"):
        create_ready_queue_from_state(state)
