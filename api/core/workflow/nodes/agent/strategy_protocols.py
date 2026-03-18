from __future__ import annotations

from collections.abc import Generator, Sequence
from typing import Any, Protocol

from core.agent.plugin_entities import AgentStrategyParameter
from core.plugin.entities.request import InvokeCredentials
from core.tools.entities.tool_entities import ToolInvokeMessage


class ResolvedAgentStrategy(Protocol):
    meta_version: str | None

    def get_parameters(self) -> Sequence[AgentStrategyParameter]: ...

    def invoke(
        self,
        *,
        params: dict[str, Any],
        user_id: str,
        conversation_id: str | None = None,
        app_id: str | None = None,
        message_id: str | None = None,
        credentials: InvokeCredentials | None = None,
    ) -> Generator[ToolInvokeMessage, None, None]: ...


class AgentStrategyResolver(Protocol):
    def resolve(
        self,
        *,
        tenant_id: str,
        agent_strategy_provider_name: str,
        agent_strategy_name: str,
    ) -> ResolvedAgentStrategy: ...


class AgentStrategyPresentationProvider(Protocol):
    def get_icon(self, *, tenant_id: str, agent_strategy_provider_name: str) -> str | None: ...
