import uuid
from unittest.mock import MagicMock, patch

import pytest
from werkzeug.exceptions import Forbidden, NotFound, Unauthorized

from controllers.openapi.auth.data import ExternalIdentity
from controllers.openapi.auth.prepare import (
    build_external_identity,
    load_account,
    load_app,
    load_app_access_mode,
    load_tenant,
    resolve_external_user,
)

# --- load_app ---


def test_load_app_writes_app_to_builder():
    app = MagicMock()
    app.status = "normal"
    app.enable_api = True
    builder = {"path_params": {"app_id": "abc"}}
    with patch("controllers.openapi.auth.prepare.AppService.get_app_by_id", return_value=app):
        load_app(builder)
    assert builder["app"] is app


def test_load_app_raises_not_found_when_missing():
    builder = {"path_params": {"app_id": "missing"}}
    with patch("controllers.openapi.auth.prepare.AppService.get_app_by_id", return_value=None):
        with pytest.raises(NotFound):
            load_app(builder)


def test_load_app_raises_not_found_when_not_normal():
    app = MagicMock()
    app.status = "archived"
    builder = {"path_params": {"app_id": "abc"}}
    with patch("controllers.openapi.auth.prepare.AppService.get_app_by_id", return_value=app):
        with pytest.raises(NotFound):
            load_app(builder)


def test_load_app_raises_forbidden_when_api_disabled():
    app = MagicMock()
    app.status = "normal"
    app.enable_api = False
    builder = {"path_params": {"app_id": "abc"}}
    with patch("controllers.openapi.auth.prepare.AppService.get_app_by_id", return_value=app):
        with pytest.raises(Forbidden):
            load_app(builder)


# --- load_tenant ---

def test_load_tenant_writes_tenant():
    app = MagicMock()
    app.tenant_id = uuid.uuid4()
    tenant = MagicMock()
    tenant.status = "normal"
    builder = {"app": app}
    with patch("controllers.openapi.auth.prepare.TenantService.get_tenant_by_id", return_value=tenant):
        load_tenant(builder)
    assert builder["tenant"] is tenant


def test_load_tenant_raises_forbidden_when_archived():
    from models.account import TenantStatus
    app = MagicMock()
    app.tenant_id = uuid.uuid4()
    tenant = MagicMock()
    tenant.status = TenantStatus.ARCHIVE
    builder = {"app": app}
    with patch("controllers.openapi.auth.prepare.TenantService.get_tenant_by_id", return_value=tenant):
        with pytest.raises(Forbidden):
            load_tenant(builder)


def test_load_tenant_raises_forbidden_when_missing():
    app = MagicMock()
    app.tenant_id = uuid.uuid4()
    builder = {"app": app}
    with patch("controllers.openapi.auth.prepare.TenantService.get_tenant_by_id", return_value=None):
        with pytest.raises(Forbidden):
            load_tenant(builder)


# --- load_account ---

def test_load_account_writes_caller():
    account = MagicMock()
    account_id = uuid.uuid4()
    builder = {"account_id": account_id}
    with patch("controllers.openapi.auth.prepare.AccountService.get_account_by_id", return_value=account):
        load_account(builder)
    assert builder["caller"] is account
    assert builder["caller_kind"] == "account"


def test_load_account_sets_current_tenant_when_tenant_present():
    account = MagicMock()
    tenant = MagicMock()
    builder = {"account_id": uuid.uuid4(), "tenant": tenant}
    with patch("controllers.openapi.auth.prepare.AccountService.get_account_by_id", return_value=account):
        load_account(builder)
    assert account.current_tenant is tenant


def test_load_account_raises_unauthorized_when_not_found():
    builder = {"account_id": uuid.uuid4()}
    with patch("controllers.openapi.auth.prepare.AccountService.get_account_by_id", return_value=None):
        with pytest.raises(Unauthorized):
            load_account(builder)


# --- resolve_external_user ---

def test_resolve_external_user_writes_caller():
    tenant = MagicMock()
    app = MagicMock()
    end_user = MagicMock()
    ext = ExternalIdentity(email="user@sso.com")
    builder = {"tenant": tenant, "app": app, "external_identity": ext}
    with patch("controllers.openapi.auth.prepare.EndUserService.get_or_create_end_user_by_type", return_value=end_user):
        resolve_external_user(builder)
    assert builder["caller"] is end_user
    assert builder["caller_kind"] == "end_user"


def test_resolve_external_user_raises_unauthorized_when_context_missing():
    builder = {"tenant": None, "app": MagicMock(), "external_identity": ExternalIdentity(email="u@s.com")}
    with pytest.raises(Unauthorized):
        resolve_external_user(builder)


# --- load_app_access_mode ---

def test_load_app_access_mode_writes_mode():
    from services.enterprise.enterprise_service import WebAppAccessMode
    app = MagicMock()
    app.id = "app-1"
    settings = MagicMock()
    settings.access_mode = "public"
    builder = {"app": app}
    with patch(
        "controllers.openapi.auth.prepare.EnterpriseService.WebAppAuth.get_app_access_mode_by_id",
        return_value=settings,
    ):
        load_app_access_mode(builder)
    assert builder["app_access_mode"] == WebAppAccessMode.PUBLIC


def test_load_app_access_mode_writes_none_when_value_error():
    app = MagicMock()
    app.id = "app-1"
    builder = {"app": app}
    with patch(
        "controllers.openapi.auth.prepare.EnterpriseService.WebAppAuth.get_app_access_mode_by_id",
        side_effect=ValueError("No data found."),
    ):
        load_app_access_mode(builder)
    assert builder["app_access_mode"] is None


def test_load_app_access_mode_no_op_when_app_missing():
    builder = {}
    load_app_access_mode(builder)
    assert "app_access_mode" not in builder


# --- build_external_identity ---

def test_build_external_identity_constructs_from_builder_keys():
    from controllers.openapi.auth.data import ExternalIdentity
    builder = {"_subject_email": "u@sso.com", "_subject_issuer": "idp"}
    build_external_identity(builder)
    assert isinstance(builder["external_identity"], ExternalIdentity)
    assert builder["external_identity"].email == "u@sso.com"
    assert "_subject_email" not in builder


def test_build_external_identity_no_op_when_email_missing():
    builder = {"_subject_email": None, "_subject_issuer": None}
    build_external_identity(builder)
    assert "external_identity" not in builder
