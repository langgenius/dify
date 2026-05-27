import uuid
from unittest.mock import MagicMock, patch

import pytest
from werkzeug.exceptions import Forbidden, NotFound, Unauthorized

from controllers.openapi.auth.data import AuthData, ExternalIdentity
from controllers.openapi.auth.prepare import (
    load_account,
    load_app,
    load_app_access_mode,
    load_tenant,
    resolve_external_user,
)
from libs.oauth_bearer import TokenType


def _make_auth_data(**kwargs) -> AuthData:
    mock_fields = {k: kwargs.pop(k) for k in ("app", "tenant", "caller") if k in kwargs}
    data = AuthData(
        token_type=kwargs.pop("token_type", TokenType.OAUTH_ACCOUNT),
        token_hash=kwargs.pop("token_hash", "testhash"),
        scopes=kwargs.pop("scopes", frozenset()),
        **kwargs,
    )
    for k, v in mock_fields.items():
        setattr(data, k, v)
    return data


def test_load_app_writes_app_to_data():
    app = MagicMock()
    app.status = "normal"
    app.enable_api = True
    data = _make_auth_data(path_params={"app_id": "abc"})
    with patch("controllers.openapi.auth.prepare.AppService.get_app_by_id", return_value=app):
        load_app(data)
    assert data.app is app


def test_load_app_raises_not_found_when_missing():
    data = _make_auth_data(path_params={"app_id": "missing"})
    with patch("controllers.openapi.auth.prepare.AppService.get_app_by_id", return_value=None):
        with pytest.raises(NotFound):
            load_app(data)


def test_load_app_raises_not_found_when_not_normal():
    app = MagicMock()
    app.status = "archived"
    data = _make_auth_data(path_params={"app_id": "abc"})
    with patch("controllers.openapi.auth.prepare.AppService.get_app_by_id", return_value=app):
        with pytest.raises(NotFound):
            load_app(data)


def test_load_app_raises_forbidden_when_api_disabled():
    app = MagicMock()
    app.status = "normal"
    app.enable_api = False
    data = _make_auth_data(path_params={"app_id": "abc"})
    with patch("controllers.openapi.auth.prepare.AppService.get_app_by_id", return_value=app):
        with pytest.raises(Forbidden):
            load_app(data)


def test_load_tenant_writes_tenant():
    app = MagicMock()
    app.tenant_id = uuid.uuid4()
    tenant = MagicMock()
    tenant.status = "normal"
    data = _make_auth_data(app=app)
    with patch("controllers.openapi.auth.prepare.TenantService.get_tenant_by_id", return_value=tenant):
        load_tenant(data)
    assert data.tenant is tenant


def test_load_tenant_raises_forbidden_when_archived():
    from models.account import TenantStatus

    app = MagicMock()
    app.tenant_id = uuid.uuid4()
    tenant = MagicMock()
    tenant.status = TenantStatus.ARCHIVE
    data = _make_auth_data(app=app)
    with patch("controllers.openapi.auth.prepare.TenantService.get_tenant_by_id", return_value=tenant):
        with pytest.raises(Forbidden):
            load_tenant(data)


def test_load_tenant_raises_forbidden_when_missing():
    app = MagicMock()
    app.tenant_id = uuid.uuid4()
    data = _make_auth_data(app=app)
    with patch("controllers.openapi.auth.prepare.TenantService.get_tenant_by_id", return_value=None):
        with pytest.raises(Forbidden):
            load_tenant(data)


def test_load_tenant_raises_500_when_app_not_loaded():
    from werkzeug.exceptions import InternalServerError

    data = _make_auth_data()
    with pytest.raises(InternalServerError):
        load_tenant(data)


def test_load_account_writes_caller():
    account = MagicMock()
    account_id = uuid.uuid4()
    data = _make_auth_data(account_id=account_id)
    with patch("controllers.openapi.auth.prepare.AccountService.get_account_by_id", return_value=account):
        load_account(data)
    assert data.caller is account
    assert data.caller_kind == "account"


def test_load_account_sets_current_tenant_when_tenant_present():
    account = MagicMock()
    tenant = MagicMock()
    data = _make_auth_data(account_id=uuid.uuid4(), tenant=tenant)
    with patch("controllers.openapi.auth.prepare.AccountService.get_account_by_id", return_value=account):
        load_account(data)
    assert account.current_tenant is tenant


def test_load_account_raises_unauthorized_when_not_found():
    data = _make_auth_data(account_id=uuid.uuid4())
    with patch("controllers.openapi.auth.prepare.AccountService.get_account_by_id", return_value=None):
        with pytest.raises(Unauthorized):
            load_account(data)


def test_resolve_external_user_writes_caller():
    tenant = MagicMock()
    app = MagicMock()
    end_user = MagicMock()
    ext = ExternalIdentity(email="user@sso.com")
    data = _make_auth_data(tenant=tenant, app=app, external_identity=ext)
    with patch("controllers.openapi.auth.prepare.EndUserService.get_or_create_end_user_by_type", return_value=end_user):
        resolve_external_user(data)
    assert data.caller is end_user
    assert data.caller_kind == "end_user"


def test_resolve_external_user_raises_unauthorized_when_context_missing():
    data = _make_auth_data(tenant=None, app=MagicMock(), external_identity=ExternalIdentity(email="u@s.com"))
    with pytest.raises(Unauthorized):
        resolve_external_user(data)


def test_load_app_access_mode_writes_mode():
    from services.enterprise.enterprise_service import WebAppAccessMode

    app = MagicMock()
    app.id = "app-1"
    settings = MagicMock()
    settings.access_mode = "public"
    data = _make_auth_data(app=app)
    with patch(
        "controllers.openapi.auth.prepare.EnterpriseService.WebAppAuth.get_app_access_mode_by_id",
        return_value=settings,
    ):
        load_app_access_mode(data)
    assert data.app_access_mode == WebAppAccessMode.PUBLIC


def test_load_app_access_mode_writes_none_when_value_error():
    app = MagicMock()
    app.id = "app-1"
    data = _make_auth_data(app=app)
    with patch(
        "controllers.openapi.auth.prepare.EnterpriseService.WebAppAuth.get_app_access_mode_by_id",
        side_effect=ValueError("No data found."),
    ):
        load_app_access_mode(data)
    assert data.app_access_mode is None


def test_load_app_access_mode_no_op_when_app_missing():
    data = _make_auth_data()
    load_app_access_mode(data)
    assert data.app_access_mode is None
