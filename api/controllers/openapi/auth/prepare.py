from __future__ import annotations

from werkzeug.exceptions import Forbidden, InternalServerError, NotFound, Unauthorized

from controllers.openapi.auth.data import AuthData
from core.app.entities.app_invoke_entities import InvokeFrom
from extensions.ext_database import db
from models.account import TenantStatus
from services.account_service import AccountService, TenantService
from services.app_service import AppService
from services.end_user_service import EndUserService
from services.enterprise.enterprise_service import EnterpriseService, WebAppAccessMode


def load_app(data: AuthData) -> None:
    app_id = data.path_params["app_id"]
    app = AppService.get_app_by_id(db.session, app_id)
    if not app or app.status != "normal":
        raise NotFound("app not found")
    if not app.enable_api:
        raise Forbidden("service_api_disabled")
    data.app = app


def load_tenant(data: AuthData) -> None:
    if data.app is None:
        raise InternalServerError("pipeline_invariant_violated: app not loaded before load_tenant")
    tenant = TenantService.get_tenant_by_id(db.session, str(data.app.tenant_id))
    if tenant is None or tenant.status == TenantStatus.ARCHIVE:
        raise Forbidden("workspace unavailable")
    data.tenant = tenant


def load_account(data: AuthData) -> None:
    account = AccountService.get_account_by_id(db.session, str(data.account_id))
    if account is None:
        raise Unauthorized("account not found")
    if data.tenant:
        account.current_tenant = data.tenant
    data.caller = account
    data.caller_kind = "account"


def resolve_external_user(data: AuthData) -> None:
    if data.tenant is None or data.app is None or data.external_identity is None:
        raise Unauthorized("missing context for external user resolution")
    end_user = EndUserService.get_or_create_end_user_by_type(
        InvokeFrom.OPENAPI,
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
