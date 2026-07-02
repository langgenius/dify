from __future__ import annotations

from collections.abc import Iterable
from typing import Any
from uuid import UUID

import sqlalchemy as sa
import yaml
from sqlalchemy.orm import Session, scoped_session

from core.tools.tool_manager import ToolManager
from graphon.model_runtime.utils.encoders import jsonable_encoder
from models import Account, Tenant
from models.account import TenantAccountJoin
from models.model import App
from models.tools import MCPToolProvider
from services.app_dsl_service import AppDslService
from services.data_migration.dependency_discovery_service import DependencyDiscoveryService, DiscoveredDependency
from services.data_migration.entities import (
    DependencyKind,
    ExportResult,
    ExportSelection,
    ImportOptions,
    MigrationDataError,
    ReportContext,
    ResourceReportItem,
    ResourceType,
)
from services.data_migration.package_service import MigrationPackageService
from services.tools.workflow_tools_manage_service import WorkflowToolManageService

SUPPORTED_APP_MODES = {"workflow", "advanced-chat"}


class ExportConfigParser:
    def parse(self, data: dict[str, Any]) -> ExportSelection:
        if not isinstance(data, dict):
            raise MigrationDataError("Export config JSON must be an object.")

        source_tenant = self._source_tenant(data)
        source_tenant_name = self._source_tenant_name(source_tenant, data)
        apps = self._mapping(data.get("apps"), field_name="apps")
        self._validate_source_scope(data)
        self._validate_app_modes(apps.get("modes", []))

        additional_tools = self._mapping(data.get("additional_tools"), field_name="additional_tools")
        return ExportSelection(
            source_tenant_name=source_tenant_name,
            app_ids=self._string_list(apps.get("ids", data.get("workflows", [])), field_name="apps.ids"),
            source_tenant_id=source_tenant.get("id"),
            export_all_apps=bool(apps.get("all", data.get("export_all_workflows", False))),
            include_referenced_tools=bool(data.get("include_referenced_tools", True)),
            additional_api_tools=self._string_list(
                additional_tools.get("api_tools", data.get("tools", [])), field_name="additional_tools.api_tools"
            ),
            additional_workflow_tools=self._string_list(
                additional_tools.get("workflow_tools", data.get("workflow_tools", [])),
                field_name="additional_tools.workflow_tools",
            ),
            additional_mcp_tools=self._string_list(
                additional_tools.get("mcp_tools", data.get("mcp_tools", [])),
                field_name="additional_tools.mcp_tools",
            ),
            include_secrets=bool(data.get("include_secrets", False)),
            import_options=ImportOptions.from_mapping(data.get("import_options")),
        )

    def _source_tenant(self, data: dict[str, Any]) -> dict[str, Any]:
        if "source_tenant" in data:
            return self._mapping(data.get("source_tenant"), field_name="source_tenant")
        return {}

    def _source_tenant_name(self, source_tenant: dict[str, Any], data: dict[str, Any]) -> str:
        if source_tenant:
            source_tenant_name = source_tenant.get("name")
            if not source_tenant_name:
                raise MigrationDataError("Export config must include source_tenant.name.")
            return str(source_tenant_name)
        source_tenant_name = data.get("tenant_name")
        if not source_tenant_name:
            raise MigrationDataError("Export config must include source_tenant.name.")
        return str(source_tenant_name)

    def _validate_source_scope(self, data: dict[str, Any]) -> None:
        source_tenant = data.get("source_tenant")
        if not isinstance(source_tenant, dict):
            return
        mode = source_tenant.get("mode", "single")
        if mode != "single":
            raise MigrationDataError(f"Unsupported source_tenant.mode: {mode}")

    def _validate_app_modes(self, modes: Any) -> None:
        app_modes = self._string_list(modes, field_name="apps.modes") if modes else []
        unsupported_modes = sorted(set(app_modes) - SUPPORTED_APP_MODES)
        if unsupported_modes:
            raise MigrationDataError(f"Unsupported app modes for export: {unsupported_modes}")

    def _mapping(self, value: Any, *, field_name: str) -> dict[str, Any]:
        if value is None:
            return {}
        if not isinstance(value, dict):
            raise MigrationDataError(f"Export config field '{field_name}' must be an object.")
        return value

    def _string_list(self, value: Any, *, field_name: str) -> list[str]:
        if value is None:
            return []
        if not isinstance(value, list):
            raise MigrationDataError(f"Export config field '{field_name}' must be a list.")
        return [str(item) for item in value]


class MigrationExportService:
    def __init__(
        self,
        *,
        package_service: MigrationPackageService | None = None,
        dependency_discovery_service: DependencyDiscoveryService | None = None,
    ) -> None:
        self.package_service = package_service or MigrationPackageService()
        self.dependency_discovery_service = dependency_discovery_service or DependencyDiscoveryService()

    def export(self, selection: ExportSelection, *, session: scoped_session | Session) -> ExportResult:
        tenant = self._get_tenant(selection, session=session)
        package = self.package_service.build_empty_package(
            source_tenant_id=tenant.id,
            source_tenant_name=tenant.name,
            include_secrets=selection.include_secrets,
            import_options=selection.import_options,
        )
        report_items: list[ResourceReportItem] = []
        discovered_dependencies: list[DiscoveredDependency] = []

        apps = self._selected_apps(tenant.id, selection, session=session)
        exported_app_ids = {app.id for app in apps}
        for app in apps:
            dsl_content = AppDslService.export_dsl(
                app_model=app, session=session, include_secret=selection.include_secrets
            )
            package.workflows.append(
                {
                    "id": app.id,
                    "name": app.name,
                    "mode": app.mode.value if hasattr(app.mode, "value") else app.mode,
                    "dsl": dsl_content,
                    "source_tenant_id": tenant.id,
                    "create_app_api_token_on_import": selection.import_options.create_app_api_token_on_import,
                }
            )
            report_items.append(ResourceReportItem(ResourceType.WORKFLOW, app.id, app.name, "exported"))
            if selection.include_referenced_tools:
                discovered_dependencies.extend(self._discover_dependencies(dsl_content))

        self._export_api_tools(
            tenant.id,
            self._provider_ids(selection.additional_api_tools, discovered_dependencies, DependencyKind.API_TOOL),
            include_secrets=selection.include_secrets,
            exported_tools=package.tools,
            report_items=report_items,
        )
        self._export_workflow_tools(
            tenant,
            self._provider_ids(
                selection.additional_workflow_tools, discovered_dependencies, DependencyKind.WORKFLOW_TOOL
            ),
            exported_app_ids=exported_app_ids,
            exported_workflow_tools=package.workflow_tools,
            dependencies=package.dependencies,
            report_items=report_items,
            session=session,
        )
        self._export_mcp_tools(
            tenant_id=tenant.id,
            provider_ids=self._provider_ids(
                selection.additional_mcp_tools,
                discovered_dependencies,
                DependencyKind.MCP_TOOL,
            ),
            include_secrets=selection.include_secrets,
            exported_mcp_tools=package.mcp_tools,
            dependencies=package.dependencies,
            report_items=report_items,
            session=session,
        )
        self._record_dependency_metadata(
            self._dependencies_by_kind(discovered_dependencies, DependencyKind.BUILTIN_OR_PLUGIN_TOOL),
            package.dependencies,
            report_items,
        )
        return ExportResult(
            package=package,
            report_items=report_items,
            report_context=ReportContext(
                source_scope=package.metadata.source_scope,
                selected_app_count=len(apps),
                include_secrets=selection.include_secrets,
            ),
        )

    def _get_tenant(self, selection: ExportSelection, *, session: scoped_session | Session) -> Tenant:
        if selection.source_tenant_id:
            tenant = session.get(Tenant, selection.source_tenant_id)
            if tenant is None:
                raise MigrationDataError(f"Source tenant not found: {selection.source_tenant_id}")
            if tenant.name != selection.source_tenant_name:
                raise MigrationDataError(
                    f"Source tenant id/name mismatch: {selection.source_tenant_id} / {selection.source_tenant_name}"
                )
            return tenant
        tenants = list(session.scalars(sa.select(Tenant).where(Tenant.name == selection.source_tenant_name)).all())
        if not tenants:
            raise MigrationDataError(f"Source tenant not found: {selection.source_tenant_name}")
        if len(tenants) > 1:
            raise MigrationDataError(
                f"Source tenant name is ambiguous; use source_tenant.id: {selection.source_tenant_name}"
            )
        return tenants[0]

    def _selected_apps(
        self, tenant_id: str, selection: ExportSelection, *, session: scoped_session | Session
    ) -> list[App]:
        query = sa.select(App).where(App.tenant_id == tenant_id, App.mode.in_(SUPPORTED_APP_MODES))
        if not selection.export_all_apps:
            if not selection.app_ids:
                return []
            query = query.where(App.id.in_(selection.app_ids))
        apps = list(session.scalars(query).all())
        if not selection.export_all_apps and len(apps) != len(set(selection.app_ids)):
            found_ids = {app.id for app in apps}
            missing_ids = [app_id for app_id in selection.app_ids if app_id not in found_ids]
            raise MigrationDataError(
                f"Selected app IDs not found in source tenant or unsupported app mode: {missing_ids}"
            )
        return apps

    def _discover_dependencies(self, dsl_content: str | dict[str, Any]) -> list[DiscoveredDependency]:
        if isinstance(dsl_content, dict):
            dsl = dsl_content
        else:
            raw_dsl = yaml.safe_load(dsl_content) if dsl_content else {}
            dsl = raw_dsl if isinstance(raw_dsl, dict) else {}
        return self.dependency_discovery_service.discover_from_dsl(dsl)

    def _export_api_tools(
        self,
        tenant_id: str,
        provider_ids: Iterable[str],
        *,
        include_secrets: bool,
        exported_tools: list[dict[str, Any]],
        report_items: list[ResourceReportItem],
    ) -> None:
        for provider_id in self._dedupe(provider_ids):
            try:
                tool_data = ToolManager.user_get_api_provider(
                    provider=provider_id,
                    tenant_id=tenant_id,
                    mask=not include_secrets,
                )
                if not include_secrets:
                    tool_data.pop("credentials", None)
                tool_data.pop("tools", None)
                tool_data["provider_name"] = provider_id
                tool_data["source_tenant_id"] = tenant_id
                exported_tools.append(tool_data)
                report_items.append(ResourceReportItem(ResourceType.API_TOOL, provider_id, provider_id, "exported"))
            except Exception as exc:
                report_items.append(
                    ResourceReportItem(ResourceType.API_TOOL, provider_id, provider_id, "unresolved", str(exc))
                )

    def _export_workflow_tools(
        self,
        tenant: Tenant,
        provider_ids: Iterable[str],
        *,
        exported_app_ids: set[str],
        exported_workflow_tools: list[dict[str, Any]],
        dependencies: list[dict[str, Any]],
        report_items: list[ResourceReportItem],
        session: scoped_session | Session,
    ) -> None:
        provider_ids = self._dedupe(provider_ids)
        if not provider_ids:
            return
        owner = self._get_tenant_owner(tenant.id, session=session)
        if owner is None:
            for provider_id in provider_ids:
                report_items.append(
                    ResourceReportItem(
                        ResourceType.WORKFLOW_TOOL,
                        provider_id,
                        provider_id,
                        "unresolved",
                        f"No owner account found for source tenant: {tenant.name}",
                    )
                )
            return

        for provider_id in provider_ids:
            try:
                tool_data = WorkflowToolManageService.get_workflow_tool_by_tool_id(
                    user_id=owner.id,
                    tenant_id=tenant.id,
                    workflow_tool_id=provider_id,
                )
                tool_info = jsonable_encoder(tool_data)
                tool_info["id"] = provider_id
                tool_info["app_id"] = tool_info.get("workflow_app_id")
                tool_info["source_tenant_id"] = tenant.id
                for field_name in ("workflow_tool_id", "workflow_app_id", "tool"):
                    tool_info.pop(field_name, None)
                exported_workflow_tools.append(tool_info)
                if tool_info.get("app_id") not in exported_app_ids:
                    workflow_app_id = str(tool_info.get("app_id") or "")
                    workflow_app = session.get(App, workflow_app_id) if workflow_app_id else None
                    self._record_dependency_metadata(
                        [
                            DiscoveredDependency(
                                DependencyKind.WORKFLOW_TOOL,
                                workflow_app_id,
                                provider_name=workflow_app.name if workflow_app else tool_info.get("name"),
                                source="workflow_tool_app",
                            )
                        ],
                        dependencies,
                        report_items,
                    )
                report_items.append(
                    ResourceReportItem(ResourceType.WORKFLOW_TOOL, provider_id, tool_info.get("name"), "exported")
                )
            except Exception as exc:
                report_items.append(
                    ResourceReportItem(ResourceType.WORKFLOW_TOOL, provider_id, provider_id, "unresolved", str(exc))
                )

    def _get_tenant_owner(self, tenant_id: str, *, session: scoped_session | Session) -> Account | None:
        return session.scalar(
            sa.select(Account)
            .join(TenantAccountJoin, Account.id == TenantAccountJoin.account_id)
            .where(TenantAccountJoin.tenant_id == tenant_id, TenantAccountJoin.role == "owner")
            .order_by(TenantAccountJoin.created_at.asc())
            .limit(1)
        )

    def _export_mcp_tools(
        self,
        *,
        tenant_id: str,
        provider_ids: Iterable[str],
        include_secrets: bool,
        exported_mcp_tools: list[dict[str, Any]],
        dependencies: list[dict[str, Any]],
        report_items: list[ResourceReportItem],
        session: scoped_session | Session,
    ) -> None:
        for provider_id in self._dedupe(provider_ids):
            if not include_secrets:
                self._record_dependency_metadata(
                    [DiscoveredDependency(DependencyKind.MCP_TOOL, provider_id, source="mcp_provider")],
                    dependencies,
                    report_items,
                )
                continue
            try:
                provider = self._get_mcp_provider(tenant_id, provider_id, session=session)
                exported_mcp_tools.append(self._serialize_mcp_provider(provider))
                report_items.append(ResourceReportItem(ResourceType.MCP_TOOL, provider_id, provider.name, "exported"))
            except Exception as exc:
                report_items.append(
                    ResourceReportItem(ResourceType.MCP_TOOL, provider_id, provider_id, "unresolved", str(exc))
                )

    def _get_mcp_provider(
        self, tenant_id: str, provider_id: str, *, session: scoped_session | Session
    ) -> MCPToolProvider:
        predicates = [MCPToolProvider.server_identifier == provider_id]
        if self._is_uuid_string(provider_id):
            predicates.append(MCPToolProvider.id == provider_id)
        provider = session.scalar(
            sa.select(MCPToolProvider).where(MCPToolProvider.tenant_id == tenant_id, sa.or_(*predicates))
        )
        if provider is None:
            raise MigrationDataError(f"MCP provider not found: {provider_id}")
        return provider

    def _is_uuid_string(self, value: str) -> bool:
        try:
            UUID(value)
        except ValueError:
            return False
        return True

    def _serialize_mcp_provider(self, provider: MCPToolProvider) -> dict[str, Any]:
        provider_entity = provider.to_entity()
        provider_icon = provider_entity.provider_icon
        if isinstance(provider_icon, dict):
            icon = provider_icon.get("content")
            icon_background = provider_icon.get("background")
            icon_type = "emoji"
        else:
            icon = provider_icon
            icon_background = None
            icon_type = "url"
        return {
            "id": provider.id,
            "name": provider.name,
            "server_url": provider_entity.decrypt_server_url(),
            "server_identifier": provider.server_identifier,
            "icon": icon,
            "icon_background": icon_background,
            "icon_type": icon_type,
            "configuration": {"timeout": provider.timeout, "sse_read_timeout": provider.sse_read_timeout},
            "headers": provider_entity.decrypt_headers(),
            "authentication": self._serialize_mcp_authentication(provider_entity.decrypt_authentication()),
            "tools": provider.tool_dict,
            "source_tenant_id": provider.tenant_id,
        }

    def _serialize_mcp_authentication(self, authentication: dict[str, Any] | None) -> dict[str, Any] | None:
        if not authentication or not authentication.get("client_id"):
            return None
        return {
            "client_id": authentication["client_id"],
            "client_secret": authentication.get("client_secret"),
        }

    def _record_dependency_metadata(
        self,
        dependencies_to_record: Iterable[DiscoveredDependency],
        dependencies: list[dict[str, Any]],
        report_items: list[ResourceReportItem],
    ) -> None:
        existing = {(item.get("kind"), item.get("provider_id")) for item in dependencies}
        for dependency in dependencies_to_record:
            key = (dependency.kind.value, dependency.provider_id)
            if key in existing:
                continue
            existing.add(key)
            dependencies.append(
                {
                    "kind": dependency.kind.value,
                    "provider_id": dependency.provider_id,
                    "provider_name": dependency.provider_name,
                    "source": dependency.source,
                }
            )
            report_items.append(
                ResourceReportItem(
                    ResourceType.DEPENDENCY,
                    dependency.provider_id,
                    self._dependency_report_name(dependency),
                    "dependency-only",
                    self._dependency_message(dependency.kind),
                )
            )

    def _provider_ids(
        self,
        manual_provider_ids: Iterable[str],
        discovered_dependencies: Iterable[DiscoveredDependency],
        kind: DependencyKind,
    ) -> list[str]:
        provider_ids = list(manual_provider_ids)
        provider_ids.extend(
            self._provider_export_identifier(dependency)
            for dependency in discovered_dependencies
            if dependency.kind == kind
        )
        return self._dedupe(provider_ids)

    def _provider_export_identifier(self, dependency: DiscoveredDependency) -> str:
        if dependency.kind == DependencyKind.API_TOOL and dependency.provider_name:
            return dependency.provider_name
        return dependency.provider_id

    def _dependencies_by_kind(
        self, discovered_dependencies: Iterable[DiscoveredDependency], kind: DependencyKind
    ) -> list[DiscoveredDependency]:
        return [dependency for dependency in discovered_dependencies if dependency.kind == kind]

    def _dedupe(self, values: Iterable[str]) -> list[str]:
        seen: set[str] = set()
        result: list[str] = []
        for value in values:
            if value and value not in seen:
                seen.add(value)
                result.append(value)
        return result

    def _dependency_message(self, kind: DependencyKind) -> str:
        if kind == DependencyKind.MCP_TOOL:
            return "Configure MCP provider manually in the target tenant unless exporting with secrets enabled."
        if kind == DependencyKind.BUILTIN_OR_PLUGIN_TOOL:
            return "Ensure the built-in or plugin tool exists in the target environment."
        return "Dependency metadata only; ensure the resource exists in the target environment."

    def _dependency_report_name(self, dependency: DiscoveredDependency) -> str:
        name = dependency.provider_name or dependency.provider_id
        if dependency.kind == DependencyKind.WORKFLOW_TOOL:
            return f"workflow {name}"
        return f"{dependency.kind.value} {name}"
