"""Strict data contract for portable Roster Agent archives."""

from __future__ import annotations

import re
from collections.abc import Mapping
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


class RosterAgentPackageApp(_RosterAgentPackageResource):
    @field_validator("path")
    @classmethod
    def validate_app_path(cls, value: str) -> str:
        if "/" in value or "\\" in value or not value.endswith((".yaml", ".yml")):
            raise ValueError("app path must be a root-level YAML member")
        if value.casefold() == "manifest.yaml":
            raise ValueError("app path must not use the package manifest name")
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
    apps: list[RosterAgentPackageApp] = Field(min_length=1)
    skills: list[RosterAgentPackageSkill] = Field(default_factory=list)
    files: list[RosterAgentPackageFile] = Field(default_factory=list)

    @model_validator(mode="after")
    def validate_resource_index(self) -> Self:
        ids = [item.id for item in self.skills] + [item.id for item in self.files]
        if len(ids) != len(set(ids)):
            raise ValueError("resource ids must be unique")
        paths = [item.path.casefold() for item in [*self.apps, *self.skills, *self.files]]
        if len(paths) != len(set(paths)):
            raise ValueError("resource paths must be unique")
        skill_names = [item.name for item in self.skills]
        if len(skill_names) != len(set(skill_names)):
            raise ValueError("skill names must be unique after workspace Skills are localized")

        return self

    def validate_apps(self, apps: Mapping[str, AgentAppDsl]) -> None:
        """Resolve all application references against the shared resource index."""
        if set(apps) != {item.path for item in self.apps}:
            raise ValueError("app members must match the package app index")
        skill_by_id = {item.id: item for item in self.skills}
        file_by_id = {item.id: item for item in self.files}
        workspace_names = {item.name for item in self.skills if item.scope == "workspace"}
        referenced_skill_ids: set[str] = set()
        referenced_file_ids: set[str] = set()
        referenced_workspace_names: set[str] = set()
        for app in apps.values():
            if app.package.soul.schema_version != 1:
                raise ValueError("unsupported Agent Soul schema version")
            for skill_ref in app.package.soul.config_skills:
                if skill_ref.is_missing:
                    continue
                skill_resource = skill_by_id.get(skill_ref.file_id)
                if skill_resource is None or skill_resource.scope != "agent_config":
                    raise ValueError("config skill reference must resolve to an agent_config skill")
                if skill_resource.name != skill_ref.name:
                    raise ValueError("config skill name must match its resource metadata")
                referenced_skill_ids.add(skill_resource.id)
            app_workspace_names = [item.name for item in app.package.workspace_skills]
            if len(app_workspace_names) != len(set(app_workspace_names)):
                raise ValueError("workspace skill names must be unique in the Agent DSL")
            if set(app_workspace_names) - workspace_names:
                raise ValueError("workspace skill references must match the package resource index")
            referenced_workspace_names.update(app_workspace_names)
            for file_ref in app.package.soul.config_files:
                if file_ref.is_missing:
                    continue
                if file_ref.file_id not in file_by_id:
                    raise ValueError("config file reference must resolve to a package file")
                referenced_file_ids.add(file_ref.file_id)
        if {item.id for item in self.skills if item.scope == "agent_config"} - referenced_skill_ids:
            raise ValueError("agent_config skill resources must be referenced by the Agent Soul")
        if workspace_names != referenced_workspace_names:
            raise ValueError("workspace skill references must match the package resource index")
        if set(file_by_id) - referenced_file_ids:
            raise ValueError("file resources must be referenced by the Agent Soul")


@dataclass
class PreparedRosterAgentPackage:
    """Validated archive retained in a bounded spool for later materialization."""

    archive: BinaryIO
    manifest: RosterAgentPackageManifest
    apps: dict[str, AgentAppDsl]
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
    "RosterAgentPackageApp",
    "RosterAgentPackageAudit",
    "RosterAgentPackageExport",
    "RosterAgentPackageFile",
    "RosterAgentPackageManifest",
    "RosterAgentPackageMember",
    "RosterAgentPackageSkill",
]
