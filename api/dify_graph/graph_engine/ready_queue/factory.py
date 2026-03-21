"""
Factory for creating ReadyQueue instances from serialized state.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from .in_memory import InMemoryReadyQueue
from .protocol import ReadyQueueState

if TYPE_CHECKING:
    from .protocol import ReadyQueue


def create_ready_queue_from_state(state: ReadyQueueState) -> ReadyQueue:
    """
    Create a ReadyQueue instance from a serialized state.

    Args:
        state: The serialized queue state (Pydantic model, dict, or JSON string), or None for a new empty queue

    Returns:
        A ReadyQueue instance initialized with the given state

    Raises:
        ValueError: If the queue type is unknown or version is unsupported
    """
    if state.type == "InMemoryReadyQueue":
        if state.version != "1.0":
            raise ValueError(f"Unsupported InMemoryReadyQueue version: {state.version}")
        queue = InMemoryReadyQueue()
        # Always pass as JSON string to loads()
        queue.loads(state.model_dump_json())
        return queue
    else:
        raise ValueError(f"Unknown ready queue type: {state.type}")
