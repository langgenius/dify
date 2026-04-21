"""Testcontainers integration tests for plugin_permission_required decorator."""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import patch

import pytest
from sqlalchemy.orm import Session
from werkzeug.exceptions import Forbidden

from controllers.console.workspace import plugin_permission_required
from models.account import Tenant, TenantPluginPermission, TenantStatus


def _create_tenant(db_session: Session) -> Tenant:
    tenant = Tenant(name="test-tenant", status=TenantStatus.NORMAL, plan="basic")
    db_session.add(tenant)
    db_session.commit()
    db_session.expire_all()
    return tenant


def _create_permission(
    db_session: Session,
    tenant_id: str,
    install: TenantPluginPermission.InstallPermission = TenantPluginPermission.InstallPermission.EVERYONE,
    debug: TenantPluginPermission.DebugPermission = TenantPluginPermission.DebugPermission.EVERYONE,
) -> TenantPluginPermission:
    perm = TenantPluginPermission(
        tenant_id=tenant_id,
        install_permission=install,
        debug_permission=debug,
    )
    db_session.add(perm)
    db_session.commit()
    db_session.expire_all()
    return perm


class TestPluginPermissionRequired:
    def test_allows_without_permission(self, db_session_with_containers: Session):
        tenant = _create_tenant(db_session_with_containers)
        user = SimpleNamespace(is_admin_or_owner=False)

        with patch(
            "controllers.console.workspace.current_account_with_tenant",
            return_value=(user, tenant.id),
        ):

            @plugin_permission_required()
            def handler():
                return "ok"

            assert handler() == "ok"

    def test_install_nobody_forbidden(self, db_session_with_containers: Session):
        tenant = _create_tenant(db_session_with_containers)
        _create_permission(
            db_session_with_containers,
            tenant.id,
            install=TenantPluginPermission.InstallPermission.NOBODY,
            debug=TenantPluginPermission.DebugPermission.EVERYONE,
        )
        user = SimpleNamespace(is_admin_or_owner=True)

        with patch(
            "controllers.console.workspace.current_account_with_tenant",
            return_value=(user, tenant.id),
        ):

            @plugin_permission_required(install_required=True)
            def handler():
                return "ok"

            with pytest.raises(Forbidden):
                handler()

    def test_install_admin_requires_admin(self, db_session_with_containers: Session):
        tenant = _create_tenant(db_session_with_containers)
        _create_permission(
            db_session_with_containers,
            tenant.id,
            install=TenantPluginPermission.InstallPermission.ADMINS,
            debug=TenantPluginPermission.DebugPermission.EVERYONE,
        )
        user = SimpleNamespace(is_admin_or_owner=False)

        with patch(
            "controllers.console.workspace.current_account_with_tenant",
            return_value=(user, tenant.id),
        ):

            @plugin_permission_required(install_required=True)
            def handler():
                return "ok"

            with pytest.raises(Forbidden):
                handler()

    def test_install_admin_allows_admin(self, db_session_with_containers: Session):
        tenant = _create_tenant(db_session_with_containers)
        _create_permission(
            db_session_with_containers,
            tenant.id,
            install=TenantPluginPermission.InstallPermission.ADMINS,
            debug=TenantPluginPermission.DebugPermission.EVERYONE,
        )
        user = SimpleNamespace(is_admin_or_owner=True)

        with patch(
            "controllers.console.workspace.current_account_with_tenant",
            return_value=(user, tenant.id),
        ):

            @plugin_permission_required(install_required=True)
            def handler():
                return "ok"

            assert handler() == "ok"

    def test_debug_nobody_forbidden(self, db_session_with_containers: Session):
        tenant = _create_tenant(db_session_with_containers)
        _create_permission(
            db_session_with_containers,
            tenant.id,
            install=TenantPluginPermission.InstallPermission.EVERYONE,
            debug=TenantPluginPermission.DebugPermission.NOBODY,
        )
        user = SimpleNamespace(is_admin_or_owner=True)

        with patch(
            "controllers.console.workspace.current_account_with_tenant",
            return_value=(user, tenant.id),
        ):

            @plugin_permission_required(debug_required=True)
            def handler():
                return "ok"

            with pytest.raises(Forbidden):
                handler()

    def test_debug_admin_requires_admin(self, db_session_with_containers: Session):
        tenant = _create_tenant(db_session_with_containers)
        _create_permission(
            db_session_with_containers,
            tenant.id,
            install=TenantPluginPermission.InstallPermission.EVERYONE,
            debug=TenantPluginPermission.DebugPermission.ADMINS,
        )
        user = SimpleNamespace(is_admin_or_owner=False)

        with patch(
            "controllers.console.workspace.current_account_with_tenant",
            return_value=(user, tenant.id),
        ):

            @plugin_permission_required(debug_required=True)
            def handler():
                return "ok"

            with pytest.raises(Forbidden):
                handler()

    def test_debug_admin_allows_admin(self, db_session_with_containers: Session):
        tenant = _create_tenant(db_session_with_containers)
        _create_permission(
            db_session_with_containers,
            tenant.id,
            install=TenantPluginPermission.InstallPermission.EVERYONE,
            debug=TenantPluginPermission.DebugPermission.ADMINS,
        )
        user = SimpleNamespace(is_admin_or_owner=True)

        with patch(
            "controllers.console.workspace.current_account_with_tenant",
            return_value=(user, tenant.id),
        ):

            @plugin_permission_required(debug_required=True)
            def handler():
                return "ok"

            assert handler() == "ok"
