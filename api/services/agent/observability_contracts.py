"""Framework-independent inputs and query port for Agent observability."""

from dataclasses import dataclass
from typing import Protocol

from machinery.context import RequestContext


class AgentObservabilityNotFoundError(Exception):
    """The requested Agent or its runtime App is unavailable in the admitted workspace."""


@dataclass(frozen=True, slots=True, kw_only=True)
class AgentLogQuery:
    page: int
    limit: int
    keyword: str | None
    statuses: tuple[str, ...]
    sources: tuple[str, ...]
    sort_by: str
    sort_order: str
    start: str | None
    end: str | None


@dataclass(frozen=True, slots=True, kw_only=True)
class AgentStatisticsQuery:
    source: str | None
    start: str | None
    end: str | None


class AgentObservability(Protocol):
    """Query a tenant-owned Agent's runtime logs and statistics."""

    def list_logs(self, context: RequestContext, agent_id: str, query: AgentLogQuery) -> dict[str, object]:
        """Return a detached page of matching conversations."""
        ...

    def list_log_messages(
        self, context: RequestContext, agent_id: str, conversation_id: str, query: AgentLogQuery
    ) -> dict[str, object]:
        """Return a detached page of matching messages for a conversation."""
        ...

    def list_log_sources(self, context: RequestContext, agent_id: str) -> dict[str, object]:
        """Return the Agent's available runtime sources."""
        ...

    def statistics(self, context: RequestContext, agent_id: str, query: AgentStatisticsQuery) -> dict[str, object]:
        """Return the requested summary in the admitted account's timezone."""
        ...
