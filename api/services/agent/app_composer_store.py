"""Detached configuration used by the standalone Agent Composer."""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from typing import Literal, Protocol

from models.agent_config_entities import AgentSoulConfig
from services.agent.build_session_store import AgentDraftSummary
from services.entities.agent_entities import ComposerSaveStrategy, ComposerVariant


class AgentComposerAgentMissingError(Exception):
    """The admitted workspace has no Agent with the requested ID."""


class AgentComposerSnapshotMissingError(Exception):
    """The Agent has no usable draft or active snapshot."""


@dataclass(frozen=True, slots=True)
class AgentComposerIdentity:
    id: str
    name: str
    description: str
    role: str | None
    icon_type: str | None
    icon: str | None
    icon_background: str | None
    scope: str
    source: str
    status: str
    app_id: str | None
    backing_app_id: str | None
    hidden_app_backed: bool
    active_config_snapshot_id: str | None


@dataclass(frozen=True, slots=True)
class AgentComposerSnapshot:
    id: str
    version: int
    version_note: str | None
    created_by: str | None
    created_at: int | None


@dataclass(frozen=True, slots=True)
class AgentComposerState:
    agent: AgentComposerIdentity
    active_config_snapshot: AgentComposerSnapshot | None
    active_config_is_published: bool
    draft: AgentDraftSummary | None
    agent_soul: dict[str, object]
    save_options: tuple[ComposerSaveStrategy, ...]
    app_id: str | None
    backing_app_id: str | None
    hidden_app_backed: bool
    chat_endpoint: str | None
    variant: Literal[ComposerVariant.AGENT_APP] = ComposerVariant.AGENT_APP


class AgentAppComposerStore(Protocol):
    def get_composer(self, *, tenant_id: str, agent_id: str) -> AgentComposerState:
        """Read the Agent's effective configuration without creating or rebasing a draft."""
        ...

    def save_composer(
        self, *, tenant_id: str, agent_id: str, account_id: str, soul: AgentSoulConfig
    ) -> AgentComposerState:
        """Commit the shared draft without modifying the immutable active snapshot."""
        ...

    def missing_composer_datasets(self, *, tenant_id: str, dataset_ids: list[str]) -> list[str]:
        """Return requested dataset IDs absent from the tenant."""
        ...

    def prepare_publication(self, *, tenant_id: str, agent_id: str) -> AgentPublicationSource:
        """Read the shared draft or active snapshot for publication without writing."""
        ...

    def publish_composer(
        self,
        *,
        tenant_id: str,
        agent_id: str,
        account_id: str,
        source: AgentPublicationSource,
        version_note: str | None,
    ) -> AgentPublication:
        """Publish the validated source only if it still matches under the Agent write lock."""
        ...

    def get_composer_candidates(self, *, tenant_id: str, agent_id: str) -> AgentComposerCandidateSource:
        """Read the effective Soul and its tenant-scoped dataset labels, without writing."""
        ...


@dataclass(frozen=True, slots=True)
class AgentComposerDatasetLabel:
    name: str
    description: str | None


@dataclass(frozen=True, slots=True)
class AgentComposerCandidateSource:
    soul: AgentSoulConfig | None
    datasets: dict[str, AgentComposerDatasetLabel]


class AgentPublicationChangedError(Exception):
    """The prepared shared draft changed during publication validation."""


class AgentPublicationHomeUnavailableError(Exception):
    """The draft references a retired or foreign Home snapshot."""


class AgentPublicationModelMissingError(Exception):
    """The shared draft does not select a model."""


@dataclass(frozen=True, slots=True)
class AgentPublicationSource:
    knowledge_app_id: str | None
    draft_id: str | None
    active_snapshot_id: str | None
    home_snapshot_id: str | None
    soul: dict[str, object]


class AgentPublicationKind(StrEnum):
    """Distinguish first-time API access enablement from an existing publication update."""

    FIRST = "first"
    UPDATE = "update"


@dataclass(frozen=True, slots=True)
class AgentPublication:
    publication_kind: AgentPublicationKind
    active_config_snapshot_id: str
    active_config_snapshot: AgentComposerSnapshot
    draft: AgentDraftSummary
    result: Literal["success"] = "success"
