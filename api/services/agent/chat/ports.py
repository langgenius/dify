"""Capabilities needed by Agent Chat without owning database sessions."""

from collections.abc import Sequence
from typing import Any, Protocol

from core.app.app_config.entities import DatasetRetrieveConfigEntity
from core.app.entities.app_invoke_entities import InvokeFrom
from core.callback_handler.agent_tool_callback_handler import DifyAgentCallbackHandler
from core.ops.ops_trace_manager import TraceQueueManager
from core.tools.__base.tool import Tool
from core.tools.entities.tool_entities import ToolInvokeMeta
from models.model import Message
from services.app.generation.ports import MessageFileWriter
from services.knowledge.retrieval.adapters.resource_events import DatasetIndexToolCallbackHandler


class AgentDatasetTools(Protocol):
    def __call__(
        self,
        *,
        tenant_id: str,
        app_id: str,
        dataset_ids: list[str],
        retrieve_config: DatasetRetrieveConfigEntity | None,
        return_resource: bool,
        invoke_from: InvokeFrom,
        hit_callback: DatasetIndexToolCallbackHandler,
        user_id: str,
        inputs: dict[str, Any],
    ) -> Sequence[Tool]: ...


class AgentToolInvoker(Protocol):
    """Invoke one Agent tool without exposing persistence ownership to runners."""

    def __call__(
        self,
        tool: Tool,
        tool_parameters: str | dict[str, Any],
        user_id: str,
        tenant_id: str,
        message: Message,
        invoke_from: InvokeFrom,
        agent_tool_callback: DifyAgentCallbackHandler,
        trace_manager: TraceQueueManager | None = None,
        conversation_id: str | None = None,
        app_id: str | None = None,
        message_id: str | None = None,
        *,
        records: MessageFileWriter,
    ) -> tuple[str, list[str], ToolInvokeMeta]: ...
