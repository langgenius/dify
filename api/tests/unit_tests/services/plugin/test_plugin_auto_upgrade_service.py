import logging
from types import SimpleNamespace
from unittest.mock import MagicMock, patch
from uuid import uuid4

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

MODULE = "services.plugin.plugin_auto_upgrade_service"
_PLUGIN_AUTO_UPGRADE_SERVICE_PLUGIN_CATEGORY = TenantPluginAutoUpgradeCategory.TOOL
STRATEGY_MODELS = (TenantPluginAutoUpgradeStrategy,)


def _strategy(
    tenant_id: str,
    *,
    category: TenantPluginAutoUpgradeCategory = _PLUGIN_AUTO_UPGRADE_SERVICE_PLUGIN_CATEGORY,
    setting: TenantPluginAutoUpgradeStrategySetting = TenantPluginAutoUpgradeStrategySetting.FIX_ONLY,
    mode: TenantPluginAutoUpgradeMode = TenantPluginAutoUpgradeMode.EXCLUDE,
    exclude: list[str] | None = None,
    include: list[str] | None = None,
    upgrade_time: int = 0,
) -> TenantPluginAutoUpgradeStrategy:
    return TenantPluginAutoUpgradeStrategy(
        tenant_id=tenant_id,
        category=category,
        strategy_setting=setting,
        upgrade_time_of_day=upgrade_time,
        upgrade_mode=mode,
        exclude_plugins=exclude or [],
        include_plugins=include or [],
    )


class TestPluginAutoUpgradeServiceCases:
    class TestGetStrategy:
        @pytest.mark.parametrize("sqlite_session", [STRATEGY_MODELS], indirect=True)
        def test_returns_strategy_when_found(self, sqlite_session: Session) -> None:
            tenant_id = str(uuid4())
            strategy = _strategy(tenant_id)
            sqlite_session.add(strategy)
            sqlite_session.commit()

            result = PluginAutoUpgradeService.get_strategy(
                tenant_id, _PLUGIN_AUTO_UPGRADE_SERVICE_PLUGIN_CATEGORY, session=sqlite_session
            )

            assert result is strategy

        @pytest.mark.parametrize("sqlite_session", [STRATEGY_MODELS], indirect=True)
        def test_returns_none_when_not_found(self, sqlite_session: Session) -> None:
            assert (
                PluginAutoUpgradeService.get_strategy(
                    str(uuid4()), _PLUGIN_AUTO_UPGRADE_SERVICE_PLUGIN_CATEGORY, session=sqlite_session
                )
                is None
            )

    class TestChangeStrategy:
        @pytest.mark.parametrize("sqlite_session", [STRATEGY_MODELS], indirect=True)
        def test_creates_new_strategy(self, sqlite_session: Session) -> None:
            tenant_id = str(uuid4())

            result = PluginAutoUpgradeService.change_strategy(
                tenant_id,
                TenantPluginAutoUpgradeStrategySetting.FIX_ONLY,
                3,
                TenantPluginAutoUpgradeMode.ALL,
                [],
                [],
                category=_PLUGIN_AUTO_UPGRADE_SERVICE_PLUGIN_CATEGORY,
                session=sqlite_session,
            )

            strategy = sqlite_session.scalar(select(TenantPluginAutoUpgradeStrategy))
            assert result is True
            assert strategy is not None
            assert strategy.tenant_id == tenant_id
            assert strategy.upgrade_time_of_day == 3
            assert strategy.upgrade_mode == TenantPluginAutoUpgradeMode.ALL

        @pytest.mark.parametrize("sqlite_session", [STRATEGY_MODELS], indirect=True)
        def test_updates_existing_strategy(self, sqlite_session: Session) -> None:
            tenant_id = str(uuid4())
            existing = _strategy(tenant_id)
            sqlite_session.add(existing)
            sqlite_session.commit()

            result = PluginAutoUpgradeService.change_strategy(
                tenant_id,
                TenantPluginAutoUpgradeStrategySetting.LATEST,
                5,
                TenantPluginAutoUpgradeMode.PARTIAL,
                ["p1"],
                ["p2"],
                category=_PLUGIN_AUTO_UPGRADE_SERVICE_PLUGIN_CATEGORY,
                session=sqlite_session,
            )

            sqlite_session.refresh(existing)
            assert result is True
            assert existing.strategy_setting == TenantPluginAutoUpgradeStrategySetting.LATEST
            assert existing.upgrade_time_of_day == 5
            assert existing.upgrade_mode == TenantPluginAutoUpgradeMode.PARTIAL
            assert existing.exclude_plugins == ["p1"]
            assert existing.include_plugins == ["p2"]

    class TestExcludePlugin:
        @pytest.mark.parametrize("sqlite_session", [STRATEGY_MODELS], indirect=True)
        def test_creates_default_strategy_when_none_exists(self, sqlite_session: Session) -> None:
            tenant_id = str(uuid4())

            result = PluginAutoUpgradeService.exclude_plugin(
                tenant_id, "plugin-1", _PLUGIN_AUTO_UPGRADE_SERVICE_PLUGIN_CATEGORY, session=sqlite_session
            )

            strategy = sqlite_session.scalar(select(TenantPluginAutoUpgradeStrategy))
            assert result is True
            assert strategy is not None
            assert strategy.exclude_plugins == ["plugin-1"]

        @pytest.mark.parametrize("sqlite_session", [STRATEGY_MODELS], indirect=True)
        def test_appends_to_exclude_list_in_exclude_mode(self, sqlite_session: Session) -> None:
            tenant_id = str(uuid4())
            existing = _strategy(tenant_id, exclude=["p-existing"])
            sqlite_session.add(existing)
            sqlite_session.commit()

            PluginAutoUpgradeService.exclude_plugin(
                tenant_id, "p-new", _PLUGIN_AUTO_UPGRADE_SERVICE_PLUGIN_CATEGORY, session=sqlite_session
            )

            sqlite_session.refresh(existing)
            assert existing.exclude_plugins == ["p-existing", "p-new"]

        @pytest.mark.parametrize("sqlite_session", [STRATEGY_MODELS], indirect=True)
        def test_removes_from_include_list_in_partial_mode(self, sqlite_session: Session) -> None:
            tenant_id = str(uuid4())
            existing = _strategy(tenant_id, mode=TenantPluginAutoUpgradeMode.PARTIAL, include=["p1", "p2"])
            sqlite_session.add(existing)
            sqlite_session.commit()

            PluginAutoUpgradeService.exclude_plugin(
                tenant_id, "p1", _PLUGIN_AUTO_UPGRADE_SERVICE_PLUGIN_CATEGORY, session=sqlite_session
            )

            sqlite_session.refresh(existing)
            assert existing.include_plugins == ["p2"]

        @pytest.mark.parametrize("sqlite_session", [STRATEGY_MODELS], indirect=True)
        def test_switches_to_exclude_mode_from_all(self, sqlite_session: Session) -> None:
            tenant_id = str(uuid4())
            existing = _strategy(tenant_id, mode=TenantPluginAutoUpgradeMode.ALL)
            sqlite_session.add(existing)
            sqlite_session.commit()

            PluginAutoUpgradeService.exclude_plugin(
                tenant_id, "p1", _PLUGIN_AUTO_UPGRADE_SERVICE_PLUGIN_CATEGORY, session=sqlite_session
            )

            sqlite_session.refresh(existing)
            assert existing.upgrade_mode == TenantPluginAutoUpgradeMode.EXCLUDE
            assert existing.exclude_plugins == ["p1"]

        @pytest.mark.parametrize("sqlite_session", [STRATEGY_MODELS], indirect=True)
        def test_no_duplicate_in_exclude_list(self, sqlite_session: Session) -> None:
            tenant_id = str(uuid4())
            existing = _strategy(tenant_id, exclude=["p1"])
            sqlite_session.add(existing)
            sqlite_session.commit()

            PluginAutoUpgradeService.exclude_plugin(
                tenant_id, "p1", _PLUGIN_AUTO_UPGRADE_SERVICE_PLUGIN_CATEGORY, session=sqlite_session
            )

            sqlite_session.refresh(existing)
            assert existing.exclude_plugins == ["p1"]

    class TestBackfillStrategyCategories:
        @pytest.mark.parametrize("sqlite_session", [STRATEGY_MODELS], indirect=True)
        def test_creates_default_missing_categories_without_fetching_daemon(self, sqlite_session: Session) -> None:
            tenant_id = str(uuid4())
            tool_strategy = _strategy(tenant_id)
            sqlite_session.add(tool_strategy)
            sqlite_session.commit()
            installer = MagicMock()

            with patch(f"{MODULE}.PluginInstaller", return_value=installer):
                result = PluginAutoUpgradeService.backfill_strategy_categories(tenant_id, session=sqlite_session)
                expected_time = PluginAutoUpgradeService.default_upgrade_time_of_day(tenant_id)

            strategies = list(sqlite_session.scalars(select(TenantPluginAutoUpgradeStrategy)).all())
            assert result.created_count == len(TenantPluginAutoUpgradeCategory) - 1
            assert result.normalized is False
            installer.list_plugins.assert_not_called()
            assert len(strategies) == len(TenantPluginAutoUpgradeCategory)
            assert tool_strategy.upgrade_time_of_day == expected_time
            model_strategy = next(
                strategy for strategy in strategies if strategy.category == TenantPluginAutoUpgradeCategory.MODEL
            )
            assert model_strategy.strategy_setting == TenantPluginAutoUpgradeStrategySetting.LATEST
            assert model_strategy.upgrade_time_of_day == expected_time

        def test_default_upgrade_time_is_aligned_to_fifteen_minutes(self) -> None:
            default_time = PluginAutoUpgradeService.default_upgrade_time_of_day(str(uuid4()))
            assert default_time % (15 * 60) == 0
            assert 0 <= default_time < 24 * 60 * 60

        @pytest.mark.parametrize("sqlite_session", [STRATEGY_MODELS], indirect=True)
        def test_creates_missing_categories_and_splits_known_plugins(
            self, sqlite_session: Session, caplog: pytest.LogCaptureFixture
        ) -> None:
            tenant_id = str(uuid4())
            tool_strategy = _strategy(
                tenant_id,
                exclude=["tool-plugin", "model-plugin", "unknown-plugin"],
                include=["model-plugin", "tool-plugin"],
            )
            model_strategy = _strategy(
                tenant_id,
                category=TenantPluginAutoUpgradeCategory.MODEL,
                exclude=["tool-plugin", "model-plugin", "unknown-plugin"],
                include=["model-plugin", "tool-plugin"],
            )
            sqlite_session.add_all([tool_strategy, model_strategy])
            sqlite_session.commit()
            installed_plugins = [
                SimpleNamespace(
                    plugin_id="tool-plugin",
                    declaration=SimpleNamespace(category=TenantPluginAutoUpgradeCategory.TOOL),
                ),
                SimpleNamespace(
                    plugin_id="model-plugin",
                    declaration=SimpleNamespace(category=TenantPluginAutoUpgradeCategory.MODEL),
                ),
            ]
            installer = MagicMock()
            installer.list_plugins.return_value = installed_plugins

            with (
                patch(f"{MODULE}.PluginInstaller", return_value=installer),
                caplog.at_level(logging.WARNING, logger=MODULE),
            ):
                result = PluginAutoUpgradeService.backfill_strategy_categories(tenant_id, session=sqlite_session)

            strategies = list(sqlite_session.scalars(select(TenantPluginAutoUpgradeStrategy)).all())
            assert result.created_count == len(TenantPluginAutoUpgradeCategory) - 2
            assert result.normalized is True
            assert len(strategies) == len(TenantPluginAutoUpgradeCategory)
            assert tool_strategy.exclude_plugins == ["tool-plugin"]
            assert tool_strategy.include_plugins == ["tool-plugin"]
            assert model_strategy.exclude_plugins == ["model-plugin"]
            assert model_strategy.include_plugins == ["model-plugin"]
            assert (
                "Skipped unknown plugin IDs while backfilling plugin auto-upgrade strategies: "
                f"tenant_id={tenant_id}, field=exclude_plugins, plugin_ids=['unknown-plugin']" in caplog.messages
            )


"""SQLite-backed lifecycle coverage for plugin permissions and auto-upgrade strategies."""


_PLUGIN_LIFECYCLE_SQLITE_PLUGIN_CATEGORY = TenantPluginAutoUpgradeCategory.TOOL


class TestPluginLifecycleSqliteCases:
    @staticmethod
    @pytest.fixture
    def tenant(sqlite_session: Session) -> str:
        tenant = Tenant(name="plugin_unit_tenant")
        sqlite_session.add(tenant)
        sqlite_session.commit()
        return tenant.id

    class TestPluginPermissionLifecycle:
        def test_get_returns_none_for_new_tenant(self, tenant: str, sqlite_session: Session) -> None:
            assert PluginPermissionService.get_permission(tenant, session=sqlite_session) is None

        def test_change_creates_row(self, tenant: str, sqlite_session: Session) -> None:
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

        def test_change_updates_existing_row(self, tenant: str, sqlite_session: Session) -> None:
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
                select(func.count())
                .select_from(TenantPluginPermission)
                .where(TenantPluginPermission.tenant_id == tenant)
            )
            assert count == 1

    class TestPluginAutoUpgradeLifecycle:
        def test_get_returns_none_for_new_tenant(self, tenant: str, sqlite_session: Session) -> None:
            assert (
                PluginAutoUpgradeService.get_strategy(
                    tenant, _PLUGIN_LIFECYCLE_SQLITE_PLUGIN_CATEGORY, session=sqlite_session
                )
                is None
            )

        def test_change_creates_row(self, tenant: str, sqlite_session: Session) -> None:
            result = PluginAutoUpgradeService.change_strategy(
                tenant,
                strategy_setting=TenantPluginAutoUpgradeStrategySetting.LATEST,
                upgrade_time_of_day=3,
                upgrade_mode=TenantPluginAutoUpgradeMode.ALL,
                exclude_plugins=[],
                include_plugins=[],
                category=_PLUGIN_LIFECYCLE_SQLITE_PLUGIN_CATEGORY,
                session=sqlite_session,
            )
            assert result is True

            strategy = PluginAutoUpgradeService.get_strategy(
                tenant, _PLUGIN_LIFECYCLE_SQLITE_PLUGIN_CATEGORY, session=sqlite_session
            )
            assert strategy is not None
            assert strategy.strategy_setting == TenantPluginAutoUpgradeStrategySetting.LATEST
            assert strategy.upgrade_time_of_day == 3

        def test_change_updates_existing_row(self, tenant: str, sqlite_session: Session) -> None:
            PluginAutoUpgradeService.change_strategy(
                tenant,
                strategy_setting=TenantPluginAutoUpgradeStrategySetting.FIX_ONLY,
                upgrade_time_of_day=0,
                upgrade_mode=TenantPluginAutoUpgradeMode.ALL,
                exclude_plugins=[],
                include_plugins=[],
                category=_PLUGIN_LIFECYCLE_SQLITE_PLUGIN_CATEGORY,
                session=sqlite_session,
            )
            PluginAutoUpgradeService.change_strategy(
                tenant,
                strategy_setting=TenantPluginAutoUpgradeStrategySetting.LATEST,
                upgrade_time_of_day=12,
                upgrade_mode=TenantPluginAutoUpgradeMode.PARTIAL,
                exclude_plugins=[],
                include_plugins=["plugin-a"],
                category=_PLUGIN_LIFECYCLE_SQLITE_PLUGIN_CATEGORY,
                session=sqlite_session,
            )

            strategy = PluginAutoUpgradeService.get_strategy(
                tenant, _PLUGIN_LIFECYCLE_SQLITE_PLUGIN_CATEGORY, session=sqlite_session
            )
            assert strategy is not None
            assert strategy.strategy_setting == TenantPluginAutoUpgradeStrategySetting.LATEST
            assert strategy.upgrade_time_of_day == 12
            assert strategy.upgrade_mode == TenantPluginAutoUpgradeMode.PARTIAL
            assert strategy.include_plugins == ["plugin-a"]

        def test_exclude_plugin_creates_strategy_when_none_exists(self, tenant: str, sqlite_session: Session) -> None:
            PluginAutoUpgradeService.exclude_plugin(
                tenant, "my-plugin", _PLUGIN_LIFECYCLE_SQLITE_PLUGIN_CATEGORY, session=sqlite_session
            )

            strategy = PluginAutoUpgradeService.get_strategy(
                tenant, _PLUGIN_LIFECYCLE_SQLITE_PLUGIN_CATEGORY, session=sqlite_session
            )
            assert strategy is not None
            assert strategy.upgrade_mode == TenantPluginAutoUpgradeMode.EXCLUDE
            assert "my-plugin" in strategy.exclude_plugins

        def test_exclude_plugin_appends_in_exclude_mode(self, tenant: str, sqlite_session: Session) -> None:
            PluginAutoUpgradeService.change_strategy(
                tenant,
                strategy_setting=TenantPluginAutoUpgradeStrategySetting.FIX_ONLY,
                upgrade_time_of_day=0,
                upgrade_mode=TenantPluginAutoUpgradeMode.EXCLUDE,
                exclude_plugins=["existing"],
                include_plugins=[],
                category=_PLUGIN_LIFECYCLE_SQLITE_PLUGIN_CATEGORY,
                session=sqlite_session,
            )
            PluginAutoUpgradeService.exclude_plugin(
                tenant, "new-plugin", _PLUGIN_LIFECYCLE_SQLITE_PLUGIN_CATEGORY, session=sqlite_session
            )

            strategy = PluginAutoUpgradeService.get_strategy(
                tenant, _PLUGIN_LIFECYCLE_SQLITE_PLUGIN_CATEGORY, session=sqlite_session
            )
            assert strategy is not None
            assert "existing" in strategy.exclude_plugins
            assert "new-plugin" in strategy.exclude_plugins

        def test_exclude_plugin_dedup_in_exclude_mode(self, tenant: str, sqlite_session: Session) -> None:
            PluginAutoUpgradeService.change_strategy(
                tenant,
                strategy_setting=TenantPluginAutoUpgradeStrategySetting.FIX_ONLY,
                upgrade_time_of_day=0,
                upgrade_mode=TenantPluginAutoUpgradeMode.EXCLUDE,
                exclude_plugins=["same-plugin"],
                include_plugins=[],
                category=_PLUGIN_LIFECYCLE_SQLITE_PLUGIN_CATEGORY,
                session=sqlite_session,
            )
            PluginAutoUpgradeService.exclude_plugin(
                tenant, "same-plugin", _PLUGIN_LIFECYCLE_SQLITE_PLUGIN_CATEGORY, session=sqlite_session
            )

            strategy = PluginAutoUpgradeService.get_strategy(
                tenant, _PLUGIN_LIFECYCLE_SQLITE_PLUGIN_CATEGORY, session=sqlite_session
            )
            assert strategy is not None
            assert strategy.exclude_plugins.count("same-plugin") == 1

        def test_exclude_from_partial_mode_removes_from_include(self, tenant: str, sqlite_session: Session) -> None:
            PluginAutoUpgradeService.change_strategy(
                tenant,
                strategy_setting=TenantPluginAutoUpgradeStrategySetting.FIX_ONLY,
                upgrade_time_of_day=0,
                upgrade_mode=TenantPluginAutoUpgradeMode.PARTIAL,
                exclude_plugins=[],
                include_plugins=["p1", "p2"],
                category=_PLUGIN_LIFECYCLE_SQLITE_PLUGIN_CATEGORY,
                session=sqlite_session,
            )
            PluginAutoUpgradeService.exclude_plugin(
                tenant, "p1", _PLUGIN_LIFECYCLE_SQLITE_PLUGIN_CATEGORY, session=sqlite_session
            )

            strategy = PluginAutoUpgradeService.get_strategy(
                tenant, _PLUGIN_LIFECYCLE_SQLITE_PLUGIN_CATEGORY, session=sqlite_session
            )
            assert strategy is not None
            assert "p1" not in strategy.include_plugins
            assert "p2" in strategy.include_plugins

        def test_exclude_from_all_mode_switches_to_exclude(self, tenant: str, sqlite_session: Session) -> None:
            PluginAutoUpgradeService.change_strategy(
                tenant,
                strategy_setting=TenantPluginAutoUpgradeStrategySetting.LATEST,
                upgrade_time_of_day=0,
                upgrade_mode=TenantPluginAutoUpgradeMode.ALL,
                exclude_plugins=[],
                include_plugins=[],
                category=_PLUGIN_LIFECYCLE_SQLITE_PLUGIN_CATEGORY,
                session=sqlite_session,
            )
            PluginAutoUpgradeService.exclude_plugin(
                tenant, "excluded-plugin", _PLUGIN_LIFECYCLE_SQLITE_PLUGIN_CATEGORY, session=sqlite_session
            )

            strategy = PluginAutoUpgradeService.get_strategy(
                tenant, _PLUGIN_LIFECYCLE_SQLITE_PLUGIN_CATEGORY, session=sqlite_session
            )
            assert strategy is not None
            assert strategy.upgrade_mode == TenantPluginAutoUpgradeMode.EXCLUDE
            assert "excluded-plugin" in strategy.exclude_plugins
