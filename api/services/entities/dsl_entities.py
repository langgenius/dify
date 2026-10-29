from dataclasses import dataclass
from enum import StrEnum
from typing import Any, Protocol, Self
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from constants.dsl_version import CURRENT_APP_DSL_VERSION
from core.plugin.entities.plugin import PluginDependency
from core.tools.entities.tool_entities import EmojiIconDict, WorkflowToolParameterConfiguration
from libs.helper import alphanumeric, uuid_value
from models.model import App, AppMode, IconType


class ImportMode(StrEnum):
    YAML_CONTENT = "yaml-content"
    YAML_URL = "yaml-url"


class ImportStatus(StrEnum):
    COMPLETED = "completed"
    COMPLETED_WITH_WARNINGS = "completed-with-warnings"
    PENDING = "pending"
    FAILED = "failed"


class AppImportParams(BaseModel):
    mode: str = Field(..., description="Import mode")
    template_id: UUID | None = None
    version_id: UUID | None = None
    package_url: str | None = None
    yaml_content: str | None = None
    yaml_url: str | None = None
    name: str | None = None
    description: str | None = None
    icon_type: str | None = None
    icon: str | None = None
    icon_background: str | None = None
    app_id: str | None = None


class DraftGuardedImportParams(AppImportParams):
    """An overwrite that saves only while the draft's ``draft_token`` still equals ``draft_hash``."""

    draft_hash: str | None = None


@dataclass(frozen=True, slots=True)
class AppDslExportData:
    """Materialized export input; remote dependencies can be resolved after closing the read transaction."""

    tenant_id: str
    data: dict[str, Any]
    dependency_identifiers: list[str]


class PendingImportOwner(BaseModel):
    model_config = ConfigDict(hide_input_in_errors=True)

    tenant_id: str
    account_id: str

    def is_accessible_by(self, *, tenant_id: str | None, account_id: str) -> bool:
        return tenant_id is not None and (self.tenant_id, self.account_id) == (tenant_id, account_id)


class DslImportWarning(BaseModel):
    """Portable DSL reference that could not be restored in the target workspace."""

    code: str
    path: str
    message: str
    details: dict[str, Any] = Field(default_factory=dict)


class PackagedWorkflowTool(BaseModel):
    """A workflow the packaged App calls through a Workflow Tool, stored as a nested single-App archive.

    ``provider_id`` is the tool's id in the exporting workspace, which the packaged DSLs still reference.
    """

    model_config = ConfigDict(extra="ignore")

    id: str = Field(pattern=r"^w_[0-9]{6}$")
    path: str
    size: int = Field(ge=0)
    sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    provider_id: str = Field(min_length=1, max_length=255)
    name: str = Field(min_length=1, max_length=255)
    label: str = Field(max_length=255)
    icon: EmojiIconDict
    description: str
    parameters: list[WorkflowToolParameterConfiguration]
    labels: list[str]
    privacy_policy: str

    @field_validator("provider_id")
    @classmethod
    def validate_provider_id(cls, value: str) -> str:
        uuid_value(value)
        return value

    @field_validator("name")
    @classmethod
    def validate_name(cls, value: str) -> str:
        return alphanumeric(value)

    @model_validator(mode="after")
    def validate_path(self) -> Self:
        if self.path != f"{self.id}.ifpkg":
            raise ValueError("workflow tool path must be the resource id with an .ifpkg extension")
        return self


class AppImportPackage(Protocol):
    """Validated App archive used by import orchestration and resource materialization."""

    dsl: str
    workflow_tools: list[PackagedWorkflowTool]

    @property
    def has_resources(self) -> bool: ...

    def materialize_icons(self, *, data: dict[str, Any], tenant_id: str, account_id: str) -> None: ...

    def materialize_agents(
        self, *, tenant_id: str, account_id: str
    ) -> tuple[dict[str, Any], list[DslImportWarning]]: ...

    def open_workflow_tool(self, tool: PackagedWorkflowTool) -> "AppImportPackage": ...

    def close(self) -> None: ...


class Import(BaseModel):
    id: str
    status: ImportStatus
    app_id: str | None = None
    app_mode: AppMode | None = None
    app_created: bool = Field(default=False, exclude=True)
    permission_keys: list[str] = Field(default_factory=list)
    current_dsl_version: str = CURRENT_APP_DSL_VERSION
    imported_dsl_version: str = ""
    error: str = ""
    warnings: list[DslImportWarning] = Field(default_factory=list)


class CheckDependenciesResult(BaseModel):
    leaked_dependencies: list[PluginDependency] = Field(default_factory=list)


def make_app_dsl(app: App) -> dict[str, Any]:
    """Build the shared App DSL envelope for standalone and archive exports."""
    return {
        "version": CURRENT_APP_DSL_VERSION,
        "kind": "app",
        "app": {
            "name": app.name,
            "mode": app.mode.value if isinstance(app.mode, AppMode) else app.mode,
            "icon": app.icon,
            "icon_type": app.icon_type.value if isinstance(app.icon_type, IconType) else app.icon_type,
            "icon_background": app.icon_background,
            "description": app.description,
            "use_icon_as_answer_icon": app.use_icon_as_answer_icon,
        },
    }
