from __future__ import annotations

import importlib
from types import SimpleNamespace

import pytest
from werkzeug.exceptions import Forbidden

from controllers.console.workspace import plugin_permission_required
from models.account import TenantPluginPermission


class _SessionStub:
    def __init__(self, permission):
        self._permission = permission

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def query(self, *_args, **_kwargs):
        return self

    def where(self, *_args, **_kwargs):
        return self

    def first(self):
        return self._permission


def _workspace_module():
    return importlib.import_module(plugin_permission_required.__module__)


def _patch_session(monkeypatch: pytest.MonkeyPatch, permission):
    module = _workspace_module()
    monkeypatch.setattr(module, "Session", lambda *_args, **_kwargs: _SessionStub(permission))
    monkeypatch.setattr(module, "db", SimpleNamespace(engine=object()))


def test_plugin_permission_allows_without_permission(monkeypatch: pytest.MonkeyPatch) -> None:
    user = SimpleNamespace(is_admin_or_owner=False)
    module = _workspace_module()
    monkeypatch.setattr(module, "current_account_with_tenant", lambda: (user, "t1"))
    _patch_session(monkeypatch, None)

    @plugin_permission_required()
    def handler():
        return "ok"

    assert handler() == "ok"


def test_plugin_permission_install_nobody_forbidden(monkeypatch: pytest.MonkeyPatch) -> None:
    user = SimpleNamespace(is_admin_or_owner=True)
    permission = SimpleNamespace(
        install_permission=TenantPluginPermission.InstallPermission.NOBODY,
        debug_permission=TenantPluginPermission.DebugPermission.EVERYONE,
    )
    module = _workspace_module()
    monkeypatch.setattr(module, "current_account_with_tenant", lambda: (user, "t1"))
    _patch_session(monkeypatch, permission)

    @plugin_permission_required(install_required=True)
    def handler():
        return "ok"

    with pytest.raises(Forbidden):
        handler()


def test_plugin_permission_install_admin_requires_admin(monkeypatch: pytest.MonkeyPatch) -> None:
    user = SimpleNamespace(is_admin_or_owner=False)
    permission = SimpleNamespace(
        install_permission=TenantPluginPermission.InstallPermission.ADMINS,
        debug_permission=TenantPluginPermission.DebugPermission.EVERYONE,
    )
    module = _workspace_module()
    monkeypatch.setattr(module, "current_account_with_tenant", lambda: (user, "t1"))
    _patch_session(monkeypatch, permission)

    @plugin_permission_required(install_required=True)
    def handler():
        return "ok"

    with pytest.raises(Forbidden):
        handler()


def test_plugin_permission_install_admin_allows_admin(monkeypatch: pytest.MonkeyPatch) -> None:
    user = SimpleNamespace(is_admin_or_owner=True)
    permission = SimpleNamespace(
        install_permission=TenantPluginPermission.InstallPermission.ADMINS,
        debug_permission=TenantPluginPermission.DebugPermission.EVERYONE,
    )
    module = _workspace_module()
    monkeypatch.setattr(module, "current_account_with_tenant", lambda: (user, "t1"))
    _patch_session(monkeypatch, permission)

    @plugin_permission_required(install_required=True)
    def handler():
        return "ok"

    assert handler() == "ok"


def test_plugin_permission_debug_nobody_forbidden(monkeypatch: pytest.MonkeyPatch) -> None:
    user = SimpleNamespace(is_admin_or_owner=True)
    permission = SimpleNamespace(
        install_permission=TenantPluginPermission.InstallPermission.EVERYONE,
        debug_permission=TenantPluginPermission.DebugPermission.NOBODY,
    )
    module = _workspace_module()
    monkeypatch.setattr(module, "current_account_with_tenant", lambda: (user, "t1"))
    _patch_session(monkeypatch, permission)

    @plugin_permission_required(debug_required=True)
    def handler():
        return "ok"

    with pytest.raises(Forbidden):
        handler()


def test_plugin_permission_debug_admin_requires_admin(monkeypatch: pytest.MonkeyPatch) -> None:
    user = SimpleNamespace(is_admin_or_owner=False)
    permission = SimpleNamespace(
        install_permission=TenantPluginPermission.InstallPermission.EVERYONE,
        debug_permission=TenantPluginPermission.DebugPermission.ADMINS,
    )
    module = _workspace_module()
    monkeypatch.setattr(module, "current_account_with_tenant", lambda: (user, "t1"))
    _patch_session(monkeypatch, permission)

    @plugin_permission_required(debug_required=True)
    def handler():
        return "ok"

    with pytest.raises(Forbidden):
        handler()
