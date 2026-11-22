"""Framework-independent inputs and query port for Agent observability."""

from collections.abc import Generator
from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum
from typing import Protocol
from uuid import UUID

from machinery.context import RequestContext
from services.entities.conversation_entities import ConsoleLogIdentity


class AgentObservabilityNotFoundError(Exception):
    """The requested Agent or its runtime App is unavailable in the admitted workspace."""


def normalize_agent_log_export_source(source: str) -> str:
    """Validate a structured app or workflow selector and normalize its UUIDs before it reaches SQL."""
    kind, separator, identifier = source.strip().partition(":")
    kind = kind.lower()
    if not separator or kind not in {"webapp", "workflow"}:
        return source.strip()
    parts = identifier.split(":")
    if not all(parts) or (len(parts) != 1 and (kind == "webapp" or len(parts) < 4)):
        raise ValueError("Invalid structured log source ID.")
    try:
        parts[0] = str(UUID(parts[0]))
        if len(parts) > 1:
            parts[1] = str(UUID(parts[1]))
    except ValueError as exc:
        raise ValueError("Invalid structured log source ID.") from exc
    return ":".join((kind, *parts))


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
    end_user_ids: tuple[str, ...] = ()
    account_ids: tuple[str, ...] = ()


@dataclass(frozen=True, slots=True, kw_only=True)
class AgentLogExportQuery:
    """Filter export rows by source, identity, and optional account-local time bounds."""

    sources: tuple[str, ...]
    end_user_ids: tuple[str, ...]
    start: str | None
    end: str | None
    account_ids: tuple[str, ...] = ()


@dataclass(frozen=True, slots=True, kw_only=True)
class AgentLogExportFilters:
    """Source and identity filters with resolved UTC bounds, absent for unbounded time."""

    sources: tuple[str, ...]
    end_user_ids: tuple[str, ...]
    start: datetime | None
    end: datetime | None
    account_ids: tuple[str, ...] = ()


@dataclass(frozen=True, slots=True)
class AgentLogExportCounts:
    log_count: int
    row_count: int


class AgentLogExportSource(StrEnum):
    WEB_APP = "WebApp"
    WORKFLOW = "Workflow"


@dataclass(frozen=True, slots=True, kw_only=True)
class AgentLogExportRow:
    """A detached WebApp question and answer or Workflow Agent node execution."""

    source: AgentLogExportSource
    end_user_id: str | None
    conversation_id: str
    message_id: str
    created_at: datetime
    user_input: str
    app_response: str
    status: str
    feedback_rating: str | None
    feedback_content: str | None
    account_id: str | None = None


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

    def search_log_identities(
        self, context: RequestContext, agent_id: str, *, keyword: str
    ) -> tuple[ConsoleLogIdentity, ...]:
        """Return up to 20 identities of each type with logs for the admitted Agent.

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

    def resolve_log_export_filters(
        self, context: RequestContext, agent_id: str, query: AgentLogExportQuery
    ) -> AgentLogExportFilters:
        """Require an available Agent in the caller's workspace and normalize its valid filters to UTC.

        Raise AgentObservabilityNotFoundError if the Agent or its runtime App is unavailable,
        and ValueError if the sources or time range are invalid.
        """
        ...

    def require_log_export_scope(self, context: RequestContext, agent_id: str) -> None:
        """Require an existing Agent and runtime App in the caller's active workspace.

        Raise AgentObservabilityNotFoundError without provisioning a backing App.
        """
        ...

    def get_log_export_workspace_id(self, agent_id: str) -> str:
        """Resolve the Agent's workspace for a trusted server operator or raise if missing."""
        ...

    def iter_export_rows(
        self, *, tenant_id: str, agent_id: str, filters: AgentLogExportFilters
    ) -> Generator[AgentLogExportRow]:
        """Yield matching CSV rows for the Agent in the supplied workspace with the same filters as the preview.

        Raise AgentObservabilityNotFoundError if the Agent or backing App is unavailable.
        Return detached rows without holding a database session open between batches.
        """
        ...

    def statistics(self, context: RequestContext, agent_id: str, query: AgentStatisticsQuery) -> dict[str, object]:
        """Return the requested summary in the admitted account's timezone."""
        ...
