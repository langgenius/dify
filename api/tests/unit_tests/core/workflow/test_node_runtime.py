from types import SimpleNamespace
from unittest.mock import MagicMock

from core.app.entities.app_invoke_entities import DifyRunContext, InvokeFrom, UserFrom
from core.workflow import node_runtime
from core.workflow.node_runtime import DifyToolFileManager


def test_dify_tool_file_manager_resolves_conversation_id_for_tool_files(monkeypatch) -> None:
    create_file_by_raw = MagicMock(return_value=SimpleNamespace(id="tool-file-id"))
    manager_instance = SimpleNamespace(create_file_by_raw=create_file_by_raw)
    monkeypatch.setattr(node_runtime, "ToolFileManager", MagicMock(return_value=manager_instance))
    conversation_id_getter = MagicMock(return_value="conversation-id")

    manager = DifyToolFileManager(
        DifyRunContext(
            tenant_id="tenant-id",
            app_id="app-id",
            user_id="user-id",
            user_from=UserFrom.ACCOUNT,
            invoke_from=InvokeFrom.DEBUGGER,
        ),
        conversation_id_getter=conversation_id_getter,
    )

    tool_file = manager.create_file_by_raw(
        file_binary=b"file-bytes",
        mimetype="image/png",
        filename="diagram",
    )

    assert tool_file.id == "tool-file-id"
    conversation_id_getter.assert_called_once_with()
    create_file_by_raw.assert_called_once_with(
        user_id="user-id",
        tenant_id="tenant-id",
        conversation_id="conversation-id",
        file_binary=b"file-bytes",
        mimetype="image/png",
        filename="diagram",
    )
