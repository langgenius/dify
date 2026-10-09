"""App discovery queries over materialized records."""

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Protocol
from uuid import UUID

from libs.pagination import PaginatedResult
from machinery.context import AppRequestContext, RequestContext
from models.enums import AppStatus
from services.app.access import AppAccessFilter
from services.app_definition_query_service import AppParameterConfig
from services.entities.app_entities import SUPPORTED_APP_TYPES, AppListParams, AppSummary, PermittedAppsPage


@dataclass(frozen=True)
class AppDiscoveryQuery:
    page: int
    limit: int
    mode: str | None
    name: str | None


@dataclass(frozen=True)
class AppDiscoveryEntry:
    app: AppSummary
    workspace_name: str | None


@dataclass(frozen=True)
class AppDescription:
    app: AppSummary
    service_api_enabled: bool
    config: AppParameterConfig | None


class DiscoveryApps(Protocol):
    def find_visible_app(self, app_id: str, tenant_id: str) -> AppSummary | None: ...

    def find_visible_apps(self, app_ids: Sequence[str]) -> list[AppSummary]: ...

    def query_apps(self, user_id: str, tenant_id: str, params: AppListParams) -> PaginatedResult[AppSummary] | None: ...

    def describe(self, context: AppRequestContext, *, include_config: bool) -> AppDescription: ...


class DiscoveryWorkspaces(Protocol):
    def names_by_ids(self, workspace_ids: Sequence[str]) -> dict[str, str]: ...


class AppDiscoveryAccess(Protocol):
    def visibility(self, context: RequestContext) -> AppAccessFilter: ...

    def permitted_apps(self, query: AppDiscoveryQuery) -> PermittedAppsPage: ...


class AppDiscoveryService:
    def __init__(self, *, apps: DiscoveryApps, workspaces: DiscoveryWorkspaces, access: AppDiscoveryAccess) -> None:
        self._apps = apps
        self._workspaces = workspaces
        self._access = access

    def list_apps(self, context: RequestContext, query: AppDiscoveryQuery) -> PaginatedResult[AppDiscoveryEntry]:
        access = (
            AppAccessFilter(set(context.resource_app_ids), can_manage_own_apps=False)
            if context.resource_app_ids is not None
            else self._access.visibility(context)
        )
        try:
            app_id = str(UUID(query.name)) if query.name else None
        except ValueError:
            app_id = None

        if app_id is not None:
            app = self._apps.find_visible_app(app_id, context.active_workspace_id)
            if (
                app is None
                or app.mode not in SUPPORTED_APP_TYPES
                or not access.is_app_accessible(app.id, app.maintainer, context.account_id)
            ):
                return PaginatedResult(items=[], total=0, page=query.page, per_page=query.limit)
            return self._page([app], total=1, page=1, limit=1)

        params = AppListParams.model_validate(
            {
                "page": query.page,
                "limit": query.limit,
                "mode": query.mode or "all",
                "name": query.name,
                "status": AppStatus.NORMAL,
                "openapi_visible": True,
            }
        )
        access.apply_to_params(params)
        result = self._apps.query_apps(context.account_id, context.active_workspace_id, params)
        return self._page(
            [app for app in result.items if app.mode in SUPPORTED_APP_TYPES] if result else [],
            total=result.total if result else 0,
            page=query.page,
            limit=query.limit,
        )

    def list_permitted_apps(self, query: AppDiscoveryQuery) -> PaginatedResult[AppDiscoveryEntry]:
        permitted = self._access.permitted_apps(query)
        apps = {app.id: app for app in self._apps.find_visible_apps(permitted.app_ids)} if permitted.app_ids else {}
        return self._page(
            [
                apps[app_id]
                for app_id in permitted.app_ids
                if app_id in apps and apps[app_id].status == AppStatus.NORMAL
            ],
            total=permitted.total,
            page=query.page,
            limit=query.limit,
        )

    def describe(self, context: AppRequestContext, fields: set[str] | None) -> AppDescription:
        include_config = fields is None or bool(fields & {"parameters", "input_schema"})
        return self._apps.describe(context, include_config=include_config)

    def _page(
        self, apps: Sequence[AppSummary], *, total: int, page: int, limit: int
    ) -> PaginatedResult[AppDiscoveryEntry]:
        names = self._workspaces.names_by_ids(list({app.tenant_id for app in apps})) if apps else {}
        return PaginatedResult(
            items=[AppDiscoveryEntry(app, names.get(app.tenant_id)) for app in apps],
            total=total,
            page=page,
            per_page=limit,
        )
