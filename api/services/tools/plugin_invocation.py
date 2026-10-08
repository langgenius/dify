from collections.abc import Callable, Generator
from contextlib import closing
from typing import Any

from core.app.apps.draft_variable_saver import DraftVariableSaverFactory
from core.callback_handler.workflow_tool_callback_handler import DifyWorkflowCallbackHandler
from core.plugin.backwards_invocation.base import BaseBackwardsInvocation
from core.tools.entities.tool_entities import ToolInvokeMessage, ToolProviderType
from core.tools.utils.message_transformer import ToolFileMessageTransformer
from models import Account
from services.tools.tool_manager import ToolManager
from services.workflow.execution.ports import WorkflowRuntime


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
        *,
        workflow_runtime: WorkflowRuntime,
        draft_variable_saver: Callable[[str, Account], DraftVariableSaverFactory],
    ) -> Generator[ToolInvokeMessage, None, None]:
        """
        invoke tool
        """
        tool_runtime = ToolManager.get_tool_runtime_from_plugin(
            tool_type,
            tenant_id,
            provider,
            tool_name,
            tool_parameters,
            user_id=user_id,
            credential_id=credential_id,
            workflow_runtime=workflow_runtime,
            draft_variable_saver=draft_variable_saver,
        )

        def invoke() -> Generator[ToolInvokeMessage, None, None]:
            with closing(
                workflow_runtime.tool_invoker(
                    tool=tool_runtime,
                    tool_parameters=tool_parameters,
                    user_id=user_id,
                    workflow_tool_callback=DifyWorkflowCallbackHandler(),
                    workflow_call_depth=1,
                )
            ) as response:
                with closing(
                    ToolFileMessageTransformer.transform_tool_invoke_messages(
                        response,
                        user_id=user_id,
                        tenant_id=tenant_id,
                    )
                ) as transformed:
                    yield from transformed

        return invoke()
