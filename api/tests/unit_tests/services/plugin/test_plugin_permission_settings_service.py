"""Workspace plugin permission settings use cases over real SQLite persistence."""

from uuid import uuid4

import pytest
from sqlalchemy.orm import Session, sessionmaker

from enums.plugin_permission import TenantPluginDebugPermission, TenantPluginInstallPermission
from machinery.context import RequestContext
from repositories.plugin_permission_repository import SQLAlchemyPluginPermissionRepository
from services.plugin.plugin_permission_settings_service import (
    DEFAULT_PLUGIN_PERMISSION_SETTINGS,
    PluginPermissionSettings,
    PluginPermissionSettingsService,
)

_NOBODY_ADMINS = PluginPermissionSettings(
    install_permission=TenantPluginInstallPermission.NOBODY,
    debug_permission=TenantPluginDebugPermission.ADMINS,
)


def _context(workspace_id: str) -> RequestContext:
    return RequestContext(request_id="req-1", trace_id=None, account_id=str(uuid4()), active_workspace_id=workspace_id)


def _service(factory: sessionmaker[Session]) -> PluginPermissionSettingsService:
    return PluginPermissionSettingsService(settings=SQLAlchemyPluginPermissionRepository(session_factory=factory))


def test_default_settings_keep_console_contract() -> None:
    assert (
        PluginPermissionSettings(
            install_permission=TenantPluginInstallPermission.ADMINS,
            debug_permission=TenantPluginDebugPermission.EVERYONE,
        )
        == DEFAULT_PLUGIN_PERMISSION_SETTINGS
    )


def test_get_settings_defaults_when_workspace_has_none(sqlite_session_factory: sessionmaker[Session]) -> None:
    service = _service(sqlite_session_factory)
    service.change_settings(_context(str(uuid4())), _NOBODY_ADMINS)

    assert service.get_settings(_context(str(uuid4()))) == DEFAULT_PLUGIN_PERMISSION_SETTINGS


def test_change_then_get_is_scoped_to_active_workspace(sqlite_session_factory: sessionmaker[Session]) -> None:
    service = _service(sqlite_session_factory)
    workspace_id, other_id = str(uuid4()), str(uuid4())
    other_settings = PluginPermissionSettings(
        install_permission=TenantPluginInstallPermission.EVERYONE,
        debug_permission=TenantPluginDebugPermission.NOBODY,
    )
    service.change_settings(_context(other_id), other_settings)

    assert service.change_settings(_context(workspace_id), _NOBODY_ADMINS) == _NOBODY_ADMINS
    assert service.get_settings(_context(workspace_id)) == _NOBODY_ADMINS
    assert service.get_settings(_context(other_id)) == other_settings


def test_account_only_context_is_rejected_before_persistence(sqlite_session_factory: sessionmaker[Session]) -> None:
    service = _service(sqlite_session_factory)

    with pytest.raises(ValueError, match="active workspace"):
        service.change_settings(_context(""), _NOBODY_ADMINS)
    with pytest.raises(ValueError, match="active workspace"):
        service.get_settings(_context(""))
