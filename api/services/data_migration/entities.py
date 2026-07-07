"""Typed entities for versioned cross-environment migration packages.

This module is intentionally side-effect free. It owns only value objects and
validation for migration package/config shapes; command output and database I/O
belong in adapter and service modules built on top of these entities.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import StrEnum
from typing import Any, Literal, TypedDict


class MigrationDataError(ValueError):
    """Raised when migration config or package data is invalid."""


class IdStrategy(StrEnum):
    PRESERVE_ID = "preserve-id"
    GENERATE_NEW_ID = "generate-new-id"


class ConflictStrategy(StrEnum):
    FAIL = "fail"
    SKIP = "skip"
    UPDATE = "update"


class ResourceType(StrEnum):
    WORKFLOW = "workflow"
    API_TOOL = "api_tool"
    WORKFLOW_TOOL = "workflow_tool"
    MCP_TOOL = "mcp_tool"
    DEPENDENCY = "dependency"


class DependencyKind(StrEnum):
    API_TOOL = "api_tool"
    WORKFLOW_TOOL = "workflow_tool"
    MCP_TOOL = "mcp_tool"
    BUILTIN_OR_PLUGIN_TOOL = "builtin_or_plugin_tool"
    UNRESOLVED = "unresolved"


class TargetTenantSelector(TypedDict, total=False):
    id: str
    name: str


def _parse_target_tenant(value: Any) -> TargetTenantSelector | None:
    if value is None:
        return None
    if not isinstance(value, dict):
        raise MigrationDataError("metadata.target_tenant must be an object when provided.")
    target: TargetTenantSelector = {}
    target_id = value.get("id")
    if target_id is not None:
        if not isinstance(target_id, str):
            raise MigrationDataError("metadata.target_tenant.id must be a string.")
        target["id"] = target_id
    target_name = value.get("name")
    if target_name is not None:
        if not isinstance(target_name, str):
            raise MigrationDataError("metadata.target_tenant.name must be a string.")
        target["name"] = target_name
    unsupported_keys = sorted(set(value.keys()) - {"id", "name"})
    if unsupported_keys:
        raise MigrationDataError(f"metadata.target_tenant contains unsupported fields: {unsupported_keys}")
    return target


def _parse_package_section(value: Any, section: str) -> list[dict[str, Any]]:
    if value is None:
        return []
    if not isinstance(value, list):
        raise MigrationDataError(f"Migration package field '{section}' must be a list.")
    for item in value:
        if not isinstance(item, dict):
            raise MigrationDataError(f"Migration package field '{section}' must contain only objects.")
    return value


@dataclass(frozen=True)
class SourceTenant:
    id: str
    name: str

    @classmethod
    def from_mapping(cls, value: dict[str, Any]) -> SourceTenant:
        return cls(id=str(value.get("id", "")), name=str(value.get("name", "")))


@dataclass(frozen=True)
class ImportOptions:
    create_app_api_token_on_import: bool = False
    id_strategy: IdStrategy = IdStrategy.PRESERVE_ID
    conflict_strategy: ConflictStrategy = ConflictStrategy.FAIL

    @classmethod
    def from_mapping(cls, value: dict[str, Any] | None) -> ImportOptions:
        value = value or {}
        try:
            id_strategy = IdStrategy(value.get("id_strategy", IdStrategy.PRESERVE_ID))
        except ValueError as exc:
            raise MigrationDataError(f"Unsupported import_options.id_strategy: {value.get('id_strategy')}") from exc
        try:
            conflict_strategy = ConflictStrategy(value.get("conflict_strategy", ConflictStrategy.FAIL))
        except ValueError as exc:
            raise MigrationDataError(
                f"Unsupported import_options.conflict_strategy: {value.get('conflict_strategy')}"
            ) from exc
        return cls(
            create_app_api_token_on_import=bool(value.get("create_app_api_token_on_import", False)),
            id_strategy=id_strategy,
            conflict_strategy=conflict_strategy,
        )


@dataclass(frozen=True)
class MigrationMetadata:
    version: str
    source_scope: Literal["single"]
    source_tenants: list[SourceTenant]
    target_tenant: TargetTenantSelector | None = None
    created_at: str | None = None
    include_secrets: bool = False
    import_options: ImportOptions = field(default_factory=ImportOptions)

    @classmethod
    def from_mapping(cls, value: dict[str, Any]) -> MigrationMetadata:
        version = value.get("version")
        if not version:
            raise MigrationDataError("Migration package must include metadata.version.")
        source_scope = value.get("source_scope", "single")
        if source_scope != "single":
            raise MigrationDataError(f"Unsupported source_scope: {source_scope}")
        source_tenants = [
            SourceTenant.from_mapping(item) for item in value.get("source_tenants", []) if isinstance(item, dict)
        ]
        return cls(
            version=str(version),
            source_scope="single",
            source_tenants=source_tenants,
            target_tenant=_parse_target_tenant(value.get("target_tenant")),
            created_at=value.get("created_at"),
            include_secrets=bool(value.get("include_secrets", False)),
            import_options=ImportOptions.from_mapping(value.get("import_options")),
        )


@dataclass(frozen=True)
class MigrationPackage:
    metadata: MigrationMetadata
    workflows: list[dict[str, Any]] = field(default_factory=list)
    tools: list[dict[str, Any]] = field(default_factory=list)
    workflow_tools: list[dict[str, Any]] = field(default_factory=list)
    mcp_tools: list[dict[str, Any]] = field(default_factory=list)
    dependencies: list[dict[str, Any]] = field(default_factory=list)

    @classmethod
    def from_mapping(cls, value: dict[str, Any]) -> MigrationPackage:
        metadata_value = value.get("metadata")
        if not isinstance(metadata_value, dict):
            raise MigrationDataError("Migration package must include metadata.version.")
        return cls(
            metadata=MigrationMetadata.from_mapping(metadata_value),
            workflows=_parse_package_section(value.get("workflows"), "workflows"),
            tools=_parse_package_section(value.get("tools"), "tools"),
            workflow_tools=_parse_package_section(value.get("workflow_tools"), "workflow_tools"),
            mcp_tools=_parse_package_section(value.get("mcp_tools"), "mcp_tools"),
            dependencies=_parse_package_section(value.get("dependencies"), "dependencies"),
        )


@dataclass(frozen=True)
class ExportSelection:
    source_tenant_name: str
    app_ids: list[str]
    source_tenant_id: str | None = None
    export_all_apps: bool = False
    include_referenced_tools: bool = True
    additional_api_tools: list[str] = field(default_factory=list)
    additional_workflow_tools: list[str] = field(default_factory=list)
    additional_mcp_tools: list[str] = field(default_factory=list)
    include_secrets: bool = False
    import_options: ImportOptions = field(default_factory=ImportOptions)


@dataclass(frozen=True)
class ResourceReportItem:
    resource_type: ResourceType
    identifier: str
    name: str | None
    status: str
    message: str | None = None


@dataclass(frozen=True)
class ResourceIdMapping:
    resource_type: ResourceType
    name: str | None
    source_id: str
    target_id: str


@dataclass(frozen=True)
class ExportResult:
    package: MigrationPackage
    report_items: list[ResourceReportItem]
    report_context: ReportContext | None = None


@dataclass(frozen=True)
class ImportTarget:
    tenant_id: str
    tenant_name: str
    operator_id: str
    operator_email: str | None


@dataclass(frozen=True)
class ImportResult:
    report_items: list[ResourceReportItem]
    id_mapping: dict[str, str] = field(default_factory=dict)
    report_context: ReportContext | None = None


@dataclass(frozen=True)
class ReportContext:
    output_path: str | None = None
    source_scope: str | None = None
    selected_app_count: int | None = None
    include_secrets: bool | None = None
    target_tenant: str | None = None
    operator_email: str | None = None
    app_api_tokens_created: int = 0
    app_api_tokens_reused: int = 0
    id_mapping_count: int = 0
    id_mappings: dict[str, str] = field(default_factory=dict)
    id_mapping_details: list[ResourceIdMapping] = field(default_factory=list)
