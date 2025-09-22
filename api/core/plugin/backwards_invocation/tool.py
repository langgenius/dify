from collections.abc import Generator
from typing import Any

from core.callback_handler.workflow_tool_callback_handler import DifyWorkflowCallbackHandler
from core.plugin.backwards_invocation.base import BaseBackwardsInvocation
from core.tools.entities.tool_entities import ToolInvokeMessage, ToolProviderType
from core.tools.tool_engine import ToolEngine
from core.tools.tool_manager import ToolManager
from core.tools.utils.message_transformer import ToolFileMessageTransformer


class PluginToolBackwardsInvocation(BaseBackwardsInvocation):
    """
    Backwards invocation for plugin tools.
    """

    @classmethod
    def invoke_tool(
        cls,
        tenant_id: str,
        user_id: str,
        tool_type: ToolProviderType,
        provider: str,
        tool_name: str,
        tool_parameters: dict[str, Any],
        credential_id: str | None = None,
    ) -> Generator[ToolInvokeMessage, None, None]:
        """
        invoke tool
        """
        # get tool runtime
        try:
            tool_runtime = ToolManager.get_tool_runtime_from_plugin(
                tool_type, tenant_id, provider, tool_name, tool_parameters, credential_id
            )
            response = ToolEngine.generic_invoke(
                tool_runtime, tool_parameters, user_id, DifyWorkflowCallbackHandler(), workflow_call_depth=1
            )

            response = ToolFileMessageTransformer.transform_tool_invoke_messages(
                response, user_id=user_id, tenant_id=tenant_id
            )

            return response
        except Exception as e:
            raise e
