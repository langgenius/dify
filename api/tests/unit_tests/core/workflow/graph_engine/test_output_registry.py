from uuid import uuid4

import pytest

from core.workflow.entities.variable_pool import VariablePool
from core.workflow.enums import NodeType
from core.workflow.graph_engine.output_registry import OutputRegistry
from core.workflow.graph_events import NodeRunStreamChunkEvent


class TestOutputRegistry:
    def test_scalar_operations(self):
        variable_pool = VariablePool()
        registry = OutputRegistry(variable_pool)

        # Test setting and getting scalar
        registry.set_scalar(["node1", "output"], "test_value")

        segment = registry.get_scalar(["node1", "output"])
        assert segment
        assert segment.text == "test_value"

        # Test getting non-existent scalar
        assert registry.get_scalar(["non_existent"]) is None

    def test_stream_operations(self):
        variable_pool = VariablePool()
        registry = OutputRegistry(variable_pool)

        # Create test events
        event1 = NodeRunStreamChunkEvent(
            id=str(uuid4()),
            node_id="node1",
            node_type=NodeType.LLM,
            selector=["node1", "stream"],
            chunk="chunk1",
            is_final=False,
        )
        event2 = NodeRunStreamChunkEvent(
            id=str(uuid4()),
            node_id="node1",
            node_type=NodeType.LLM,
            selector=["node1", "stream"],
            chunk="chunk2",
            is_final=True,
        )

        # Test appending events
        registry.append_chunk(["node1", "stream"], event1)
        registry.append_chunk(["node1", "stream"], event2)

        # Test has_unread
        assert registry.has_unread(["node1", "stream"]) is True

        # Test popping events
        popped_event1 = registry.pop_chunk(["node1", "stream"])
        assert popped_event1 == event1
        assert popped_event1.chunk == "chunk1"

        popped_event2 = registry.pop_chunk(["node1", "stream"])
        assert popped_event2 == event2
        assert popped_event2.chunk == "chunk2"

        assert registry.pop_chunk(["node1", "stream"]) is None

        # Test has_unread after popping all
        assert registry.has_unread(["node1", "stream"]) is False

    def test_stream_closing(self):
        variable_pool = VariablePool()
        registry = OutputRegistry(variable_pool)

        # Test stream is not closed initially
        assert registry.stream_closed(["node1", "stream"]) is False

        # Test closing stream
        registry.close_stream(["node1", "stream"])
        assert registry.stream_closed(["node1", "stream"]) is True

        # Test appending to closed stream raises error
        event = NodeRunStreamChunkEvent(
            id=str(uuid4()),
            node_id="node1",
            node_type=NodeType.LLM,
            selector=["node1", "stream"],
            chunk="chunk",
            is_final=False,
        )
        with pytest.raises(ValueError, match="Stream node1.stream is already closed"):
            registry.append_chunk(["node1", "stream"], event)

    def test_thread_safety(self):
        import threading

        variable_pool = VariablePool()
        registry = OutputRegistry(variable_pool)
        results = []

        def append_chunks(thread_id: int):
            for i in range(100):
                event = NodeRunStreamChunkEvent(
                    id=str(uuid4()),
                    node_id="test_node",
                    node_type=NodeType.LLM,
                    selector=["stream"],
                    chunk=f"thread{thread_id}_chunk{i}",
                    is_final=False,
                )
                registry.append_chunk(["stream"], event)

        # Start multiple threads
        threads = []
        for i in range(5):
            thread = threading.Thread(target=append_chunks, args=(i,))
            threads.append(thread)
            thread.start()

        # Wait for threads
        for thread in threads:
            thread.join()

        # Verify all events are present
        events = []
        while True:
            event = registry.pop_chunk(["stream"])
            if event is None:
                break
            events.append(event)

        assert len(events) == 500  # 5 threads * 100 events each
        # Verify the events have the expected chunk content format
        chunk_texts = [e.chunk for e in events]
        for i in range(5):
            for j in range(100):
                assert f"thread{i}_chunk{j}" in chunk_texts
