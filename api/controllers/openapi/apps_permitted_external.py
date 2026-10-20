"""GET /openapi/v1/permitted-external-apps — external-subject app discovery (EE only).

`dfoe_` (External SSO) callers reach apps gated by ACL access-mode
(public / sso_verified). License-gated: CE deploys never enable the
EE blueprint chain so this module is unreachable there.
"""

from __future__ import annotations

from http import HTTPStatus

from flask_restx import Resource
from werkzeug.exceptions import NotFound, ServiceUnavailable

from constants.oauth_bearer import Scope
from controllers.openapi import openapi_ns
from controllers.openapi._app_response import app_list_row, build_app_describe_response
from controllers.openapi._contract import Example, Kind, endpoint
from controllers.openapi._models import (
    AppDescribeQuery,
    AppDescribeResponse,
    PermittedExternalAppsListQuery,
    PermittedExternalAppsListResponse,
)
from controllers.openapi.auth.requirements import (
    CheckAppAccess,
    CheckAppApiEnabled,
    CheckScope,
    CheckSubject,
)
from controllers.openapi.auth.subjects import ExternalSsoSubject
from enums import DeploymentEdition
from extensions.ext_application_services import application_services
from machinery.context import AppRequestContext
from services.app.query_service import AppDiscoveryQuery
from services.errors.app import AppDiscoveryNotFoundError, PermittedAppsUnavailableError

_ENTERPRISE_ONLY = frozenset({DeploymentEdition.ENTERPRISE})


@openapi_ns.route("/permitted-external-apps")
class PermittedExternalAppsListApi(Resource):
    @endpoint(
        context=None,
        op="get.console_app.external",
        kind=Kind.LIST,
        summary="List apps an external SSO subject may run",
        examples=(Example(title="List the apps this SSO subject may run, first page", input={"page": 1, "limit": 20}),),
        requirements=(
            CheckSubject(allowed=(ExternalSsoSubject,)),
            CheckScope(Scope.APPS_READ_PERMITTED_EXTERNAL),
        ),
        query=PermittedExternalAppsListQuery,
        returns=(HTTPStatus.OK, PermittedExternalAppsListResponse, "Permitted external apps list"),
        edition=_ENTERPRISE_ONLY,
    )
    def get(self, *, query: PermittedExternalAppsListQuery):
        try:
            result = application_services().apps.discovery.list_permitted_apps(
                AppDiscoveryQuery(query.page, query.limit, query.mode.value if query.mode else None, query.name)
            )
        except PermittedAppsUnavailableError as exc:
            raise ServiceUnavailable(str(exc)) from exc
        return PermittedExternalAppsListResponse.build(
            page=result.page,
            limit=result.per_page,
            total=result.total,
            items=[app_list_row(entry) for entry in result.items],
        )


@openapi_ns.route("/permitted-external-apps/<string:app_id>")
class PermittedExternalAppDescribeApi(Resource):
    @endpoint(
        context="app",
        op="describe.console_app.external",
        kind=Kind.OBJECT,
        summary="External-subject app detail",
        examples=(Example(title="Describe a permitted app with its input_schema", input={"app_id": "<app_id>"}),),
        requirements=(
            CheckSubject(allowed=(ExternalSsoSubject,)),
            CheckAppApiEnabled(),
            CheckScope(Scope.APPS_READ_PERMITTED_EXTERNAL),
            CheckAppAccess(),
        ),
        query=AppDescribeQuery,
        returns=(200, AppDescribeResponse, "Permitted external app description"),
        edition=_ENTERPRISE_ONLY,
    )
    def get(self, ctx: AppRequestContext, app_id: str, *, query: AppDescribeQuery):
        try:
            result = application_services().apps.discovery.describe(ctx, query.fields)
        except AppDiscoveryNotFoundError as exc:
            raise NotFound(str(exc)) from exc
        return build_app_describe_response(result, query.fields)
