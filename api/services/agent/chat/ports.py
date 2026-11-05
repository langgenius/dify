"""Capabilities needed by Agent Chat without owning database sessions."""

from collections.abc import Sequence
from typing import Any, Protocol

from dify_trace_sdk.emitter import TraceScope

from core.app.app_config.entities import DatasetRetrieveConfigEntity
from core.app.entities.app_invoke_entities import InvokeFrom
from core.callback_handler.agent_tool_callback_handler import DifyAgentCallbackHandler
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
    """Invoke one Agent tool without exposing persistence ownership to runners.

    Preconditions: ``trace_scope`` is the current invocation's scope, or
    ``None`` when nothing consumes its trace events; runners always pass it.
    Postconditions: Implementations own any database session they need and
    return the observation, committed message file IDs, and invocation meta.
    A completed tool call is reported to ``trace_scope`` after its message
    files are committed; failed calls return an error meta and report nothing.
    """

    def __call__(
        self,
        tool: Tool,
        tool_parameters: str | dict[str, Any],
        user_id: str,
        tenant_id: str,
        message: Message,
        invoke_from: InvokeFrom,
        agent_tool_callback: DifyAgentCallbackHandler,
        trace_scope: TraceScope | None,
        conversation_id: str | None = None,
        app_id: str | None = None,
        message_id: str | None = None,
        *,
        records: MessageFileWriter,
    ) -> tuple[str, list[str], ToolInvokeMeta]: ...
