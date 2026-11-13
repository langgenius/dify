"""Detached records and persistence contract for an account's Agent Build session."""

from dataclasses import dataclass
from typing import Protocol


class AgentBuildAgentNotFoundError(Exception):
    """The requested Agent does not exist or cannot start a Build conversation."""


class AgentBuildDraftNotFoundError(Exception):
    """The requested account has no Build draft for this Agent."""


class AgentBuildBindingUnavailableError(Exception):
    """The draft's retained Sandbox binding is no longer available in its owner scope."""


@dataclass(frozen=True, slots=True)
class AgentDraftSummary:
    """Identity, base snapshot and audit fields shared by Agent drafts."""

    id: str
    agent_id: str
    draft_type: str
    account_id: str | None
    base_snapshot_id: str | None
    created_by: str | None
    updated_by: str | None
    created_at: int | None
    updated_at: int | None


@dataclass(frozen=True, slots=True)
class AgentBuildDraft:
    """The draft's summary and stored Soul configuration, detached from persistence."""

    summary: AgentDraftSummary
    agent_soul: dict[str, object]


@dataclass(frozen=True, slots=True)
class AgentBuildRefresh:
    """The new conversation and any binding retired by the same commit."""

    conversation_id: str
    retired_binding_id: str | None


class AgentBuildSessionStore(Protocol):
    def refresh_build_conversation(self, *, tenant_id: str, agent_id: str, account_id: str) -> AgentBuildRefresh:
        """Commit the new conversation mapping and clear and retire the caller's retained binding atomically."""
        ...

    def get_build_draft(self, *, tenant_id: str, agent_id: str, account_id: str) -> AgentBuildDraft:
        """Read the caller's draft without creating one; raise AgentBuildDraftNotFoundError if absent."""
        ...

    def discard_build_draft(self, *, tenant_id: str, agent_id: str, account_id: str) -> str | None:
        """Delete the caller's draft and retire its binding atomically. Return the retired id, if any."""
        ...
