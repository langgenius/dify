import uuid
from typing import NamedTuple
from unittest import mock

import httpx
import pytest
from sqlalchemy import Engine

from core.file import FileTransferMethod, FileType, models
from core.helper import ssrf_proxy
from core.tools import signature
from core.tools.tool_file_manager import ToolFileManager
from core.workflow.nodes.llm.file_saver import (
    FileSaverImpl,
    _extract_content_type_and_extension,
    _get_extension,
    _validate_extension_override,
)
from models import ToolFile

_PNG_DATA = b"\x89PNG\r\n\x1a\n"


def _gen_id():
    return str(uuid.uuid4())


class TestFileSaverImpl:
    def test_save_binary_string(self, monkeypatch: pytest.MonkeyPatch):
        user_id = _gen_id()
        tenant_id = _gen_id()
        file_type = FileType.IMAGE
        mime_type = "image/png"
        mock_signed_url = "https://example.com/image.png"
        mock_tool_file = ToolFile(
            user_id=user_id,
            tenant_id=tenant_id,
            conversation_id=None,
            file_key="test-file-key",
            mimetype=mime_type,
            original_url=None,
            name=f"{_gen_id()}.png",
            size=len(_PNG_DATA),
        )
        mock_tool_file.id = _gen_id()
        mocked_tool_file_manager = mock.MagicMock(spec=ToolFileManager)
        mocked_engine = mock.MagicMock(spec=Engine)

        mocked_tool_file_manager.create_file_by_raw.return_value = mock_tool_file
        monkeypatch.setattr(FileSaverImpl, "_get_tool_file_manager", lambda _: mocked_tool_file_manager)
        # Since `File.generate_url` used `ToolFileManager.sign_file` directly, we also need to patch it here.
        mocked_sign_file = mock.MagicMock(spec=signature.sign_tool_file)
        # Since `File.generate_url` used `signature.sign_tool_file` directly, we also need to patch it here.
        monkeypatch.setattr(models, "sign_tool_file", mocked_sign_file)
        mocked_sign_file.return_value = mock_signed_url

        storage_file_manager = FileSaverImpl(
            user_id=user_id,
            tenant_id=tenant_id,
            engine_factory=mocked_engine,
        )

        file = storage_file_manager.save_binary_string(_PNG_DATA, mime_type, file_type)
        assert file.tenant_id == tenant_id
        assert file.type == file_type
        assert file.transfer_method == FileTransferMethod.TOOL_FILE
        assert file.extension == ".png"
        assert file.mime_type == mime_type
        assert file.size == len(_PNG_DATA)
        assert file.related_id == mock_tool_file.id

        assert file.generate_url() == mock_signed_url

        mocked_tool_file_manager.create_file_by_raw.assert_called_once_with(
            user_id=user_id,
            tenant_id=tenant_id,
            conversation_id=None,
            file_binary=_PNG_DATA,
            mimetype=mime_type,
        )
        mocked_sign_file.assert_called_once_with(mock_tool_file.id, ".png")

    def test_save_remote_url_request_failed(self, monkeypatch: pytest.MonkeyPatch):
        _TEST_URL = "https://example.com/image.png"
        mock_request = httpx.Request("GET", _TEST_URL)
        mock_response = httpx.Response(
            status_code=401,
            request=mock_request,
        )
        file_saver = FileSaverImpl(
            user_id=_gen_id(),
            tenant_id=_gen_id(),
        )
        mock_get = mock.MagicMock(spec=ssrf_proxy.get, return_value=mock_response)
        monkeypatch.setattr(ssrf_proxy, "get", mock_get)

        with pytest.raises(httpx.HTTPStatusError) as exc:
            file_saver.save_remote_url(_TEST_URL, FileType.IMAGE)
        mock_get.assert_called_once_with(_TEST_URL)
        assert exc.value.response.status_code == 401

    def test_save_remote_url_success(self, monkeypatch: pytest.MonkeyPatch):
        _TEST_URL = "https://example.com/image.png"
        mime_type = "image/png"
        user_id = _gen_id()
        tenant_id = _gen_id()

        mock_request = httpx.Request("GET", _TEST_URL)
        mock_response = httpx.Response(
            status_code=200,
            content=b"test-data",
            headers={"Content-Type": mime_type},
            request=mock_request,
        )

        file_saver = FileSaverImpl(user_id=user_id, tenant_id=tenant_id)
        mock_tool_file = ToolFile(
            user_id=user_id,
            tenant_id=tenant_id,
            conversation_id=None,
            file_key="test-file-key",
            mimetype=mime_type,
            original_url=None,
            name=f"{_gen_id()}.png",
            size=len(_PNG_DATA),
        )
        mock_tool_file.id = _gen_id()
        mock_get = mock.MagicMock(spec=ssrf_proxy.get, return_value=mock_response)
        monkeypatch.setattr(ssrf_proxy, "get", mock_get)
        mock_save_binary_string = mock.MagicMock(spec=file_saver.save_binary_string, return_value=mock_tool_file)
        monkeypatch.setattr(file_saver, "save_binary_string", mock_save_binary_string)

        file = file_saver.save_remote_url(_TEST_URL, FileType.IMAGE)
        mock_save_binary_string.assert_called_once_with(
            mock_response.content,
            mime_type,
            FileType.IMAGE,
            extension_override=".png",
        )
        assert file == mock_tool_file


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
