from unittest.mock import MagicMock, patch

from core.tools.tool_file_manager import ToolFileManager
from core.workflow.file_reference import build_file_reference
from models.tools import ToolFile
from services.plugin_file_upload_gateway import ToolFilePluginUploadGateway
from services.plugin_file_upload_service import PluginFileUploadResult


def _tool_file() -> ToolFile:
    file = ToolFile(
        user_id="user-id",
        tenant_id="tenant-id",
        conversation_id="conversation-id",
        file_key="tools/tenant-id/generated.pdf",
        mimetype="application/pdf",
        original_url=None,
        name="report.pdf",
        size=7,
    )
    file.id = "file-id"
    return file


def test_store_adapts_tool_file_to_transport_neutral_result() -> None:
    tool_files = MagicMock(spec=ToolFileManager)
    tool_files.create_file_by_raw.return_value = _tool_file()
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

    assert result == PluginFileUploadResult(
        id="file-id",
        reference=build_file_reference(record_id="file-id"),
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
        file_key="tools/tenant-id/generated.pdf",
    )
    tool_files.create_file_by_raw.assert_called_once_with(
        user_id="user-id",
        tenant_id="tenant-id",
        conversation_id="conversation-id",
        file_binary=b"content",
        mimetype="application/pdf",
        filename="report.pdf",
    )
    sign_file.assert_called_once_with(
        tool_file_id="file-id",
        extension=".pdf",
        for_external=True,
    )


def test_filename_extension_wins_over_generic_mimetype() -> None:
    tool_files = MagicMock(spec=ToolFileManager)
    file = _tool_file()
    file.name = "report.docx"
    file.mimetype = "application/octet-stream"
    tool_files.create_file_by_raw.return_value = file
    gateway = ToolFilePluginUploadGateway(tool_files=tool_files)

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
