import uuid
from unittest import mock

import pydantic
import pytest
from sqlalchemy import Engine

from core.file import FileTransferMethod, FileType, models
from core.tools import signature
from core.tools.tool_file_manager import ToolFileManager
from core.workflow.nodes.llm.file_saver import MultiModalFile, StorageFileSaver
from models import ToolFile

_PNG_DATA = b"\x89PNG\r\n\x1a\n"
#
# class _MockToolFileManager:
#     def __init__(self, mock_tool_file: ToolFile, mock_signed_url: str):
#         self._mock_tool_file = mock_tool_file
#         self._mock_signed_url = mock_signed_url
#
#     @staticmethod
#     def create_file_by_raw(
#             *,
#             user_id: str,
#             tenant_id: str,
#             conversation_id: Optional[str],
#             file_binary: bytes,
#             mimetype: str,
#             filename: Optional[str] = None,
#     ) -> ToolFile:
#         return self._mock_tool_file
#
#     @staticmethod
#     def sign_file(tool_file_id: str, extension: str) -> str:
#         return ""


def test_storage_file_saver(monkeypatch):
    def gen_id():
        return str(uuid.uuid4())

    mmf = MultiModalFile(
        user_id=gen_id(),
        tenant_id=gen_id(),
        file_type=FileType.IMAGE,
        data=_PNG_DATA,
        mime_type="image/png",
        extension_override=None,
    )
    mock_signed_url = "https://example.com/image.png"
    mock_tool_file = ToolFile(
        id=gen_id(),
        user_id=mmf.user_id,
        tenant_id=mmf.tenant_id,
        conversation_id=None,
        file_key="test-file-key",
        mimetype=mmf.mime_type,
        original_url=None,
        name=f"{gen_id()}.png",
        size=len(mmf.data),
    )
    mocked_tool_file_manager = mock.MagicMock(spec=ToolFileManager)
    mocked_engine = mock.MagicMock(spec=Engine)

    mocked_tool_file_manager.create_file_by_raw.return_value = mock_tool_file
    monkeypatch.setattr(StorageFileSaver, "_get_tool_file_manager", lambda _: mocked_tool_file_manager)
    # Since `File.generate_url` used `ToolFileManager.sign_file` directly, we also need to patch it here.
    mocked_sign_file = mock.MagicMock(spec=signature.sign_tool_file)
    # Since `File.generate_url` used `signature.sign_tool_file` directly, we also need to patch it here.
    monkeypatch.setattr(models, "sign_tool_file", mocked_sign_file)
    mocked_sign_file.return_value = mock_signed_url

    storage_file_manager = StorageFileSaver(engine_factory=lambda: mocked_engine)

    file = storage_file_manager.save_file(mmf)
    assert file.tenant_id == mmf.tenant_id
    assert file.type == mmf.file_type
    assert file.transfer_method == FileTransferMethod.TOOL_FILE
    assert file.extension == mmf.get_extension()
    assert file.mime_type == mmf.mime_type
    assert file.size == len(mmf.data)
    assert file.related_id == mock_tool_file.id

    assert file.generate_url() == mock_signed_url

    mocked_tool_file_manager.create_file_by_raw.assert_called_once_with(
        user_id=mmf.user_id,
        tenant_id=mmf.tenant_id,
        conversation_id=None,
        file_binary=mmf.data,
        mimetype=mmf.mime_type,
    )
    mocked_sign_file.assert_called_once_with(mock_tool_file.id, mmf.get_extension())


def test_multi_modal_file_extension_override():
    # Test should pass if `extension_override` is not set.
    MultiModalFile(user_id="", tenant_id="", file_type=FileType.IMAGE, data=b"", mime_type="image/png")

    # Test should pass if `extension_override` is explicitly set to `None`.
    MultiModalFile(
        user_id="", tenant_id="", file_type=FileType.IMAGE, data=b"", mime_type="image/png", extension_override=None
    )

    # Test should pass if `extension_override` is a string prefixed with `.`.
    for extension_override in [".png", ".tar.gz"]:
        MultiModalFile(
            user_id="",
            tenant_id="",
            file_type=FileType.IMAGE,
            data=b"",
            mime_type="image/png",
            extension_override=extension_override,
        )

    for invalid_ext_override in ["png", "tar.gz"]:
        with pytest.raises(pydantic.ValidationError) as exc:
            MultiModalFile(
                user_id="",
                tenant_id="",
                file_type=FileType.IMAGE,
                data=b"",
                mime_type="image/png",
                extension_override=invalid_ext_override,
            )

        error_details = exc.value.errors()
        assert exc.value.error_count() == 1
        assert error_details[0]["loc"] == ("extension_override",)
