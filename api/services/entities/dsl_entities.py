from enum import StrEnum
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from constants.dsl_version import CURRENT_APP_DSL_VERSION
from core.plugin.entities.plugin import PluginDependency
from models.model import App, AppMode, IconType


class ImportMode(StrEnum):
    YAML_CONTENT = "yaml-content"
    YAML_URL = "yaml-url"


class ImportStatus(StrEnum):
    COMPLETED = "completed"
    COMPLETED_WITH_WARNINGS = "completed-with-warnings"
    PENDING = "pending"
    FAILED = "failed"


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
