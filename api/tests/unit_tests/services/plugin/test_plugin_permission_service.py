from unittest.mock import MagicMock, patch

from models.account import TenantPluginPermission

MODULE = "services.plugin.plugin_permission_service"


def _patched_session():
    """Patch Session(db.engine) to return a mock session as context manager."""
    session = MagicMock()
    session_cls = MagicMock()
    session_cls.return_value.__enter__ = MagicMock(return_value=session)
    session_cls.return_value.__exit__ = MagicMock(return_value=False)
    patcher = patch(f"{MODULE}.Session", session_cls)
    db_patcher = patch(f"{MODULE}.db")
    return patcher, db_patcher, session


class TestGetPermission:
    def test_returns_permission_when_found(self):
        p1, p2, session = _patched_session()
        permission = MagicMock()
        session.query.return_value.where.return_value.first.return_value = permission

        with p1, p2:
            from services.plugin.plugin_permission_service import PluginPermissionService

            result = PluginPermissionService.get_permission("t1")

        assert result is permission

    def test_returns_none_when_not_found(self):
        p1, p2, session = _patched_session()
        session.query.return_value.where.return_value.first.return_value = None

        with p1, p2:
            from services.plugin.plugin_permission_service import PluginPermissionService

            result = PluginPermissionService.get_permission("t1")

        assert result is None


class TestChangePermission:
    def test_creates_new_permission_when_not_exists(self):
        p1, p2, session = _patched_session()
        session.query.return_value.where.return_value.first.return_value = None

        with p1, p2, patch(f"{MODULE}.TenantPluginPermission") as perm_cls:
            perm_cls.return_value = MagicMock()
            from services.plugin.plugin_permission_service import PluginPermissionService

            result = PluginPermissionService.change_permission(
                "t1", TenantPluginPermission.InstallPermission.EVERYONE, TenantPluginPermission.DebugPermission.EVERYONE
            )

        session.add.assert_called_once()
        session.commit.assert_called_once()

    def test_updates_existing_permission(self):
        p1, p2, session = _patched_session()
        existing = MagicMock()
        session.query.return_value.where.return_value.first.return_value = existing

        with p1, p2:
            from services.plugin.plugin_permission_service import PluginPermissionService

            result = PluginPermissionService.change_permission(
                "t1", TenantPluginPermission.InstallPermission.ADMINS, TenantPluginPermission.DebugPermission.ADMINS
            )

        assert existing.install_permission == TenantPluginPermission.InstallPermission.ADMINS
        assert existing.debug_permission == TenantPluginPermission.DebugPermission.ADMINS
        session.commit.assert_called_once()
        session.add.assert_not_called()
