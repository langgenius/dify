"""Strict data contract for portable Roster Agent archives."""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import BinaryIO, Final, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from services.agent.dsl_entities import AgentAppDsl

ROSTER_AGENT_PACKAGE_FORMAT: Final[Literal["dify.roster-agent"]] = "dify.roster-agent"
ROSTER_AGENT_PACKAGE_FORMAT_VERSION: Final[Literal[1]] = 1
ROSTER_AGENT_PACKAGE_MAX_SIGNATURE_BYTES = 64 * 1024

_SHA256_PATTERN = re.compile(r"^[0-9a-f]{64}$")


@dataclass(frozen=True)
class RosterAgentPackageMember:
    size: int
    sha256: str


class RosterAgentPackageAudit(BaseModel):
    model_config = ConfigDict(extra="forbid")

    ref: str = Field(min_length=1, max_length=255)


class _RosterAgentPackageResource(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    path: str = Field(min_length=1, max_length=255)
    size: int = Field(ge=0)
    sha256: str
    audit: RosterAgentPackageAudit | None = None

    @field_validator("sha256")
    @classmethod
    def validate_sha256(cls, value: str) -> str:
        if _SHA256_PATTERN.fullmatch(value) is None:
            raise ValueError("sha256 must be a lowercase hexadecimal SHA-256 digest")
        return value


class RosterAgentPackageSkill(_RosterAgentPackageResource):
    id: str = Field(pattern=r"^s_[0-9]{6}$")
    scope: Literal["agent_config", "workspace"]
    name: str = Field(min_length=1, max_length=64)

    @model_validator(mode="after")
    def validate_skill_path(self) -> Self:
        if self.path != f"{self.id}.zip":
            raise ValueError("skill path must be the resource id with a .zip extension")
        return self


class RosterAgentPackageFile(_RosterAgentPackageResource):
    id: str = Field(pattern=r"^f_[0-9]{6}$")

    @model_validator(mode="after")
    def validate_file_metadata(self) -> Self:
        if self.path == self.id or not self.path.startswith(f"{self.id}."):
            raise ValueError("file path must start with the resource id and include an extension")
        if "/" in self.path or "\\" in self.path:
            raise ValueError("file path must be a root-level archive member")
        return self


class RosterAgentPackageManifest(BaseModel):
    """Package metadata and resource index stored in ``manifest.yaml``."""

    model_config = ConfigDict(extra="forbid")

    format: Literal["dify.roster-agent"]
    format_version: Literal[1]
    audit: RosterAgentPackageAudit | None = None
    skills: list[RosterAgentPackageSkill] = Field(default_factory=list)
    files: list[RosterAgentPackageFile] = Field(default_factory=list)

    @model_validator(mode="after")
    def validate_resource_index(self) -> Self:
        resources = [*self.skills, *self.files]
        ids = [item.id for item in resources]
        if len(ids) != len(set(ids)):
            raise ValueError("resource ids must be unique")
        skill_names = [item.name for item in self.skills]
        if len(skill_names) != len(set(skill_names)):
            raise ValueError("skill names must be unique after workspace Skills are localized")

        return self

    def validate_app(self, app: AgentAppDsl) -> None:
        """Resolve application references against the package resource index."""

        if app.package.soul.schema_version != 1:
            raise ValueError("unsupported Agent Soul schema version")
        skill_by_id = {item.id: item for item in self.skills}
        referenced_skill_ids: set[str] = set()
        for skill_ref in app.package.soul.config_skills:
            if skill_ref.is_missing:
                continue
            skill_resource = skill_by_id.get(skill_ref.file_id)
            if skill_resource is None or skill_resource.scope != "agent_config":
                raise ValueError("config skill reference must resolve to an agent_config skill")
            if skill_resource.name != skill_ref.name:
                raise ValueError("config skill name must match its resource metadata")
            referenced_skill_ids.add(skill_resource.id)
        unreferenced_skills = {
            item.id for item in self.skills if item.scope == "agent_config" and item.id not in referenced_skill_ids
        }
        if unreferenced_skills:
            raise ValueError("agent_config skill resources must be referenced by the Agent Soul")

        workspace_names = [item.name for item in app.package.workspace_skills]
        if len(workspace_names) != len(set(workspace_names)):
            raise ValueError("workspace skill names must be unique in the Agent DSL")
        if set(workspace_names) != {item.name for item in self.skills if item.scope == "workspace"}:
            raise ValueError("workspace skill references must match the package resource index")

        file_by_id = {item.id: item for item in self.files}
        referenced_file_ids: set[str] = set()
        for file_ref in app.package.soul.config_files:
            if file_ref.is_missing:
                continue
            file_resource = file_by_id.get(file_ref.file_id)
            if file_resource is None:
                raise ValueError("config file reference must resolve to a package file")
            referenced_file_ids.add(file_resource.id)
        unreferenced_files = {item.id for item in self.files if item.id not in referenced_file_ids}
        if unreferenced_files:
            raise ValueError("file resources must be referenced by the Agent Soul")


@dataclass
class PreparedRosterAgentPackage:
    """Validated archive retained in a bounded spool for later materialization."""

    archive: BinaryIO
    manifest: RosterAgentPackageManifest
    app: AgentAppDsl
    members: dict[str, RosterAgentPackageMember]
    invalid_skills: dict[str, str] = field(default_factory=dict)

    def close(self) -> None:
        self.archive.close()

    def __enter__(self) -> PreparedRosterAgentPackage:
        return self

    def __exit__(self, *_args: object) -> None:
        self.close()


@dataclass
class RosterAgentPackageExport:
    """Download artifact owning its archive until the response closes."""

    archive: BinaryIO
    filename: str
    size: int

    def close(self) -> None:
        self.archive.close()

    def __enter__(self) -> RosterAgentPackageExport:
        return self

    def __exit__(self, *_args: object) -> None:
        self.close()


__all__ = [
    "ROSTER_AGENT_PACKAGE_FORMAT",
    "ROSTER_AGENT_PACKAGE_FORMAT_VERSION",
    "ROSTER_AGENT_PACKAGE_MAX_SIGNATURE_BYTES",
    "PreparedRosterAgentPackage",
    "RosterAgentPackageAudit",
    "RosterAgentPackageExport",
    "RosterAgentPackageFile",
    "RosterAgentPackageManifest",
    "RosterAgentPackageMember",
    "RosterAgentPackageSkill",
]
