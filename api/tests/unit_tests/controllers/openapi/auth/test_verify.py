import uuid
from unittest.mock import MagicMock, patch

import pytest
from werkzeug.exceptions import Forbidden, Unauthorized

from controllers.openapi.auth.data import AuthData
from controllers.openapi.auth.verify import (
    check_acl,
    check_app_access,
    check_membership,
    check_private_app_permission,
    check_scope,
)
from libs.oauth_bearer import Scope, TokenType
from models.account import Tenant
from models.model import App
from services.enterprise.enterprise_service import WebAppAccessMode


def _data(**kwargs) -> AuthData:
    defaults: dict = {"token_type": TokenType.OAUTH_ACCOUNT, "token_hash": "hash", "scopes": frozenset({Scope.FULL})}
    defaults.update(kwargs)
    return AuthData(**defaults)


def test_check_scope_passes_when_required_is_none():
    check_scope(_data(required_scope=None))


def test_check_scope_passes_when_full_in_scopes():
    check_scope(_data(required_scope=Scope.APPS_RUN, scopes=frozenset({Scope.FULL})))


def test_check_scope_passes_when_exact_scope_present():
    check_scope(_data(required_scope=Scope.APPS_RUN, scopes=frozenset({Scope.APPS_RUN})))


def test_check_scope_raises_forbidden_when_scope_missing():
    with pytest.raises(Forbidden, match="insufficient_scope"):
        check_scope(_data(required_scope=Scope.APPS_RUN, scopes=frozenset({Scope.APPS_READ})))


def test_check_membership_raises_unauthorized_when_tenant_none():
    with pytest.raises(Unauthorized):
        check_membership(_data(tenant=None))


def test_check_membership_calls_check_workspace_membership():
    tenant = MagicMock(spec=Tenant)
    tenant.id = "tenant-1"
    data = _data(
        account_id=uuid.uuid4(),
        token_hash="myhash",
        tenants={"tenant-1": True},
        tenant=tenant,
    )
    with patch("controllers.openapi.auth.verify.check_workspace_membership") as mock_cwm:
        check_membership(data)
    mock_cwm.assert_called_once_with(
        account_id=data.account_id,
        tenant_id="tenant-1",
        token_hash="myhash",
        membership_cache=data.tenants,
    )


def test_check_app_access_passes_when_tenant_none():
    check_app_access(_data(tenant=None))


def test_check_app_access_passes_when_member():
    tenant = MagicMock(spec=Tenant)
    tenant.id = "t1"
    data = _data(account_id=uuid.uuid4(), tenant=tenant)
    with patch("controllers.openapi.auth.verify.TenantService.account_belongs_to_tenant", return_value=True):
        check_app_access(data)


def test_check_app_access_raises_when_not_member():
    tenant = MagicMock(spec=Tenant)
    tenant.id = "t1"
    data = _data(account_id=uuid.uuid4(), tenant=tenant)
    with patch("controllers.openapi.auth.verify.TenantService.account_belongs_to_tenant", return_value=False):
        with pytest.raises(Forbidden, match="subject_no_app_access"):
            check_app_access(data)


def test_check_acl_raises_when_app_or_mode_missing():
    with pytest.raises(Forbidden):
        check_acl(_data(app=None, app_access_mode=None))


def test_check_acl_account_allowed_for_public():
    app = MagicMock(spec=App)
    data = _data(token_type=TokenType.OAUTH_ACCOUNT, app=app, app_access_mode=WebAppAccessMode.PUBLIC)
    check_acl(data)


def test_check_acl_external_sso_blocked_for_private():
    app = MagicMock(spec=App)
    data = _data(
        token_type=TokenType.OAUTH_EXTERNAL_SSO,
        app=app,
        app_access_mode=WebAppAccessMode.PRIVATE,
    )
    with pytest.raises(Forbidden, match="subject_not_allowed_for_access_mode"):
        check_acl(data)


def test_check_acl_external_sso_allowed_for_sso_verified():
    app = MagicMock(spec=App)
    data = _data(
        token_type=TokenType.OAUTH_EXTERNAL_SSO,
        app=app,
        app_access_mode=WebAppAccessMode.SSO_VERIFIED,
    )
    check_acl(data)


def test_check_private_app_permission_raises_when_app_none():
    with pytest.raises(Forbidden):
        check_private_app_permission(_data(app=None))


def test_check_private_app_permission_raises_when_user_not_allowed():
    app = MagicMock(spec=App)
    app.id = "app-1"
    data = _data(account_id=uuid.uuid4(), app=app)
    target = "controllers.openapi.auth.verify.EnterpriseService.WebAppAuth.is_user_allowed_to_access_webapp"
    with patch(target, return_value=False):
        with pytest.raises(Forbidden, match="user_not_allowed_for_private_app"):
            check_private_app_permission(data)


def test_check_private_app_permission_passes_when_allowed():
    app = MagicMock(spec=App)
    app.id = "app-1"
    data = _data(account_id=uuid.uuid4(), app=app)
    target = "controllers.openapi.auth.verify.EnterpriseService.WebAppAuth.is_user_allowed_to_access_webapp"
    with patch(target, return_value=True):
        check_private_app_permission(data)
