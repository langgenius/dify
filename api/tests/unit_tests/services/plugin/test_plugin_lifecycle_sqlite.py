"""SQLite-backed lifecycle coverage for plugin permissions and auto-upgrade strategies."""

import pytest
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from models import Tenant
from models.account import (
    TenantPluginAutoUpgradeCategory,
    TenantPluginAutoUpgradeMode,
    TenantPluginAutoUpgradeStrategy,
    TenantPluginAutoUpgradeStrategySetting,
    TenantPluginDebugPermission,
    TenantPluginInstallPermission,
    TenantPluginPermission,
)
from services.plugin.plugin_auto_upgrade_service import PluginAutoUpgradeService
from services.plugin.plugin_permission_service import PluginPermissionService

PLUGIN_CATEGORY = TenantPluginAutoUpgradeCategory.TOOL


@pytest.fixture
def tenant(sqlite_session: Session) -> str:
    tenant = Tenant(name="plugin_unit_tenant")
    sqlite_session.add(tenant)
    sqlite_session.commit()
    return tenant.id


class TestPluginPermissionLifecycle:
    def test_get_returns_none_for_new_tenant(self, tenant: str, sqlite_session: Session):
        assert PluginPermissionService.get_permission(tenant, session=sqlite_session) is None

    def test_change_creates_row(self, tenant: str, sqlite_session: Session):
        result = PluginPermissionService.change_permission(
            tenant,
            TenantPluginInstallPermission.ADMINS,
            TenantPluginDebugPermission.EVERYONE,
            session=sqlite_session,
        )
        assert result is True

        perm = PluginPermissionService.get_permission(tenant, session=sqlite_session)
        assert perm is not None
        assert perm.install_permission == TenantPluginInstallPermission.ADMINS
        assert perm.debug_permission == TenantPluginDebugPermission.EVERYONE

    def test_change_updates_existing_row(self, tenant: str, sqlite_session: Session):
        PluginPermissionService.change_permission(
            tenant,
            TenantPluginInstallPermission.ADMINS,
            TenantPluginDebugPermission.NOBODY,
            session=sqlite_session,
        )
        PluginPermissionService.change_permission(
            tenant,
            TenantPluginInstallPermission.EVERYONE,
            TenantPluginDebugPermission.ADMINS,
            session=sqlite_session,
        )
        perm = PluginPermissionService.get_permission(tenant, session=sqlite_session)
        assert perm is not None
        assert perm.install_permission == TenantPluginInstallPermission.EVERYONE
        assert perm.debug_permission == TenantPluginDebugPermission.ADMINS

        count = sqlite_session.scalar(
            select(func.count()).select_from(TenantPluginPermission).where(TenantPluginPermission.tenant_id == tenant)
        )
        assert count == 1


class TestPluginAutoUpgradeLifecycle:
    def test_get_returns_none_for_new_tenant(self, tenant: str, sqlite_session: Session):
        assert PluginAutoUpgradeService.get_strategy(tenant, PLUGIN_CATEGORY, session=sqlite_session) is None

    def test_change_creates_row(self, tenant: str, sqlite_session: Session):
        result = PluginAutoUpgradeService.change_strategy(
            tenant,
            strategy_setting=TenantPluginAutoUpgradeStrategySetting.LATEST,
            upgrade_time_of_day=3,
            upgrade_mode=TenantPluginAutoUpgradeMode.ALL,
            exclude_plugins=[],
            include_plugins=[],
            category=PLUGIN_CATEGORY,
            session=sqlite_session,
        )
        assert result is True

        strategy = PluginAutoUpgradeService.get_strategy(tenant, PLUGIN_CATEGORY, session=sqlite_session)
        assert strategy is not None
        assert strategy.strategy_setting == TenantPluginAutoUpgradeStrategySetting.LATEST
        assert strategy.upgrade_time_of_day == 3

    def test_change_updates_existing_row(self, tenant: str, sqlite_session: Session):
        PluginAutoUpgradeService.change_strategy(
            tenant,
            strategy_setting=TenantPluginAutoUpgradeStrategySetting.FIX_ONLY,
            upgrade_time_of_day=0,
            upgrade_mode=TenantPluginAutoUpgradeMode.ALL,
            exclude_plugins=[],
            include_plugins=[],
            category=PLUGIN_CATEGORY,
            session=sqlite_session,
        )
        PluginAutoUpgradeService.change_strategy(
            tenant,
            strategy_setting=TenantPluginAutoUpgradeStrategySetting.LATEST,
            upgrade_time_of_day=12,
            upgrade_mode=TenantPluginAutoUpgradeMode.PARTIAL,
            exclude_plugins=[],
            include_plugins=["plugin-a"],
            category=PLUGIN_CATEGORY,
            session=sqlite_session,
        )

        strategy = PluginAutoUpgradeService.get_strategy(tenant, PLUGIN_CATEGORY, session=sqlite_session)
        assert strategy is not None
        assert strategy.strategy_setting == TenantPluginAutoUpgradeStrategySetting.LATEST
        assert strategy.upgrade_time_of_day == 12
        assert strategy.upgrade_mode == TenantPluginAutoUpgradeMode.PARTIAL
        assert strategy.include_plugins == ["plugin-a"]

    def test_exclude_plugin_creates_strategy_when_none_exists(self, tenant: str, sqlite_session: Session):
        PluginAutoUpgradeService.exclude_plugin(tenant, "my-plugin", PLUGIN_CATEGORY, session=sqlite_session)

        strategy = PluginAutoUpgradeService.get_strategy(tenant, PLUGIN_CATEGORY, session=sqlite_session)
        assert strategy is not None
        assert strategy.upgrade_mode == TenantPluginAutoUpgradeMode.EXCLUDE
        assert "my-plugin" in strategy.exclude_plugins

    def test_exclude_plugin_appends_in_exclude_mode(self, tenant: str, sqlite_session: Session):
        PluginAutoUpgradeService.change_strategy(
            tenant,
            strategy_setting=TenantPluginAutoUpgradeStrategySetting.FIX_ONLY,
            upgrade_time_of_day=0,
            upgrade_mode=TenantPluginAutoUpgradeMode.EXCLUDE,
            exclude_plugins=["existing"],
            include_plugins=[],
            category=PLUGIN_CATEGORY,
            session=sqlite_session,
        )
        PluginAutoUpgradeService.exclude_plugin(tenant, "new-plugin", PLUGIN_CATEGORY, session=sqlite_session)

        strategy = PluginAutoUpgradeService.get_strategy(tenant, PLUGIN_CATEGORY, session=sqlite_session)
        assert strategy is not None
        assert "existing" in strategy.exclude_plugins
        assert "new-plugin" in strategy.exclude_plugins

    def test_exclude_plugin_dedup_in_exclude_mode(self, tenant: str, sqlite_session: Session):
        PluginAutoUpgradeService.change_strategy(
            tenant,
            strategy_setting=TenantPluginAutoUpgradeStrategySetting.FIX_ONLY,
            upgrade_time_of_day=0,
            upgrade_mode=TenantPluginAutoUpgradeMode.EXCLUDE,
            exclude_plugins=["same-plugin"],
            include_plugins=[],
            category=PLUGIN_CATEGORY,
            session=sqlite_session,
        )
        PluginAutoUpgradeService.exclude_plugin(tenant, "same-plugin", PLUGIN_CATEGORY, session=sqlite_session)

        strategy = PluginAutoUpgradeService.get_strategy(tenant, PLUGIN_CATEGORY, session=sqlite_session)
        assert strategy is not None
        assert strategy.exclude_plugins.count("same-plugin") == 1

    def test_exclude_from_partial_mode_removes_from_include(self, tenant: str, sqlite_session: Session):
        PluginAutoUpgradeService.change_strategy(
            tenant,
            strategy_setting=TenantPluginAutoUpgradeStrategySetting.FIX_ONLY,
            upgrade_time_of_day=0,
            upgrade_mode=TenantPluginAutoUpgradeMode.PARTIAL,
            exclude_plugins=[],
            include_plugins=["p1", "p2"],
            category=PLUGIN_CATEGORY,
            session=sqlite_session,
        )
        PluginAutoUpgradeService.exclude_plugin(tenant, "p1", PLUGIN_CATEGORY, session=sqlite_session)

        strategy = PluginAutoUpgradeService.get_strategy(tenant, PLUGIN_CATEGORY, session=sqlite_session)
        assert strategy is not None
        assert "p1" not in strategy.include_plugins
        assert "p2" in strategy.include_plugins

    def test_exclude_from_all_mode_switches_to_exclude(self, tenant: str, sqlite_session: Session):
        PluginAutoUpgradeService.change_strategy(
            tenant,
            strategy_setting=TenantPluginAutoUpgradeStrategySetting.LATEST,
            upgrade_time_of_day=0,
            upgrade_mode=TenantPluginAutoUpgradeMode.ALL,
            exclude_plugins=[],
            include_plugins=[],
            category=PLUGIN_CATEGORY,
            session=sqlite_session,
        )
        PluginAutoUpgradeService.exclude_plugin(tenant, "excluded-plugin", PLUGIN_CATEGORY, session=sqlite_session)

        strategy = PluginAutoUpgradeService.get_strategy(tenant, PLUGIN_CATEGORY, session=sqlite_session)
        assert strategy is not None
        assert strategy.upgrade_mode == TenantPluginAutoUpgradeMode.EXCLUDE
        assert "excluded-plugin" in strategy.exclude_plugins
