from unittest.mock import patch

from graphon.enums import BuiltinNodeTypes
from graphon.node_events import StreamChunkEvent

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.utils.message_transformer import ToolFileMessageTransformer
from core.workflow.nodes.agent.message_transformer import AgentMessageTransformer


def test_transform_passes_conversation_id_to_tool_file_message_transformer() -> None:
    messages = iter(())
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


def test_transform_splits_long_single_text_into_multiple_stream_chunks() -> None:
    long_text = "a" * 200
    plugin_messages = [
        ToolInvokeMessage(
            type=ToolInvokeMessage.MessageType.TEXT,
            message=ToolInvokeMessage.TextMessage(text=long_text),
        )
    ]
    transformer = AgentMessageTransformer()

    with patch.object(
        ToolFileMessageTransformer,
        "transform_tool_invoke_messages",
        return_value=iter(plugin_messages),
    ):
        events = list(
            transformer.transform(
                messages=iter(()),
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

    text_chunks = [
        e
        for e in events
        if isinstance(e, StreamChunkEvent) and e.selector == ["node-id", "text"] and not e.is_final and e.chunk
    ]
    assert len(text_chunks) == 4
    assert "".join(e.chunk for e in text_chunks) == long_text
