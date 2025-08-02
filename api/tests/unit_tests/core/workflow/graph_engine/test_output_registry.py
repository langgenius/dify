import pytest

from core.workflow.graph_engine.output_registry import OutputRegistry


class TestOutputRegistry:
    def test_scalar_operations(self):
        registry = OutputRegistry()

        # Test setting and getting scalar
        registry.set_scalar(["node1", "output"], "test_value")
        assert registry.get_scalar(["node1", "output"]) == "test_value"

        # Test getting non-existent scalar
        assert registry.get_scalar(["non_existent"]) is None

    def test_stream_operations(self):
        registry = OutputRegistry()

        # Test appending chunks
        registry.append_chunk(["node1", "stream"], "chunk1")
        registry.append_chunk(["node1", "stream"], "chunk2")

        # Test has_unread
        assert registry.has_unread(["node1", "stream"]) is True

        # Test popping chunks
        assert registry.pop_chunk(["node1", "stream"]) == "chunk1"
        assert registry.pop_chunk(["node1", "stream"]) == "chunk2"
        assert registry.pop_chunk(["node1", "stream"]) is None

        # Test has_unread after popping all
        assert registry.has_unread(["node1", "stream"]) is False

    def test_stream_closing(self):
        registry = OutputRegistry()

        # Test stream is not closed initially
        assert registry.stream_closed(["node1", "stream"]) is False

        # Test closing stream
        registry.close_stream(["node1", "stream"])
        assert registry.stream_closed(["node1", "stream"]) is True

        # Test appending to closed stream raises error
        with pytest.raises(ValueError, match="Stream node1.stream is already closed"):
            registry.append_chunk(["node1", "stream"], "chunk")

    def test_serialization(self):
        registry = OutputRegistry()

        # Set up some data
        registry.set_scalar(["scalar1"], "value1")
        registry.set_scalar(["scalar2"], {"nested": "value"})
        registry.append_chunk(["stream1"], "chunk1")
        registry.append_chunk(["stream1"], "chunk2")
        registry.close_stream(["stream1"])

        # Serialize
        data = registry.serialize()

        # Check serialized data
        assert data["scalars"]["scalar1"] == "value1"
        assert data["scalars"]["scalar2"] == {"nested": "value"}
        assert data["streams"]["stream1"] == ["chunk1", "chunk2"]
        assert data["stream_closed"]["stream1"] is True

        # Deserialize
        new_registry = OutputRegistry.deserialize(data)

        # Verify deserialized data
        assert new_registry.get_scalar(["scalar1"]) == "value1"
        assert new_registry.get_scalar(["scalar2"]) == {"nested": "value"}
        assert new_registry.pop_chunk(["stream1"]) == "chunk1"
        assert new_registry.pop_chunk(["stream1"]) == "chunk2"
        assert new_registry.stream_closed(["stream1"]) is True

    def test_thread_safety(self):
        import threading

        registry = OutputRegistry()
        results = []

        def append_chunks(thread_id: int):
            for i in range(100):
                registry.append_chunk(["stream"], f"thread{thread_id}_chunk{i}")

        # Start multiple threads
        threads = []
        for i in range(5):
            thread = threading.Thread(target=append_chunks, args=(i,))
            threads.append(thread)
            thread.start()

        # Wait for threads
        for thread in threads:
            thread.join()

        # Verify all chunks are present
        chunks = []
        while True:
            chunk = registry.pop_chunk(["stream"])
            if chunk is None:
                break
            chunks.append(chunk)

        assert len(chunks) == 500  # 5 threads * 100 chunks each

    def test_multi_level_selectors(self):
        registry = OutputRegistry()

        # Test selectors with different levels
        registry.set_scalar(["node1", "output"], "simple")
        registry.set_scalar(["node1", "output", "nested"], "nested_value")
        registry.set_scalar(["container", "iter0", "node2", "result"], "deep_nested")

        # Verify all selectors work independently
        assert registry.get_scalar(["node1", "output"]) == "simple"
        assert registry.get_scalar(["node1", "output", "nested"]) == "nested_value"
        assert registry.get_scalar(["container", "iter0", "node2", "result"]) == "deep_nested"

        # Test streams with multi-level selectors
        registry.append_chunk(["container", "iter1", "node3", "stream"], "chunk1")
        registry.append_chunk(["container", "iter1", "node3", "stream"], "chunk2")

        assert registry.has_unread(["container", "iter1", "node3", "stream"]) is True
        assert registry.pop_chunk(["container", "iter1", "node3", "stream"]) == "chunk1"
        assert registry.pop_chunk(["container", "iter1", "node3", "stream"]) == "chunk2"
