from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
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

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    not_installed: list[TenantPluginNotInstalled] = Field(default_factory=list)
    failed_plugin_ids: list[str] = Field(default_factory=list, alias="plugin_install_failed")


class RagPipelinePluginInstallSummary(BaseModel):
    """JSON summary written after RAG pipeline plugin installation."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    total_success_tenant: int = 0
    total_failed_tenant: int = 0
    failed_plugin_ids: list[str] = Field(default_factory=list, alias="plugin_install_failed")


@dataclass(frozen=True, slots=True)
class PluginInstallResult:
    """Internal result of installing plugin packages, keyed by plugin ID."""

    successful_plugin_ids: tuple[str, ...] = ()
    failed_plugin_ids: tuple[str, ...] = ()


@dataclass(frozen=True, slots=True)
class PluginInstallBatch:
    """Internal install request for one daemon task, keyed by migration plugin ID."""

    tenant_id: str
    plugin_ids: tuple[str, ...]
    identifier_by_id: Mapping[str, str]

    @classmethod
    def from_plugin_ids(
        cls,
        tenant_id: str,
        plugin_ids: Sequence[str],
        identifier_by_id: Mapping[str, str],
    ) -> PluginInstallBatch:
        batch_identifier_by_id = {plugin_id: identifier_by_id[plugin_id] for plugin_id in plugin_ids}
        return cls(
            tenant_id=tenant_id,
            plugin_ids=tuple(plugin_ids),
            identifier_by_id=MappingProxyType(batch_identifier_by_id),
        )

    @property
    def plugin_unique_identifiers(self) -> tuple[str, ...]:
        return tuple(self.identifier_by_id[plugin_id] for plugin_id in self.plugin_ids)

    @property
    def plugin_id_by_identifier(self) -> Mapping[str, str]:
        return MappingProxyType({identifier: plugin_id for plugin_id, identifier in self.identifier_by_id.items()})


@dataclass(frozen=True, slots=True)
class TenantPluginInstallOutcome:
    """Internal tenant installation outcome, keyed by plugin ID."""

    tenant_id: str
    failed_plugin_ids: tuple[str, ...] = ()

    @property
    def succeeded(self) -> bool:
        return not self.failed_plugin_ids


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

    @property
    def installable_plugin_ids(self) -> tuple[str, ...]:
        return tuple(plugin_id for plugin_id in self.plugin_ids if plugin_id in self.identifier_by_id)

    def to_not_installed_record(self) -> TenantPluginNotInstalled:
        return TenantPluginNotInstalled(
            tenant_id=self.tenant_id,
            plugin_not_exist=list(self.unresolved_plugin_ids),
        )
