"""Application contracts for visible Agent configuration versions."""

from dataclasses import dataclass
from typing import Literal, Protocol

from pydantic import JsonValue


class VersionAgentNotFoundError(Exception):
    """The Agent is absent from the admitted workspace's roster."""


class AgentVersionUnavailableError(Exception):
    """The requested version is not visible for the Agent."""


class AgentVersionPlanRequiredError(Exception):
    """Restoring a version requires a paid workspace plan."""


@dataclass(frozen=True, slots=True)
class AgentVersionSummary:
    """Visible version metadata; optional fields are absent in older snapshots."""

    id: str
    agent_id: str
    version: int
    display_version: int
    snapshot_version: int
    summary: str | None
    version_note: str | None
    created_by: str | None
    created_at: int | None


@dataclass(frozen=True, slots=True)
class AgentVersionRevision:
    """Audit revision metadata; optional fields reflect absent legacy values."""

    id: str
    previous_snapshot_id: str | None
    current_snapshot_id: str | None
    revision: int
    operation: str
    summary: str | None
    version_note: str | None
    created_by: str | None
    created_at: int | None


@dataclass(frozen=True, slots=True)
class AgentVersionDetail(AgentVersionSummary):
    """A visible version and its immutable configuration and audit history."""

    config_snapshot: dict[str, JsonValue]
    revisions: list[AgentVersionRevision]


@dataclass(frozen=True, slots=True)
class AgentVersionRestored:
    """Identifiers of the shared draft and snapshot after a committed restore."""

    result: Literal["success"]
    active_config_snapshot_id: str
    draft_config_id: str
    restored_version_id: str


class AgentVersionStore(Protocol):
    """Scope each operation to the workspace and roster Agent; return detached records."""

    def list_versions(self, *, tenant_id: str, agent_id: str) -> list[AgentVersionSummary]:
        """Return visible versions or raise VersionAgentNotFoundError."""
        ...

    def get_version(self, *, tenant_id: str, agent_id: str, version_id: str) -> AgentVersionDetail:
        """Return a visible version or raise the matching owner/version error."""
        ...

    def restore_version(
        self, *, tenant_id: str, agent_id: str, version_id: str, account_id: str
    ) -> AgentVersionRestored:
        """Commit a visible version to the shared draft, or leave it unchanged on error."""
        ...
