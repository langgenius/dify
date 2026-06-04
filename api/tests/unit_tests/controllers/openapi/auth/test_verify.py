import uuid
from unittest.mock import MagicMock, patch

import pytest
from flask import Flask
from werkzeug.exceptions import Forbidden, NotFound

from controllers.openapi.auth.data import AuthData
from controllers.openapi.auth.verify import (
    check_acl,
    check_app_access,
    check_app_api_enabled,
    check_private_app_permission,
    check_scope,
    check_workspace_member,
    check_workspace_mismatch,
    check_workspace_role,
)
from libs.oauth_bearer import Scope, TokenType
from models.account import Tenant, TenantAccountRole
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


def test_check_workspace_member_raises_not_found_when_no_role():
    with pytest.raises(NotFound, match="workspace not found"):
        check_workspace_member(_data(tenant_role=None))


def test_check_workspace_member_passes_when_role_present():
    check_workspace_member(_data(tenant_role=TenantAccountRole.NORMAL))


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


# --- check_workspace_mismatch ---


@pytest.fixture
def flask_app():
    return Flask(__name__)


def test_check_workspace_mismatch_passes_when_tenant_none(flask_app):
    with flask_app.test_request_context("/test"):
        check_workspace_mismatch(_data(tenant=None))


def test_check_workspace_mismatch_passes_when_ids_match(flask_app):
    tenant = MagicMock(spec=Tenant)
    tid = uuid.uuid4()
    tenant.id = tid
    with flask_app.test_request_context(f"/test?workspace_id={tid}"):
        check_workspace_mismatch(_data(tenant=tenant, path_params={}))


def test_check_workspace_mismatch_raises_422_on_mismatch(flask_app):
    from werkzeug.exceptions import UnprocessableEntity

    tenant = MagicMock(spec=Tenant)
    tenant.id = uuid.uuid4()
    other_id = uuid.uuid4()
    with flask_app.test_request_context(f"/test?workspace_id={other_id}"):
        with pytest.raises(UnprocessableEntity):
            check_workspace_mismatch(_data(tenant=tenant, path_params={}))


def test_check_workspace_mismatch_passes_when_no_request_workspace_id(flask_app):
    tenant = MagicMock(spec=Tenant)
    tenant.id = uuid.uuid4()
    with flask_app.test_request_context("/test"):
        check_workspace_mismatch(_data(tenant=tenant, path_params={}))


# --- check_workspace_role ---


def test_check_workspace_role_passes_when_allowed_roles_none():
    check_workspace_role(_data(allowed_roles=None))


def test_check_workspace_role_raises_not_found_when_not_member():
    data = _data(tenant_role=None, allowed_roles=frozenset({TenantAccountRole.ADMIN}))
    with pytest.raises(NotFound):
        check_workspace_role(data)


def test_check_workspace_role_raises_forbidden_when_wrong_role():
    data = _data(
        tenant_role=TenantAccountRole.EDITOR,
        allowed_roles=frozenset({TenantAccountRole.OWNER}),
    )
    with pytest.raises(Forbidden, match="insufficient workspace role"):
        check_workspace_role(data)


def test_check_workspace_role_passes_when_role_allowed():
    data = _data(
        tenant_role=TenantAccountRole.ADMIN,
        allowed_roles=frozenset({TenantAccountRole.OWNER, TenantAccountRole.ADMIN}),
    )
    check_workspace_role(data)


# --- check_app_api_enabled ---


def test_check_app_api_enabled_passes_when_enabled():
    app = MagicMock(spec=App)
    app.enable_api = True
    check_app_api_enabled(_data(app=app))


def test_check_app_api_enabled_raises_forbidden_when_disabled():
    app = MagicMock(spec=App)
    app.enable_api = False
    with pytest.raises(Forbidden, match="service_api_disabled"):
        check_app_api_enabled(_data(app=app))


def test_check_app_api_enabled_passes_when_app_none():
    check_app_api_enabled(_data(app=None))
