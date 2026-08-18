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
