from collections.abc import Generator
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.utils.message_transformer import ToolFileMessageTransformer
from core.workflow.file_reference import build_file_reference
from core.workflow.nodes.agent.exceptions import ToolFileNotFoundError
from core.workflow.nodes.agent.message_transformer import AgentMessageTransformer
from graphon.enums import BuiltinNodeTypes
from graphon.file import File, FileTransferMethod, FileType
from graphon.node_events import StreamCompletedEvent
from graphon.variables.segments import ArrayFileSegment


def _file() -> File:
    return File(
        type=FileType.DOCUMENT,
        transfer_method=FileTransferMethod.TOOL_FILE,
        reference=build_file_reference(record_id="tool-file-id"),
        related_id="tool-file-id",
        filename="report.docx",
        extension=".docx",
        mime_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        size=12,
    )


def _message_stream(messages: list[ToolInvokeMessage]) -> Generator[ToolInvokeMessage, None, None]:
    yield from messages


def _run_transform(messages: list[ToolInvokeMessage]) -> tuple[str, ArrayFileSegment]:
    events = list(
        AgentMessageTransformer().transform(
            messages=_message_stream(messages),
            tool_info={},
            parameters_for_log={},
            user_id="user-id",
            tenant_id="tenant-id",
            conversation_id=None,
            node_type=BuiltinNodeTypes.AGENT,
            node_id="node-id",
            node_execution_id="execution-id",
        )
    )
    completed = next(event for event in events if isinstance(event, StreamCompletedEvent))
    outputs = completed.node_run_result.outputs
    assert isinstance(outputs["files"], ArrayFileSegment)
    return outputs["text"], outputs["files"]


def test_transform_passes_conversation_id_to_tool_file_message_transformer() -> None:
    messages = _message_stream([])
    transformer = AgentMessageTransformer()

    with patch.object(ToolFileMessageTransformer, "transform_tool_invoke_messages", return_value=iter(())) as transform:
        result = list(
            transformer.transform(
                messages=messages,
                tool_info={},
                parameters_for_log={},
                user_id="user-id",
                tenant_id="tenant-id",
                conversation_id="conversation-id",
                node_type=BuiltinNodeTypes.AGENT,
                node_id="node-id",
                node_execution_id="execution-id",
            )
        )

    assert len(result) == 2
    transform.assert_called_once_with(
        messages=messages,
        user_id="user-id",
        tenant_id="tenant-id",
        conversation_id="conversation-id",
    )


def test_transform_promotes_tool_file_message_to_files_output() -> None:
    file = _file()
    message = ToolInvokeMessage(
        type=ToolInvokeMessage.MessageType.FILE,
        message=ToolInvokeMessage.FileMessage(file_marker="file_marker"),
        meta={"file": file},
    )

    text, files = _run_transform([message])

    assert text == "File: /files/tools/tool-file-id.docx\n"
    assert files.value == [file]


def test_transform_promotes_serialized_tool_file_link_to_files_output() -> None:
    file = _file()
    message = ToolInvokeMessage(
        type=ToolInvokeMessage.MessageType.LINK,
        message=ToolInvokeMessage.TextMessage(text="/files/tools/tool-file-id.docx"),
        meta={"file": file.model_dump(mode="json"), "tool_file_id": "tool-file-id"},
    )

    session = MagicMock()
    session.scalar.return_value = SimpleNamespace(
        mimetype="application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    )
    session_context = MagicMock()
    session_context.__enter__.return_value = session
    with (
        patch("core.workflow.nodes.agent.message_transformer.db", SimpleNamespace(engine=object())),
        patch("core.workflow.nodes.agent.message_transformer.Session", return_value=session_context),
        patch(
            "core.workflow.nodes.agent.message_transformer.file_factory.build_from_mapping",
            return_value=file,
        ) as build_file,
    ):
        text, files = _run_transform([message])

    assert text == "File: /files/tools/tool-file-id.docx\n"
    assert files.value == [file]
    build_file.assert_called_once()


def test_transform_promotes_serialized_file_mapping_without_tool_file_id() -> None:
    file = _file()
    file_mapping = file.model_dump(mode="json")
    message = ToolInvokeMessage(
        type=ToolInvokeMessage.MessageType.LINK,
        message=ToolInvokeMessage.TextMessage(text="https://example.com/report.docx"),
        meta={"file": file_mapping},
    )

    with patch(
        "core.workflow.nodes.agent.message_transformer.file_factory.build_from_mapping",
        return_value=file,
    ) as build_file:
        text, files = _run_transform([message])

    assert text == "File: https://example.com/report.docx\n"
    assert files.value == [file]
    build_file.assert_called_once()


def test_transform_rejects_unknown_tool_file_link() -> None:
    message = ToolInvokeMessage(
        type=ToolInvokeMessage.MessageType.LINK,
        message=ToolInvokeMessage.TextMessage(text="/files/tools/missing.docx"),
        meta={"tool_file_id": "missing"},
    )

    session = MagicMock()
    session.scalar.return_value = None
    session_context = MagicMock()
    session_context.__enter__.return_value = session
    with (
        patch("core.workflow.nodes.agent.message_transformer.db", SimpleNamespace(engine=object())),
        patch("core.workflow.nodes.agent.message_transformer.Session", return_value=session_context),
        pytest.raises(ToolFileNotFoundError, match="missing"),
    ):
        _run_transform([message])


def test_file_from_link_message_ignores_non_text_message() -> None:
    message = ToolInvokeMessage(
        type=ToolInvokeMessage.MessageType.JSON,
        message=ToolInvokeMessage.JsonMessage(json_object={}),
    )

    assert AgentMessageTransformer._file_from_link_message(message=message, tenant_id="tenant-id") is None


def test_transform_keeps_fileless_link_metadata_as_text() -> None:
    message = ToolInvokeMessage(
        type=ToolInvokeMessage.MessageType.LINK,
        message=ToolInvokeMessage.TextMessage(text="https://dify.ai/docs"),
        meta={"tool_file_id": "", "description": "documentation"},
    )

    text, files = _run_transform([message])

    assert text == "Link: https://dify.ai/docs\n"
    assert files.value == []


def test_transform_keeps_plain_link_as_text() -> None:
    message = ToolInvokeMessage(
        type=ToolInvokeMessage.MessageType.LINK,
        message=ToolInvokeMessage.TextMessage(text="https://dify.ai"),
    )

    text, files = _run_transform([message])

    assert text == "Link: https://dify.ai\n"
    assert files.value == []


def _log_message(provider: str) -> ToolInvokeMessage:
    return ToolInvokeMessage(
        type=ToolInvokeMessage.MessageType.LOG,
        message=ToolInvokeMessage.LogMessage(
            id="log-id",
            label="",
            parent_id=None,
            error=None,
            status=ToolInvokeMessage.LogMessage.LogStatus.START,
            data={},
            metadata={"provider": provider},
        ),
    )


def _collect_log_metadata(messages: list[ToolInvokeMessage]) -> list[dict]:
    events = list(
        AgentMessageTransformer().transform(
            messages=_message_stream(messages),
            tool_info={"icon": "seed-icon"},
            parameters_for_log={},
            user_id="user-id",
            tenant_id="tenant-id",
            conversation_id=None,
            node_type=BuiltinNodeTypes.AGENT,
            node_id="node-id",
            node_execution_id="execution-id",
        )
    )
    return [
        event.metadata
        for event in events
        if hasattr(event, "metadata") and getattr(event, "metadata", None) is not None
    ]


def test_log_icon_enrichment_uses_seed_when_provider_unknown() -> None:
    with (
        patch("core.plugin.impl.plugin.PluginInstaller") as plugin_installer,
        patch(
            "services.tools.builtin_tools_manage_service.BuiltinToolManageService.list_builtin_tools",
            return_value=[],
        ),
    ):
        result = _collect_log_metadata([_log_message("unknown/plugin")])

    assert result
    assert result[0]["icon"] == "seed-icon"
    assert result[0]["icon_dark"] is None
    # The plugin daemon was queried once (no cache hit) for the unknown provider
    # and the builtins list was queried once.
    plugin_installer.return_value.list_plugins.assert_called_once_with("tenant-id")


def test_log_icon_enrichment_repeated_provider_uses_cache() -> None:
    """Repeated LOG messages for the same provider must not re-scan plugins/builtins."""
    plugin = SimpleNamespace(
        plugin_id="plug",
        name="tool",
        declaration=SimpleNamespace(icon="plug-icon"),
    )
    built_in = SimpleNamespace(name="plug/tool", icon="built-in-icon", icon_dark="built-in-dark")

    with (
        patch("core.plugin.impl.plugin.PluginInstaller") as plugin_installer_cls,
        patch(
            "services.tools.builtin_tools_manage_service.BuiltinToolManageService.list_builtin_tools",
            return_value=[built_in],
        ) as list_builtin,
    ):
        plugin_installer_cls.return_value.list_plugins.return_value = [plugin]
        result = _collect_log_metadata(
            [_log_message("plug/tool"), _log_message("plug/tool"), _log_message("plug/tool")]
        )

    assert len(result) == 3
    for metadata in result:
        assert metadata["icon"] == "built-in-icon"
        assert metadata["icon_dark"] == "built-in-dark"

    # The plugin daemon must have been hit only once even though there were
    # three LOG messages for the same provider.
    plugin_installer_cls.return_value.list_plugins.assert_called_once_with("tenant-id")
    list_builtin.assert_called_once_with("user-id", "tenant-id")


def test_log_icon_enrichment_fails_open_when_plugin_daemon_unavailable() -> None:
    built_in = SimpleNamespace(name="plug/tool", icon="built-in-icon", icon_dark="built-in-dark")

    with (
        patch("core.plugin.impl.plugin.PluginInstaller") as plugin_installer_cls,
        patch(
            "services.tools.builtin_tools_manage_service.BuiltinToolManageService.list_builtin_tools",
            return_value=[built_in],
        ),
    ):
        plugin_installer_cls.return_value.list_plugins.side_effect = RuntimeError("daemon down")
        result = _collect_log_metadata([_log_message("plug/tool")])

    assert result[0]["icon"] == "built-in-icon"
    assert result[0]["icon_dark"] == "built-in-dark"


def test_log_icon_enrichment_fails_open_when_builtin_service_unavailable() -> None:
    plugin = SimpleNamespace(
        plugin_id="plug",
        name="tool",
        declaration=SimpleNamespace(icon="plug-icon"),
    )

    with (
        patch("core.plugin.impl.plugin.PluginInstaller") as plugin_installer_cls,
        patch(
            "services.tools.builtin_tools_manage_service.BuiltinToolManageService.list_builtin_tools",
            side_effect=RuntimeError("decrypt boom"),
        ),
    ):
        plugin_installer_cls.return_value.list_plugins.return_value = [plugin]
        result = _collect_log_metadata([_log_message("plug/tool")])

    assert result[0]["icon"] == "plug-icon"
    assert result[0]["icon_dark"] is None


def test_log_icon_enrichment_fails_open_when_both_lookups_raise() -> None:
    with (
        patch("core.plugin.impl.plugin.PluginInstaller") as plugin_installer_cls,
        patch(
            "services.tools.builtin_tools_manage_service.BuiltinToolManageService.list_builtin_tools",
            side_effect=RuntimeError("decrypt boom"),
        ),
    ):
        plugin_installer_cls.return_value.list_plugins.side_effect = RuntimeError("daemon down")
        result = _collect_log_metadata([_log_message("plug/tool")])

    assert result[0]["icon"] == "seed-icon"
    assert result[0]["icon_dark"] is None


def test_log_icon_enrichment_uses_plugin_icon_when_not_in_builtins() -> None:
    plugin = SimpleNamespace(
        plugin_id="plug",
        name="tool",
        declaration=SimpleNamespace(icon="plug-icon"),
    )

    with (
        patch("core.plugin.impl.plugin.PluginInstaller") as plugin_installer_cls,
        patch(
            "services.tools.builtin_tools_manage_service.BuiltinToolManageService.list_builtin_tools",
            return_value=[],
        ),
    ):
        plugin_installer_cls.return_value.list_plugins.return_value = [plugin]
        result = _collect_log_metadata([_log_message("plug/tool")])

    assert result[0]["icon"] == "plug-icon"
    assert result[0]["icon_dark"] is None


def test_log_icon_enrichment_handles_uncaught_helper_failure() -> None:
    """A bug in the helper itself must not break Agent execution."""
    with patch.object(
        AgentMessageTransformer,
        "_resolve_provider_icons",
        side_effect=RuntimeError("unexpected"),
    ):
        result = _collect_log_metadata([_log_message("plug/tool")])

    # The transform should still complete and emit the LOG event; metadata
    # falls back to the seed icon rather than the original (un-enriched) dict.
    assert result[0]["icon"] == "seed-icon"
    assert result[0]["icon_dark"] is None
