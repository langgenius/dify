"""Framework-independent inputs and query port for Agent observability."""

from collections.abc import Generator
from dataclasses import dataclass
from datetime import datetime
from typing import Literal, Protocol

from machinery.context import RequestContext
from services.entities.conversation_entities import ConsoleLogIdentity


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
class AgentLogExportQuery:
    """Filter export rows by source, end user, and optional account-local time bounds."""

    sources: tuple[str, ...]
    end_user_ids: tuple[str, ...]
    start: str | None
    end: str | None


@dataclass(frozen=True, slots=True)
class AgentLogExportCounts:
    log_count: int
    row_count: int


@dataclass(frozen=True, slots=True, kw_only=True)
class AgentLogExportRow:
    """A detached WebApp question and answer or Workflow Agent node execution."""

    source: Literal["WebApp", "Workflow"]
    end_user_id: str | None
    conversation_id: str
    message_id: str
    created_at: datetime
    user_input: str
    app_response: str
    status: str
    feedback_rating: str | None
    feedback_content: str | None


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

    def search_log_end_users(
        self, context: RequestContext, agent_id: str, *, keyword: str
    ) -> tuple[ConsoleLogIdentity, ...]:
        """Return up to 20 end users with logs for the admitted Agent.

        Require a nonblank keyword. Match the visible label by substring or the
        full internal ID. Raise AgentObservabilityNotFoundError for an unavailable Agent.
        """
        ...

    def count_export_logs(
        self, context: RequestContext, agent_id: str, query: AgentLogExportQuery
    ) -> AgentLogExportCounts | None:
        """Count the admitted Agent's filtered logs and export rows, or return None on timeout.

        Raise AgentObservabilityNotFoundError for an unavailable Agent and ValueError
        for invalid sources or time bounds. No log contents leave the read session.
        """
        ...

    def iter_export_rows(
        self, context: RequestContext, agent_id: str, filters: AgentLogExportQuery
    ) -> Generator[AgentLogExportRow]:
        """Yield matching CSV rows for the admitted Agent with the same filters as the preview.

        Raise AgentObservabilityNotFoundError if the Agent or backing App is unavailable.
        Return detached rows without holding a database session open between batches.
        """
        ...

    def statistics(self, context: RequestContext, agent_id: str, query: AgentStatisticsQuery) -> dict[str, object]:
        """Return the requested summary in the admitted account's timezone."""
        ...
