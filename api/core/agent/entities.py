import uuid
from collections.abc import Mapping
from enum import StrEnum
from typing import Any, Union

from pydantic import BaseModel, Field

from core.tools.entities.tool_entities import ToolInvokeMessage, ToolProviderType


class AgentToolEntity(BaseModel):
    """
    Agent Tool Entity.
    """

    provider_type: ToolProviderType
    provider_id: str
    tool_name: str
    tool_parameters: dict[str, Any] = Field(default_factory=dict)
    plugin_unique_identifier: str | None = None
    credential_id: str | None = None


class AgentPromptEntity(BaseModel):
    """
    Agent Prompt Entity.
    """

    first_prompt: str
    next_iteration: str


class AgentScratchpadUnit(BaseModel):
    """
    Agent First Prompt Entity.
    """

    class Action(BaseModel):
        """
        Action Entity.
        """

        action_name: str
        action_input: Union[dict, str]

        def to_dict(self):
            """
            Convert to dictionary.
            """
            return {
                "action": self.action_name,
                "action_input": self.action_input,
            }

    agent_response: str | None = None
    thought: str | None = None
    action_str: str | None = None
    observation: str | None = None
    action: Action | None = None

    def is_final(self) -> bool:
        """
        Check if the scratchpad unit is final.
        """
        return self.action is None or (
            "final" in self.action.action_name.lower() and "answer" in self.action.action_name.lower()
        )


class AgentEntity(BaseModel):
    """
    Agent Entity.
    """

    class Strategy(StrEnum):
        """
        Agent Strategy.
        """

        CHAIN_OF_THOUGHT = "chain-of-thought"
        FUNCTION_CALLING = "function-calling"

    provider: str
    model: str
    strategy: Strategy
    prompt: AgentPromptEntity | None = None
    tools: list[AgentToolEntity] | None = None
    max_iteration: int = 10


class AgentInvokeMessage(ToolInvokeMessage):
    """
    Agent Invoke Message.
    """

    pass


class ExecutionContext(BaseModel):
    """Execution context containing trace and audit information.

    Carries IDs and metadata needed for tracing, auditing, and correlation
    but not part of the core business logic.
    """

    user_id: str | None = None
    app_id: str | None = None
    conversation_id: str | None = None
    message_id: str | None = None
    tenant_id: str | None = None
    node_id: str | None = None

    @classmethod
    def create_minimal(cls, user_id: str | None = None) -> "ExecutionContext":
        return cls(user_id=user_id)

    def to_dict(self) -> dict[str, Any]:
        return {
            "user_id": self.user_id,
            "app_id": self.app_id,
            "conversation_id": self.conversation_id,
            "message_id": self.message_id,
            "tenant_id": self.tenant_id,
        }

    def with_updates(self, **kwargs) -> "ExecutionContext":
        data = self.to_dict()
        data.update(kwargs)
        return ExecutionContext(**{k: v for k, v in data.items() if k in ExecutionContext.model_fields})


class AgentLog(BaseModel):
    """Structured log entry for agent execution tracing."""

    class LogType(StrEnum):
        ROUND = "round"
        THOUGHT = "thought"
        TOOL_CALL = "tool_call"

    class LogMetadata(StrEnum):
        STARTED_AT = "started_at"
        FINISHED_AT = "finished_at"
        ELAPSED_TIME = "elapsed_time"
        TOTAL_PRICE = "total_price"
        TOTAL_TOKENS = "total_tokens"
        PROVIDER = "provider"
        CURRENCY = "currency"
        LLM_USAGE = "llm_usage"
        ICON = "icon"
        ICON_DARK = "icon_dark"

    class LogStatus(StrEnum):
        START = "start"
        ERROR = "error"
        SUCCESS = "success"

    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    label: str = Field(...)
    log_type: LogType = Field(...)
    parent_id: str | None = Field(default=None)
    error: str | None = Field(default=None)
    status: LogStatus = Field(...)
    data: Mapping[str, Any] = Field(...)
    metadata: Mapping[LogMetadata, Any] = Field(default={})


class AgentResult(BaseModel):
    """Agent execution result."""

    text: str = Field(default="")
    files: list[Any] = Field(default_factory=list)
    usage: Any | None = Field(default=None)
    finish_reason: str | None = Field(default=None)
