from unittest.mock import patch

from graphon.enums import BuiltinNodeTypes

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
