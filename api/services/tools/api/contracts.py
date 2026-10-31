"""Loaded API tool definitions consumed after the database transaction closes."""

from dataclasses import dataclass
from typing import Any

from core.tools.entities.tool_bundle import ApiToolBundle


@dataclass(frozen=True)
class ApiToolProviderRecord:
    id: str
    tenant_id: str
    name: str
    description: str
    icon: str
    author: str
    tools: list[ApiToolBundle]
    credentials: dict[str, Any]
    schema_type: str
    schema: str
    privacy_policy: str | None
    custom_disclaimer: str
