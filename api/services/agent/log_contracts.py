"""Loaded inputs and persistence port for Agent message logs."""

from dataclasses import dataclass
from datetime import datetime
from typing import Any, Protocol

from core.tools.entities.tool_entities import EmojiIconDict, ToolProviderType
from models.model import AppModelConfigDict


class AgentLogAppNotFoundError(Exception):
    """The requested Agent Chat app is outside the admitted workspace or mode."""


class AgentLogNotFoundError(ValueError):
    """The conversation or message required for the log is unavailable."""


class AgentLogConfigurationError(ValueError):
    """The app has no usable Agent configuration."""


@dataclass(frozen=True)
class AgentLogThought:
    tokens: int | None
    tools: list[str]
    labels: dict[str, Any]
    metadata: dict[str, Any]
    inputs: dict[str, Any]
    outputs: dict[str, Any]
    raw_input: str | None
    raw_output: str | None
    thought: str | None
    created_at: datetime
    files: list[Any]


@dataclass(frozen=True)
class AgentLogSnapshot:
    executor: str
    timezone: str
    created_at: datetime
    elapsed_time: float
    total_tokens: int
    model_config: AppModelConfigDict
    thoughts: list[AgentLogThought]
    files: list[dict[str, Any]]


class AgentLogRecords(Protocol):
    def agent_log(
        self, *, tenant_id: str, account_id: str, app_id: str, conversation_id: str, message_id: str
    ) -> AgentLogSnapshot: ...


class AgentLogFiles(Protocol):
    def resolve(self, *, tenant_id: str, files: list[dict[str, Any]]) -> list[dict[str, Any]]: ...


class AgentLogIcons(Protocol):
    def __call__(self, *, tenant_id: str, provider_type: ToolProviderType, provider_id: str) -> str | EmojiIconDict: ...
