from enum import StrEnum
from typing import Any

from pydantic import BaseModel, Field

from core.plugin.entities.plugin import PluginDependency


class ImportMode(StrEnum):
    YAML_CONTENT = "yaml-content"
    YAML_URL = "yaml-url"


class ImportStatus(StrEnum):
    COMPLETED = "completed"
    COMPLETED_WITH_WARNINGS = "completed-with-warnings"
    PENDING = "pending"
    FAILED = "failed"


class DslImportWarning(BaseModel):
    """Portable DSL reference that could not be restored in the target workspace."""

    code: str
    path: str
    message: str
    details: dict[str, Any] = Field(default_factory=dict)


class CheckDependenciesResult(BaseModel):
    leaked_dependencies: list[PluginDependency] = Field(default_factory=list)
