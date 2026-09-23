"""Immutable application values, independent of SaaS wire names and HTTP DTOs."""

from dataclasses import dataclass
from datetime import datetime
from typing import Literal, NamedTuple

NetworkAccessPoint = Literal["webapp", "service_api", "mcp", "trigger"]


class NetworkAccessGroupAppRecord(NamedTuple):
    id: str
    mode: str
    name: str
    icon: str | None
    icon_type: str | None
    icon_background: str | None
    bound_agent_id: str | None = None


@dataclass(frozen=True)
class NetworkAccessGroup:
    id: str
    tenant_id: str
    name: str
    description: str
    allowed_cidrs: tuple[str, ...]
    version: int
    used_by_count: int
    enforcing_count: int
    app_ids: tuple[str, ...]
    updated_by_account_id: str | None
    created_at: datetime
    updated_at: datetime
    apps: tuple[NetworkAccessGroupAppRecord, ...] = ()


@dataclass(frozen=True)
class NetworkAccessBinding:
    id: str
    tenant_id: str
    app_id: str
    enabled: bool
    group_id: str | None
    # Preserve legacy/future scope names at the port; the service owns capabilities.
    access_points: tuple[str, ...]
    version: int
    updated_by_account_id: str | None
    created_at: datetime
    updated_at: datetime


@dataclass(frozen=True)
class NetworkAccessGroupList:
    tenant_id: str
    entitled: bool
    groups: tuple[NetworkAccessGroup, ...]


@dataclass(frozen=True)
class NetworkAccessAppConfig:
    tenant_id: str
    app_id: str
    entitled: bool
    effective_enabled: bool
    binding: NetworkAccessBinding | None
    available_access_points: tuple[NetworkAccessPoint, ...] = ()


@dataclass(frozen=True)
class NetworkAccessBindingUpdate:
    binding: NetworkAccessBinding
    effective_enabled: bool
    available_access_points: tuple[NetworkAccessPoint, ...] = ()


@dataclass(frozen=True)
class NetworkAccessCurrentIPCheck:
    client_ip: str
    allowed: bool
    policy_version: int
