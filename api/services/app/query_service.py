"""App discovery queries over materialized records."""

from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from typing import Protocol
from uuid import UUID

from constants.oauth_bearer import SubjectType
from libs.pagination import PaginatedResult
from machinery.context import AppRequestContext, CallerIdentity, RequestContext
from machinery.scope import UNRESTRICTED, scope_admits
from models.enums import AppStatus
from services.app.access import AppAccessFilter
from services.app_definition_query_service import AppParameterConfig
from services.entities.app_entities import SUPPORTED_APP_TYPES, AppListParams, AppRecord, AppSummary, PermittedAppsPage


@dataclass(frozen=True)
class AppDiscoveryQuery:
    page: int
    limit: int
    mode: str | None
    name: str | None


@dataclass(frozen=True)
class AppListLogin:
    """Who asks for the app list, as admission resolved it.

    ``workspace_id`` is the workspace the request named, after the membership check; for a workspace token it is the
    token's own workspace. None means the request named none; it is always None for an external SSO login.
    """

    kind: SubjectType
    caller: CallerIdentity
    workspace_id: str | None


type _AppListRule = Callable[[AppListLogin, AppDiscoveryQuery], PaginatedResult[AppDiscoveryEntry]]


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


class RelatedApps(Protocol):
    def related_apps(self, tenant_id: str, app_ids: Sequence[str]) -> list[AppRecord]: ...


class DiscoveryWorkspaces(Protocol):
    def names_by_ids(self, workspace_ids: Sequence[str]) -> dict[str, str]: ...

    def member_workspace_ids(self, account_id: str) -> list[str]: ...


class AppDiscoveryAccess(Protocol):
    def visibility(self, context: RequestContext) -> AppAccessFilter: ...

    def permitted_apps(self, query: AppDiscoveryQuery) -> PermittedAppsPage: ...


class AppDiscoveryService:
    def __init__(self, *, apps: DiscoveryApps, workspaces: DiscoveryWorkspaces, access: AppDiscoveryAccess) -> None:
        self._apps = apps
        self._workspaces = workspaces
        self._access = access
        self._rules: Mapping[SubjectType, _AppListRule] = {
            SubjectType.ACCOUNT: self._account_apps,
            SubjectType.RESOURCE_ACCESS: self._workspace_token_apps,
            SubjectType.EXTERNAL_SSO: self._external_apps,
            SubjectType.KNOWLEDGE_AGENT: self._no_apps,
        }

    def list_apps_for(self, login: AppListLogin, query: AppDiscoveryQuery) -> PaginatedResult[AppDiscoveryEntry]:
        """The one app list: the rule is chosen by the login kind."""
        return self._rules[login.kind](login, query)

    def list_apps(self, context: RequestContext, query: AppDiscoveryQuery) -> PaginatedResult[AppDiscoveryEntry]:
        access = self._visibility(context)
        app_id = _app_id_in(query.name)
        if app_id is not None:
            app = self._visible_app(context, access, app_id)
            if app is None:
                return PaginatedResult(items=[], total=0, page=query.page, per_page=query.limit)
            return self._page([app], total=1, page=1, limit=1)
        result = self._query_rows(context, access, query, page=query.page)
        return self._page(
            _listable(result.items) if result else [],
            total=result.total if result else 0,
            page=query.page,
            limit=query.limit,
        )

    def _account_apps(self, login: AppListLogin, query: AppDiscoveryQuery) -> PaginatedResult[AppDiscoveryEntry]:
        """Without a workspace: each workspace's list, joined in workspace order, then paged."""
        if login.workspace_id is not None:
            return self.list_apps(login.caller.in_workspace(login.workspace_id), query)
        contexts = [
            login.caller.in_workspace(w) for w in self._workspaces.member_workspace_ids(login.caller.account_id)
        ]
        start = (query.page - 1) * query.limit
        stop = start + query.limit
        app_id = _app_id_in(query.name)
        if app_id is not None:
            found = [
                app
                for context in contexts
                if (app := self._visible_app(context, self._visibility(context), app_id)) is not None
            ]
            return self._page(found[start:stop], total=len(found), page=query.page, limit=query.limit)
        rows: list[AppSummary] = []
        total = 0
        for context in contexts:
            access = self._visibility(context)
            counted = self._query_rows(context, access, query, page=1, limit=1)
            count = counted.total if counted else 0
            low, high = max(start - total, 0), min(stop - total, count)
            if low < high:
                rows += self._rows_between(context, access, query, low, high)
            total += count
        return self._page(_listable(rows), total=total, page=query.page, limit=query.limit)

    def _workspace_token_apps(
        self, login: AppListLogin, query: AppDiscoveryQuery
    ) -> PaginatedResult[AppDiscoveryEntry]:
        if login.workspace_id is None:
            raise ValueError("a workspace token always has its workspace")
        return self.list_apps(login.caller.in_workspace(login.workspace_id), query)

    def _external_apps(self, login: AppListLogin, query: AppDiscoveryQuery) -> PaginatedResult[AppDiscoveryEntry]:
        """An external SSO login belongs to no workspace: admission refuses one that names a workspace."""
        return self.list_permitted_apps(query)

    def _no_apps(self, login: AppListLogin, query: AppDiscoveryQuery) -> PaginatedResult[AppDiscoveryEntry]:
        """A knowledge-agent login reads only knowledge bases: it may use no app."""
        return PaginatedResult(items=[], total=0, page=query.page, per_page=query.limit)

    def _visibility(self, context: RequestContext) -> AppAccessFilter:
        if context.resource_app_ids is not None:
            return AppAccessFilter.unrestricted()
        return self._access.visibility(context)

    def _visible_app(self, context: RequestContext, access: AppAccessFilter, app_id: str) -> AppSummary | None:
        app = self._apps.find_visible_app(app_id, context.active_workspace_id)
        if (
            app is None
            or (context.resource_app_ids is not None and app.id not in context.resource_app_ids)
            or app.mode not in SUPPORTED_APP_TYPES
            or not scope_admits(context.personal_app_ids, app.id)
            or not access.is_app_accessible(app.id, app.maintainer, context.account_id)
        ):
            return None
        return app

    def _query_rows(
        self,
        context: RequestContext,
        access: AppAccessFilter,
        query: AppDiscoveryQuery,
        *,
        page: int,
        limit: int | None = None,
    ) -> PaginatedResult[AppSummary] | None:
        """One page of the workspace's query rows, before modes the list does not show are dropped."""
        params = AppListParams.model_validate(
            {
                "page": page,
                "limit": query.limit if limit is None else limit,
                "mode": query.mode or "all",
                "name": query.name,
                "status": AppStatus.NORMAL,
                "openapi_visible": True,
                "resource_ids": None if context.personal_app_ids is UNRESTRICTED else list(context.personal_app_ids),
            }
        )
        access.apply_to_params(params)
        if context.resource_app_ids is not None:
            params.resource_app_ids = sorted(context.resource_app_ids)
        return self._apps.query_apps(context.account_id, context.active_workspace_id, params)

    def _rows_between(
        self, context: RequestContext, access: AppAccessFilter, query: AppDiscoveryQuery, low: int, high: int
    ) -> list[AppSummary]:
        """Query rows low..high-1 of one workspace, read in pages of the request's own size."""
        first, last = low // query.limit + 1, (high - 1) // query.limit + 1
        rows: list[AppSummary] = []
        for page in range(first, last + 1):
            result = self._query_rows(context, access, query, page=page)
            rows += result.items if result else []
        offset = (first - 1) * query.limit
        return rows[low - offset : high - offset]

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


def _app_id_in(name: str | None) -> str | None:
    """An app id given as the name filter, in canonical form; None for any other name."""
    if not name:
        return None
    try:
        return str(UUID(name))
    except ValueError:
        return None


def _listable(apps: Sequence[AppSummary]) -> list[AppSummary]:
    return [app for app in apps if app.mode in SUPPORTED_APP_TYPES]
