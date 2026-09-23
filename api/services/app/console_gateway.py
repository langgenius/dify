"""Adapters for app permissions, existing DSL operations and package exporters."""

from __future__ import annotations

from collections.abc import Callable
from contextlib import AbstractContextManager
from dataclasses import dataclass, replace
from typing import BinaryIO, Literal, override
from uuid import UUID

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, sessionmaker

from configs import dify_config
from core.rbac import RBACPermission
from enums import DeploymentEdition
from events.app_event import app_was_updated
from machinery.context import RequestContext
from models.account import Account
from models.agent import AgentIconType
from models.model import AppMode
from repositories.app.console_repository import ConsoleAppRepository, console_app_actor, require_console_app
from repositories.app.response import app_record
from services.agent.errors import AgentNameConflictError
from services.agent.home_snapshot_service import AgentHomeSnapshotService
from services.agent.roster_package_entities import RosterAgentPackageExport
from services.agent.roster_package_exporter import RosterAgentPackageExporter
from services.agent.roster_package_importer import RosterAgentPackageImporter
from services.agent.roster_service import AgentRosterService
from services.agent.workspace_service import AgentWorkspaceService
from services.app.access import AppAccessFilter, resolve_app_access_filter
from services.app.console_service import (
    AppLifecycle,
    AppPermissions,
    AppTransfers,
    ConsoleAppAccess,
    InvalidAppAccessModesError,
)
from services.app.import_service import AppDefinitionImports
from services.app.response_gateway import AppResponseGateway
from services.app_dsl_service import IMPORT_INFO_REDIS_KEY_PREFIX, AppDslService, PendingData
from services.app_import_source import download_app_import_source, try_read_yaml
from services.app_package_service import AppPackageService
from services.app_service import AppService
from services.enterprise import rbac_service
from services.enterprise.enterprise_service import EnterpriseService
from services.entities.app_entities import (
    AppCreationSettings,
    AppDeletion,
    AppEvent,
    AppExportOptions,
    AppListParams,
    AppRecord,
    CreateAppParams,
    ImportedAppPackage,
)
from services.entities.dsl_entities import (
    AppImportPackage,
    AppImportParams,
    CheckDependenciesResult,
    Import,
    ImportStatus,
)
from services.errors.account import NoPermissionError
from services.feature_service import FeatureService
from services.system_feature_service import SystemFeatureService
from tasks.initialize_created_app_rbac_access_task import initialize_created_app_rbac_access_task


@dataclass(frozen=True)
class ConsoleAppPermissions(AppPermissions):
    snapshot: rbac_service.MyPermissionsResponse
    access_filter: AppAccessFilter

    @override
    def filter_list(self, params: AppListParams) -> AppListParams:
        params = params.model_copy(deep=True)
        self.access_filter.apply_to_params(params)
        return params

    @override
    def keys_for(self, app_ids: list[str]) -> dict[str, list[str]]:
        return self.snapshot.app.permission_keys_by_resource_ids(app_ids)


class EnterpriseConsoleAppAccess(ConsoleAppAccess):
    @override
    def require_import(self, context: RequestContext, kind: Literal["url", "dsl", "agent"]) -> None:
        if kind == "dsl" and dify_config.DEPLOYMENT_EDITION == DeploymentEdition.CLOUD:
            apps = FeatureService.get_features(context.active_workspace_id, exclude_vector_space=True).apps
            if 0 < apps.limit <= apps.size:
                raise NoPermissionError("The number of apps has reached the limit of your subscription.")
        if not dify_config.RBAC_ENABLED:
            return
        permissions = (
            (RBACPermission.AGENT_CREATE, RBACPermission.AGENT_IMPORT_EXPORT_DSL)
            if kind == "agent"
            else (RBACPermission.APP_IMPORT_EXPORT_DSL, RBACPermission.AGENT_IMPORT_EXPORT_DSL)
            if kind == "url"
            else (RBACPermission.APP_IMPORT_EXPORT_DSL,)
        )
        checks = (
            rbac_service.RBACService.CheckAccess.check(
                context.active_workspace_id, context.account_id, scene=permission, resource_type=None, resource_id=None
            )
            for permission in permissions
        )
        allowed = any(checks) if kind == "url" else all(checks)
        if not allowed:
            raise NoPermissionError("You do not have permission to import this App")

    @override
    def imported_permissions(self, context: RequestContext, app_id: str) -> list[str]:
        return self.created_permissions(context, app_id) if dify_config.RBAC_ENABLED else []

    @override
    def initialize_import_access(self, app_id: str) -> None:
        if SystemFeatureService.is_webapp_auth_enabled():
            EnterpriseService.WebAppAuth.update_app_access_mode(app_id, "private")

    @override
    def inherit_access(self, source_app_id: str, app_id: str) -> None:
        if not SystemFeatureService.is_webapp_auth_enabled():
            return
        try:
            access_mode = EnterpriseService.WebAppAuth.get_app_access_mode_by_id(source_app_id).access_mode
        except Exception:
            # Old apps without settings default to public, matching the access fallback.
            access_mode = "public"
        EnterpriseService.WebAppAuth.update_app_access_mode(app_id, access_mode)

    def __init__(self, *, session_factory: sessionmaker[Session]) -> None:
        self._session_factory = session_factory

    @override
    def permissions(self, context: RequestContext, *, app_id: str | None = None) -> ConsoleAppPermissions:
        with self._session_factory() as session:
            permissions = rbac_service.RBACService.MyPermissions.get(
                context.active_workspace_id,
                context.account_id,
                app_id=app_id,
                session=session,
            )
            access_filter = AppAccessFilter.unrestricted()
            if dify_config.RBAC_ENABLED and app_id is None:
                access_filter = resolve_app_access_filter(
                    context.active_workspace_id,
                    context.account_id,
                    session=session,
                    permissions=permissions,
                )
        return ConsoleAppPermissions(permissions, access_filter)

    @override
    def created_permissions(self, context: RequestContext, app_id: str) -> list[str]:
        with self._session_factory() as session:
            keys = rbac_service.RBACService.AppPermissions.batch_get(
                context.active_workspace_id,
                context.account_id,
                [app_id],
                session=session,
            )
        return keys.get(app_id, [])

    @override
    def initialize_created_app(self, context: RequestContext, app_id: str) -> None:
        if dify_config.RBAC_ENABLED:
            rbac_service.RBACService.AppAccess.replace_whitelist(
                context.active_workspace_id,
                context.account_id,
                app_id,
                rbac_service.ReplaceMemberBindings(automatic_include_workspace_members=True),
            )
            initialize_created_app_rbac_access_task.delay(
                context.active_workspace_id, context.account_id, app_id=app_id
            )

    @override
    def access_modes(self, app_ids: list[str]) -> dict[str, str]:
        if not SystemFeatureService.is_webapp_auth_enabled():
            return {}
        settings = EnterpriseService.WebAppAuth.batch_get_app_access_mode_by_id(app_ids=app_ids)
        if len(settings) != len(app_ids):
            raise InvalidAppAccessModesError("Invalid app id in webapp auth")
        return {app_id: setting.access_mode for app_id, setting in settings.items()}

    @override
    def access_mode(self, app_id: str) -> str | None:
        if not SystemFeatureService.is_webapp_auth_enabled():
            return None
        return EnterpriseService.WebAppAuth.get_app_access_mode_by_id(app_id=app_id).access_mode

    @override
    def can_export_version(self, workspace_id: str) -> bool:
        return (
            dify_config.DEPLOYMENT_EDITION != DeploymentEdition.CLOUD
            or FeatureService.get_workspace_plan(workspace_id).is_paid
        )


class AppTransferGateway(AppTransfers, AppDefinitionImports):
    def __init__(
        self,
        *,
        session_factory: sessionmaker[Session],
        dsl_factory: Callable[[Session], AppDslService],
        packages: AppPackageService,
        agent_packages: RosterAgentPackageExporter,
        agent_importer: RosterAgentPackageImporter,
    ) -> None:
        self._session_factory = session_factory
        self._dsl_factory = dsl_factory
        self._packages = packages
        self._agent_packages = agent_packages
        self._agent_importer = agent_importer

    @override
    def download_import(self, url: str) -> AbstractContextManager[BinaryIO]:
        return download_app_import_source(url)

    @override
    def read_import_yaml(self, source: BinaryIO) -> str | None:
        return try_read_yaml(source)

    @override
    def read_app_package(self, source: BinaryIO) -> AppImportPackage | None:
        return self._packages.read_package(source)

    def _import_actor(self, context: RequestContext) -> Account:
        with self._session_factory() as session:
            return console_app_actor(session, context)

    @override
    def import_dsl(
        self,
        context: RequestContext,
        params: AppImportParams,
        *,
        as_copy: bool = False,
        package: AppImportPackage | None = None,
    ) -> Import:
        account = self._import_actor(context)
        with self._session_factory() as session:
            result = self._dsl_factory(session).import_app(
                account=account,
                import_mode=params.mode,
                yaml_content=params.yaml_content,
                yaml_url=params.yaml_url,
                name=params.name,
                description=params.description,
                icon_type=params.icon_type,
                icon=params.icon,
                icon_background=params.icon_background,
                app_id=params.app_id,
                package=package,
            )
            if result.status == ImportStatus.FAILED or (as_copy and result.status == ImportStatus.PENDING):
                session.rollback()
            else:
                session.commit()
        return result

    @override
    def confirm_import(self, context: RequestContext, import_id: str) -> tuple[Import, bool]:
        from extensions.ext_redis import redis_client

        raw = redis_client.get(f"{IMPORT_INFO_REDIS_KEY_PREFIX}{import_id}")
        pending = PendingData.model_validate_json(raw) if raw else None
        result = self.confirm_definition(context, import_id)
        return result, pending is not None and pending.app_id is None

    @override
    def confirm_definition(self, context: RequestContext, import_id: str) -> Import:
        account = self._import_actor(context)
        with self._session_factory() as session:
            result = self._dsl_factory(session).confirm_import(import_id=import_id, account=account)
            if result.status == ImportStatus.FAILED:
                session.rollback()
            else:
                session.commit()
        return result

    @override
    def import_agent_package(self, context: RequestContext, source: BinaryIO) -> ImportedAppPackage:
        account = self._import_actor(context)
        result = self._agent_importer.import_package(
            source=source,
            tenant_id=context.active_workspace_id,
            account=account,
        )
        return ImportedAppPackage(result.app_id, result.agent_id, result.warnings)

    @override
    def check_dependencies(self, context: RequestContext, app_id: str) -> CheckDependenciesResult:
        return AppDslService.check_app_dependencies(tenant_id=context.active_workspace_id, app_id=app_id)

    @override
    def export_dsl(self, context: RequestContext, app_id: str, options: AppExportOptions) -> str:
        with self._session_factory() as session:
            app = require_console_app(session, context, app_id)
            dsl = self._dsl_factory(session)
            prepared = dsl.load_export_data(
                app_model=app,
                session=session,
                include_secret=options.include_secret,
                workflow_id=options.workflow_id,
                version_id=options.version_id,
            )
        return dsl.serialize_export_data(prepared)

    @override
    def export_app_package(
        self, context: RequestContext, app_id: str, options: AppExportOptions
    ) -> RosterAgentPackageExport:
        with self._session_factory() as session:
            app = require_console_app(session, context, app_id)
        return self._packages.export_app(
            app_model=app, include_secret=options.include_secret, workflow_id=options.workflow_id
        )

    @override
    def export_agent_package(
        self, *, workspace_id: str, agent_id: str, version_id: UUID | None
    ) -> RosterAgentPackageExport:
        return self._agent_packages.export(tenant_id=workspace_id, agent_id=agent_id, version_id=version_id)


class AppLifecycleGateway(AppLifecycle):
    """Integrate App persistence with existing Agent transaction participants.

    Agent services retain their current API. Their database-only operations join
    the App transaction; notification and resource cleanup run after it closes.
    """

    def __init__(self, *, session_factory: sessionmaker[Session]) -> None:
        self._session_factory = session_factory

    @override
    def create(self, context: RequestContext, params: CreateAppParams, settings: AppCreationSettings) -> AppRecord:
        with self._session_factory.begin() as session:
            account = console_app_actor(session, context)
            app = ConsoleAppRepository.insert_app_record(
                context.active_workspace_id, params, account, settings, session=session
            )
            if app.mode == AppMode.AGENT:
                initial_soul = AppService.prepare_agent_soul(context.active_workspace_id, session=session)
                try:
                    AgentRosterService(session).create_backing_agent_for_app(
                        tenant_id=context.active_workspace_id,
                        account_id=context.account_id,
                        app_id=app.id,
                        name=params.name,
                        description=params.description or "",
                        role=params.agent_role,
                        icon_type=AgentIconType(params.icon_type) if params.icon_type else None,
                        icon=params.icon,
                        icon_background=params.icon_background,
                        initial_soul=initial_soul,
                    )
                except IntegrityError as exc:
                    raise AgentNameConflictError() from exc
            return app_record(app, session=session, projection="detail-with-site")

    @override
    def delete(self, context: RequestContext, app_id: str) -> AppDeletion:
        with self._session_factory.begin() as session:
            app = require_console_app(session, context, app_id)
            deleted = ConsoleAppRepository.delete_app_record(app, account_id=context.account_id, session=session)
            for binding_id in deleted.binding_ids:
                AgentWorkspaceService.retire_binding(
                    session=session, tenant_id=context.active_workspace_id, binding_id=binding_id
                )
            snapshots = (
                AgentHomeSnapshotService.retire_all_for_agent(
                    session=session, tenant_id=context.active_workspace_id, agent_id=deleted.backing_agent_id
                )
                if deleted.backing_agent_id is not None
                else []
            )
            workspaces = AgentWorkspaceService.retire_all_for_app(
                session=session, tenant_id=context.active_workspace_id, app_id=app_id
            )
            return replace(deleted, home_snapshot_ids=snapshots, workspace_ids=workspaces)

    @override
    def prepare_creation(self, context: RequestContext, params: CreateAppParams) -> AppCreationSettings:
        return AppService.prepare_creation(context.active_workspace_id, params)

    @override
    def created(self, context: RequestContext, app: AppRecord) -> None:
        AppService.notify_created_app(
            event=AppEvent(app.id, context.active_workspace_id, app.mode_compatible_with_agent),
            account_id=context.account_id,
            backing_agent_id=app.bound_agent_id,
        )

    @override
    def updated(self, context: RequestContext, app: AppRecord) -> None:
        app_was_updated.send(AppEvent(app.id, context.active_workspace_id, app.mode_compatible_with_agent))

    @override
    def deleted(self, context: RequestContext, deleted: AppDeletion) -> None:
        AppService.notify_deleted_app(deleted, account_id=context.account_id)

    @override
    def present(self, context: RequestContext, app: AppRecord, *, mask_credentials: bool = False) -> AppRecord:
        app = replace(
            app, deleted_tools=AppResponseGateway.find_deleted_tools(context.active_workspace_id, app.tool_references)
        )
        return AppResponseGateway.mask_record(context, app) if mask_credentials else app
