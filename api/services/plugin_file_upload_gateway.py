"""ToolFile adapter for signed plugin uploads."""

from typing import override

from core.tools.signature import sign_tool_file
from core.tools.tool_file_manager import ToolFileManager, resolve_extension
from core.workflow.file_reference import build_file_reference
from services.plugin_file_upload_service import PluginFileUploadFiles, PluginFileUploadResult


class ToolFilePluginUploadGateway(PluginFileUploadFiles):
    def __init__(self, *, tool_files: ToolFileManager) -> None:
        self._tool_files = tool_files

    @override
    def store(
        self,
        *,
        user_id: str,
        tenant_id: str,
        conversation_id: str | None,
        content: bytes,
        mimetype: str,
        filename: str,
    ) -> PluginFileUploadResult:
        tool_file = self._tool_files.create_file_by_raw(
            user_id=user_id,
            tenant_id=tenant_id,
            conversation_id=conversation_id,
            file_binary=content,
            mimetype=mimetype,
            filename=filename,
        )
        extension = resolve_extension(filename=tool_file.name, mimetype=tool_file.mimetype)

        return PluginFileUploadResult(
            id=tool_file.id,
            reference=build_file_reference(record_id=tool_file.id),
            name=tool_file.name,
            size=tool_file.size,
            extension=extension,
            mime_type=mimetype,
            preview_url=sign_tool_file(
                tool_file_id=tool_file.id,
                extension=extension,
                for_external=True,
            ),
            source_url=tool_file.original_url,
            original_url=tool_file.original_url,
            user_id=tool_file.user_id,
            tenant_id=tool_file.tenant_id,
            conversation_id=tool_file.conversation_id,
            file_key=tool_file.file_key,
        )
