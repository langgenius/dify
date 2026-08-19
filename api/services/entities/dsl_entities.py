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


class PendingImportOwner(BaseModel):
    tenant_id: str | None = None
    account_id: str | None = None

    def is_accessible_by(self, *, tenant_id: str | None, account_id: str) -> bool:
        if tenant_id is None:
            return False
        owner = (self.tenant_id, self.account_id)
        # Ownerless payloads come from older pods and expire after 10 minutes; #40106 removes this bridge.
        return owner in ((None, None), (tenant_id, account_id))


class DslImportWarning(BaseModel):
    """Portable DSL reference that could not be restored in the target workspace."""

    code: str
    path: str
    message: str
    details: dict[str, Any] = Field(default_factory=dict)


class CheckDependenciesResult(BaseModel):
    leaked_dependencies: list[PluginDependency] = Field(default_factory=list)
