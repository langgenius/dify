"""GET /openapi/v1/permitted-external-apps — external-subject app discovery (EE only).

`dfoe_` (External SSO) callers reach apps gated by ACL access-mode
(public / sso_verified). License-gated: CE deploys never enable the
EE blueprint chain so this module is unreachable there.
"""

from __future__ import annotations

from flask_restx import Resource

from controllers.openapi import openapi_ns
from controllers.openapi._contract import endpoint
from controllers.openapi._models import (
    AppDescribeQuery,
    AppDescribeResponse,
    AppListRow,
    PermittedExternalAppsListQuery,
    PermittedExternalAppsListResponse,
)
from controllers.openapi.apps import build_app_describe_response
from controllers.openapi.auth.context import Context
from controllers.openapi.auth.requirements import RequireWebappAccess, SubjectCheck, TokenScope
from controllers.openapi.auth.subjects import ExternalSsoSubject
from enums import DeploymentEdition
from libs.oauth_bearer import Scope
from models import App
from models.enums import AppStatus
from services.account_service import TenantService
from services.app_service import AppService
from services.enterprise.app_permitted_service import list_permitted_apps

_EXTERNAL_SUBJECT = SubjectCheck(allowed=(ExternalSsoSubject,))
_ENTERPRISE_ONLY = frozenset({DeploymentEdition.ENTERPRISE})


@openapi_ns.route("/permitted-external-apps")
class PermittedExternalAppsListApi(Resource):
    @endpoint(
        requirements=(
            _EXTERNAL_SUBJECT,
            TokenScope(Scope.APPS_READ_PERMITTED_EXTERNAL),
        ),
        query=PermittedExternalAppsListQuery,
        returns=(200, PermittedExternalAppsListResponse, "Permitted external apps list"),
        edition=_ENTERPRISE_ONLY,
        write=False,
    )
    def get(self, ctx: Context, *, query: PermittedExternalAppsListQuery):
        page_result = list_permitted_apps(
            page=query.page,
            limit=query.limit,
            mode=query.mode.value if query.mode else None,
            name=query.name,
        )

        if not page_result.app_ids:
            env = PermittedExternalAppsListResponse(
                page=query.page, limit=query.limit, total=page_result.total, has_more=False, data=[]
            )
            return env

        apps_by_id: dict[str, App] = {
            str(a.id): a for a in AppService.find_visible_apps_by_ids(page_result.app_ids, ctx.session)
        }
        tenant_ids = list({str(a.tenant_id) for a in apps_by_id.values()})
        tenants_by_id = {str(t.id): t for t in TenantService.get_tenants_by_ids(tenant_ids, session=ctx.session)}

        items: list[AppListRow] = []
        for app_id in page_result.app_ids:
            app = apps_by_id.get(app_id)
            if not app or app.status != AppStatus.NORMAL:
                continue
            tenant = tenants_by_id.get(str(app.tenant_id))
            items.append(
                AppListRow(
                    id=str(app.id),
                    name=app.name,
                    description=app.description,
                    mode=app.mode,
                    updated_at=app.updated_at.isoformat() if app.updated_at else None,
                    workspace_id=str(app.tenant_id),
                    workspace_name=tenant.name if tenant else None,
                )
            )
        env = PermittedExternalAppsListResponse(
            page=query.page,
            limit=query.limit,
            total=page_result.total,
            has_more=query.page * query.limit < page_result.total,
            data=items,
        )
        return env


@openapi_ns.route("/permitted-external-apps/<string:app_id>")
class PermittedExternalAppDescribeApi(Resource):
    @endpoint(
        requirements=(
            _EXTERNAL_SUBJECT,
            TokenScope(Scope.APPS_READ_PERMITTED_EXTERNAL),
            RequireWebappAccess(),
        ),
        query=AppDescribeQuery,
        returns=(200, AppDescribeResponse, "Permitted external app description"),
        edition=_ENTERPRISE_ONLY,
        write=False,
    )
    def get(self, ctx: Context, app_id: str, *, query: AppDescribeQuery):
        # The pipeline has already loaded and ACL-checked the app; project it.
        return build_app_describe_response(ctx.app, query.fields, session=ctx.session)
