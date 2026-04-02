import pytest
from sqlalchemy import delete

from core.db.session_factory import session_factory
from models import Tenant
from models.account import TenantPluginAutoUpgradeStrategy, TenantPluginPermission
from services.plugin.plugin_auto_upgrade_service import PluginAutoUpgradeService
from services.plugin.plugin_permission_service import PluginPermissionService


@pytest.fixture
def tenant(flask_req_ctx):
    with session_factory.create_session() as session:
        t = Tenant(name="plugin_it_tenant")
        session.add(t)
        session.commit()
        tenant_id = t.id

    yield tenant_id

    with session_factory.create_session() as session:
        session.execute(delete(TenantPluginPermission).where(TenantPluginPermission.tenant_id == tenant_id))
        session.execute(
            delete(TenantPluginAutoUpgradeStrategy).where(TenantPluginAutoUpgradeStrategy.tenant_id == tenant_id)
        )
        session.execute(delete(Tenant).where(Tenant.id == tenant_id))
        session.commit()


class TestPluginPermissionLifecycle:
    def test_get_returns_none_for_new_tenant(self, tenant):
        assert PluginPermissionService.get_permission(tenant) is None

    def test_change_creates_row(self, tenant):
        result = PluginPermissionService.change_permission(
            tenant,
            TenantPluginPermission.InstallPermission.ADMINS,
            TenantPluginPermission.DebugPermission.EVERYONE,
        )
        assert result is True

        perm = PluginPermissionService.get_permission(tenant)
        assert perm is not None
        assert perm.install_permission == TenantPluginPermission.InstallPermission.ADMINS
        assert perm.debug_permission == TenantPluginPermission.DebugPermission.EVERYONE

    def test_change_updates_existing_row(self, tenant):
        PluginPermissionService.change_permission(
            tenant,
            TenantPluginPermission.InstallPermission.ADMINS,
            TenantPluginPermission.DebugPermission.NOBODY,
        )
        PluginPermissionService.change_permission(
            tenant,
            TenantPluginPermission.InstallPermission.EVERYONE,
            TenantPluginPermission.DebugPermission.ADMINS,
        )
        perm = PluginPermissionService.get_permission(tenant)
        assert perm is not None
        assert perm.install_permission == TenantPluginPermission.InstallPermission.EVERYONE
        assert perm.debug_permission == TenantPluginPermission.DebugPermission.ADMINS

        with session_factory.create_session() as session:
            count = session.query(TenantPluginPermission).where(TenantPluginPermission.tenant_id == tenant).count()
        assert count == 1


class TestPluginAutoUpgradeLifecycle:
    def test_get_returns_none_for_new_tenant(self, tenant):
        assert PluginAutoUpgradeService.get_strategy(tenant) is None

    def test_change_creates_row(self, tenant):
        result = PluginAutoUpgradeService.change_strategy(
            tenant,
            strategy_setting=TenantPluginAutoUpgradeStrategy.StrategySetting.LATEST,
            upgrade_time_of_day=3,
            upgrade_mode=TenantPluginAutoUpgradeStrategy.UpgradeMode.ALL,
            exclude_plugins=[],
            include_plugins=[],
        )
        assert result is True

        strategy = PluginAutoUpgradeService.get_strategy(tenant)
        assert strategy is not None
        assert strategy.strategy_setting == TenantPluginAutoUpgradeStrategy.StrategySetting.LATEST
        assert strategy.upgrade_time_of_day == 3

    def test_change_updates_existing_row(self, tenant):
        PluginAutoUpgradeService.change_strategy(
            tenant,
            strategy_setting=TenantPluginAutoUpgradeStrategy.StrategySetting.FIX_ONLY,
            upgrade_time_of_day=0,
            upgrade_mode=TenantPluginAutoUpgradeStrategy.UpgradeMode.ALL,
            exclude_plugins=[],
            include_plugins=[],
        )
        PluginAutoUpgradeService.change_strategy(
            tenant,
            strategy_setting=TenantPluginAutoUpgradeStrategy.StrategySetting.LATEST,
            upgrade_time_of_day=12,
            upgrade_mode=TenantPluginAutoUpgradeStrategy.UpgradeMode.PARTIAL,
            exclude_plugins=[],
            include_plugins=["plugin-a"],
        )

        strategy = PluginAutoUpgradeService.get_strategy(tenant)
        assert strategy is not None
        assert strategy.strategy_setting == TenantPluginAutoUpgradeStrategy.StrategySetting.LATEST
        assert strategy.upgrade_time_of_day == 12
        assert strategy.upgrade_mode == TenantPluginAutoUpgradeStrategy.UpgradeMode.PARTIAL
        assert strategy.include_plugins == ["plugin-a"]

    def test_exclude_plugin_creates_strategy_when_none_exists(self, tenant):
        PluginAutoUpgradeService.exclude_plugin(tenant, "my-plugin")

        strategy = PluginAutoUpgradeService.get_strategy(tenant)
        assert strategy is not None
        assert strategy.upgrade_mode == TenantPluginAutoUpgradeStrategy.UpgradeMode.EXCLUDE
        assert "my-plugin" in strategy.exclude_plugins

    def test_exclude_plugin_appends_in_exclude_mode(self, tenant):
        PluginAutoUpgradeService.change_strategy(
            tenant,
            strategy_setting=TenantPluginAutoUpgradeStrategy.StrategySetting.FIX_ONLY,
            upgrade_time_of_day=0,
            upgrade_mode=TenantPluginAutoUpgradeStrategy.UpgradeMode.EXCLUDE,
            exclude_plugins=["existing"],
            include_plugins=[],
        )
        PluginAutoUpgradeService.exclude_plugin(tenant, "new-plugin")

        strategy = PluginAutoUpgradeService.get_strategy(tenant)
        assert strategy is not None
        assert "existing" in strategy.exclude_plugins
        assert "new-plugin" in strategy.exclude_plugins

    def test_exclude_plugin_dedup_in_exclude_mode(self, tenant):
        PluginAutoUpgradeService.change_strategy(
            tenant,
            strategy_setting=TenantPluginAutoUpgradeStrategy.StrategySetting.FIX_ONLY,
            upgrade_time_of_day=0,
            upgrade_mode=TenantPluginAutoUpgradeStrategy.UpgradeMode.EXCLUDE,
            exclude_plugins=["same-plugin"],
            include_plugins=[],
        )
        PluginAutoUpgradeService.exclude_plugin(tenant, "same-plugin")

        strategy = PluginAutoUpgradeService.get_strategy(tenant)
        assert strategy is not None
        assert strategy.exclude_plugins.count("same-plugin") == 1

    def test_exclude_from_partial_mode_removes_from_include(self, tenant):
        PluginAutoUpgradeService.change_strategy(
            tenant,
            strategy_setting=TenantPluginAutoUpgradeStrategy.StrategySetting.FIX_ONLY,
            upgrade_time_of_day=0,
            upgrade_mode=TenantPluginAutoUpgradeStrategy.UpgradeMode.PARTIAL,
            exclude_plugins=[],
            include_plugins=["p1", "p2"],
        )
        PluginAutoUpgradeService.exclude_plugin(tenant, "p1")

        strategy = PluginAutoUpgradeService.get_strategy(tenant)
        assert strategy is not None
        assert "p1" not in strategy.include_plugins
        assert "p2" in strategy.include_plugins

    def test_exclude_from_all_mode_switches_to_exclude(self, tenant):
        PluginAutoUpgradeService.change_strategy(
            tenant,
            strategy_setting=TenantPluginAutoUpgradeStrategy.StrategySetting.LATEST,
            upgrade_time_of_day=0,
            upgrade_mode=TenantPluginAutoUpgradeStrategy.UpgradeMode.ALL,
            exclude_plugins=[],
            include_plugins=[],
        )
        PluginAutoUpgradeService.exclude_plugin(tenant, "excluded-plugin")

        strategy = PluginAutoUpgradeService.get_strategy(tenant)
        assert strategy is not None
        assert strategy.upgrade_mode == TenantPluginAutoUpgradeStrategy.UpgradeMode.EXCLUDE
        assert "excluded-plugin" in strategy.exclude_plugins
