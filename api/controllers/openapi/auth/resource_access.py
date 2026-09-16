"""Resource-token authentication and live resource authorization for OpenAPI.

Machine credentials never inherit their creator's account or workspace role.
Re-read bindings on every request so revocation takes effect without cache lag.
"""

import uuid

from flask import request
from sqlalchemy import select
from werkzeug.exceptions import Forbidden, Unauthorized

from controllers.openapi.auth.data import AuthData, CallerKind
from core.db.session_factory import session_factory
from libs.datetime_utils import naive_utc_now
from libs.oauth_bearer import AuthContext, Scope, SubjectType, TokenType, sha256_hex
from libs.rate_limit import enforce_bearer_rate_limit
from models.account import Tenant, TenantStatus
from models.enums import AppStatus, EndUserType
from models.model import App
from models.resource_access_token import (
    ResourceAccessToken,
    ResourceAccessTokenRelation,
    ResourceAccessTokenResourceType,
)
from services.end_user_service import EndUserService


def authenticate_resource_token(token: str) -> AuthContext:
    token_hash = sha256_hex(token)
    enforce_bearer_rate_limit(token_hash)
    with session_factory.create_session() as session:
        row = session.scalar(select(ResourceAccessToken).where(ResourceAccessToken.token == token))
        if row is None:
            raise Unauthorized("invalid_bearer")
        token_id = uuid.UUID(str(row.id))
    return AuthContext(
        subject_type=SubjectType.RESOURCE_ACCESS,
        subject_email=None,
        subject_issuer=None,
        account_id=None,
        client_id=None,
        scopes=frozenset({Scope.WORKSPACE_READ, Scope.APPS_READ, Scope.APPS_RUN}),
        token_id=token_id,
        token_type=TokenType.RESOURCE_ACCESS,
        expires_at=None,
        token_hash=token_hash,
    )


def prepare_resource_access(data: AuthData) -> None:
    with session_factory.create_session() as session:
        row = session.scalar(select(ResourceAccessToken).where(ResourceAccessToken.id == str(data.token_id)))
        if row is None:
            raise Unauthorized("invalid_bearer")
        tenant = session.get(Tenant, row.tenant_id)
        if tenant is None or tenant.status != TenantStatus.NORMAL:
            raise Forbidden("workspace unavailable")
        workspace_id = data.path_params.get("workspace_id") or request.args.get("workspace_id")
        if workspace_id and workspace_id != str(tenant.id):
            raise Forbidden("resource_not_authorized")
        data.tenant = tenant
        data.resource_app_ids = frozenset(
            session.scalars(
                select(App.id)
                .join(ResourceAccessTokenRelation, ResourceAccessTokenRelation.app_id == App.id)
                .where(
                    ResourceAccessTokenRelation.token_id == row.id,
                    ResourceAccessTokenRelation.resource_type == ResourceAccessTokenResourceType.APP,
                    App.tenant_id == tenant.id,
                )
            )
        )
        app_id = data.path_params.get("app_id")
        if app_id:
            if app_id not in data.resource_app_ids:
                raise Forbidden("resource_not_authorized")
            app = session.scalar(select(App).where(App.id == app_id, App.tenant_id == tenant.id))
            if app is None or app.status != AppStatus.NORMAL or not app.enable_api:
                raise Forbidden("resource_not_authorized")
            data.app = app
        row.last_used_at = naive_utc_now()
        # Keep the authorized context detached across the write transaction.
        session.expunge(tenant)
        if data.app is not None:
            session.expunge(data.app)
        session.commit()
    if data.app is not None:
        data.caller = EndUserService.get_or_create_end_user_by_type(
            EndUserType.OPENAPI,
            tenant_id=str(tenant.id),
            app_id=str(data.app.id),
            user_id=f"resource-token:{data.token_id}",
        )
        data.caller_kind = CallerKind.END_USER
