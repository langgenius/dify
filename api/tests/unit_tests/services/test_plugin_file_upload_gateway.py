from unittest.mock import patch

from pytest_mock import MockerFixture
from sqlalchemy.orm import Session

from core.tools.tool_file_manager import ToolFileManager
from core.workflow.file_reference import build_file_reference
from models.tools import ToolFile
from services.plugin_file_upload_gateway import ToolFilePluginUploadGateway
from services.plugin_file_upload_service import PluginFileUploadResult


def test_store_adapts_tool_file_to_transport_neutral_result(sqlite_session: Session, mocker: MockerFixture) -> None:
    tool_files = ToolFileManager()
    create_file = mocker.spy(tool_files, "create_file_by_raw")
    save = mocker.patch("core.tools.tool_file_manager.storage.save")
    gateway = ToolFilePluginUploadGateway(tool_files=tool_files)

    with patch("services.plugin_file_upload_gateway.sign_tool_file", return_value="signed-url") as sign_file:
        result = gateway.store(
            user_id="user-id",
            tenant_id="tenant-id",
            conversation_id="conversation-id",
            content=b"content",
            mimetype="application/pdf",
            filename="report.pdf",
        )

    persisted = sqlite_session.get(ToolFile, result.id)
    assert persisted is not None
    assert result == PluginFileUploadResult(
        id=persisted.id,
        reference=build_file_reference(record_id=persisted.id),
        name="report.pdf",
        size=7,
        extension=".pdf",
        mime_type="application/pdf",
        preview_url="signed-url",
        source_url=None,
        original_url=None,
        user_id="user-id",
        tenant_id="tenant-id",
        conversation_id="conversation-id",
        file_key=persisted.file_key,
    )
    assert persisted.file_key.startswith("tools/tenant-id/")
    assert persisted.file_key.endswith(".pdf")
    save.assert_called_once_with(persisted.file_key, b"content")
    create_file.assert_called_once_with(
        user_id="user-id",
        tenant_id="tenant-id",
        conversation_id="conversation-id",
        file_binary=b"content",
        mimetype="application/pdf",
        filename="report.pdf",
    )
    sign_file.assert_called_once_with(tool_file_id=persisted.id, extension=".pdf", for_external=True)


def test_filename_extension_wins_over_generic_mimetype(sqlite_session: Session, mocker: MockerFixture) -> None:
    save = mocker.patch("core.tools.tool_file_manager.storage.save")
    gateway = ToolFilePluginUploadGateway(tool_files=ToolFileManager())

    with patch("services.plugin_file_upload_gateway.sign_tool_file", return_value="signed-url"):
        result = gateway.store(
            user_id="user-id",
            tenant_id="tenant-id",
            conversation_id=None,
            content=b"content",
            mimetype="application/octet-stream",
            filename="report.docx",
        )

    assert result.extension == ".docx"
    assert result.mime_type == "application/octet-stream"
    persisted = sqlite_session.get(ToolFile, result.id)
    assert persisted is not None
    assert persisted.name == "report.docx"
    assert persisted.file_key.endswith(".docx")
    save.assert_called_once_with(persisted.file_key, b"content")
