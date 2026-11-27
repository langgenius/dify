"""Detached reads for the Agent configuration version and its referenced files."""

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


class AgentConfigFileReader(Protocol):
    def get_workspace_content_record(self, *, tenant_id: str, file_id: str, kind: FileKind) -> FileContentRecord | None:
        """Return detached metadata for the specified workspace file, or None if unavailable."""
        ...
