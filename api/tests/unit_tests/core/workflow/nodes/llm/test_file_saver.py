import uuid
from typing import NamedTuple
from unittest import mock
from unittest.mock import MagicMock

import httpx
import pytest

from core.tools.tool_file_manager import ToolFileManager
from dify_graph.file import FileTransferMethod, FileType
from dify_graph.nodes.llm.file_saver import (
    FileSaverImpl,
    _extract_content_type_and_extension,
    _get_extension,
    _validate_extension_override,
)

_PNG_DATA = b"\x89PNG\r\n\x1a\n"


def _gen_id():
    return str(uuid.uuid4())


class TestFileSaverImpl:
    def test_save_binary_string(self, monkeypatch: pytest.MonkeyPatch):
        file_type = FileType.IMAGE
        mime_type = "image/png"
        mock_tool_file = MagicMock()
        mock_tool_file.id = _gen_id()
        mock_tool_file.name = f"{_gen_id()}.png"
        mock_tool_file.file_key = "test-file-key"
        mocked_tool_file_manager = mock.MagicMock(spec=ToolFileManager)
        mocked_tool_file_manager.create_file_by_raw.return_value = mock_tool_file
        file_reference = MagicMock()
        file_reference_factory = MagicMock()
        file_reference_factory.build_from_mapping.return_value = file_reference
        http_client = MagicMock()

        file_saver = FileSaverImpl(
            tool_file_manager=mocked_tool_file_manager,
            file_reference_factory=file_reference_factory,
            http_client=http_client,
        )

        file = file_saver.save_binary_string(_PNG_DATA, mime_type, file_type)
        assert file is file_reference

        mocked_tool_file_manager.create_file_by_raw.assert_called_once_with(
            conversation_id=None,
            file_binary=_PNG_DATA,
            mimetype=mime_type,
        )
        file_reference_factory.build_from_mapping.assert_called_once_with(
            mapping={
                "type": file_type,
                "transfer_method": FileTransferMethod.TOOL_FILE,
                "filename": mock_tool_file.name,
                "extension": ".png",
                "mime_type": mime_type,
                "size": len(_PNG_DATA),
                "tool_file_id": mock_tool_file.id,
                "related_id": mock_tool_file.id,
                "storage_key": mock_tool_file.file_key,
            }
        )

    def test_save_remote_url_request_failed(self, monkeypatch: pytest.MonkeyPatch):
        _TEST_URL = "https://example.com/image.png"
        mock_request = httpx.Request("GET", _TEST_URL)
        mock_response = httpx.Response(
            status_code=401,
            request=mock_request,
        )
        http_client = MagicMock()
        http_client.get.return_value = mock_response

        file_saver = FileSaverImpl(
            tool_file_manager=MagicMock(),
            file_reference_factory=MagicMock(),
            http_client=http_client,
        )

        with pytest.raises(httpx.HTTPStatusError) as exc:
            file_saver.save_remote_url(_TEST_URL, FileType.IMAGE)
        http_client.get.assert_called_once_with(_TEST_URL)
        assert exc.value.response.status_code == 401

    def test_save_remote_url_success(self, monkeypatch: pytest.MonkeyPatch):
        _TEST_URL = "https://example.com/image.png"
        mime_type = "image/png"

        mock_request = httpx.Request("GET", _TEST_URL)
        mock_response = httpx.Response(
            status_code=200,
            content=b"test-data",
            headers={"Content-Type": mime_type},
            request=mock_request,
        )
        http_client = MagicMock()
        http_client.get.return_value = mock_response

        file_saver = FileSaverImpl(
            tool_file_manager=MagicMock(),
            file_reference_factory=MagicMock(),
            http_client=http_client,
        )
        expected_file = MagicMock()
        mock_save_binary_string = mock.MagicMock(spec=file_saver.save_binary_string, return_value=expected_file)
        monkeypatch.setattr(file_saver, "save_binary_string", mock_save_binary_string)

        file = file_saver.save_remote_url(_TEST_URL, FileType.IMAGE)
        mock_save_binary_string.assert_called_once_with(
            mock_response.content,
            mime_type,
            FileType.IMAGE,
            extension_override=".png",
        )
        assert file is expected_file


def test_validate_extension_override():
    class TestCase(NamedTuple):
        extension_override: str | None
        expected: str | None

    cases = [TestCase(None, None), TestCase("", ""), ".png", ".png", ".tar.gz", ".tar.gz"]

    for valid_ext_override in [None, "", ".png", ".tar.gz"]:
        assert valid_ext_override == _validate_extension_override(valid_ext_override)

    for invalid_ext_override in ["png", "tar.gz"]:
        with pytest.raises(ValueError) as exc:
            _validate_extension_override(invalid_ext_override)


class TestExtractContentTypeAndExtension:
    def test_with_both_content_type_and_extension(self):
        content_type, extension = _extract_content_type_and_extension("https://example.com/image.jpg", "image/png")
        assert content_type == "image/png"
        assert extension == ".png"

    def test_url_with_file_extension(self):
        for content_type in [None, ""]:
            content_type, extension = _extract_content_type_and_extension("https://example.com/image.png", content_type)
            assert content_type == "image/png"
            assert extension == ".png"

    def test_response_with_content_type(self):
        content_type, extension = _extract_content_type_and_extension("https://example.com/image", "image/png")
        assert content_type == "image/png"
        assert extension == ".png"

    def test_no_content_type_and_no_extension(self):
        for content_type in [None, ""]:
            content_type, extension = _extract_content_type_and_extension("https://example.com/image", content_type)
            assert content_type == "application/octet-stream"
            assert extension == ".bin"


class TestGetExtension:
    def test_with_extension_override(self):
        mime_type = "image/png"
        for override in [".jpg", ""]:
            extension = _get_extension(mime_type, override)
            assert extension == override

    def test_without_extension_override(self):
        mime_type = "image/png"
        extension = _get_extension(mime_type)
        assert extension == ".png"
