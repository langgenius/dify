"""GET /openapi/v1/permitted-external-apps — external-subject app discovery (EE only).

`dfoe_` (External SSO) callers reach apps gated by ACL access-mode
(public / sso_verified). License-gated: CE deploys never enable the
EE blueprint chain so this module is unreachable there.
"""

from __future__ import annotations

import sqlalchemy as sa
from flask import request
from flask_restx import Resource
from pydantic import ValidationError
from werkzeug.exceptions import UnprocessableEntity

from controllers.openapi import openapi_ns
from controllers.openapi._models import (
    AppListRow,
    PermittedExternalAppsListQuery,
    PermittedExternalAppsListResponse,
)
from controllers.openapi.auth.surface_gate import accept_subjects
from extensions.ext_database import db
from libs.device_flow_security import enterprise_only
from libs.oauth_bearer import (
    ACCEPT_USER_ANY,
    Scope,
    SubjectType,
    require_scope,
    validate_bearer,
)
from models import App, Tenant
from services.enterprise.app_permitted_service import list_permitted_apps
from services.openapi.license_gate import license_required
from services.openapi.visibility import apply_openapi_gate


@openapi_ns.route("/permitted-external-apps")
class PermittedExternalAppsListApi(Resource):
    # method_decorators applies left-to-right innermost-first; execution
    # flows enterprise_only → validate_bearer → accept_subjects →
    # license_required → require_scope → handler. validate_bearer is
    # widened to ACCEPT_USER_ANY so accept_subjects can emit the
    # `openapi.wrong_surface_denied` audit on dfoa_→external misses
    # instead of validate_bearer rejecting silently with "subject type
    # not accepted here".
    method_decorators = [
        require_scope(Scope.APPS_READ_PERMITTED_EXTERNAL),
        license_required,
        accept_subjects(SubjectType.EXTERNAL_SSO),
        validate_bearer(accept=ACCEPT_USER_ANY),
        enterprise_only,
    ]

    @openapi_ns.response(
        200, "Permitted external apps list", openapi_ns.models[PermittedExternalAppsListResponse.__name__]
    )
    def get(self):
        try:
            query = PermittedExternalAppsListQuery.model_validate(request.args.to_dict(flat=True))
        except ValidationError as exc:
            raise UnprocessableEntity(exc.json())

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
            return env.model_dump(mode="json"), 200

        apps_by_id = {
            str(a.id): a
            for a in db.session.execute(apply_openapi_gate(sa.select(App).where(App.id.in_(page_result.app_ids))))
            .scalars()
            .all()
        }
        tenant_ids = list({a.tenant_id for a in apps_by_id.values()})
        tenants_by_id = {
            str(t.id): t for t in db.session.execute(sa.select(Tenant).where(Tenant.id.in_(tenant_ids))).scalars().all()
        }

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

        # total/has_more reflect the EE-side allow-list; len(items) may be < limit when local rows are dropped.
        env = PermittedExternalAppsListResponse(
            page=query.page,
            limit=query.limit,
            total=page_result.total,
            has_more=query.page * query.limit < page_result.total,
            data=items,
        )
        return env.model_dump(mode="json"), 200
