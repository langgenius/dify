"""Execute plugin callbacks into API-owned tools."""

from __future__ import annotations

from collections.abc import Generator
from typing import TYPE_CHECKING, Any

from sqlalchemy.orm import Session

from core.callback_handler.workflow_tool_callback_handler import DifyWorkflowCallbackHandler
from core.tools.entities.tool_entities import ToolInvokeMessage, ToolProviderType
from core.tools.tool_engine import ToolEngine
from core.tools.tool_manager import ToolManager
from core.tools.utils.message_transformer import ToolFileMessageTransformer
from services.knowledge.retrieval.retrieval import KnowledgeRetriever

if TYPE_CHECKING:
    from core.app.apps.workflow_app_runner import WorkflowRunDriver


class PluginToolInvocationService:
    """Invoke tools with execution dependencies bound by the composition root."""

    def __init__(
        self,
        *,
        execution_driver: WorkflowRunDriver,
        knowledge_retrieval: KnowledgeRetriever,
    ) -> None:
        self._execution_driver = execution_driver
        self._knowledge_retrieval = knowledge_retrieval

    def invoke_tool(
        self,
        *,
        session: Session,
        tenant_id: str,
        user_id: str,
        tool_type: ToolProviderType,
        provider: str,
        tool_name: str,
        tool_parameters: dict[str, Any],
        credential_id: str | None = None,
    ) -> Generator[ToolInvokeMessage]:
        tool_runtime = ToolManager.get_tool_runtime_from_plugin(
            tool_type,
            tenant_id,
            provider,
            tool_name,
            tool_parameters,
            user_id=user_id,
            credential_id=credential_id,
            execution_driver=self._execution_driver,
            knowledge_retrieval=self._knowledge_retrieval,
        )
        response = ToolEngine.generic_invoke(
            session, tool_runtime, tool_parameters, user_id, DifyWorkflowCallbackHandler(), workflow_call_depth=1
        )
        return ToolFileMessageTransformer.transform_tool_invoke_messages(response, user_id=user_id, tenant_id=tenant_id)
