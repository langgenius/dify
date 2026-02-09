"""Tests for file_manager module, specifically multimodal content handling."""

from unittest.mock import patch

from core.file import File, FileTransferMethod, FileType
from core.file.file_manager import (
    _encode_file_ref,
    restore_multimodal_content,
    to_prompt_message_content,
)
from core.model_runtime.entities.message_entities import ImagePromptMessageContent


class TestEncodeFileRef:
    """Tests for _encode_file_ref function."""

    def test_encodes_local_file(self):
        """Local file should be encoded as 'local:id'."""
        file = File(
            tenant_id="t",
            type=FileType.IMAGE,
            transfer_method=FileTransferMethod.LOCAL_FILE,
            related_id="abc123",
            storage_key="key",
        )
        assert _encode_file_ref(file) == "local:abc123"

    def test_encodes_tool_file(self):
        """Tool file should be encoded as 'tool:id'."""
        file = File(
            tenant_id="t",
            type=FileType.IMAGE,
            transfer_method=FileTransferMethod.TOOL_FILE,
            related_id="xyz789",
            storage_key="key",
        )
        assert _encode_file_ref(file) == "tool:xyz789"

    def test_encodes_remote_url(self):
        """Remote URL should be encoded as 'remote:url'."""
        file = File(
            tenant_id="t",
            type=FileType.IMAGE,
            transfer_method=FileTransferMethod.REMOTE_URL,
            remote_url="https://example.com/image.png",
            storage_key="",
        )
        assert _encode_file_ref(file) == "remote:https://example.com/image.png"


class TestToPromptMessageContent:
    """Tests for to_prompt_message_content function with file_ref field."""

    @patch("core.file.file_manager.dify_config")
    @patch("core.file.file_manager._get_encoded_string")
    def test_includes_file_ref(self, mock_get_encoded, mock_config):
        """Generated content should include file_ref field."""
        mock_config.MULTIMODAL_SEND_FORMAT = "base64"
        mock_get_encoded.return_value = "base64data"

        file = File(
            id="test-message-file-id",
            tenant_id="test-tenant",
            type=FileType.IMAGE,
            transfer_method=FileTransferMethod.LOCAL_FILE,
            related_id="test-related-id",
            remote_url=None,
            extension=".png",
            mime_type="image/png",
            filename="test.png",
            storage_key="test-key",
        )

        result = to_prompt_message_content(file)

        assert isinstance(result, ImagePromptMessageContent)
        assert result.file_ref == "local:test-related-id"
        assert result.base64_data == "base64data"


class TestRestoreMultimodalContent:
    """Tests for restore_multimodal_content function."""

    def test_returns_content_unchanged_when_no_file_ref(self):
        """Content without file_ref should pass through unchanged."""
        content = ImagePromptMessageContent(
            format="png",
            base64_data="existing-data",
            mime_type="image/png",
            file_ref=None,
        )

        result = restore_multimodal_content(content)

        assert result.base64_data == "existing-data"

    def test_returns_content_unchanged_when_already_has_data(self):
        """Content that already has base64_data should not be reloaded."""
        content = ImagePromptMessageContent(
            format="png",
            base64_data="existing-data",
            mime_type="image/png",
            file_ref="local:file-id",
        )

        result = restore_multimodal_content(content)

        assert result.base64_data == "existing-data"

    def test_returns_content_unchanged_when_already_has_url(self):
        """Content that already has url should not be reloaded."""
        content = ImagePromptMessageContent(
            format="png",
            url="https://example.com/image.png",
            mime_type="image/png",
            file_ref="local:file-id",
        )

        result = restore_multimodal_content(content)

        assert result.url == "https://example.com/image.png"

    @patch("core.file.file_manager.dify_config")
    @patch("core.file.file_manager._build_file_from_ref")
    @patch("core.file.file_manager._to_url")
    def test_restores_url_from_file_ref(self, mock_to_url, mock_build_file, mock_config):
        """Content should be restored from file_ref when url is empty (url mode)."""
        mock_config.MULTIMODAL_SEND_FORMAT = "url"
        mock_build_file.return_value = "mock_file"
        mock_to_url.return_value = "https://restored-url.com/image.png"

        content = ImagePromptMessageContent(
            format="png",
            base64_data="",
            url="",
            mime_type="image/png",
            filename="test.png",
            file_ref="local:test-file-id",
        )

        result = restore_multimodal_content(content)

        assert result.url == "https://restored-url.com/image.png"
        mock_build_file.assert_called_once()

    @patch("core.file.file_manager.dify_config")
    @patch("core.file.file_manager._build_file_from_ref")
    @patch("core.file.file_manager._get_encoded_string")
    def test_restores_base64_from_file_ref(self, mock_get_encoded, mock_build_file, mock_config):
        """Content should be restored as base64 when in base64 mode."""
        mock_config.MULTIMODAL_SEND_FORMAT = "base64"
        mock_build_file.return_value = "mock_file"
        mock_get_encoded.return_value = "restored-base64-data"

        content = ImagePromptMessageContent(
            format="png",
            base64_data="",
            url="",
            mime_type="image/png",
            filename="test.png",
            file_ref="local:test-file-id",
        )

        result = restore_multimodal_content(content)

        assert result.base64_data == "restored-base64-data"
        mock_build_file.assert_called_once()

    def test_handles_invalid_file_ref_gracefully(self):
        """Invalid file_ref format should be handled gracefully."""
        content = ImagePromptMessageContent(
            format="png",
            base64_data="",
            url="",
            mime_type="image/png",
            file_ref="invalid_format_no_colon",
        )

        result = restore_multimodal_content(content)

        # Should return unchanged on error
        assert result.base64_data == ""
