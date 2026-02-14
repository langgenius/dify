import uuid

import pytest

from core.file.enums import FileTransferMethod, FileType
from core.file.models import File
from core.model_runtime.entities.message_entities import (
    AudioPromptMessageContent,
    ImagePromptMessageContent,
    PromptMessageContentType,
    TextPromptMessageContent,
    VideoPromptMessageContent,
)
from core.variables.segments import (
    ArrayFileSegment,
    FileSegment,
    NoneSegment,
    ObjectSegment,
    StringSegment,
)
from core.variables.utils import dumps_with_segments, segment_orjson_default


@pytest.fixture
def sample_file():
    """Create a sample File object for testing."""
    return File(
        id=str(uuid.uuid4()),
        tenant_id=str(uuid.uuid4()),
        type=FileType.DOCUMENT,
        transfer_method=FileTransferMethod.LOCAL_FILE,
        related_id=str(uuid.uuid4()),
        filename="test_file.txt",
        extension=".txt",
        mime_type="text/plain",
        size=1024,
        storage_key="test_key",
    )


class TestSegmentOrjsonDefault:
    """Test segment_orjson_default function with different types."""

    def test_string_segment(self):
        """Test StringSegment is serialized correctly."""
        segment = StringSegment(value="hello world")
        result = segment_orjson_default(segment)
        assert result == "hello world"

    def test_none_segment(self):
        """Test NoneSegment is serialized correctly."""
        segment = NoneSegment()
        result = segment_orjson_default(segment)
        assert result is None

    def test_file_segment(self, sample_file):
        """Test FileSegment is serialized to dict."""
        segment = FileSegment(value=sample_file)
        result = segment_orjson_default(segment)
        assert isinstance(result, dict)
        assert result["filename"] == "test_file.txt"
        assert result["id"] == sample_file.id

    def test_array_file_segment(self, sample_file):
        """Test ArrayFileSegment is serialized to list of dicts."""
        segment = ArrayFileSegment(value=[sample_file, sample_file])
        result = segment_orjson_default(segment)
        assert isinstance(result, list)
        assert len(result) == 2
        assert all(isinstance(item, dict) for item in result)

    def test_text_prompt_message_content(self):
        """Test TextPromptMessageContent is serialized to dict."""
        message = TextPromptMessageContent(
            type=PromptMessageContentType.TEXT,
            data="Test message content",
        )
        result = segment_orjson_default(message)
        assert isinstance(result, dict)
        assert result["type"] == "text"
        assert result["data"] == "Test message content"

    def test_image_prompt_message_content(self):
        """Test ImagePromptMessageContent is serialized to dict."""
        message = ImagePromptMessageContent(
            type=PromptMessageContentType.IMAGE,
            format="png",
            base64_data="iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
            mime_type="image/png",
        )
        result = segment_orjson_default(message)
        assert isinstance(result, dict)
        assert result["type"] == "image"
        assert result["format"] == "png"
        assert "data" in result or "base64_data" in result

    def test_audio_prompt_message_content(self):
        """Test AudioPromptMessageContent is serialized to dict."""
        message = AudioPromptMessageContent(
            type=PromptMessageContentType.AUDIO,
            format="mp3",
            base64_data="base64audiodata",
            mime_type="audio/mpeg",
        )
        result = segment_orjson_default(message)
        assert isinstance(result, dict)
        assert result["type"] == "audio"
        assert result["format"] == "mp3"

    def test_video_prompt_message_content(self):
        """Test VideoPromptMessageContent is serialized to dict."""
        message = VideoPromptMessageContent(
            type=PromptMessageContentType.VIDEO,
            format="mp4",
            base64_data="base64videodata",
            mime_type="video/mp4",
        )
        result = segment_orjson_default(message)
        assert isinstance(result, dict)
        assert result["type"] == "video"
        assert result["format"] == "mp4"

    def test_object_segment_with_messages(self):
        """Test ObjectSegment containing PromptMessageContent objects."""
        obj_segment = ObjectSegment(
            value={
                "message": TextPromptMessageContent(type=PromptMessageContentType.TEXT, data="Hello"),
                "messages": [
                    TextPromptMessageContent(type=PromptMessageContentType.TEXT, data=f"Msg {i}") for i in range(3)
                ],
                "text": "plain text",
                "count": 42,
            }
        )
        result = segment_orjson_default(obj_segment)
        assert isinstance(result, dict)
        # segment_orjson_default returns the value directly for Segments
        # The PromptMessageContent objects remain as-is
        assert isinstance(result["message"], TextPromptMessageContent)
        assert result["message"].data == "Hello"
        # Array messages should also remain as PromptMessageContent
        assert all(isinstance(msg, TextPromptMessageContent) for msg in result["messages"])
        # Plain values should remain as-is
        assert result["text"] == "plain text"
        assert result["count"] == 42

    def test_unknown_type_raises_error(self):
        """Test that unknown types raise TypeError."""

        class CustomType:
            pass

        with pytest.raises(TypeError) as exc_info:
            segment_orjson_default(CustomType())
        assert "is not JSON serializable" in str(exc_info.value)


class TestDumpsWithSegments:
    """Test dumps_with_segments function with various data structures."""

    def test_simple_string(self):
        """Test simple string serialization."""
        result = dumps_with_segments("hello")
        assert result == '"hello"'

    def test_simple_number(self):
        """Test simple number serialization."""
        result = dumps_with_segments(123)
        assert result == "123"

    def test_string_segment(self):
        """Test StringSegment serialization."""
        segment = StringSegment(value="test value")
        result = dumps_with_segments(segment)
        assert '"test value"' in result

    def test_nested_structure_with_string_segment(self):
        """Test nested structure containing StringSegment."""
        data = {
            "text": StringSegment(value="nested text"),
            "count": 10,
            "items": [StringSegment(value=f"item {i}") for i in range(3)],
        }
        result = dumps_with_segments(data)
        assert '"nested text"' in result
        assert '"item 0"' in result
        assert '"item 1"' in result
        assert '"item 2"' in result

    def test_array_with_text_prompt_messages(self):
        """Test array containing TextPromptMessageContent objects."""
        data = [
            TextPromptMessageContent(type=PromptMessageContentType.TEXT, data="Message 1"),
            TextPromptMessageContent(type=PromptMessageContentType.TEXT, data="Message 2"),
            "plain string",
        ]
        result = dumps_with_segments(data)
        # Should be valid JSON
        import json

        parsed = json.loads(result)
        assert len(parsed) == 3
        # Messages should be converted to dicts
        assert isinstance(parsed[0], dict)
        assert parsed[0]["data"] == "Message 1"
        assert isinstance(parsed[1], dict)
        assert parsed[1]["data"] == "Message 2"
        assert parsed[2] == "plain string"

    def test_object_with_text_prompt_message_content(self):
        """Test object containing TextPromptMessageContent."""
        data = {
            "message": TextPromptMessageContent(type=PromptMessageContentType.TEXT, data="Hello, world!"),
            "nested": {"inner_message": TextPromptMessageContent(type=PromptMessageContentType.TEXT, data="Nested")},
        }
        result = dumps_with_segments(data)
        # Should be valid JSON
        import json

        parsed = json.loads(result)
        assert isinstance(parsed["message"], dict)
        assert parsed["message"]["data"] == "Hello, world!"
        assert isinstance(parsed["nested"]["inner_message"], dict)
        assert parsed["nested"]["inner_message"]["data"] == "Nested"

    def test_workflow_output_with_messages(self):
        """Test realistic workflow output containing various message types."""
        data = {
            "result": "success",
            "summary": TextPromptMessageContent(
                type=PromptMessageContentType.TEXT,
                data="Summary of workflow execution",
            ),
            "messages": [
                TextPromptMessageContent(type=PromptMessageContentType.TEXT, data=f"Step {i} completed")
                for i in range(5)
            ],
            "metadata": {
                "count": 5,
                "status": "completed",
            },
        }
        result = dumps_with_segments(data)
        # Should be valid JSON
        import json

        parsed = json.loads(result)
        assert parsed["result"] == "success"
        assert isinstance(parsed["summary"], dict)
        assert parsed["summary"]["data"] == "Summary of workflow execution"
        assert len(parsed["messages"]) == 5
        assert all(isinstance(msg, dict) for msg in parsed["messages"])
        assert parsed["metadata"]["count"] == 5

    def test_unicode_and_special_characters_in_messages(self):
        """Test messages with unicode and special characters."""
        data = [
            TextPromptMessageContent(type=PromptMessageContentType.TEXT, data="Hello 🌍🚀 世界"),
            TextPromptMessageContent(type=PromptMessageContentType.TEXT, data='{"key": "value"}'),
        ]
        result = dumps_with_segments(data)
        # Should be valid JSON
        import json

        parsed = json.loads(result)
        assert parsed[0]["data"] == "Hello 🌍🚀 世界"
        assert parsed[1]["data"] == '{"key": "value"}'

    def test_very_long_text_message_content(self):
        """Test very long text in message content doesn't break serialization."""
        long_text = "x" * 10000
        data = TextPromptMessageContent(type=PromptMessageContentType.TEXT, data=long_text)
        result = dumps_with_segments(data)
        # Should be valid JSON
        import json

        parsed = json.loads(result)
        assert parsed["data"] == long_text
        assert len(result) > 10000  # Should include the full text

    def test_mixed_segment_types(self):
        """Test serialization with various segment and message types mixed."""
        data = {
            "string_segment": StringSegment(value="segment value"),
            "text_message": TextPromptMessageContent(type=PromptMessageContentType.TEXT, data="message value"),
            "none_segment": NoneSegment(),
            "plain_string": "plain value",
            "number": 42,
            "array": [1, 2, 3],
        }
        result = dumps_with_segments(data)
        # Should be valid JSON
        import json

        parsed = json.loads(result)
        assert parsed["string_segment"] == "segment value"
        assert isinstance(parsed["text_message"], dict)
        assert parsed["text_message"]["data"] == "message value"
        assert parsed["none_segment"] is None
        assert parsed["plain_string"] == "plain value"
        assert parsed["number"] == 42
        assert parsed["array"] == [1, 2, 3]
