"""Shared Agent configuration contracts for version selection and asset access."""

from dataclasses import dataclass
from enum import StrEnum


class AgentConfigVersionKind(StrEnum):
    SNAPSHOT = "snapshot"
    DRAFT = "draft"
    BUILD_DRAFT = "build_draft"


class AgentConfigRuntimeMissingError(Exception):
    """The workspace has no runtime App for the requested Agent."""


class AgentConfigWorkflowMissingError(Exception):
    """No eligible Workflow or Chatflow is visible within the current tenant."""


class AgentConfigNodeUnboundError(Exception):
    """The selected Workflow draft node does not bind an Agent."""


class AgentConfigVersionMissingError(Exception):
    """The selected shared or account-owned configuration cannot be resolved."""


@dataclass(frozen=True, slots=True)
class AgentConfigSelection:
    tenant_id: str
    agent_id: str
    account_id: str | None
    version_id: str
    version_kind: AgentConfigVersionKind
