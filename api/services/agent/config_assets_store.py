"""Detached reads and scoped edits of Agent configuration versions and their files."""

from contextlib import AbstractContextManager
from dataclasses import dataclass
from enum import StrEnum
from typing import Protocol

from models.agent_config_entities import AgentSoulConfig
from services.agent.agent_config_contracts import AgentConfigSelection, AgentConfigVersionKind
from services.entities.file_grant_entities import FileContentRecord, FileKind


class AgentConfigTargetErrorCode(StrEnum):
    AGENT_NOT_FOUND = "agent_not_found"
    VERSION_NOT_FOUND = "config_version_not_found"
    MISSING_USER_ID = "missing_user_id"
    INVALID_VERSION_KIND = "invalid_config_version_kind"


class AgentConfigTargetError(Exception):
    """The requested version could not be loaded in its Agent and account scope."""

    def __init__(self, code: AgentConfigTargetErrorCode, message: str) -> None:
        """Carry the reason and existing fallback message to the application boundary."""
        super().__init__(message)
        self.code = code


@dataclass(slots=True)
class AgentConfigTarget:
    """The selected version's metadata and validated Soul, detached from persistence."""

    tenant_id: str
    agent_id: str
    version_id: str
    kind: AgentConfigVersionKind
    writable: bool
    agent_soul: AgentSoulConfig


class AgentConfigReader(Protocol):
    def get_config_target(self, selection: AgentConfigSelection) -> AgentConfigTarget:
        """Read the exact scoped version and return its Soul or raise AgentConfigTargetError."""
        ...


@dataclass(frozen=True, slots=True)
class AgentConfigFileSource:
    """File metadata safe for use after its workspace lookup transaction closes."""

    id: str
    name: str
    storage_key: str
    size: int
    mime_type: str | None
    hash: str | None


class AgentConfigFileSourceError(Exception):
    """Persistence could not read the workspace file metadata."""


class AgentConfigEdit(Protocol):
    """Operate on a single selection while its repository context is open."""

    def lock_target(self) -> AgentConfigTarget:
        """Lock the Agent then its Draft and return the same refreshed mutable Soul on repeated calls.

        Authorization to edit the loaded version remains with the use case.
        Raise AgentConfigTargetError if the exact owned version cannot be selected.
        """
        ...

    def get_file_source(self, *, file_id: str, kind: FileKind) -> AgentConfigFileSource | None:
        """Return workspace-scoped metadata without locking the target.

        Return None for an unavailable file and raise AgentConfigFileSourceError on a read failure.
        """
        ...


class AgentConfigStore(AgentConfigReader, Protocol):
    def edit_config(self, selection: AgentConfigSelection) -> AbstractContextManager[AgentConfigEdit]:
        """Open a scoped edit and commit the locked draft's Soul only on a successful exit.

        Use the context for database operations and in-memory changes. An exception aborts the edit,
        and a context used only to look up file sources closes without writing. Snapshots are read-only.
        """
        ...


class AgentConfigFileReader(Protocol):
    def get_workspace_content_record(self, *, tenant_id: str, file_id: str, kind: FileKind) -> FileContentRecord | None:
        """Return detached metadata for the specified workspace file, or None if unavailable."""
        ...
