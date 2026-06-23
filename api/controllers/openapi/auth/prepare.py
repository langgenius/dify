from __future__ import annotations

import uuid

from flask import request
from werkzeug.exceptions import Forbidden, InternalServerError, NotFound, Unauthorized

from controllers.openapi.auth.data import AuthData
from extensions.ext_database import db
from models.account import TenantStatus
from models.enums import EndUserType
from services.account_service import AccountService, TenantService
from services.app_service import AppService
from services.end_user_service import EndUserService
from services.enterprise.enterprise_service import EnterpriseService, WebAppAccessMode


def load_app(data: AuthData) -> None:
    if data.app is not None:
        return
    app_id = data.path_params["app_id"]
    try:
        uuid.UUID(app_id)
    except ValueError:
        raise NotFound("app not found")
    app = AppService.get_app_by_id(db.session, app_id)
    if not app or app.status != "normal":
        raise NotFound("app not found")
    data.app = app


def load_tenant(data: AuthData) -> None:
    if data.tenant is not None:
        return
    if data.app is None:
        raise InternalServerError("pipeline_invariant_violated: app not loaded before load_tenant")
    tenant = TenantService.get_tenant_by_id(db.session, str(data.app.tenant_id))
    if tenant is None or tenant.status == TenantStatus.ARCHIVE:
        raise Forbidden("workspace unavailable")
    data.tenant = tenant


def load_tenant_from_request(data: AuthData) -> None:
    if data.tenant is not None:
        return
    workspace_id = data.path_params.get("workspace_id") or request.args.get("workspace_id")
    if not workspace_id:
        raise NotFound("workspace not found")
    try:
        uuid.UUID(workspace_id)
    except ValueError:
        raise NotFound("workspace not found")
    tenant = TenantService.get_tenant_by_id(db.session, workspace_id)
    if tenant is None or tenant.status == TenantStatus.ARCHIVE:
        raise NotFound("workspace not found")
    data.tenant = tenant


def load_account(data: AuthData) -> None:
    if data.caller is not None:
        return
    account = AccountService.get_account_by_id(db.session, str(data.account_id))
    if account is None:
        raise Unauthorized("account not found")
    if data.tenant:
        account.current_tenant = data.tenant
    data.caller = account
    data.caller_kind = "account"


def load_workspace_role(data: AuthData) -> None:
    if data.tenant_role is not None:
        return
    if data.tenant is None or data.account_id is None:
        return
    if data.caller is not None and getattr(data.caller, "status", None) != "active":
        return
    role = TenantService.get_account_role_in_tenant(db.session, str(data.account_id), str(data.tenant.id))
    if role is None:
        return
    data.tenant_role = role


def resolve_external_user(data: AuthData) -> None:
    if data.tenant is None or data.app is None or data.external_identity is None:
        raise Unauthorized("missing context for external user resolution")
    end_user = EndUserService.get_or_create_end_user_by_type(
        EndUserType.OPENAPI,
        tenant_id=str(data.tenant.id),
        app_id=str(data.app.id),
        user_id=data.external_identity.email,
    )
    data.caller = end_user
    data.caller_kind = "end_user"


def load_app_access_mode(data: AuthData) -> None:
    if data.app is None:
        return
    try:
        settings = EnterpriseService.WebAppAuth.get_app_access_mode_by_id(app_id=str(data.app.id))
        if settings is None:
            data.app_access_mode = None
            return
        data.app_access_mode = WebAppAccessMode(settings.access_mode)
    except ValueError:
        data.app_access_mode = None
