from __future__ import annotations

from collections.abc import Mapping, Sequence
from enum import StrEnum

from werkzeug.exceptions import BadRequest, Conflict, NotFound

from libs.exception import BaseHTTPException


class AgentNotFoundError(NotFound):
    description = "Agent not found."


class AgentVersionNotFoundError(NotFound):
    description = "Agent config version not found."


class AgentNameConflictError(Conflict):
    description = "Agent name already exists."


class AgentArchivedError(Conflict):
    description = "Archived agent cannot be modified."


class AgentVersionConflictError(Conflict):
    description = "Agent config version changed. Please reload and try again."


class AgentModelNotConfiguredError(BaseHTTPException):
    error_code = "agent_model_not_configured"
    description = "Agent App requires the Agent Soul model to be configured."
    code = 400


class AgentAccessNotReadyError(BaseHTTPException):
    error_code = "agent_not_published"
    description = "Publish the Agent before enabling Web App or API access."
    code = 409


class AgentBuildSandboxNotFoundError(BaseHTTPException):
    error_code = "agent_build_sandbox_not_found"
    description = "The retained Build Sandbox is no longer available."
    code = 404


class AgentHomeSnapshotCreateFailedError(BaseHTTPException):
    error_code = "agent_home_snapshot_create_failed"
    description = "Failed to capture the Agent Home Snapshot."
    code = 502


class AgentHomeSnapshotTooLargeError(BaseHTTPException):
    error_code = "agent_home_snapshot_too_large"
    description = "The Agent Home Snapshot exceeds the configured size limit."
    code = 413


class InvalidRosterAgentPackageError(BaseHTTPException):
    error_code = "invalid_roster_agent_package"
    description = "The Roster Agent package is invalid."
    code = 400


class WorkspaceSkillProblem(StrEnum):
    """Why a workspace Skill a package links to cannot be bound, with what to do about it."""

    remedy: str

    NOT_FOUND = ("workspace_skill_not_found", "is not in this workspace. Import it into the Skill Hub first.")
    NOT_PUBLISHED = (
        "workspace_skill_not_published",
        "has no published version. Publish it in the Skill Hub first.",
    )

    def __new__(cls, value: str, remedy: str) -> WorkspaceSkillProblem:
        member = str.__new__(cls, value)
        member._value_ = value
        member.remedy = remedy
        return member

    def describe(self, name: str) -> str:
        return f'Workspace Skill "{name}" {self.remedy}'


class WorkspaceSkillUnavailableError(InvalidRosterAgentPackageError):
    """A package links its Agents to workspace Skills by name, and these cannot be bound in the workspace."""

    error_code = "workspace_skill_unavailable"

    def __init__(self, problems: Mapping[str, WorkspaceSkillProblem]) -> None:
        self.problems = dict(sorted(problems.items()))
        super().__init__(f"Workspace Skills cannot be linked in this workspace: {', '.join(self.problems)}.")


class RosterReferenceNotAcceptedError(InvalidRosterAgentPackageError):
    """A package links Agent nodes to roster Agents, and the import was not asked to keep such links."""

    error_code = "roster_reference_not_accepted"

    def __init__(self, node_ids: Sequence[str]) -> None:
        self.node_ids = list(node_ids)
        super().__init__(f"App package links these Agent nodes to roster Agents: {', '.join(self.node_ids)}.")


class RosterAgentPackageTooLargeError(BaseHTTPException):
    error_code = "roster_agent_package_too_large"
    description = "The Roster Agent package exceeds the size limit."
    code = 413


class RosterAgentPackageExportFailedError(BaseHTTPException):
    error_code = "roster_agent_package_export_failed"
    description = "The Roster Agent package could not be exported."
    code = 500


class RosterAgentPackageImportFailedError(BaseHTTPException):
    error_code = "roster_agent_package_import_failed"
    description = "The Roster Agent package could not be imported."
    code = 500


class RosterAgentPackageResourceUnavailableError(BaseHTTPException):
    error_code = "roster_agent_package_resource_unavailable"
    description = "The Roster Agent package resources could not be stored."
    code = 503


class AgentSoulLockedError(BadRequest):
    description = "Agent Soul is locked for this workflow node."


class InvalidComposerConfigError(BadRequest):
    description = "Invalid agent composer config."


class PlaintextSecretNotAllowedError(BadRequest):
    description = "Plaintext secret values are not allowed in Agent config."
