"""Native webhook file storage through the shared tool-file owner."""

from core.app.file_access import DatabaseFileAccessController
from core.tools.tool_file_manager import ToolFileManager
from factories import file_factory
from graphon.file import File, FileTransferMethod


class ToolWebhookFiles:
    def __init__(self, *, manager: ToolFileManager, access: DatabaseFileAccessController) -> None:
        self._manager = manager
        self._access = access

    def create(self, *, tenant_id: str, user_id: str, content: bytes, mimetype: str) -> File:
        record = self._manager.create_file_by_raw(
            user_id=user_id, tenant_id=tenant_id, conversation_id=None, file_binary=content, mimetype=mimetype
        )
        return file_factory.build_from_mapping(
            mapping={"tool_file_id": record.id, "transfer_method": FileTransferMethod.TOOL_FILE.value},
            tenant_id=tenant_id,
            access_controller=self._access,
        )
