from unittest.mock import MagicMock, patch

from models.account import TenantPluginPermission

MODULE = "services.plugin.plugin_permission_service"


def _patched_session():
    """Patch session_factory.create_session() to return a mock session as context manager."""
    session = MagicMock()
    session.__enter__ = MagicMock(return_value=session)
    session.__exit__ = MagicMock(return_value=False)
    session.begin.return_value.__enter__ = MagicMock(return_value=session)
    session.begin.return_value.__exit__ = MagicMock(return_value=False)
    mock_factory = MagicMock()
    mock_factory.create_session.return_value = session
    patcher = patch(f"{MODULE}.session_factory", mock_factory)
    return patcher, session


class TestGetPermission:
    def test_returns_permission_when_found(self):
        p1, session = _patched_session()
        permission = MagicMock()
        session.scalar.return_value = permission

        with p1:
            from services.plugin.plugin_permission_service import PluginPermissionService

            result = PluginPermissionService.get_permission("t1")

        assert result is permission

    def test_returns_none_when_not_found(self):
        p1, session = _patched_session()
        session.scalar.return_value = None

        with p1:
            from services.plugin.plugin_permission_service import PluginPermissionService

            result = PluginPermissionService.get_permission("t1")

        assert result is None


class TestChangePermission:
    def test_creates_new_permission_when_not_exists(self):
        p1, session = _patched_session()
        session.scalar.return_value = None

        with p1, patch(f"{MODULE}.select"), patch(f"{MODULE}.TenantPluginPermission") as perm_cls:
            perm_cls.return_value = MagicMock()
            from services.plugin.plugin_permission_service import PluginPermissionService

            result = PluginPermissionService.change_permission(
                "t1", TenantPluginPermission.InstallPermission.EVERYONE, TenantPluginPermission.DebugPermission.EVERYONE
            )

        assert result is True
        session.begin.assert_called_once()
        session.add.assert_called_once()

    def test_updates_existing_permission(self):
        p1, session = _patched_session()
        existing = MagicMock()
        session.scalar.return_value = existing

        with p1:
            from services.plugin.plugin_permission_service import PluginPermissionService

            result = PluginPermissionService.change_permission(
                "t1", TenantPluginPermission.InstallPermission.ADMINS, TenantPluginPermission.DebugPermission.ADMINS
            )

        assert result is True
        session.begin.assert_called_once()
        assert existing.install_permission == TenantPluginPermission.InstallPermission.ADMINS
        assert existing.debug_permission == TenantPluginPermission.DebugPermission.ADMINS
        session.add.assert_not_called()
