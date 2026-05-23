"""User-scoped workspace reads under /openapi/v1/workspaces. Bearer-authed
counterparts to the cookie-authed /console/api/workspaces endpoints.

Account bearers (dfoa_) see every tenant they're a member of. External
SSO bearers (dfoe_) have no account_id and so see an empty list — that
matches /openapi/v1/account.
"""

from __future__ import annotations

from itertools import starmap

from flask_restx import Resource
from sqlalchemy import select
from werkzeug.exceptions import NotFound

from controllers.openapi import openapi_ns
from controllers.openapi._models import WorkspaceDetailResponse, WorkspaceListResponse, WorkspaceSummaryResponse
from controllers.openapi.auth.surface_gate import accept_subjects
from extensions.ext_database import db
from libs.oauth_bearer import (
    ACCEPT_USER_ANY,
    SubjectType,
    get_auth_ctx,
    validate_bearer,
)
from models import Tenant, TenantAccountJoin


@openapi_ns.route("/workspaces")
class WorkspacesApi(Resource):
    @openapi_ns.response(200, "Workspace list", openapi_ns.models[WorkspaceListResponse.__name__])
    @validate_bearer(accept=ACCEPT_USER_ANY)
    @accept_subjects(SubjectType.ACCOUNT)
    def get(self):
        ctx = get_auth_ctx()

        rows = db.session.execute(
            select(Tenant, TenantAccountJoin)
            .join(TenantAccountJoin, TenantAccountJoin.tenant_id == Tenant.id)
            .where(TenantAccountJoin.account_id == str(ctx.account_id))
            .order_by(Tenant.created_at.asc())
        ).all()

        return WorkspaceListResponse(workspaces=list(starmap(_workspace_summary, rows))).model_dump(mode="json"), 200


@openapi_ns.route("/workspaces/<string:workspace_id>")
class WorkspaceByIdApi(Resource):
    @openapi_ns.response(200, "Workspace detail", openapi_ns.models[WorkspaceDetailResponse.__name__])
    @validate_bearer(accept=ACCEPT_USER_ANY)
    @accept_subjects(SubjectType.ACCOUNT)
    def get(self, workspace_id: str):
        ctx = get_auth_ctx()

        row = db.session.execute(
            select(Tenant, TenantAccountJoin)
            .join(TenantAccountJoin, TenantAccountJoin.tenant_id == Tenant.id)
            .where(
                Tenant.id == workspace_id,
                TenantAccountJoin.account_id == str(ctx.account_id),
            )
        ).first()
        # 404 (not 403) on non-member so workspace IDs don't leak across tenants.
        if row is None:
            raise NotFound("workspace not found")

        tenant, membership = row
        return _workspace_detail(tenant, membership).model_dump(mode="json"), 200


def _workspace_summary(tenant: Tenant, membership: TenantAccountJoin) -> WorkspaceSummaryResponse:
    return WorkspaceSummaryResponse(
        id=str(tenant.id),
        name=tenant.name,
        role=getattr(membership, "role", ""),
        status=tenant.status,
        current=getattr(membership, "current", False),
    )


def _workspace_detail(tenant: Tenant, membership: TenantAccountJoin) -> WorkspaceDetailResponse:
    return WorkspaceDetailResponse(
        id=str(tenant.id),
        name=tenant.name,
        role=getattr(membership, "role", ""),
        status=tenant.status,
        current=getattr(membership, "current", False),
        created_at=tenant.created_at.isoformat() if tenant.created_at else None,
    )
