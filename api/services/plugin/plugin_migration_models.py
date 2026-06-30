from __future__ import annotations

from _thread import LockType
from collections.abc import Mapping
from dataclasses import dataclass, field
from threading import Lock
from types import MappingProxyType
from typing import NamedTuple

from pydantic import BaseModel, ConfigDict, Field


class TenantPluginRecord(BaseModel):
    """JSONL record produced by plugin extraction and consumed by plugin installation."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    tenant_id: str
    plugin_ids: list[str] = Field(default_factory=list, alias="plugins")


class ExtractedPluginIdentifiers(BaseModel):
    """Resolved marketplace package identifiers keyed by plugin ID."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    identifier_by_id: dict[str, str] = Field(default_factory=dict, alias="plugins")
    unresolved_plugin_ids: list[str] = Field(default_factory=list, alias="plugin_not_exist")


class PluginIdentifierResolution(NamedTuple):
    """Single marketplace lookup result."""

    plugin_id: str
    unique_identifier: str | None


class TenantPluginNotInstalled(BaseModel):
    """Per-tenant plugin IDs that could not be resolved to marketplace identifiers."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    tenant_id: str
    unresolved_plugin_ids: list[str] = Field(default_factory=list, alias="plugin_not_exist")


class PluginInstallSummary(BaseModel):
    """JSON summary written after tenant plugin installation."""

    model_config = ConfigDict(extra="forbid")

    not_installed: list[TenantPluginNotInstalled] = Field(default_factory=list)
    plugin_install_failed: list[str] = Field(default_factory=list)


class RagPipelinePluginInstallSummary(BaseModel):
    """JSON summary written after RAG pipeline plugin installation."""

    model_config = ConfigDict(extra="forbid")

    total_success_tenant: int = 0
    total_failed_tenant: int = 0
    plugin_install_failed: list[str] = Field(default_factory=list)


@dataclass(frozen=True, slots=True)
class PluginInstallResult:
    """Internal result of installing plugin packages for one tenant."""

    success: tuple[str, ...] = ()
    failed: tuple[str, ...] = ()


@dataclass(frozen=True, slots=True)
class TenantPluginInstallPlan:
    """Resolved installation plan for a tenant, derived from validated JSON input."""

    tenant_id: str
    plugin_ids: tuple[str, ...]
    identifier_by_id: Mapping[str, str]
    unresolved_plugin_ids: tuple[str, ...] = ()

    @classmethod
    def from_record(
        cls, record: TenantPluginRecord, plugin_identifier_by_id: Mapping[str, str]
    ) -> TenantPluginInstallPlan:
        installable_identifier_by_id = {
            plugin_id: plugin_identifier_by_id[plugin_id]
            for plugin_id in record.plugin_ids
            if plugin_id in plugin_identifier_by_id
        }
        unresolved_plugin_ids = tuple(
            plugin_id for plugin_id in record.plugin_ids if plugin_id not in plugin_identifier_by_id
        )
        return cls(
            tenant_id=record.tenant_id,
            plugin_ids=tuple(record.plugin_ids),
            identifier_by_id=MappingProxyType(installable_identifier_by_id),
            unresolved_plugin_ids=unresolved_plugin_ids,
        )

    @classmethod
    def from_resolved_identifiers(
        cls, tenant_id: str, plugin_identifier_by_id: Mapping[str, str]
    ) -> TenantPluginInstallPlan:
        identifier_by_id = dict(plugin_identifier_by_id)
        return cls(
            tenant_id=tenant_id,
            plugin_ids=tuple(identifier_by_id),
            identifier_by_id=MappingProxyType(identifier_by_id),
        )

    def to_not_installed_record(self) -> TenantPluginNotInstalled:
        return TenantPluginNotInstalled(
            tenant_id=self.tenant_id,
            plugin_not_exist=list(self.unresolved_plugin_ids),
        )


@dataclass(slots=True)
class TenantInstallCounters:
    """Thread-safe counters for RAG pipeline tenant installation results."""

    success: int = 0
    failed: int = 0
    _lock: LockType = field(default_factory=Lock, init=False, repr=False)

    def record_success(self) -> None:
        with self._lock:
            self.success += 1

    def record_failure(self) -> None:
        with self._lock:
            self.failed += 1
