"""Tests for llm_utils module, specifically multimodal content handling."""

import string
from unittest.mock import patch

from core.model_runtime.entities.message_entities import (
    ImagePromptMessageContent,
    TextPromptMessageContent,
    UserPromptMessage,
)
from core.workflow.nodes.llm.llm_utils import (
    _truncate_multimodal_content,
    build_context,
    restore_multimodal_content_in_messages,
)


class TestTruncateMultimodalContent:
    """Tests for _truncate_multimodal_content function."""

    def test_returns_message_unchanged_for_string_content(self):
        """String content should pass through unchanged."""
        message = UserPromptMessage(content="Hello, world!")
        result = _truncate_multimodal_content(message)
        assert result.content == "Hello, world!"

    def test_returns_message_unchanged_for_none_content(self):
        """None content should pass through unchanged."""
        message = UserPromptMessage(content=None)
        result = _truncate_multimodal_content(message)
        assert result.content is None

    def test_clears_base64_when_file_ref_present(self):
        """When file_ref is present, base64_data and url should be cleared."""
        image_content = ImagePromptMessageContent(
            format="png",
            base64_data=string.ascii_lowercase,
            url="https://example.com/image.png",
            mime_type="image/png",
            filename="test.png",
            file_ref="local:test-file-id",
        )
        message = UserPromptMessage(content=[image_content])

        result = _truncate_multimodal_content(message)

        assert isinstance(result.content, list)
        assert len(result.content) == 1
        result_content = result.content[0]
        assert isinstance(result_content, ImagePromptMessageContent)
        assert result_content.base64_data == ""
        assert result_content.url == ""
        # file_ref should be preserved
        assert result_content.file_ref == "local:test-file-id"

    def test_truncates_base64_when_no_file_ref(self):
        """When file_ref is missing (legacy), base64_data should be truncated."""
        long_base64 = "a" * 100
        image_content = ImagePromptMessageContent(
            format="png",
            base64_data=long_base64,
            mime_type="image/png",
            filename="test.png",
            file_ref=None,
        )
        message = UserPromptMessage(content=[image_content])

        result = _truncate_multimodal_content(message)

        assert isinstance(result.content, list)
        result_content = result.content[0]
        assert isinstance(result_content, ImagePromptMessageContent)
        # Should be truncated with marker
        assert "...[TRUNCATED]..." in result_content.base64_data
        assert len(result_content.base64_data) < len(long_base64)

    def test_preserves_text_content(self):
        """Text content should pass through unchanged."""
        text_content = TextPromptMessageContent(data="Hello!")
        image_content = ImagePromptMessageContent(
            format="png",
            base64_data="test123",
            mime_type="image/png",
            file_ref="local:file-id",
        )
        message = UserPromptMessage(content=[text_content, image_content])

        result = _truncate_multimodal_content(message)

        assert isinstance(result.content, list)
        assert len(result.content) == 2
        # Text content unchanged
        assert result.content[0].data == "Hello!"
        # Image content base64 cleared
        assert result.content[1].base64_data == ""


class TestBuildContext:
    """Tests for build_context function."""

    def test_excludes_system_messages(self):
        """System messages should be excluded from context."""
        from core.model_runtime.entities.message_entities import SystemPromptMessage

        messages = [
            SystemPromptMessage(content="You are a helpful assistant."),
            UserPromptMessage(content="Hello!"),
        ]

        context = build_context(messages, "Hi there!")

        # Should have user message + assistant response, no system message
        assert len(context) == 2
        assert context[0].content == "Hello!"
        assert context[1].content == "Hi there!"

    def test_appends_assistant_response(self):
        """Assistant response should be appended to context."""
        messages = [UserPromptMessage(content="What is 2+2?")]

        context = build_context(messages, "The answer is 4.")

        assert len(context) == 2
        assert context[1].content == "The answer is 4."


class TestRestoreMultimodalContentInMessages:
    """Tests for restore_multimodal_content_in_messages function."""

    @patch("core.file.file_manager.restore_multimodal_content")
    def test_restores_multimodal_content(self, mock_restore):
        """Should restore multimodal content in messages."""
        # Setup mock
        restored_content = ImagePromptMessageContent(
            format="png",
            base64_data="restored-base64",
            mime_type="image/png",
            file_ref="local:abc123",
        )
        mock_restore.return_value = restored_content

        # Create message with truncated content
        truncated_content = ImagePromptMessageContent(
            format="png",
            base64_data="",
            mime_type="image/png",
            file_ref="local:abc123",
        )
        message = UserPromptMessage(content=[truncated_content])

        result = restore_multimodal_content_in_messages([message])

        assert len(result) == 1
        assert result[0].content[0].base64_data == "restored-base64"
        mock_restore.assert_called_once()

    def test_passes_through_string_content(self):
        """String content should pass through unchanged."""
        message = UserPromptMessage(content="Hello!")

        result = restore_multimodal_content_in_messages([message])

        assert len(result) == 1
        assert result[0].content == "Hello!"

    def test_passes_through_text_content(self):
        """TextPromptMessageContent should pass through unchanged."""
        text_content = TextPromptMessageContent(data="Hello!")
        message = UserPromptMessage(content=[text_content])

        result = restore_multimodal_content_in_messages([message])

        assert len(result) == 1
        assert result[0].content[0].data == "Hello!"
