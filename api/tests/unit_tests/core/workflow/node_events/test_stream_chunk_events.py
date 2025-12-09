"""Tests for StreamChunkEvent and its subclasses."""

from core.workflow.node_events import (
    ChunkType,
    StreamChunkEvent,
    ThoughtChunkEvent,
    ToolCallChunkEvent,
    ToolResultChunkEvent,
)


class TestChunkType:
    """Tests for ChunkType enum."""

    def test_chunk_type_values(self):
        """Test that ChunkType has expected values."""
        assert ChunkType.TEXT == "text"
        assert ChunkType.TOOL_CALL == "tool_call"
        assert ChunkType.TOOL_RESULT == "tool_result"
        assert ChunkType.THOUGHT == "thought"

    def test_chunk_type_is_str_enum(self):
        """Test that ChunkType values are strings."""
        for chunk_type in ChunkType:
            assert isinstance(chunk_type.value, str)


class TestStreamChunkEvent:
    """Tests for base StreamChunkEvent."""

    def test_create_with_required_fields(self):
        """Test creating StreamChunkEvent with required fields."""
        event = StreamChunkEvent(
            selector=["node1", "text"],
            chunk="Hello",
        )

        assert event.selector == ["node1", "text"]
        assert event.chunk == "Hello"
        assert event.is_final is False
        assert event.chunk_type == ChunkType.TEXT

    def test_create_with_all_fields(self):
        """Test creating StreamChunkEvent with all fields."""
        event = StreamChunkEvent(
            selector=["node1", "output"],
            chunk="World",
            is_final=True,
            chunk_type=ChunkType.TEXT,
        )

        assert event.selector == ["node1", "output"]
        assert event.chunk == "World"
        assert event.is_final is True
        assert event.chunk_type == ChunkType.TEXT

    def test_default_chunk_type_is_text(self):
        """Test that default chunk_type is TEXT."""
        event = StreamChunkEvent(
            selector=["node1", "text"],
            chunk="test",
        )

        assert event.chunk_type == ChunkType.TEXT

    def test_serialization(self):
        """Test that event can be serialized to dict."""
        event = StreamChunkEvent(
            selector=["node1", "text"],
            chunk="Hello",
            is_final=True,
        )

        data = event.model_dump()

        assert data["selector"] == ["node1", "text"]
        assert data["chunk"] == "Hello"
        assert data["is_final"] is True
        assert data["chunk_type"] == "text"


class TestToolCallChunkEvent:
    """Tests for ToolCallChunkEvent."""

    def test_create_with_required_fields(self):
        """Test creating ToolCallChunkEvent with required fields."""
        event = ToolCallChunkEvent(
            selector=["node1", "tool_calls"],
            chunk='{"city": "Beijing"}',
            tool_call_id="call_123",
            tool_name="weather",
        )

        assert event.selector == ["node1", "tool_calls"]
        assert event.chunk == '{"city": "Beijing"}'
        assert event.tool_call_id == "call_123"
        assert event.tool_name == "weather"
        assert event.chunk_type == ChunkType.TOOL_CALL

    def test_chunk_type_is_tool_call(self):
        """Test that chunk_type is always TOOL_CALL."""
        event = ToolCallChunkEvent(
            selector=["node1", "tool_calls"],
            chunk="",
            tool_call_id="call_123",
            tool_name="test_tool",
        )

        assert event.chunk_type == ChunkType.TOOL_CALL

    def test_tool_arguments_field(self):
        """Test tool_arguments field."""
        event = ToolCallChunkEvent(
            selector=["node1", "tool_calls"],
            chunk='{"param": "value"}',
            tool_call_id="call_123",
            tool_name="test_tool",
            tool_arguments='{"param": "value"}',
        )

        assert event.tool_arguments == '{"param": "value"}'

    def test_serialization(self):
        """Test that event can be serialized to dict."""
        event = ToolCallChunkEvent(
            selector=["node1", "tool_calls"],
            chunk='{"city": "Beijing"}',
            tool_call_id="call_123",
            tool_name="weather",
            tool_arguments='{"city": "Beijing"}',
            is_final=True,
        )

        data = event.model_dump()

        assert data["chunk_type"] == "tool_call"
        assert data["tool_call_id"] == "call_123"
        assert data["tool_name"] == "weather"
        assert data["tool_arguments"] == '{"city": "Beijing"}'
        assert data["is_final"] is True


class TestToolResultChunkEvent:
    """Tests for ToolResultChunkEvent."""

    def test_create_with_required_fields(self):
        """Test creating ToolResultChunkEvent with required fields."""
        event = ToolResultChunkEvent(
            selector=["node1", "tool_results"],
            chunk="Weather: Sunny, 25°C",
            tool_call_id="call_123",
            tool_name="weather",
        )

        assert event.selector == ["node1", "tool_results"]
        assert event.chunk == "Weather: Sunny, 25°C"
        assert event.tool_call_id == "call_123"
        assert event.tool_name == "weather"
        assert event.chunk_type == ChunkType.TOOL_RESULT

    def test_chunk_type_is_tool_result(self):
        """Test that chunk_type is always TOOL_RESULT."""
        event = ToolResultChunkEvent(
            selector=["node1", "tool_results"],
            chunk="result",
            tool_call_id="call_123",
            tool_name="test_tool",
        )

        assert event.chunk_type == ChunkType.TOOL_RESULT

    def test_tool_files_default_empty(self):
        """Test that tool_files defaults to empty list."""
        event = ToolResultChunkEvent(
            selector=["node1", "tool_results"],
            chunk="result",
            tool_call_id="call_123",
            tool_name="test_tool",
        )

        assert event.tool_files == []

    def test_tool_files_with_values(self):
        """Test tool_files with file IDs."""
        event = ToolResultChunkEvent(
            selector=["node1", "tool_results"],
            chunk="result",
            tool_call_id="call_123",
            tool_name="test_tool",
            tool_files=["file_1", "file_2"],
        )

        assert event.tool_files == ["file_1", "file_2"]

    def test_tool_error_field(self):
        """Test tool_error field."""
        event = ToolResultChunkEvent(
            selector=["node1", "tool_results"],
            chunk="",
            tool_call_id="call_123",
            tool_name="test_tool",
            tool_error="Tool execution failed",
        )

        assert event.tool_error == "Tool execution failed"

    def test_serialization(self):
        """Test that event can be serialized to dict."""
        event = ToolResultChunkEvent(
            selector=["node1", "tool_results"],
            chunk="Weather: Sunny",
            tool_call_id="call_123",
            tool_name="weather",
            tool_files=["file_1"],
            tool_error=None,
            is_final=True,
        )

        data = event.model_dump()

        assert data["chunk_type"] == "tool_result"
        assert data["tool_call_id"] == "call_123"
        assert data["tool_name"] == "weather"
        assert data["tool_files"] == ["file_1"]
        assert data["tool_error"] is None
        assert data["is_final"] is True


class TestThoughtChunkEvent:
    """Tests for ThoughtChunkEvent."""

    def test_create_with_required_fields(self):
        """Test creating ThoughtChunkEvent with required fields."""
        event = ThoughtChunkEvent(
            selector=["node1", "thought"],
            chunk="I need to query the weather...",
        )

        assert event.selector == ["node1", "thought"]
        assert event.chunk == "I need to query the weather..."
        assert event.chunk_type == ChunkType.THOUGHT
        assert event.round_index == 1  # default

    def test_chunk_type_is_thought(self):
        """Test that chunk_type is always THOUGHT."""
        event = ThoughtChunkEvent(
            selector=["node1", "thought"],
            chunk="thinking...",
        )

        assert event.chunk_type == ChunkType.THOUGHT

    def test_round_index_default(self):
        """Test that round_index defaults to 1."""
        event = ThoughtChunkEvent(
            selector=["node1", "thought"],
            chunk="thinking...",
        )

        assert event.round_index == 1

    def test_round_index_custom(self):
        """Test custom round_index."""
        event = ThoughtChunkEvent(
            selector=["node1", "thought"],
            chunk="Second round thinking...",
            round_index=2,
        )

        assert event.round_index == 2

    def test_serialization(self):
        """Test that event can be serialized to dict."""
        event = ThoughtChunkEvent(
            selector=["node1", "thought"],
            chunk="I need to analyze this...",
            round_index=3,
            is_final=False,
        )

        data = event.model_dump()

        assert data["chunk_type"] == "thought"
        assert data["round_index"] == 3
        assert data["chunk"] == "I need to analyze this..."
        assert data["is_final"] is False


class TestEventInheritance:
    """Tests for event inheritance relationships."""

    def test_tool_call_is_stream_chunk(self):
        """Test that ToolCallChunkEvent is a StreamChunkEvent."""
        event = ToolCallChunkEvent(
            selector=["node1", "tool_calls"],
            chunk="",
            tool_call_id="call_123",
            tool_name="test",
        )

        assert isinstance(event, StreamChunkEvent)

    def test_tool_result_is_stream_chunk(self):
        """Test that ToolResultChunkEvent is a StreamChunkEvent."""
        event = ToolResultChunkEvent(
            selector=["node1", "tool_results"],
            chunk="result",
            tool_call_id="call_123",
            tool_name="test",
        )

        assert isinstance(event, StreamChunkEvent)

    def test_thought_is_stream_chunk(self):
        """Test that ThoughtChunkEvent is a StreamChunkEvent."""
        event = ThoughtChunkEvent(
            selector=["node1", "thought"],
            chunk="thinking...",
        )

        assert isinstance(event, StreamChunkEvent)

    def test_all_events_have_common_fields(self):
        """Test that all events have common StreamChunkEvent fields."""
        events = [
            StreamChunkEvent(selector=["n", "t"], chunk="a"),
            ToolCallChunkEvent(selector=["n", "t"], chunk="b", tool_call_id="1", tool_name="t"),
            ToolResultChunkEvent(selector=["n", "t"], chunk="c", tool_call_id="1", tool_name="t"),
            ThoughtChunkEvent(selector=["n", "t"], chunk="d"),
        ]

        for event in events:
            assert hasattr(event, "selector")
            assert hasattr(event, "chunk")
            assert hasattr(event, "is_final")
            assert hasattr(event, "chunk_type")
