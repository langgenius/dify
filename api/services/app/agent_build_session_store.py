"""Detached records and persistence contract for an account's Agent Build session."""

from dataclasses import dataclass
from typing import Protocol


class AgentBuildAgentNotFoundError(Exception):
    """The requested Agent does not exist or cannot start a Build conversation."""


class AgentBuildDraftNotFoundError(Exception):
    """The requested account has no Build draft for this Agent."""


class AgentBuildBaseUnavailableError(Exception):
    """The Agent has no configuration snapshot from which to initialize a draft."""


class AgentBuildApplyChangedError(Exception):
    """The prepared Build draft or Sandbox changed before Apply could commit."""


class AgentBuildBindingUnavailableError(Exception):
    """The draft's retained Sandbox binding is no longer available in its owner scope."""


class AgentBuildSnapshotFailedError(Exception):
    """The Sandbox backend failed to checkpoint its Home."""


class AgentBuildSnapshotTooLargeError(Exception):
    """The Sandbox Home exceeds the backend checkpoint limit."""


class AgentBuildSoulLockedError(Exception):
    """The requested save edits a locked workflow Soul."""


class AgentBuildInvalidConfigError(Exception):
    """The Soul configuration cannot be applied."""


class AgentBuildPlaintextSecretError(Exception):
    """The Soul includes a secret in plaintext."""


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


@dataclass(frozen=True, slots=True)
class AgentBuildSandbox:
    """The validated participant and backend reference for checkpointing a Build draft."""

    binding_id: str
    workspace_id: str
    app_id: str
    backend_binding_ref: str


@dataclass(frozen=True, slots=True)
class AgentBuildApplySource:
    """The complete Build state used for validation and compared again before writeback."""

    draft_id: str
    base_snapshot_id: str | None
    home_snapshot_id: str | None
    agent_soul: dict[str, object]
    sandbox: AgentBuildSandbox | None


@dataclass(frozen=True, slots=True)
class AgentBuildHomeSnapshot:
    """The backend handle and API-generated identity of a successful checkpoint."""

    id: str
    ref: str


@dataclass(frozen=True, slots=True)
class AgentBuildCheckout:
    """The caller's Build draft and a binding retired by a forced checkout, if any."""

    draft: AgentBuildDraft
    retired_binding_id: str | None


@dataclass(frozen=True, slots=True)
class AgentBuildApplied:
    """The shared draft and binding IDs retired by the committed apply."""

    draft: AgentDraftSummary
    retired_binding_ids: tuple[str, ...]


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

    def save_build_draft(
        self, *, tenant_id: str, agent_id: str, account_id: str, agent_soul: dict[str, object]
    ) -> AgentBuildDraft:
        """Save a validated personal Soul. Omitted config files retain the latest stored list."""
        ...

    def checkout_build_draft(
        self, *, tenant_id: str, agent_id: str, account_id: str, force: bool
    ) -> AgentBuildCheckout:
        """Copy the shared draft into the caller's draft, or reuse it unless force is set."""
        ...

    def prepare_build_apply(self, *, tenant_id: str, agent_id: str, account_id: str) -> AgentBuildApplySource:
        """Read the caller's draft and resolve its Sandbox. None means no valid binding."""
        ...

    def commit_build_apply(
        self,
        *,
        tenant_id: str,
        agent_id: str,
        account_id: str,
        source: AgentBuildApplySource,
        snapshot: AgentBuildHomeSnapshot | None,
    ) -> AgentBuildApplied:
        """Revalidate the source under lock before applying it. None means an image-fresh Home."""
        ...
