import uuid
from unittest.mock import MagicMock, patch

import pytest
from flask import Flask
from werkzeug.exceptions import Forbidden, NotFound, Unauthorized

from controllers.openapi.auth.data import AuthData, ExternalIdentity
from controllers.openapi.auth.prepare import (
    load_account,
    load_app,
    load_app_access_mode,
    load_tenant,
    load_tenant_from_request,
    load_workspace_role,
    resolve_external_user,
)
from libs.oauth_bearer import TokenType
from models.account import TenantAccountRole


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


_VALID_APP_UUID = "00000000-0000-0000-0000-000000000001"


def test_load_app_writes_app_to_data():
    app = MagicMock()
    app.status = "normal"
    app.enable_api = True
    data = _make_auth_data(path_params={"app_id": _VALID_APP_UUID})
    with patch("controllers.openapi.auth.prepare.AppService.get_app_by_id", return_value=app):
        load_app(data)
    assert data.app is app


def test_load_app_raises_not_found_for_non_uuid_app_id():
    data = _make_auth_data(path_params={"app_id": "not-a-uuid"})
    with pytest.raises(NotFound):
        load_app(data)


def test_load_app_raises_not_found_when_missing():
    data = _make_auth_data(path_params={"app_id": _VALID_APP_UUID})
    with patch("controllers.openapi.auth.prepare.AppService.get_app_by_id", return_value=None):
        with pytest.raises(NotFound):
            load_app(data)


def test_load_app_raises_not_found_when_not_normal():
    app = MagicMock()
    app.status = "archived"
    data = _make_auth_data(path_params={"app_id": _VALID_APP_UUID})
    with patch("controllers.openapi.auth.prepare.AppService.get_app_by_id", return_value=app):
        with pytest.raises(NotFound):
            load_app(data)


def test_load_app_stashes_app_even_when_api_disabled():
    app = MagicMock()
    app.status = "normal"
    app.enable_api = False
    data = _make_auth_data(path_params={"app_id": _VALID_APP_UUID})
    with patch("controllers.openapi.auth.prepare.AppService.get_app_by_id", return_value=app):
        load_app(data)
    assert data.app is app


def test_load_app_skips_when_already_set():
    existing_app = MagicMock()
    data = _make_auth_data(app=existing_app, path_params={"app_id": "abc"})
    load_app(data)
    assert data.app is existing_app


def test_load_tenant_writes_tenant():
    app = MagicMock()
    app.tenant_id = uuid.uuid4()
    tenant = MagicMock()
    tenant.status = "normal"
    data = _make_auth_data(app=app)
    with patch("controllers.openapi.auth.prepare.TenantService.get_tenant_by_id", return_value=tenant):
        load_tenant(data)
    assert data.tenant is tenant


def test_load_tenant_skips_when_already_set():
    existing_tenant = MagicMock()
    data = _make_auth_data(app=MagicMock(), tenant=existing_tenant)
    load_tenant(data)
    assert data.tenant is existing_tenant


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


def test_load_account_skips_when_already_set():
    existing_caller = MagicMock()
    data = _make_auth_data(account_id=uuid.uuid4(), caller=existing_caller)
    load_account(data)
    assert data.caller is existing_caller


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


@pytest.fixture
def flask_app():
    return Flask(__name__)


def test_load_tenant_from_request_from_path_params(flask_app):
    tenant = MagicMock()
    tenant.status = "normal"
    wid = str(uuid.uuid4())
    data = _make_auth_data(path_params={"workspace_id": wid})
    with flask_app.test_request_context("/test"):
        with patch("controllers.openapi.auth.prepare.TenantService.get_tenant_by_id", return_value=tenant):
            load_tenant_from_request(data)
    assert data.tenant is tenant


def test_load_tenant_from_request_from_query_param(flask_app):
    tenant = MagicMock()
    tenant.status = "normal"
    wid = str(uuid.uuid4())
    data = _make_auth_data(path_params={})
    with flask_app.test_request_context(f"/test?workspace_id={wid}"):
        with patch("controllers.openapi.auth.prepare.TenantService.get_tenant_by_id", return_value=tenant):
            load_tenant_from_request(data)
    assert data.tenant is tenant


def test_load_tenant_from_request_skips_when_already_set(flask_app):
    existing_tenant = MagicMock()
    data = _make_auth_data(tenant=existing_tenant, path_params={})
    with flask_app.test_request_context("/test"):
        load_tenant_from_request(data)
    assert data.tenant is existing_tenant


def test_load_tenant_from_request_raises_not_found_when_no_id(flask_app):
    data = _make_auth_data(path_params={})
    with flask_app.test_request_context("/test"):
        with pytest.raises(NotFound):
            load_tenant_from_request(data)


def test_load_tenant_from_request_raises_not_found_when_missing(flask_app):
    wid = str(uuid.uuid4())
    data = _make_auth_data(path_params={"workspace_id": wid})
    with flask_app.test_request_context("/test"):
        with patch("controllers.openapi.auth.prepare.TenantService.get_tenant_by_id", return_value=None):
            with pytest.raises(NotFound):
                load_tenant_from_request(data)


def test_load_tenant_from_request_raises_not_found_when_archived(flask_app):
    from models.account import TenantStatus

    tenant = MagicMock()
    tenant.status = TenantStatus.ARCHIVE
    wid = str(uuid.uuid4())
    data = _make_auth_data(path_params={"workspace_id": wid})
    with flask_app.test_request_context("/test"):
        with patch("controllers.openapi.auth.prepare.TenantService.get_tenant_by_id", return_value=tenant):
            with pytest.raises(NotFound):
                load_tenant_from_request(data)


def test_load_tenant_from_request_raises_not_found_when_invalid_uuid(flask_app):
    data = _make_auth_data(path_params={"workspace_id": "not-a-uuid"})
    with flask_app.test_request_context("/test"):
        with pytest.raises(NotFound):
            load_tenant_from_request(data)


# --- load_workspace_role ---


def test_load_workspace_role_stashes_role():
    tenant = MagicMock()
    tenant.id = uuid.uuid4()
    caller = MagicMock()
    caller.status = "active"
    data = _make_auth_data(account_id=uuid.uuid4(), tenant=tenant, caller=caller)
    with patch(
        "controllers.openapi.auth.prepare.TenantService.get_account_role_in_tenant",
        return_value=TenantAccountRole.ADMIN,
    ):
        load_workspace_role(data)
    assert data.tenant_role == TenantAccountRole.ADMIN


def test_load_workspace_role_none_when_not_member():
    tenant = MagicMock()
    tenant.id = uuid.uuid4()
    caller = MagicMock()
    caller.status = "active"
    data = _make_auth_data(account_id=uuid.uuid4(), tenant=tenant, caller=caller)
    with patch(
        "controllers.openapi.auth.prepare.TenantService.get_account_role_in_tenant",
        return_value=None,
    ):
        load_workspace_role(data)
    assert data.tenant_role is None


def test_load_workspace_role_none_when_account_inactive():
    tenant = MagicMock()
    tenant.id = uuid.uuid4()
    caller = MagicMock()
    caller.status = "banned"
    data = _make_auth_data(account_id=uuid.uuid4(), tenant=tenant, caller=caller)
    load_workspace_role(data)
    assert data.tenant_role is None


def test_load_workspace_role_skips_when_already_set():
    tenant = MagicMock()
    tenant.id = uuid.uuid4()
    caller = MagicMock()
    caller.status = "active"
    data = _make_auth_data(
        account_id=uuid.uuid4(),
        tenant=tenant,
        caller=caller,
        tenant_role=TenantAccountRole.OWNER,
    )
    load_workspace_role(data)
    assert data.tenant_role == TenantAccountRole.OWNER


def test_load_workspace_role_skips_when_tenant_missing():
    data = _make_auth_data(account_id=uuid.uuid4())
    load_workspace_role(data)
    assert data.tenant_role is None


def test_load_workspace_role_skips_when_account_id_missing():
    tenant = MagicMock()
    data = _make_auth_data(tenant=tenant, account_id=None)
    load_workspace_role(data)
    assert data.tenant_role is None
