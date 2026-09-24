"""Console app use cases with explicit identity and framework-neutral ports."""

from __future__ import annotations

from contextlib import AbstractContextManager, closing
from dataclasses import replace
from typing import BinaryIO, Literal, Protocol
from uuid import UUID, uuid4

from machinery.context import RequestContext
from models.model import AppMode
from services.agent.errors import InvalidRosterAgentPackageError
from services.agent.roster_package_entities import RosterAgentPackageExport
from services.entities.app_entities import (
    AppChange,
    AppCreationSettings,
    AppDeletion,
    AppExportOptions,
    AppListParams,
    AppPage,
    AppRecord,
    AppReference,
    AppTraceSettings,
    CopyAppParams,
    CreateAppParams,
    ImportedAppPackage,
    RecentAppListItem,
    StarredAppListParams,
    UpdateAppParams,
)
from services.entities.dsl_entities import (
    AppImportPackage,
    AppImportParams,
    CheckDependenciesResult,
    Import,
    ImportStatus,
)


class ConsoleAppNotFoundError(Exception):
    pass


class AppExportAgentNotFoundError(ConsoleAppNotFoundError):
    pass


class InvalidAppExportError(ValueError):
    pass


class AppExportPaidPlanRequiredError(Exception):
    pass


class CreatorsPlatformDisabledError(Exception):
    pass


class InvalidAppAccessModesError(ValueError):
    pass


class AppPermissions(Protocol):
    def filter_list(self, params: AppListParams) -> AppListParams: ...

    def keys_for(self, app_ids: list[str]) -> dict[str, list[str]]: ...


class ConsoleAppAccess(Protocol):
    def require_import(self, context: RequestContext, kind: Literal["url", "dsl", "agent"]) -> None: ...

    def imported_permissions(self, context: RequestContext, app_id: str) -> list[str]: ...

    def initialize_import_access(self, app_id: str) -> None: ...

    def inherit_access(self, source_app_id: str, app_id: str) -> None: ...

    def permissions(self, context: RequestContext, *, app_id: str | None = None) -> AppPermissions: ...

    def created_permissions(self, context: RequestContext, app_id: str) -> list[str]: ...

    def initialize_created_app(self, context: RequestContext, app_id: str) -> None: ...

    def access_modes(self, app_ids: list[str]) -> dict[str, str]: ...

    def access_mode(self, app_id: str) -> str | None: ...

    def can_export_version(self, workspace_id: str) -> bool: ...


class ConsoleApps(Protocol):
    def list_apps(self, context: RequestContext, params: AppListParams | StarredAppListParams) -> AppPage: ...

    def recent(self, context: RequestContext, params: AppListParams) -> list[RecentAppListItem]: ...

    def get(self, context: RequestContext, app_id: str) -> AppRecord: ...

    def update(self, context: RequestContext, app_id: str, params: UpdateAppParams) -> AppRecord: ...

    def rename(self, context: RequestContext, app_id: str, name: str) -> AppRecord: ...

    def update_icon(
        self, context: RequestContext, app_id: str, *, icon: str, icon_background: str, icon_type: str | None
    ) -> AppRecord: ...

    def set_site_enabled(self, context: RequestContext, app_id: str, enabled: bool) -> AppChange: ...

    def set_api_enabled(self, context: RequestContext, app_id: str, enabled: bool) -> AppChange: ...

    def set_starred(self, context: RequestContext, app_id: str, starred: bool) -> None: ...

    def get_reference(self, context: RequestContext, app_id: str) -> AppReference: ...

    def get_trace(self, context: RequestContext, app_id: str) -> AppTraceSettings: ...

    def set_trace(self, context: RequestContext, app_id: str, settings: AppTraceSettings) -> None: ...


class AppTransfers(Protocol):
    def download_import(self, url: str) -> AbstractContextManager[BinaryIO]: ...

    def read_import_yaml(self, source: BinaryIO) -> str | None: ...

    def read_app_package(self, source: BinaryIO) -> AppImportPackage | None: ...

    def import_dsl(
        self,
        context: RequestContext,
        params: AppImportParams,
        *,
        as_copy: bool = False,
        package: AppImportPackage | None = None,
    ) -> Import: ...

    def confirm_import(self, context: RequestContext, import_id: str) -> tuple[Import, bool]: ...

    def import_agent_package(self, context: RequestContext, source: BinaryIO) -> ImportedAppPackage: ...

    def check_dependencies(self, context: RequestContext, app_id: str) -> CheckDependenciesResult: ...

    def export_dsl(self, context: RequestContext, app_id: str, options: AppExportOptions) -> str: ...

    def export_app_package(
        self, context: RequestContext, app_id: str, options: AppExportOptions
    ) -> RosterAgentPackageExport: ...

    def export_agent_package(
        self, *, workspace_id: str, agent_id: str, version_id: UUID | None
    ) -> RosterAgentPackageExport: ...


class CreatorsPlatform(Protocol):
    def require_enabled(self) -> None: ...

    def upload(self, dsl: str) -> str: ...

    def authorize(self, account_id: str) -> str | None: ...

    def redirect_url(self, claim_code: str, oauth_code: str | None) -> str: ...


class AppTraceProvider(Protocol):
    def validate_provider(self, tracing_provider: str) -> None: ...

    def require_provider_available(self, tracing_provider: str) -> None: ...


class AppLifecycle(Protocol):
    def create(self, context: RequestContext, params: CreateAppParams, settings: AppCreationSettings) -> AppRecord: ...

    def delete(self, context: RequestContext, app_id: str) -> AppDeletion: ...

    def prepare_creation(self, context: RequestContext, params: CreateAppParams) -> AppCreationSettings: ...

    def created(self, context: RequestContext, app: AppRecord) -> None: ...

    def updated(self, context: RequestContext, app: AppRecord) -> None: ...

    def deleted(self, context: RequestContext, deleted: AppDeletion) -> None: ...

    def present(self, context: RequestContext, app: AppRecord, *, mask_credentials: bool = False) -> AppRecord: ...


class ConsoleAppService:
    def __init__(
        self,
        *,
        apps: ConsoleApps,
        access: ConsoleAppAccess,
        transfers: AppTransfers,
        creators: CreatorsPlatform,
        tracing: AppTraceProvider,
        lifecycle: AppLifecycle,
    ) -> None:
        self._apps = apps
        self._access = access
        self._transfers = transfers
        self._creators = creators
        self._tracing = tracing
        self._lifecycle = lifecycle

    def import_app(self, context: RequestContext, params: AppImportParams, *, source: BinaryIO | None = None) -> Import:
        if source is not None:
            return self._import_package(context, params, source)
        if params.mode == "yaml-url" and params.yaml_url:
            self._access.require_import(context, "url")
            with self._transfers.download_import(params.yaml_url) as downloaded:
                content = self._transfers.read_import_yaml(downloaded)
                if content is None:
                    return self._import_package(context, params, downloaded)
                params = params.model_copy(update={"mode": "yaml-content", "yaml_content": content, "yaml_url": None})
        return self._import_dsl(context, params)

    def _import_package(self, context: RequestContext, params: AppImportParams, source: BinaryIO) -> Import:
        package = self._transfers.read_app_package(source)
        if package is not None:
            with closing(package):
                return self._import_dsl(
                    context,
                    params.model_copy(update={"mode": "yaml-content", "yaml_content": package.dsl, "yaml_url": None}),
                    package=package,
                )
        self._access.require_import(context, "agent")
        if params.app_id:
            raise InvalidRosterAgentPackageError("Roster Agent package import does not support overwriting an App")
        result = self._transfers.import_agent_package(context, source)
        return Import(
            id=str(uuid4()),
            status=ImportStatus.COMPLETED_WITH_WARNINGS if result.warnings else ImportStatus.COMPLETED,
            app_id=result.app_id,
            app_mode=AppMode.AGENT,
            warnings=result.warnings,
        )

    def _import_dsl(
        self, context: RequestContext, params: AppImportParams, *, package: AppImportPackage | None = None
    ) -> Import:
        self._access.require_import(context, "dsl")
        result = self._transfers.import_dsl(context, params, package=package)
        self._set_import_permissions(context, result, created=params.app_id is None)
        if result.app_id:
            self._access.initialize_import_access(result.app_id)
        return result

    def confirm_import(self, context: RequestContext, import_id: str) -> Import:
        result, created = self._transfers.confirm_import(context, import_id)
        self._set_import_permissions(context, result, created=created)
        return result

    def _set_import_permissions(self, context: RequestContext, result: Import, *, created: bool) -> None:
        if (
            created
            and result.app_id
            and result.status in {ImportStatus.COMPLETED, ImportStatus.COMPLETED_WITH_WARNINGS}
        ):
            result.permission_keys = self._access.imported_permissions(context, result.app_id)

    def check_import_dependencies(self, context: RequestContext, app_id: str) -> CheckDependenciesResult:
        self._apps.get_reference(context, app_id)
        return self._transfers.check_dependencies(context, app_id)

    def list_apps(self, context: RequestContext, params: AppListParams | StarredAppListParams) -> AppPage:
        permissions = None
        if isinstance(params, AppListParams):
            permissions = self._access.permissions(context)
            params = permissions.filter_list(params)
        page = self._apps.list_apps(context, params)
        if not page.data:
            return page
        app_ids = [app.id for app in page.data]
        modes = self._access.access_modes(app_ids)
        keys = permissions.keys_for(app_ids) if permissions is not None else {}
        return replace(
            page,
            data=[
                replace(app, access_mode=modes.get(app.id), permission_keys=keys.get(app.id, [])) for app in page.data
            ],
        )

    def recent(self, context: RequestContext, limit: int) -> list[RecentAppListItem]:
        permissions = self._access.permissions(context)
        apps = self._apps.recent(context, permissions.filter_list(AppListParams(limit=limit)))
        keys = permissions.keys_for([app.id for app in apps])
        return [replace(app, permission_keys=keys.get(app.id, [])) for app in apps]

    def get(self, context: RequestContext, app_id: str) -> AppRecord:
        app = self._lifecycle.present(context, self._apps.get(context, app_id), mask_credentials=True)
        access_mode = self._access.access_mode(app.id)
        keys = self._access.permissions(context, app_id=app.id).keys_for([app.id])
        return replace(app, access_mode=access_mode, permission_keys=keys.get(app.id, []))

    def create(self, context: RequestContext, params: CreateAppParams) -> AppRecord:
        settings = self._lifecycle.prepare_creation(context, params)
        app = self._lifecycle.create(context, params, settings)
        self._lifecycle.created(context, app)
        keys = self._access.created_permissions(context, app.id)
        self._access.initialize_created_app(context, app.id)
        return self._lifecycle.present(context, replace(app, permission_keys=keys))

    def update(self, context: RequestContext, app_id: str, params: UpdateAppParams) -> AppRecord:
        app = self._apps.update(context, app_id, params)
        self._lifecycle.updated(context, app)
        return self.get(context, app_id)

    def rename(self, context: RequestContext, app_id: str, name: str) -> AppRecord:
        app = self._apps.rename(context, app_id, name)
        self._lifecycle.updated(context, app)
        return app

    def update_icon(
        self, context: RequestContext, app_id: str, *, icon: str, icon_background: str, icon_type: str | None
    ) -> AppRecord:
        app = self._apps.update_icon(context, app_id, icon=icon, icon_background=icon_background, icon_type=icon_type)
        self._lifecycle.updated(context, app)
        return app

    def set_site_enabled(self, context: RequestContext, app_id: str, enabled: bool) -> AppRecord:
        result = self._apps.set_site_enabled(context, app_id, enabled)
        if result.changed:
            self._lifecycle.updated(context, result.app)
        return result.app

    def set_api_enabled(self, context: RequestContext, app_id: str, enabled: bool) -> AppRecord:
        result = self._apps.set_api_enabled(context, app_id, enabled)
        if result.changed:
            self._lifecycle.updated(context, result.app)
        return result.app

    def delete(self, context: RequestContext, app_id: str) -> None:
        deleted = self._lifecycle.delete(context, app_id)
        self._lifecycle.deleted(context, deleted)

    def set_starred(self, context: RequestContext, app_id: str, starred: bool) -> None:
        self._apps.set_starred(context, app_id, starred)

    def copy(self, context: RequestContext, app_id: str, params: CopyAppParams) -> tuple[Import, AppRecord | None]:
        dsl = self._transfers.export_dsl(context, app_id, AppExportOptions(include_secret=True))
        result = self._transfers.import_dsl(
            context,
            AppImportParams(mode="yaml-content", yaml_content=dsl, **params.model_dump()),
            as_copy=True,
        )
        if result.status in {ImportStatus.FAILED, ImportStatus.PENDING}:
            return result, None
        if result.app_id is None:
            raise ConsoleAppNotFoundError
        app = self._apps.get(context, result.app_id)
        self._access.inherit_access(app_id, app.id)
        app = replace(app, permission_keys=self._access.created_permissions(context, app.id))
        return result, self._lifecycle.present(context, app)

    def export(self, context: RequestContext, app_id: str, options: AppExportOptions) -> str | RosterAgentPackageExport:
        app = self._apps.get_reference(context, app_id)
        if options.version_id is not None:
            if app.mode != "agent":
                raise InvalidAppExportError("version_id is only available for Agent Apps")
            if not self._access.can_export_version(context.active_workspace_id):
                raise AppExportPaidPlanRequiredError("This feature requires a paid plan.")
        if options.format == "yaml":
            return self._transfers.export_dsl(context, app.id, options)
        if app.mode == "agent":
            if app.bound_agent_id is None:
                raise AppExportAgentNotFoundError("Agent not found")
            return self._transfers.export_agent_package(
                workspace_id=context.active_workspace_id,
                agent_id=app.bound_agent_id,
                version_id=options.version_id,
            )
        return self._transfers.export_app_package(context, app.id, options)

    def publish(self, context: RequestContext, app_id: str) -> str:
        # Validate ownership before producing external effects, including feature rejection.
        self._apps.get_reference(context, app_id)
        self._creators.require_enabled()
        dsl = self._transfers.export_dsl(context, app_id, AppExportOptions(include_secret=False))
        claim_code = self._creators.upload(dsl)
        code = self._creators.authorize(context.account_id)
        return self._creators.redirect_url(claim_code, code)

    def get_trace(self, context: RequestContext, app_id: str) -> AppTraceSettings:
        return self._apps.get_trace(context, app_id)

    def set_trace(self, context: RequestContext, app_id: str, settings: AppTraceSettings) -> None:
        self._apps.get_reference(context, app_id)
        if settings.tracing_provider is not None:
            if settings.enabled:
                self._tracing.require_provider_available(settings.tracing_provider)
            else:
                self._tracing.validate_provider(settings.tracing_provider)
        self._apps.set_trace(context, app_id, settings)
