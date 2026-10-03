"""Adapt machine credential authentication and authorization to OpenAPI admission."""

import uuid
from typing import override

from flask import request
from sqlalchemy.orm import Session
from werkzeug.exceptions import Forbidden, Unauthorized

from controllers.common.resource_access_token_errors import resource_access_token_errors
from controllers.openapi.auth.context import Context
from controllers.openapi.auth.requirements import Rank, Requirement
from controllers.openapi.auth.subjects import Subject
from extensions.ext_application_services import application_services
from libs.oauth_bearer import AuthContext, TokenType, sha256_hex
from libs.rate_limit import enforce_bearer_rate_limit
from models.account import TenantStatus
from models.enums import AppStatus
from services.app_service import AppService
from services.auth.resource_access_token_contracts import ResourceAccessTokenInvalidError


def authenticate_resource_token(token: str) -> AuthContext:
    enforce_bearer_rate_limit(sha256_hex(token))
    try:
        access = application_services().resource_access_tokens.authenticate(token)
    except ResourceAccessTokenInvalidError as error:
        raise Unauthorized("invalid_bearer") from error
    return AuthContext(
        subject_email=None,
        subject_issuer=None,
        account_id=None,
        client_id=None,
        token_id=uuid.UUID(access.token_id),
        token_type=TokenType.RESOURCE_ACCESS,
        expires_at=None,
    )


class CheckResourceAccess(Requirement):
    """Load ORM context only after the service has authorized live bindings."""

    rank = Rank.FIRST

    @override
    def run(self, subject: Subject, ctx: Context, session: Session) -> None:
        app_id = ctx.view_args.get("app_id")
        with resource_access_token_errors():
            grant = application_services().resource_access_tokens.authorize_openapi(
                token_id=str(subject.token_id),
                workspace_id=ctx.view_args.get("workspace_id") or request.args.get("workspace_id"),
                app_id=app_id,
            )
        # The current OpenAPI pipeline still needs ORM context. Reconstruct it
        # within admission's session using the authorized owner chain.
        tenant = application_services().workspaces.identity.get_workspace(grant.tenant_id)
        if tenant is None or tenant.status != TenantStatus.NORMAL:
            raise Forbidden("workspace unavailable")
        ctx._workspace = tenant
        ctx.resource_app_ids = grant.app_ids
        if app_id:
            app = AppService.get_app_in_workspace(tenant_id=grant.tenant_id, app_id=app_id, session=session)
            if app is None or app.status != AppStatus.NORMAL or not app.enable_api:
                raise Forbidden("resource_not_authorized")
            ctx._app = app
