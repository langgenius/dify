from collections.abc import Generator
from unittest.mock import patch

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.utils.message_transformer import ToolFileMessageTransformer
from core.workflow.nodes.agent.message_transformer import AgentMessageTransformer
from graphon.enums import BuiltinNodeTypes
from graphon.node_events import StreamChunkEvent, StreamCompletedEvent, StreamReasoningEvent


def text_message(text: str) -> ToolInvokeMessage:
    return ToolInvokeMessage(
        type=ToolInvokeMessage.MessageType.TEXT,
        message=ToolInvokeMessage.TextMessage(text=text),
    )


def message_stream(*messages: ToolInvokeMessage) -> Generator[ToolInvokeMessage, None, None]:
    yield from messages


def test_transform_passes_conversation_id_to_tool_file_message_transformer() -> None:
    messages = message_stream()
    transformer = AgentMessageTransformer()

    with patch.object(
        ToolFileMessageTransformer,
        "transform_tool_invoke_messages",
        return_value=message_stream(),
    ) as transform:
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


def test_transform_keeps_think_tags_by_default() -> None:
    messages = message_stream(text_message("<think>plan</think>answer"))
    transformer = AgentMessageTransformer()

    with patch.object(ToolFileMessageTransformer, "transform_tool_invoke_messages", return_value=messages):
        result = list(
            transformer.transform(
                messages=message_stream(),
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

    assert result[0] == StreamChunkEvent(
        selector=["node-id", "text"],
        chunk="<think>plan</think>answer",
        is_final=False,
    )
    completed = result[-1]
    assert isinstance(completed, StreamCompletedEvent)
    assert completed.node_run_result.outputs["text"] == "<think>plan</think>answer"
    assert completed.node_run_result.outputs["reasoning_content"] == ""


def test_transform_separates_reasoning_tags_across_text_chunks() -> None:
    messages = message_stream(
        text_message("<thi"),
        text_message("nk>plan</think>answer"),
    )
    transformer = AgentMessageTransformer()

    with patch.object(ToolFileMessageTransformer, "transform_tool_invoke_messages", return_value=messages):
        result = list(
            transformer.transform(
                messages=message_stream(),
                tool_info={},
                parameters_for_log={},
                user_id="user-id",
                tenant_id="tenant-id",
                conversation_id="conversation-id",
                node_type=BuiltinNodeTypes.AGENT,
                node_id="node-id",
                node_execution_id="execution-id",
                reasoning_format="separated",
            )
        )

    assert result[0] == StreamReasoningEvent(
        selector=["node-id", "reasoning_content"],
        chunk="plan",
        is_final=False,
    )
    assert result[1] == StreamChunkEvent(
        selector=["node-id", "text"],
        chunk="answer",
        is_final=False,
    )
    assert result[2] == StreamReasoningEvent(
        selector=["node-id", "reasoning_content"],
        chunk="",
        is_final=True,
    )
    assert result[3] == StreamChunkEvent(
        selector=["node-id", "text"],
        chunk="",
        is_final=True,
    )

    completed = result[-1]
    assert isinstance(completed, StreamCompletedEvent)
    assert completed.node_run_result.outputs["text"] == "answer"
    assert completed.node_run_result.outputs["reasoning_content"] == "plan"
