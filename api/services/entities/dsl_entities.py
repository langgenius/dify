from enum import StrEnum
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from core.plugin.entities.plugin import PluginDependency


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
