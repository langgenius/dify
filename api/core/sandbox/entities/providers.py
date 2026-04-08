from collections.abc import Mapping
from typing import Any

from pydantic import BaseModel, Field


class SandboxProviderApiEntity(BaseModel):
    provider_type: str = Field(..., description="Provider type identifier")
    is_system_configured: bool = Field(default=False)
    is_tenant_configured: bool = Field(default=False)
    is_active: bool = Field(default=False)
    config: Mapping[str, Any] = Field(default_factory=dict)
    config_schema: list[dict[str, Any]] = Field(default_factory=list)


class SandboxProviderEntity(BaseModel):
    id: str = Field(..., description="Provider identifier")
    provider_type: str = Field(..., description="Provider type identifier")
    is_active: bool = Field(default=False)
    config: Mapping[str, Any] = Field(default_factory=dict)
    config_schema: list[dict[str, Any]] = Field(default_factory=list)
