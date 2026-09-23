"""Portable Agent package DTOs and workspace-sensitive value filtering."""

from __future__ import annotations

import hashlib
from typing import Any, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, model_validator

from core.plugin.entities.plugin import PluginDependency
from models.agent import Agent
from models.agent_config_entities import AgentSoulConfig
from models.model import App
from services.entities.dsl_entities import make_app_dsl

AGENT_PACKAGE_SCHEMA_VERSION = 1
AGENT_PACKAGE_REF_KEY = "package_ref"
AGENT_NODE_JOB_DSL_KEY = "agent_job"


class AgentPackageMetadata(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=255)
    description: str = ""
    role: str = ""
    icon_type: str | None = None
    icon: str | None = None
    icon_background: str | None = None


class AgentPackageOmittedAsset(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: Literal["skill", "file"]
    name: str
    size: int | None = None
    hash: str | None = None
    mime_type: str | None = None


class AgentPackageWorkspaceSkill(BaseModel):
    """Workspace Skill binding represented without source-workspace identifiers."""

    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=64)
    display_name: str = ""
    description: str = ""
    priority: int = Field(ge=0)


class AgentPackage(BaseModel):
    """One portable Agent Soul with display metadata and omitted asset hints."""

    model_config = ConfigDict(extra="forbid")

    schema_version: Literal[1] = 1
    metadata: AgentPackageMetadata
    soul: AgentSoulConfig
    omitted_assets: list[AgentPackageOmittedAsset] = Field(default_factory=list)
    workspace_skills: list[AgentPackageWorkspaceSkill] = Field(default_factory=list)


class AgentAppReference(BaseModel):
    model_config = ConfigDict(extra="forbid")

    package_ref: str = Field(min_length=1)


class AgentAppDsl(BaseModel):
    """The existing standalone Agent App DSL, also stored as archive app.yaml."""

    model_config = ConfigDict(extra="forbid")

    version: str = Field(min_length=1)
    kind: Literal["app"]
    app: dict[str, Any]
    agent: AgentAppReference
    agent_packages: dict[str, AgentPackage]
    dependencies: list[PluginDependency] = Field(default_factory=list)

    @model_validator(mode="after")
    def validate_agent_app(self) -> Self:
        if self.app.get("mode") != "agent":
            raise ValueError("Agent App DSL requires app.mode=agent")
        if not isinstance(self.app.get("name"), str) or not self.app["name"]:
            raise ValueError("Agent App DSL requires an app name")
        if set(self.agent_packages) != {self.agent.package_ref}:
            raise ValueError("Agent App DSL must contain exactly the referenced Agent package")
        return self

    @property
    def package(self) -> AgentPackage:
        return self.agent_packages[self.agent.package_ref]


def make_agent_app_dsl(
    app: App,
    *,
    package_ref: str,
    packages: dict[str, AgentPackage],
    dependencies: list[PluginDependency],
) -> AgentAppDsl:
    return AgentAppDsl(
        **make_app_dsl(app),
        agent=AgentAppReference(package_ref=package_ref),
        agent_packages=packages,
        dependencies=dependencies,
    )


def portable_ref(prefix: str, value: str) -> str:
    digest = hashlib.sha256(value.encode()).hexdigest()[:16]
    return f"{prefix}-{digest}"


def _strip_sensitive_values(value: Any) -> Any:
    """Remove nested credential, secret, and uploaded-file locators."""

    if isinstance(value, list):
        return [_strip_sensitive_values(item) for item in value]
    if not isinstance(value, dict):
        return value

    result: dict[str, Any] = {}
    for key, item in value.items():
        normalized_key = key.lower()
        is_sensitive = (
            "credential" in normalized_key
            or "secret" in normalized_key
            or "password" in normalized_key
            or normalized_key in {"api_key", "token", "access_token", "refresh_token"}
            or normalized_key.endswith("file_id")
            or normalized_key == "upload_file_id"
        )
        result[key] = None if is_sensitive else _strip_sensitive_values(item)
    return result


def make_portable_agent_soul(agent_soul: AgentSoulConfig) -> AgentSoulConfig:
    """Return an Agent Soul without workspace-local credentials or identities.

    Resource references are intentionally preserved. Container formats decide
    whether to omit their payloads, as YAML DSL does, or remap them to
    package-local identifiers, as Roster packages do.
    """

    soul_data = agent_soul.model_dump(mode="json")

    if soul_data.get("model"):
        soul_data["model"]["credential_ref"] = None

    for tool in soul_data.get("tools", {}).get("dify_tools", []):
        tool["credential_type"] = "unauthorized"
        tool["credential_ref"] = None
        tool["runtime_parameters"] = _strip_sensitive_values(tool.get("runtime_parameters", {}))

    for tool in soul_data.get("tools", {}).get("cli_tools", []):
        env = tool.get("env") or {}
        env["secret_refs"] = [
            {
                key: secret_ref.get(key)
                for key in ("name", "key", "env_name", "variable", "type", "provider")
                if secret_ref.get(key) is not None
            }
            for secret_ref in env.get("secret_refs", [])
        ]
        tool["env"] = env

    soul_data.setdefault("env", {})["secret_refs"] = [
        {
            key: secret_ref.get(key)
            for key in ("name", "key", "env_name", "variable", "type", "provider")
            if secret_ref.get(key) is not None
        }
        for secret_ref in soul_data.get("env", {}).get("secret_refs", [])
    ]

    for contact in soul_data.get("human", {}).get("contacts", []):
        for key in ("id", "contact_id", "human_id", "tenant_id"):
            contact[key] = None

    return AgentSoulConfig.model_validate(soul_data)


def make_portable_agent_package(
    agent: Agent,
    agent_soul: AgentSoulConfig,
    workspace_skills: list[AgentPackageWorkspaceSkill] | None = None,
    *,
    include_assets: bool = False,
) -> AgentPackage:
    """Return a portable package for YAML, clipboard, or an asset-bearing archive.

    Archives preserve package-local references to included assets; standalone
    YAML and clipboard exports mark resources missing because they omit payloads.
    """

    portable_soul = make_portable_agent_soul(agent_soul)
    omitted_assets = [
        AgentPackageOmittedAsset(
            kind="skill",
            name=item.name,
            size=item.size,
            hash=item.hash,
            mime_type=item.mime_type,
        )
        for item in agent_soul.config_skills
        if not include_assets or item.is_missing
    ]
    omitted_assets.extend(
        AgentPackageOmittedAsset(
            kind="file",
            name=item.name,
            size=item.size,
            hash=item.hash,
            mime_type=item.mime_type,
        )
        for item in agent_soul.config_files
        if not include_assets or item.is_missing
    )
    for skill_ref in portable_soul.config_skills:
        if not include_assets or skill_ref.is_missing:
            skill_ref.file_id = ""
            skill_ref.is_missing = True
    for file_ref in portable_soul.config_files:
        if not include_assets or file_ref.is_missing:
            file_ref.file_id = ""
            file_ref.is_missing = True
    icon_type = agent.icon_type.value if agent.icon_type is not None else None
    return AgentPackage(
        metadata=AgentPackageMetadata(
            name=agent.name,
            description=agent.description or "",
            role=agent.role or "",
            icon_type=icon_type,
            icon=agent.icon,
            icon_background=agent.icon_background,
        ),
        soul=portable_soul,
        omitted_assets=omitted_assets,
        workspace_skills=workspace_skills or [],
    )
