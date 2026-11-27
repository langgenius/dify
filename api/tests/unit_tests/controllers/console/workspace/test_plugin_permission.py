"""Console plugin permission handlers over the real slice and SQLite persistence."""

from inspect import unwrap
from types import SimpleNamespace
from unittest.mock import patch
from uuid import uuid4

import pytest
from flask import Flask
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker
from werkzeug.exceptions import Forbidden, UnprocessableEntity

from controllers.console.workspace.plugin_permission import (
    ParserPermissionChange,
    PluginChangePermissionApi,
    PluginFetchPermissionApi,
)
from enums.account import TenantAccountRole
from enums.plugin_permission import TenantPluginDebugPermission, TenantPluginInstallPermission
from libs.login import AccountWithTenant
from machinery.context import RequestContext
from models.account import Account, TenantPluginPermission
from repositories.plugin_permission_repository import SQLAlchemyPluginPermissionRepository
from services.plugin.plugin_permission_settings_service import PluginPermissionSettingsService
from tests.helpers.unit.config_override import config_overrides_context
from tests.helpers.unit.model_factories import make_account

_MODULE = "controllers.console.workspace.plugin_permission"


def _account(role: TenantAccountRole) -> Account:
    return make_account(account_id="u1", name="Test User", email="u1@example.com", role=role)


def _context(workspace_id: str) -> RequestContext:
    return RequestContext(request_id="req-1", trace_id=None, account_id="u1", active_workspace_id=workspace_id)


def _services(factory: sessionmaker[Session]) -> SimpleNamespace:
    service = PluginPermissionSettingsService(settings=SQLAlchemyPluginPermissionRepository(session_factory=factory))
    return SimpleNamespace(workspaces=SimpleNamespace(plugin_permissions=service))


def _change(
    app: Flask, factory: sessionmaker[Session], account: Account, workspace_id: str, payload: dict[str, str]
) -> dict[str, bool]:
    api = PluginChangePermissionApi()
    with (
        app.test_request_context("/", json=payload),
        patch(f"{_MODULE}.application_services", return_value=_services(factory)),
        patch(f"{_MODULE}.current_account_with_tenant", return_value=(account, workspace_id)),
    ):
        return unwrap(api.post)(api, ParserPermissionChange.model_validate(payload), _context(workspace_id))


def _fetch(app: Flask, factory: sessionmaker[Session], workspace_id: str) -> dict[str, str]:
    api = PluginFetchPermissionApi()
    with app.test_request_context("/"), patch(f"{_MODULE}.application_services", return_value=_services(factory)):
        return unwrap(api.get)(api, _context(workspace_id))


def _store(session: Session, workspace_id: str, install: str, debug: str) -> None:
    session.add(
        TenantPluginPermission(
            tenant_id=workspace_id,
            install_permission=TenantPluginInstallPermission(install),
            debug_permission=TenantPluginDebugPermission(debug),
        )
    )
    session.commit()


def test_parser_defaults_are_unchanged() -> None:
    assert ParserPermissionChange().model_dump(mode="json") == {
        "install_permission": "everyone",
        "debug_permission": "everyone",
    }


@pytest.mark.parametrize("role", [TenantAccountRole.OWNER, TenantAccountRole.ADMIN])
def test_admin_or_owner_creates_settings_and_preserves_other_workspace(
    app: Flask, sqlite_session: Session, sqlite_session_factory: sessionmaker[Session], role: TenantAccountRole
) -> None:
    workspace_id, other_id = str(uuid4()), str(uuid4())
    _store(sqlite_session, other_id, "admins", "everyone")
    payload = {"install_permission": "everyone", "debug_permission": "admins"}

    with config_overrides_context(RBAC_ENABLED=False):
        result = _change(app, sqlite_session_factory, _account(role), workspace_id, payload)

    sqlite_session.rollback()
    assert result == {"success": True}
    assert _fetch(app, sqlite_session_factory, workspace_id) == payload
    assert _fetch(app, sqlite_session_factory, other_id) == {
        "install_permission": "admins",
        "debug_permission": "everyone",
    }


def test_admin_updates_existing_settings(
    app: Flask, sqlite_session: Session, sqlite_session_factory: sessionmaker[Session]
) -> None:
    workspace_id = str(uuid4())
    _store(sqlite_session, workspace_id, "admins", "noone")
    payload = {"install_permission": "noone", "debug_permission": "everyone"}

    with config_overrides_context(RBAC_ENABLED=False):
        _change(app, sqlite_session_factory, _account(TenantAccountRole.ADMIN), workspace_id, payload)

    sqlite_session.expire_all()
    rows = sqlite_session.scalars(
        select(TenantPluginPermission).where(TenantPluginPermission.tenant_id == workspace_id)
    ).all()
    assert [(row.install_permission, row.debug_permission) for row in rows] == [("noone", "everyone")]


@pytest.mark.parametrize("role", [TenantAccountRole.NORMAL, TenantAccountRole.EDITOR])
def test_non_admin_is_forbidden_and_database_is_unchanged(
    app: Flask, sqlite_session: Session, sqlite_session_factory: sessionmaker[Session], role: TenantAccountRole
) -> None:
    workspace_id = str(uuid4())
    _store(sqlite_session, workspace_id, "admins", "everyone")
    payload = {"install_permission": "everyone", "debug_permission": "noone"}

    with config_overrides_context(RBAC_ENABLED=False), pytest.raises(Forbidden):
        _change(app, sqlite_session_factory, _account(role), workspace_id, payload)

    assert _fetch(app, sqlite_session_factory, workspace_id) == {
        "install_permission": "admins",
        "debug_permission": "everyone",
    }
    assert _fetch(app, sqlite_session_factory, str(uuid4())) == {
        "install_permission": "admins",
        "debug_permission": "everyone",
    }


def test_rbac_enabled_keeps_legacy_account_admin_check(
    app: Flask, sqlite_session_factory: sessionmaker[Session]
) -> None:
    """Pin legacy behavior: ``Account.is_admin_or_owner`` is True for every role under RBAC.

    The endpoint never had an RBAC permission check, so with RBAC enabled the
    legacy handler admitted a normal member. This migration preserves that.
    """
    workspace_id = str(uuid4())
    payload = {"install_permission": "noone", "debug_permission": "noone"}

    with config_overrides_context(RBAC_ENABLED=True):
        result = _change(app, sqlite_session_factory, _account(TenantAccountRole.NORMAL), workspace_id, payload)

    assert result == {"success": True}
    assert _fetch(app, sqlite_session_factory, workspace_id) == payload


def test_fetch_returns_stored_settings(
    app: Flask, sqlite_session: Session, sqlite_session_factory: sessionmaker[Session]
) -> None:
    workspace_id = str(uuid4())
    _store(sqlite_session, workspace_id, "noone", "admins")

    assert _fetch(app, sqlite_session_factory, workspace_id) == {
        "install_permission": "noone",
        "debug_permission": "admins",
    }


@pytest.mark.parametrize("install_permission", ["noone", "invalid"])
def test_decorated_change_validates_payload_and_injects_workspace(
    app: Flask, sqlite_session_factory: sessionmaker[Session], install_permission: str
) -> None:
    """Exercise admission/context and payload decorators over real persistence."""
    workspace_id = str(uuid4())
    account = _account(TenantAccountRole.ADMIN)
    admitted = AccountWithTenant(account=account, tenant_id=workspace_id)
    payload = {"install_permission": install_permission, "debug_permission": "admins"}
    with (
        app.test_request_context("/", method="POST", json=payload),
        config_overrides_context(LOGIN_DISABLED=True, RBAC_ENABLED=False),
        patch("controllers.console.wraps._is_setup_completed", return_value=True),
        patch("controllers.console.wraps.current_account_with_tenant", return_value=admitted),
        patch("controllers.console.flask_admission.current_account_with_tenant", return_value=admitted),
        patch(f"{_MODULE}.current_account_with_tenant", return_value=admitted),
        patch(f"{_MODULE}.application_services", return_value=_services(sqlite_session_factory)),
    ):
        if install_permission == "invalid":
            with pytest.raises(UnprocessableEntity):
                PluginChangePermissionApi().post()
        else:
            assert PluginChangePermissionApi().post() == {"success": True}

    expected = (
        {"install_permission": "admins", "debug_permission": "everyone"} if install_permission == "invalid" else payload
    )
    assert _fetch(app, sqlite_session_factory, workspace_id) == expected
