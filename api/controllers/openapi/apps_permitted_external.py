"""GET /openapi/v1/permitted-external-apps — external-subject app discovery (EE only).

`dfoe_` (External SSO) callers reach apps gated by ACL access-mode
(public / sso_verified). License-gated: CE deploys never enable the
EE blueprint chain so this module is unreachable there.
"""

from __future__ import annotations

from flask_restx import Resource

from controllers.openapi import openapi_ns
from controllers.openapi._contract import accepts, returns
from controllers.openapi._models import (
    AppListRow,
    PermittedExternalAppsListQuery,
    PermittedExternalAppsListResponse,
)
from controllers.openapi.auth.composition import auth_router
from controllers.openapi.auth.data import AuthData, Edition
from extensions.ext_database import db
from libs.oauth_bearer import Scope, TokenType
from models import App
from services.account_service import TenantService
from services.app_service import AppService
from services.enterprise.app_permitted_service import list_permitted_apps


@openapi_ns.route("/permitted-external-apps")
class PermittedExternalAppsListApi(Resource):
    @auth_router.guard(
        scope=Scope.APPS_READ_PERMITTED_EXTERNAL,
        allowed_token_types=frozenset({TokenType.OAUTH_EXTERNAL_SSO}),
        edition=frozenset({Edition.EE}),
    )
    @returns(200, PermittedExternalAppsListResponse, description="Permitted external apps list")
    @accepts(query=PermittedExternalAppsListQuery)
    def get(self, *, auth_data: AuthData, query: PermittedExternalAppsListQuery):
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
            str(a.id): a for a in AppService.find_visible_apps_by_ids(db.session, page_result.app_ids)
        }
        tenant_ids = list({str(a.tenant_id) for a in apps_by_id.values()})
        tenants_by_id = {str(t.id): t for t in TenantService.get_tenants_by_ids(db.session, tenant_ids)}

        items: list[AppListRow] = []
        for app_id in page_result.app_ids:
            app = apps_by_id.get(app_id)
            if not app or app.status != "normal":
                continue
            tenant = tenants_by_id.get(str(app.tenant_id))
            items.append(
                AppListRow(
                    id=str(app.id),
                    name=app.name,
                    description=app.description,
                    mode=app.mode,
                    tags=[],  # tenant-scoped; not surfaced cross-tenant
                    updated_at=app.updated_at.isoformat() if app.updated_at else None,
                    created_by_name=None,  # cross-tenant author leak prevention
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
