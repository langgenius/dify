from unittest.mock import patch

import pytest

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.utils.message_transformer import ToolFileMessageTransformer
from core.workflow.nodes.agent.message_transformer import AgentMessageTransformer
from graphon.enums import BuiltinNodeTypes, WorkflowNodeExecutionMetadataKey
from graphon.node_events import StreamCompletedEvent


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


def _log_message(
    *,
    message_id: str,
    status: ToolInvokeMessage.LogMessage.LogStatus,
    metadata: dict[str, object] | None,
) -> ToolInvokeMessage:
    return ToolInvokeMessage(
        type=ToolInvokeMessage.MessageType.LOG,
        message=ToolInvokeMessage.LogMessage(
            id=message_id,
            label=f"label-{message_id}",
            status=status,
            data={"message_id": message_id, "status": status.value},
            metadata=metadata,
        ),
    )


def _agent_logs_from_transform(messages: list[ToolInvokeMessage]):
    transformer = AgentMessageTransformer()

    with patch.object(ToolFileMessageTransformer, "transform_tool_invoke_messages", return_value=iter(messages)):
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

    completed_event = events[-1]
    assert isinstance(completed_event, StreamCompletedEvent)
    return completed_event.node_run_result.metadata[WorkflowNodeExecutionMetadataKey.AGENT_LOG]


@pytest.mark.parametrize("final_metadata", [{"elapsed_time": 0}, {}])
def test_transform_keeps_existing_positive_elapsed_time_when_final_log_has_zero_or_missing(
    final_metadata: dict[str, object],
) -> None:
    agent_logs = _agent_logs_from_transform(
        [
            _log_message(
                message_id="thought-1",
                status=ToolInvokeMessage.LogMessage.LogStatus.START,
                metadata={"elapsed_time": 1.25},
            ),
            _log_message(
                message_id="thought-1",
                status=ToolInvokeMessage.LogMessage.LogStatus.SUCCESS,
                metadata=final_metadata,
            ),
        ]
    )

    assert len(agent_logs) == 1
    assert agent_logs[0].metadata["elapsed_time"] == 1.25


def test_transform_updates_elapsed_time_when_new_log_has_positive_value() -> None:
    agent_logs = _agent_logs_from_transform(
        [
            _log_message(
                message_id="thought-1",
                status=ToolInvokeMessage.LogMessage.LogStatus.START,
                metadata={"elapsed_time": 1.25},
            ),
            _log_message(
                message_id="thought-1",
                status=ToolInvokeMessage.LogMessage.LogStatus.SUCCESS,
                metadata={"elapsed_time": 1.5},
            ),
        ]
    )

    assert len(agent_logs) == 1
    assert agent_logs[0].metadata["elapsed_time"] == 1.5


def test_transform_does_not_preserve_positive_infinity_elapsed_time() -> None:
    agent_logs = _agent_logs_from_transform(
        [
            _log_message(
                message_id="thought-1",
                status=ToolInvokeMessage.LogMessage.LogStatus.START,
                metadata={"elapsed_time": float("inf")},
            ),
            _log_message(
                message_id="thought-1",
                status=ToolInvokeMessage.LogMessage.LogStatus.SUCCESS,
                metadata={"elapsed_time": 0},
            ),
        ]
    )

    assert len(agent_logs) == 1
    assert agent_logs[0].metadata["elapsed_time"] == 0


def test_transform_does_not_update_elapsed_time_to_positive_infinity() -> None:
    agent_logs = _agent_logs_from_transform(
        [
            _log_message(
                message_id="thought-1",
                status=ToolInvokeMessage.LogMessage.LogStatus.START,
                metadata={"elapsed_time": 1.25},
            ),
            _log_message(
                message_id="thought-1",
                status=ToolInvokeMessage.LogMessage.LogStatus.SUCCESS,
                metadata={"elapsed_time": float("inf")},
            ),
        ]
    )

    assert len(agent_logs) == 1
    assert agent_logs[0].metadata["elapsed_time"] == 1.25


def test_transform_does_not_treat_bool_elapsed_time_as_positive_value() -> None:
    agent_logs = _agent_logs_from_transform(
        [
            _log_message(
                message_id="thought-1",
                status=ToolInvokeMessage.LogMessage.LogStatus.START,
                metadata={"elapsed_time": True},
            ),
            _log_message(
                message_id="thought-1",
                status=ToolInvokeMessage.LogMessage.LogStatus.SUCCESS,
                metadata={"elapsed_time": 0},
            ),
        ]
    )

    assert len(agent_logs) == 1
    assert agent_logs[0].metadata["elapsed_time"] == 0


@pytest.mark.parametrize("metadata", [{"elapsed_time": 0}, {}])
def test_transform_preserves_zero_or_missing_elapsed_time_when_no_positive_value_was_seen(
    metadata: dict[str, object],
) -> None:
    agent_logs = _agent_logs_from_transform(
        [
            _log_message(
                message_id="thought-1",
                status=ToolInvokeMessage.LogMessage.LogStatus.START,
                metadata=metadata,
            ),
            _log_message(
                message_id="thought-1",
                status=ToolInvokeMessage.LogMessage.LogStatus.SUCCESS,
                metadata=metadata,
            ),
        ]
    )

    assert len(agent_logs) == 1
    assert agent_logs[0].metadata == metadata


def test_transform_elapsed_time_merge_is_scoped_to_message_id() -> None:
    agent_logs = _agent_logs_from_transform(
        [
            _log_message(
                message_id="thought-1",
                status=ToolInvokeMessage.LogMessage.LogStatus.START,
                metadata={"elapsed_time": 1.25},
            ),
            _log_message(
                message_id="thought-2",
                status=ToolInvokeMessage.LogMessage.LogStatus.SUCCESS,
                metadata={"elapsed_time": 0},
            ),
            _log_message(
                message_id="thought-1",
                status=ToolInvokeMessage.LogMessage.LogStatus.SUCCESS,
                metadata={},
            ),
        ]
    )

    logs_by_id = {log.message_id: log for log in agent_logs}
    assert logs_by_id["thought-1"].metadata["elapsed_time"] == 1.25
    assert logs_by_id["thought-2"].metadata["elapsed_time"] == 0
