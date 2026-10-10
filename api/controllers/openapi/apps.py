"""GET /openapi/v1/apps and per-app reads."""

from __future__ import annotations

from http import HTTPStatus

from flask_restx import Resource
from werkzeug.exceptions import NotFound

from constants.oauth_bearer import Scope
from controllers.common.rbac import PlainApp, RBACCheck, RBACPermission
from controllers.openapi import openapi_ns
from controllers.openapi._app_response import app_list_row, build_app_describe_response
from controllers.openapi._contract import Example, Kind, endpoint
from controllers.openapi._models import AppDescribeQuery, AppDescribeResponse, AppListQuery, AppListResponse
from controllers.openapi.auth.requirements import (
    CheckAppApiEnabled,
    CheckRBACPermission,
    CheckScope,
    CheckSubject,
    CheckWorkspaceMember,
)
from controllers.openapi.auth.subjects import AccountSubject, ResourceAccessSubject
from extensions.ext_application_services import application_services
from machinery.context import AppRequestContext, RequestContext
from services.app.query_service import AppDiscoveryQuery
from services.errors.app import AppDiscoveryNotFoundError


@openapi_ns.route("/apps/<string:app_id>")
class AppDescribeApi(Resource):
    @endpoint(
        context="app",
        op="describe.console_app",
        kind=Kind.OBJECT,
        summary="App detail, parameters and runtime input_schema",
        examples=(
            Example(title="Describe an app: info, parameters and input_schema", input={"app_id": "<app_id>"}),
            Example(
                title="Only the runtime input_schema of an app",
                input={"app_id": "<app_id>", "fields": "input_schema"},
            ),
        ),
        requirements=(
            CheckSubject(allowed=(AccountSubject, ResourceAccessSubject)),
            CheckAppApiEnabled(),
            CheckWorkspaceMember(),
            CheckScope(Scope.APPS_READ),
            CheckRBACPermission(RBACCheck(RBACPermission.APP_VIEW_LAYOUT, PlainApp())),
        ),
        query=AppDescribeQuery,
        returns=(200, AppDescribeResponse, "App description"),
    )
    def get(self, ctx: AppRequestContext, app_id: str, *, query: AppDescribeQuery):
        try:
            result = application_services().apps.discovery.describe(ctx, query.fields)
        except AppDiscoveryNotFoundError as exc:
            raise NotFound(str(exc)) from exc
        return build_app_describe_response(result, query.fields)


@openapi_ns.route("/apps")
class AppListApi(Resource):
    @endpoint(
        context="workspace",
        op="get.console_app",
        kind=Kind.LIST,
        summary="List apps in a workspace",
        examples=(
            Example(title="List apps in the pinned workspace, first page", input={"page": 1, "limit": 20}),
            Example(
                title="Find workflow apps whose name contains a word",
                input={"mode": "workflow", "name": "summary"},
            ),
        ),
        requirements=(
            CheckSubject(allowed=(AccountSubject, ResourceAccessSubject)),
            CheckScope(Scope.APPS_READ),
            CheckWorkspaceMember(),
        ),
        query=AppListQuery,
        returns=(HTTPStatus.OK, AppListResponse, "App list"),
    )
    def get(self, ctx: RequestContext, *, query: AppListQuery):
        result = application_services().apps.discovery.list_apps(
            ctx, AppDiscoveryQuery(query.page, query.limit, query.mode.value if query.mode else None, query.name)
        )
        return AppListResponse.build(
            page=result.page,
            limit=result.per_page,
            total=result.total,
            items=[app_list_row(entry) for entry in result.items],
        )
