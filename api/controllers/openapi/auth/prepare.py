from __future__ import annotations

from werkzeug.exceptions import Forbidden, NotFound, Unauthorized

from controllers.openapi.auth.data import ExternalIdentity
from core.app.entities.app_invoke_entities import InvokeFrom
from extensions.ext_database import db
from models.account import TenantStatus
from services.account_service import AccountService, TenantService
from services.app_service import AppService
from services.end_user_service import EndUserService
from services.enterprise.enterprise_service import EnterpriseService, WebAppAccessMode


def build_external_identity(builder: dict) -> None:
    email = builder.pop("_subject_email", None)
    issuer = builder.pop("_subject_issuer", None)
    if email:
        builder["external_identity"] = ExternalIdentity(email=email, issuer=issuer)


def load_app(builder: dict) -> None:
    app_id = builder["path_params"]["app_id"]
    app = AppService.get_app_by_id(db.session, app_id)
    if not app or app.status != "normal":
        raise NotFound("app not found")
    if not app.enable_api:
        raise Forbidden("service_api_disabled")
    builder["app"] = app


def load_tenant(builder: dict) -> None:
    app = builder["app"]
    tenant = TenantService.get_tenant_by_id(db.session, str(app.tenant_id))
    if tenant is None or tenant.status == TenantStatus.ARCHIVE:
        raise Forbidden("workspace unavailable")
    builder["tenant"] = tenant


def load_account(builder: dict) -> None:
    account = AccountService.get_account_by_id(db.session, str(builder["account_id"]))
    if account is None:
        raise Unauthorized("account not found")
    tenant = builder.get("tenant")
    if tenant:
        account.current_tenant = tenant
    builder["caller"] = account
    builder["caller_kind"] = "account"


def resolve_external_user(builder: dict) -> None:
    tenant = builder.get("tenant")
    app = builder.get("app")
    ext: ExternalIdentity | None = builder.get("external_identity")
    if not all([tenant, app, ext]):
        raise Unauthorized("missing context for external user resolution")
    end_user = EndUserService.get_or_create_end_user_by_type(
        InvokeFrom.OPENAPI,
        tenant_id=str(tenant.id),  # type: ignore[union-attr]
        app_id=str(app.id),  # type: ignore[union-attr]
        user_id=ext.email,  # type: ignore[union-attr]
    )
    builder["caller"] = end_user
    builder["caller_kind"] = "end_user"


def load_app_access_mode(builder: dict) -> None:
    app = builder.get("app")
    if app is None:
        return
    try:
        settings = EnterpriseService.WebAppAuth.get_app_access_mode_by_id(app_id=str(app.id))
        if settings is None:
            builder["app_access_mode"] = None
            return
        builder["app_access_mode"] = WebAppAccessMode(settings.access_mode)
    except ValueError:
        builder["app_access_mode"] = None
