"""Apply versioned migration packages to an explicitly resolved target tenant.

Import target resolution is deliberately performed before any resource import
work. The service does not write Click output; callers receive structured
report items and can decide how to render them.
"""

from __future__ import annotations

import json
from collections.abc import Iterable
from dataclasses import dataclass
from typing import Any
from uuid import UUID

import sqlalchemy as sa
import yaml
from sqlalchemy import or_
from sqlalchemy.orm import sessionmaker

from core.entities.mcp_provider import MCPAuthentication, MCPConfiguration
from core.tools.entities.tool_entities import WorkflowToolParameterConfiguration
from extensions.ext_database import db
from libs.datetime_utils import naive_utc_now
from models import Account, ApiToken, Tenant, TenantAccountJoin, TenantAccountRole
from models.enums import ApiTokenType
from models.model import App
from models.tools import ApiToolProvider, MCPToolProvider, WorkflowToolProvider
from services.app_dsl_service import AppDslService
from services.data_migration.dependency_discovery_service import DependencyDiscoveryService
from services.data_migration.entities import (
    ConflictStrategy,
    DependencyKind,
    IdStrategy,
    ImportOptions,
    ImportResult,
    ImportTarget,
    MigrationDataError,
    MigrationPackage,
    ReportContext,
    ResourceReportItem,
    ResourceType,
)
from services.entities.dsl_entities import ImportStatus
from services.tools.api_tools_manage_service import ApiToolManageService
from services.tools.mcp_tools_manage_service import MCPToolManageService
from services.tools.workflow_tools_manage_service import WorkflowToolManageService
from services.workflow_service import WorkflowService


@dataclass(frozen=True)
class ImportRequest:
    """Structured input for package import.

    `cli_target_tenant` and `config_target_tenant` are target tenant names from
    outer adapters. They intentionally override package metadata, because a
    migration package may be reused across environments.
    """

    package: MigrationPackage
    cli_target_tenant: str | None = None
    config_target_tenant: str | None = None
    operator_email: str | None = None
    options_override: ImportOptions | None = None


class ImportTargetResolver:
    """Resolve the target tenant and operator before import side effects begin."""

    def select_target_tenant_name(self, request: ImportRequest) -> str:
        if request.cli_target_tenant:
            return request.cli_target_tenant
        if request.config_target_tenant:
            return request.config_target_tenant
        package_target = request.package.metadata.target_tenant or {}
        if package_target.get("name"):
            return package_target["name"]
        if package_target.get("id"):
            return package_target["id"]
        raise MigrationDataError(
            "Target tenant must be provided by --target-tenant, import config, or package metadata."
        )

    def resolve(self, request: ImportRequest) -> ImportTarget:
        target_tenant_name = self.select_target_tenant_name(request)
        package_target = request.package.metadata.target_tenant or {}
        if request.cli_target_tenant or request.config_target_tenant:
            tenant = self._resolve_tenant_by_id_or_name(target_tenant_name)
        elif package_target.get("id") and self._is_uuid(package_target["id"]):
            tenant = db.session.get(Tenant, package_target["id"])
            if tenant is not None and package_target.get("name") and tenant.name != package_target.get("name"):
                raise MigrationDataError(
                    f"Target tenant id/name mismatch: {package_target['id']} / {package_target['name']}"
                )
        else:
            tenant = self._resolve_tenant_by_id_or_name(target_tenant_name)
        if tenant is None:
            raise MigrationDataError(f"Target tenant not found: {target_tenant_name}")

        account_query = (
            db.session.query(Account)
            .join(TenantAccountJoin, Account.id == TenantAccountJoin.account_id)
            .filter(TenantAccountJoin.tenant_id == tenant.id)
        )
        if request.operator_email:
            account_query = account_query.filter(Account.email == request.operator_email)
            identity = request.operator_email
        else:
            account_query = account_query.filter(TenantAccountJoin.role == TenantAccountRole.OWNER).order_by(
                TenantAccountJoin.created_at.asc()
            )
            identity = "earliest owner"

        account = account_query.first()
        if account is None:
            raise MigrationDataError(f"No operator account found for target tenant {target_tenant_name}: {identity}")

        return ImportTarget(
            tenant_id=tenant.id,
            tenant_name=tenant.name,
            operator_id=account.id,
            operator_email=account.email,
        )

    def _resolve_tenant_by_id_or_name(self, value: str) -> Tenant | None:
        if self._is_uuid(value):
            tenant = db.session.get(Tenant, value)
            if tenant is not None:
                return tenant
        tenants = list(db.session.scalars(sa.select(Tenant).where(Tenant.name == value)).all())
        if len(tenants) > 1:
            raise MigrationDataError(f"Target tenant name is ambiguous; use target_tenant.id: {value}")
        return tenants[0] if tenants else None

    def _is_uuid(self, value: str) -> bool:
        try:
            UUID(value)
        except ValueError:
            return False
        return True


class MigrationImportService:
    """Apply package resources using Dify service APIs and structured reporting."""

    target_resolver: ImportTargetResolver

    def __init__(self, *, target_resolver: ImportTargetResolver | None = None) -> None:
        self.target_resolver = target_resolver or ImportTargetResolver()

    def import_package(self, request: ImportRequest) -> ImportResult:
        target = self.target_resolver.resolve(request)
        options = request.options_override or request.package.metadata.import_options
        report_items = [
            ResourceReportItem(
                resource_type=ResourceType.DEPENDENCY,
                identifier=target.tenant_id,
                name=target.tenant_name,
                status="resolved",
                message=f"operator: {target.operator_email or target.operator_id}",
            )
        ]
        id_mapping: dict[str, str] = {}

        self._import_api_tools(
            request.package,
            target,
            options,
            report_items,
            id_mapping,
            self._source_api_provider_ids_by_name(request.package),
        )
        self._import_mcp_tools(request.package, target, options, report_items, id_mapping)
        workflow_tool_app_ids = self._workflow_tool_source_app_ids(request.package)
        imported_workflow_ids: set[str] = set()
        if workflow_tool_app_ids:
            self._import_workflows(
                request.package,
                target,
                options,
                report_items,
                id_mapping,
                imported_workflow_ids=imported_workflow_ids,
                only_app_ids=workflow_tool_app_ids,
            )
        self._import_workflow_tools(request.package, target, options, id_mapping, report_items)
        self._import_workflows(
            request.package,
            target,
            options,
            report_items,
            id_mapping,
            imported_workflow_ids=imported_workflow_ids,
            skip_app_ids=imported_workflow_ids,
        )
        self._report_dependency_only_mcp(request.package, report_items)
        return ImportResult(
            report_items=report_items,
            id_mapping=id_mapping,
            report_context=ReportContext(
                target_tenant=target.tenant_name,
                operator_email=target.operator_email,
                id_mapping_count=len(id_mapping),
                id_mappings=dict(id_mapping),
            ),
        )

    def _import_workflows(
        self,
        package: MigrationPackage,
        target: ImportTarget,
        options: ImportOptions,
        report_items: list[ResourceReportItem],
        id_mapping: dict[str, str],
        imported_workflow_ids: set[str] | None = None,
        only_app_ids: set[str] | None = None,
        skip_app_ids: set[str] | None = None,
    ) -> None:
        account = db.session.get(Account, target.operator_id)
        tenant = db.session.get(Tenant, target.tenant_id)
        if account is None:
            raise MigrationDataError(f"Operator account not found: {target.operator_id}")
        if tenant is None:
            raise MigrationDataError(f"Target tenant not found: {target.tenant_id}")
        account.current_tenant = tenant

        for workflow_data in package.workflows:
            app_id = self._optional_string(workflow_data.get("id"))
            if only_app_ids and app_id not in only_app_ids:
                continue
            if skip_app_ids and app_id in skip_app_ids:
                continue
            dsl_content = self._rewrite_workflow_dsl_provider_ids(
                self._required_string(workflow_data, "dsl", "workflow"),
                id_mapping,
            )
            existing_app = (
                self._find_existing_app(app_id, target.tenant_id)
                if options.id_strategy == IdStrategy.PRESERVE_ID
                else None
            )
            if existing_app is not None and options.conflict_strategy == ConflictStrategy.FAIL:
                raise MigrationDataError(f"App already exists and conflict_strategy=fail: {app_id}")
            if existing_app is not None and options.conflict_strategy == ConflictStrategy.SKIP:
                report_items.append(
                    ResourceReportItem(ResourceType.WORKFLOW, str(app_id), workflow_data.get("name"), "skipped")
                )
                continue

            imported_app_id = self._import_workflow_app(
                account=account,
                workflow_data=workflow_data,
                dsl_content=dsl_content,
                app_id=app_id,
                existing_app=existing_app,
                options=options,
            )
            if app_id:
                id_mapping[app_id] = imported_app_id
                if imported_workflow_ids is not None:
                    imported_workflow_ids.add(app_id)
            if options.create_app_api_token_on_import:
                self._create_or_reuse_app_api_token(imported_app_id, target.tenant_id)
            report_items.append(
                ResourceReportItem(
                    ResourceType.WORKFLOW,
                    imported_app_id,
                    workflow_data.get("name"),
                    "updated" if existing_app is not None else "created",
                )
            )

    def _workflow_tool_source_app_ids(self, package: MigrationPackage) -> set[str]:
        app_ids: set[str] = set()
        for workflow_tool_data in package.workflow_tools:
            app_id = self._optional_string(workflow_tool_data.get("app_id"))
            if app_id:
                app_ids.add(app_id)
        return app_ids

    def _import_workflow_app(
        self,
        *,
        account: Account,
        workflow_data: dict[str, object],
        dsl_content: str,
        app_id: str | None,
        existing_app: App | None,
        options: ImportOptions,
    ) -> str:
        import_service = AppDslService(db.session)
        if existing_app is not None:
            import_result = import_service.import_app(
                account=account,
                import_mode="yaml-content",
                yaml_content=dsl_content,
                app_id=existing_app.id,
            )
        else:
            import_app_id = app_id if self._should_preserve_source_app_id(options) else None
            import_result = import_service.import_app(
                account=account,
                import_mode="yaml-content",
                yaml_content=dsl_content,
                import_app_id=import_app_id,
            )
        if import_result.status not in {ImportStatus.COMPLETED, ImportStatus.COMPLETED_WITH_WARNINGS}:
            error = import_result.error or f"unexpected import status {import_result.status}"
            raise MigrationDataError(f"Workflow import failed: {error}")
        if import_result.app_id is None:
            raise MigrationDataError(f"Workflow import did not return an app id: {workflow_data.get('name')}")
        db.session.commit()
        return import_result.app_id

    def _rewrite_workflow_dsl_provider_ids(self, dsl_content: str, id_mapping: dict[str, str]) -> str:
        if not id_mapping:
            return dsl_content
        parsed = yaml.safe_load(dsl_content) if dsl_content else {}
        if not isinstance(parsed, dict):
            return dsl_content
        for node in self._workflow_nodes(parsed):
            data = node.get("data") if isinstance(node, dict) else None
            if not isinstance(data, dict):
                continue
            self._rewrite_tool_config_provider_id(data, id_mapping)
            for tool_config in self._agent_tool_configs(data):
                self._rewrite_tool_config_provider_id(tool_config, id_mapping)
        return yaml.safe_dump(parsed, sort_keys=False, allow_unicode=True)

    def _rewrite_tool_config_provider_id(self, tool_config: dict[str, Any], id_mapping: dict[str, str]) -> None:
        provider_id = self._optional_string(tool_config.get("provider_id"))
        if provider_id and provider_id in id_mapping:
            tool_config["provider_id"] = id_mapping[provider_id]

    def _source_api_provider_ids_by_name(self, package: MigrationPackage) -> dict[str, set[str]]:
        provider_ids_by_name: dict[str, set[str]] = {}
        discovery_service = DependencyDiscoveryService()
        for workflow_data in package.workflows:
            dsl_content = self._optional_string(workflow_data.get("dsl"))
            if not dsl_content:
                continue
            parsed = yaml.safe_load(dsl_content) if dsl_content else {}
            if not isinstance(parsed, dict):
                continue
            for dependency in discovery_service.discover_from_dsl(parsed):
                if dependency.kind != DependencyKind.API_TOOL or not dependency.provider_name:
                    continue
                provider_ids_by_name.setdefault(dependency.provider_name, set()).add(dependency.provider_id)
        return provider_ids_by_name

    def _workflow_nodes(self, dsl: dict[str, Any]) -> list[dict[str, Any]]:
        nodes: list[dict[str, Any]] = []
        graph = dsl.get("graph")
        if isinstance(graph, dict) and isinstance(graph.get("nodes"), list):
            nodes.extend(node for node in graph["nodes"] if isinstance(node, dict))
        workflow = dsl.get("workflow")
        workflow_graph = workflow.get("graph") if isinstance(workflow, dict) else None
        if isinstance(workflow_graph, dict) and isinstance(workflow_graph.get("nodes"), list):
            nodes.extend(node for node in workflow_graph["nodes"] if isinstance(node, dict))
        return nodes

    def _agent_tool_configs(self, data: dict[str, Any]) -> list[dict[str, Any]]:
        configs = data.get("tools")
        if isinstance(configs, list):
            return [config for config in configs if isinstance(config, dict)]
        agent_parameters = data.get("agent_parameters")
        if not isinstance(agent_parameters, dict):
            return []
        tools_parameter = agent_parameters.get("tools")
        if not isinstance(tools_parameter, dict):
            return []
        value = tools_parameter.get("value", [])
        if not isinstance(value, list):
            return []
        return [config for config in value if isinstance(config, dict)]

    def _should_preserve_source_app_id(self, options: ImportOptions) -> bool:
        return options.id_strategy == IdStrategy.PRESERVE_ID

    def _find_existing_app(self, app_id: str | None, tenant_id: str) -> App | None:
        if not self._is_uuid_string(app_id):
            return None
        return db.session.scalar(sa.select(App).where(App.id == app_id, App.tenant_id == tenant_id))

    def _create_or_reuse_app_api_token(self, app_id: str, tenant_id: str) -> None:
        existing = db.session.scalar(
            sa.select(ApiToken).where(
                ApiToken.type == ApiTokenType.APP,
                ApiToken.app_id == app_id,
                ApiToken.tenant_id == tenant_id,
            )
        )
        if existing is not None:
            return
        api_token = ApiToken()
        api_token.app_id = app_id
        api_token.tenant_id = tenant_id
        api_token.token = ApiToken.generate_api_key("app", 24)
        api_token.type = ApiTokenType.APP
        db.session.add(api_token)
        db.session.commit()

    def _import_api_tools(
        self,
        package: MigrationPackage,
        target: ImportTarget,
        options: ImportOptions,
        report_items: list[ResourceReportItem],
        id_mapping: dict[str, str],
        source_provider_ids_by_name: dict[str, set[str]],
    ) -> None:
        for tool_data in package.tools:
            provider_name = self._required_string(tool_data, "provider_name", "api_tool")
            schema = self._required_string(tool_data, "schema", "api_tool")
            existing = db.session.scalar(
                sa.select(ApiToolProvider).where(
                    ApiToolProvider.tenant_id == target.tenant_id,
                    ApiToolProvider.name == provider_name,
                )
            )
            if existing is not None and options.conflict_strategy == ConflictStrategy.FAIL:
                raise MigrationDataError(f"API tool already exists and conflict_strategy=fail: {provider_name}")
            if existing is not None and options.conflict_strategy == ConflictStrategy.SKIP:
                self._record_id_mappings(
                    id_mapping,
                    self._api_tool_source_ids(provider_name, tool_data, source_provider_ids_by_name),
                    existing.id,
                )
                report_items.append(ResourceReportItem(ResourceType.API_TOOL, provider_name, provider_name, "skipped"))
                continue

            schema_info = ApiToolManageService.parser_api_schema(schema=schema)
            credentials = tool_data.get("credentials") if isinstance(tool_data.get("credentials"), dict) else {}
            credentials = credentials or {"auth_type": "none"}
            icon = (
                tool_data.get("icon")
                if isinstance(tool_data.get("icon"), dict)
                else {"content": "tool", "background": "#FEF7C3"}
            )
            labels = tool_data.get("labels") if isinstance(tool_data.get("labels"), list) else []
            if existing is not None:
                ApiToolManageService.update_api_tool_provider(
                    user_id=target.operator_id,
                    tenant_id=target.tenant_id,
                    provider_name=provider_name,
                    original_provider=existing.name,
                    _schema_type=schema_info["schema_type"],
                    schema=schema,
                    privacy_policy=self._optional_string(tool_data.get("privacy_policy")) or "",
                    credentials=credentials,
                    custom_disclaimer=self._optional_string(tool_data.get("custom_disclaimer")) or "",
                    labels=labels,
                    icon=icon,
                )
                status = "updated"
            else:
                ApiToolManageService.create_api_tool_provider(
                    user_id=target.operator_id,
                    tenant_id=target.tenant_id,
                    provider_name=provider_name,
                    schema_type=schema_info["schema_type"],
                    schema=schema,
                    privacy_policy=self._optional_string(tool_data.get("privacy_policy")) or "",
                    credentials=credentials,
                    custom_disclaimer=self._optional_string(tool_data.get("custom_disclaimer")) or "",
                    labels=labels,
                    icon=icon,
                )
                status = "created"
            target_provider = self._find_api_tool_provider(target.tenant_id, provider_name)
            if target_provider is not None:
                self._record_id_mappings(
                    id_mapping,
                    self._api_tool_source_ids(provider_name, tool_data, source_provider_ids_by_name),
                    target_provider.id,
                )
            report_items.append(ResourceReportItem(ResourceType.API_TOOL, provider_name, provider_name, status))

    def _find_api_tool_provider(self, tenant_id: str, provider_name: str) -> ApiToolProvider | None:
        return db.session.scalar(
            sa.select(ApiToolProvider).where(
                ApiToolProvider.tenant_id == tenant_id,
                ApiToolProvider.name == provider_name,
            )
        )

    def _api_tool_source_ids(
        self,
        provider_name: str,
        tool_data: dict[str, Any],
        source_provider_ids_by_name: dict[str, set[str]],
    ) -> set[str]:
        source_ids = set(source_provider_ids_by_name.get(provider_name, set()))
        source_id = self._optional_string(tool_data.get("id"))
        if source_id:
            source_ids.add(source_id)
        return source_ids

    def _record_id_mappings(self, id_mapping: dict[str, str], source_ids: Iterable[str], target_id: str) -> None:
        for source_id in source_ids:
            id_mapping[source_id] = target_id

    def _import_workflow_tools(
        self,
        package: MigrationPackage,
        target: ImportTarget,
        options: ImportOptions,
        id_mapping: dict[str, str],
        report_items: list[ResourceReportItem],
    ) -> None:
        if not package.workflow_tools:
            return
        account = db.session.get(Account, target.operator_id)
        if account is None:
            raise MigrationDataError(f"Operator account not found: {target.operator_id}")
        for workflow_tool_data in package.workflow_tools:
            app_id = self._optional_string(workflow_tool_data.get("app_id"))
            resolved_app_id = id_mapping.get(app_id or "", app_id)
            if not resolved_app_id or self._find_existing_app(resolved_app_id, target.tenant_id) is None:
                report_items.append(
                    ResourceReportItem(
                        ResourceType.WORKFLOW_TOOL,
                        str(workflow_tool_data.get("id", workflow_tool_data.get("name", ""))),
                        self._optional_string(workflow_tool_data.get("name")),
                        "unresolved",
                        "Referenced workflow app was not found in the target tenant; workflow tool was skipped.",
                    )
                )
                continue
            try:
                self._ensure_workflow_app_is_published(target, account, resolved_app_id)
            except Exception as exc:
                report_items.append(
                    ResourceReportItem(
                        ResourceType.WORKFLOW_TOOL,
                        str(workflow_tool_data.get("id", workflow_tool_data.get("name", ""))),
                        self._optional_string(workflow_tool_data.get("name")),
                        "unresolved",
                        f"Referenced workflow app could not be published: {exc}",
                    )
                )
                continue
            workflow_tool_id = self._optional_string(workflow_tool_data.get("id"))
            tool_name = self._required_string(workflow_tool_data, "name", "workflow_tool")
            lookup_workflow_tool_id = workflow_tool_id if options.id_strategy == IdStrategy.PRESERVE_ID else None
            existing = self._find_existing_workflow_tool(
                target.tenant_id, lookup_workflow_tool_id, tool_name, resolved_app_id
            )
            if existing is not None and options.conflict_strategy == ConflictStrategy.FAIL:
                raise MigrationDataError(f"Workflow tool already exists and conflict_strategy=fail: {tool_name}")
            if existing is not None and options.conflict_strategy == ConflictStrategy.SKIP:
                if workflow_tool_id:
                    id_mapping[workflow_tool_id] = existing.id
                report_items.append(ResourceReportItem(ResourceType.WORKFLOW_TOOL, existing.id, tool_name, "skipped"))
                continue
            kwargs = {
                "user_id": account.id,
                "tenant_id": target.tenant_id,
                "name": tool_name,
                "label": self._optional_string(workflow_tool_data.get("label")) or tool_name,
                "icon": workflow_tool_data.get("icon") or {"content": "🤖", "background": "#FFEAD5"},
                "description": self._optional_string(workflow_tool_data.get("description")) or "",
                "parameters": [
                    parameter
                    if isinstance(parameter, WorkflowToolParameterConfiguration)
                    else WorkflowToolParameterConfiguration(**parameter)
                    for parameter in workflow_tool_data.get("parameters", [])
                    if isinstance(parameter, dict | WorkflowToolParameterConfiguration)
                ],
                "privacy_policy": self._optional_string(workflow_tool_data.get("privacy_policy")) or "",
                "labels": workflow_tool_data.get("labels")
                if isinstance(workflow_tool_data.get("labels"), list)
                else [],
            }
            if existing is not None:
                WorkflowToolManageService.update_workflow_tool(workflow_tool_id=existing.id, **kwargs)
                status = "updated"
                identifier = existing.id
            else:
                import_id = workflow_tool_id if options.id_strategy == IdStrategy.PRESERVE_ID else ""
                WorkflowToolManageService.create_workflow_tool(
                    workflow_app_id=resolved_app_id,
                    import_id=import_id or "",
                    **kwargs,
                )
                status = "created"
                target_provider = self._find_existing_workflow_tool(
                    target.tenant_id, import_id or None, tool_name, resolved_app_id
                )
                if target_provider is None:
                    raise MigrationDataError(f"Workflow tool was not created: {tool_name}")
                identifier = target_provider.id
            if workflow_tool_id:
                id_mapping[workflow_tool_id] = identifier
            report_items.append(ResourceReportItem(ResourceType.WORKFLOW_TOOL, identifier, tool_name, status))

    def _ensure_workflow_app_is_published(self, target: ImportTarget, account: Account, app_id: str) -> None:
        app = self._find_existing_app(app_id, target.tenant_id)
        if app is None:
            raise MigrationDataError(f"Referenced workflow app was not found in target tenant: {app_id}")
        if app.workflow_id:
            return
        workflow_service = WorkflowService()
        with sessionmaker(db.engine).begin() as session:
            app_in_session = session.get(App, app_id)
            account_in_session = session.get(Account, account.id)
            if app_in_session is None:
                raise MigrationDataError(f"Referenced workflow app was not found in target tenant: {app_id}")
            if account_in_session is None:
                raise MigrationDataError(f"Operator account not found: {account.id}")
            workflow = workflow_service.publish_workflow(
                session=session,
                app_model=app_in_session,
                account=account_in_session,
                marked_name="Migration import",
                marked_comment="Published automatically for workflow tool import.",
            )
            app_in_session.workflow_id = workflow.id
            app_in_session.updated_by = account.id
            app_in_session.updated_at = naive_utc_now()

    def _import_mcp_tools(
        self,
        package: MigrationPackage,
        target: ImportTarget,
        options: ImportOptions,
        report_items: list[ResourceReportItem],
        id_mapping: dict[str, str],
    ) -> None:
        for mcp_data in package.mcp_tools:
            name = self._required_string(mcp_data, "name", "mcp_tool")
            server_identifier = self._required_string(mcp_data, "server_identifier", "mcp_tool")
            provider_id = self._optional_string(mcp_data.get("id"))
            lookup_provider_id = provider_id if options.id_strategy == IdStrategy.PRESERVE_ID else None
            existing = self._find_existing_mcp_tool(target.tenant_id, lookup_provider_id, server_identifier)
            if existing is not None and options.conflict_strategy == ConflictStrategy.FAIL:
                raise MigrationDataError(f"MCP tool already exists and conflict_strategy=fail: {name}")
            if existing is not None and options.conflict_strategy == ConflictStrategy.SKIP:
                if provider_id:
                    id_mapping[provider_id] = existing.id
                report_items.append(ResourceReportItem(ResourceType.MCP_TOOL, existing.id, name, "skipped"))
                continue

            service = MCPToolManageService(session=db.session)
            configuration = MCPConfiguration.model_validate(mcp_data.get("configuration") or {})
            authentication = (
                MCPAuthentication.model_validate(mcp_data["authentication"]) if mcp_data.get("authentication") else None
            )
            if existing is not None:
                service.update_provider(
                    tenant_id=target.tenant_id,
                    provider_id=existing.id,
                    server_url=self._required_string(mcp_data, "server_url", "mcp_tool"),
                    name=name,
                    icon=self._optional_string(mcp_data.get("icon")) or "",
                    icon_type=self._optional_string(mcp_data.get("icon_type")) or "emoji",
                    icon_background=self._optional_string(mcp_data.get("icon_background")) or "",
                    server_identifier=server_identifier,
                    headers=mcp_data.get("headers") if isinstance(mcp_data.get("headers"), dict) else {},
                    configuration=configuration,
                    authentication=authentication,
                )
                db.session.commit()
                status = "updated"
                identifier = existing.id
                provider = existing
            else:
                service.create_provider(
                    tenant_id=target.tenant_id,
                    user_id=target.operator_id,
                    server_url=self._required_string(mcp_data, "server_url", "mcp_tool"),
                    name=name,
                    icon=self._optional_string(mcp_data.get("icon")) or "",
                    icon_type=self._optional_string(mcp_data.get("icon_type")) or "emoji",
                    icon_background=self._optional_string(mcp_data.get("icon_background")) or "",
                    server_identifier=server_identifier,
                    headers=mcp_data.get("headers") if isinstance(mcp_data.get("headers"), dict) else {},
                    configuration=configuration,
                    authentication=authentication,
                )
                provider = self._find_existing_mcp_tool(target.tenant_id, lookup_provider_id, server_identifier)
                if provider is None:
                    raise MigrationDataError(f"MCP provider was not created: {name}")
                status = "created"
                identifier = provider.id
            self._restore_mcp_provider_tools(provider, mcp_data)
            db.session.commit()
            if provider_id:
                id_mapping[provider_id] = identifier
            report_items.append(ResourceReportItem(ResourceType.MCP_TOOL, identifier, name, status))

    def _restore_mcp_provider_tools(self, provider: MCPToolProvider, mcp_data: dict[str, object]) -> None:
        tools = mcp_data.get("tools")
        if not isinstance(tools, list):
            return
        provider.tools = json.dumps(tools)
        provider.authed = True

    def _find_existing_mcp_tool(
        self, tenant_id: str, provider_id: str | None, server_identifier: str
    ) -> MCPToolProvider | None:
        predicates = [MCPToolProvider.server_identifier == server_identifier]
        if self._is_uuid_string(provider_id):
            predicates.append(MCPToolProvider.id == provider_id)
        return db.session.scalar(
            sa.select(MCPToolProvider)
            .where(MCPToolProvider.tenant_id == tenant_id, or_(*predicates))
            .limit(1)
        )

    def _is_uuid_string(self, value: str | None) -> bool:
        if not value:
            return False
        try:
            UUID(value)
        except ValueError:
            return False
        return True

    def _find_existing_workflow_tool(
        self, tenant_id: str, workflow_tool_id: str | None, tool_name: str, app_id: str
    ) -> WorkflowToolProvider | None:
        predicates = [WorkflowToolProvider.name == tool_name, WorkflowToolProvider.app_id == app_id]
        if self._is_uuid_string(workflow_tool_id):
            predicates.append(WorkflowToolProvider.id == workflow_tool_id)
        return db.session.scalar(
            sa.select(WorkflowToolProvider)
            .where(WorkflowToolProvider.tenant_id == tenant_id, or_(*predicates))
            .limit(1)
        )

    def _report_dependency_only_mcp(self, package: MigrationPackage, report_items: list[ResourceReportItem]) -> None:
        for dependency in package.dependencies:
            if dependency.get("kind") == "mcp_tool":
                report_items.append(
                    ResourceReportItem(
                        ResourceType.DEPENDENCY,
                        str(dependency.get("provider_id", dependency.get("id", ""))),
                        self._optional_string(dependency.get("name")),
                        "skipped",
                        "MCP provider is dependency-only; configure it manually in target tenant.",
                    )
                )

    def _required_string(self, value: dict[str, object], field_name: str, resource_name: str) -> str:
        field_value = value.get(field_name)
        if not isinstance(field_value, str) or not field_value:
            raise MigrationDataError(f"Missing required {resource_name} field: {field_name}")
        return field_value

    def _optional_string(self, value: object) -> str | None:
        if isinstance(value, str) and value:
            return value
        return None
