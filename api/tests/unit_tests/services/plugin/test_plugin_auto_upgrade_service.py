from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from models.account import TenantPluginAutoUpgradeStrategy

MODULE = "services.plugin.plugin_auto_upgrade_service"
PLUGIN_CATEGORY = TenantPluginAutoUpgradeStrategy.PluginCategory.TOOL


def _patched_session():
    """Patch session_factory.create_session() to return a mock session as context manager."""
    session = MagicMock()
    session.__enter__ = MagicMock(return_value=session)
    session.__exit__ = MagicMock(return_value=False)
    mock_factory = MagicMock()
    mock_factory.create_session.return_value = session
    patcher = patch(f"{MODULE}.session_factory", mock_factory)
    return patcher, session


class TestGetStrategy:
    def test_returns_strategy_when_found(self):
        p1, session = _patched_session()
        strategy = MagicMock()
        session.scalar.return_value = strategy

        with p1:
            from services.plugin.plugin_auto_upgrade_service import PluginAutoUpgradeService

            result = PluginAutoUpgradeService.get_strategy("t1", PLUGIN_CATEGORY)

        assert result is strategy

    def test_returns_none_when_not_found(self):
        p1, session = _patched_session()
        session.scalar.return_value = None

        with p1:
            from services.plugin.plugin_auto_upgrade_service import PluginAutoUpgradeService

            result = PluginAutoUpgradeService.get_strategy("t1", PLUGIN_CATEGORY)

        assert result is None


class TestChangeStrategy:
    def test_creates_new_strategy(self):
        p1, session = _patched_session()
        session.scalar.return_value = None

        with p1, patch(f"{MODULE}.select"), patch(f"{MODULE}.TenantPluginAutoUpgradeStrategy") as strat_cls:
            strat_cls.return_value = MagicMock()
            from services.plugin.plugin_auto_upgrade_service import PluginAutoUpgradeService

            result = PluginAutoUpgradeService.change_strategy(
                "t1",
                TenantPluginAutoUpgradeStrategy.StrategySetting.FIX_ONLY,
                3,
                TenantPluginAutoUpgradeStrategy.UpgradeMode.ALL,
                [],
                [],
                category=PLUGIN_CATEGORY,
            )

        assert result is True
        session.add.assert_called_once()

    def test_updates_existing_strategy(self):
        p1, session = _patched_session()
        existing = MagicMock()
        session.scalar.return_value = existing

        with p1:
            from services.plugin.plugin_auto_upgrade_service import PluginAutoUpgradeService

            result = PluginAutoUpgradeService.change_strategy(
                "t1",
                TenantPluginAutoUpgradeStrategy.StrategySetting.LATEST,
                5,
                TenantPluginAutoUpgradeStrategy.UpgradeMode.PARTIAL,
                ["p1"],
                ["p2"],
                category=PLUGIN_CATEGORY,
            )

        assert result is True
        assert existing.strategy_setting == TenantPluginAutoUpgradeStrategy.StrategySetting.LATEST
        assert existing.upgrade_time_of_day == 5
        assert existing.upgrade_mode == TenantPluginAutoUpgradeStrategy.UpgradeMode.PARTIAL
        assert existing.exclude_plugins == ["p1"]
        assert existing.include_plugins == ["p2"]


class TestExcludePlugin:
    def test_creates_default_strategy_when_none_exists(self):
        p1, session = _patched_session()
        session.scalar.return_value = None

        with (
            p1,
            patch(f"{MODULE}.select"),
            patch(f"{MODULE}.TenantPluginAutoUpgradeStrategy") as strat_cls,
        ):
            strat_cls.StrategySetting.FIX_ONLY = "fix_only"
            strat_cls.UpgradeMode.EXCLUDE = "exclude"
            from services.plugin.plugin_auto_upgrade_service import PluginAutoUpgradeService

            result = PluginAutoUpgradeService.exclude_plugin(
                "t1",
                "plugin-1",
                PLUGIN_CATEGORY,
            )

        assert result is True
        session.add.assert_called_once()

    def test_appends_to_exclude_list_in_exclude_mode(self):
        p1, session = _patched_session()
        existing = MagicMock()
        existing.upgrade_mode = "exclude"
        existing.exclude_plugins = ["p-existing"]
        session.scalar.return_value = existing

        with p1, patch(f"{MODULE}.select"), patch(f"{MODULE}.TenantPluginAutoUpgradeStrategy") as strat_cls:
            strat_cls.UpgradeMode.EXCLUDE = "exclude"
            strat_cls.UpgradeMode.PARTIAL = "partial"
            strat_cls.UpgradeMode.ALL = "all"
            from services.plugin.plugin_auto_upgrade_service import PluginAutoUpgradeService

            result = PluginAutoUpgradeService.exclude_plugin("t1", "p-new", PLUGIN_CATEGORY)

        assert result is True
        assert existing.exclude_plugins == ["p-existing", "p-new"]

    def test_removes_from_include_list_in_partial_mode(self):
        p1, session = _patched_session()
        existing = MagicMock()
        existing.upgrade_mode = "partial"
        existing.include_plugins = ["p1", "p2"]
        session.scalar.return_value = existing

        with p1, patch(f"{MODULE}.select"), patch(f"{MODULE}.TenantPluginAutoUpgradeStrategy") as strat_cls:
            strat_cls.UpgradeMode.EXCLUDE = "exclude"
            strat_cls.UpgradeMode.PARTIAL = "partial"
            strat_cls.UpgradeMode.ALL = "all"
            from services.plugin.plugin_auto_upgrade_service import PluginAutoUpgradeService

            result = PluginAutoUpgradeService.exclude_plugin("t1", "p1", PLUGIN_CATEGORY)

        assert result is True
        assert existing.include_plugins == ["p2"]

    def test_switches_to_exclude_mode_from_all(self):
        p1, session = _patched_session()
        existing = MagicMock()
        existing.upgrade_mode = "all"
        session.scalar.return_value = existing

        with p1, patch(f"{MODULE}.select"), patch(f"{MODULE}.TenantPluginAutoUpgradeStrategy") as strat_cls:
            strat_cls.UpgradeMode.EXCLUDE = "exclude"
            strat_cls.UpgradeMode.PARTIAL = "partial"
            strat_cls.UpgradeMode.ALL = "all"
            from services.plugin.plugin_auto_upgrade_service import PluginAutoUpgradeService

            result = PluginAutoUpgradeService.exclude_plugin("t1", "p1", PLUGIN_CATEGORY)

        assert result is True
        assert existing.upgrade_mode == "exclude"
        assert existing.exclude_plugins == ["p1"]

    def test_no_duplicate_in_exclude_list(self):
        p1, session = _patched_session()
        existing = MagicMock()
        existing.upgrade_mode = "exclude"
        existing.exclude_plugins = ["p1"]
        session.scalar.return_value = existing

        with p1, patch(f"{MODULE}.select"), patch(f"{MODULE}.TenantPluginAutoUpgradeStrategy") as strat_cls:
            strat_cls.UpgradeMode.EXCLUDE = "exclude"
            strat_cls.UpgradeMode.PARTIAL = "partial"
            strat_cls.UpgradeMode.ALL = "all"
            from services.plugin.plugin_auto_upgrade_service import PluginAutoUpgradeService

            PluginAutoUpgradeService.exclude_plugin("t1", "p1", PLUGIN_CATEGORY)

        assert existing.exclude_plugins == ["p1"]


class TestBackfillStrategyCategories:
    def test_creates_default_missing_categories_without_fetching_daemon(self):
        p1, session = _patched_session()
        tool_strategy = SimpleNamespace(
            category=TenantPluginAutoUpgradeStrategy.PluginCategory.TOOL,
            strategy_setting=TenantPluginAutoUpgradeStrategy.StrategySetting.FIX_ONLY,
            upgrade_time_of_day=0,
            upgrade_mode=TenantPluginAutoUpgradeStrategy.UpgradeMode.EXCLUDE,
            exclude_plugins=[],
            include_plugins=[],
        )
        session.scalars.return_value.all.return_value = [tool_strategy]
        installer = MagicMock()

        with p1, patch(f"{MODULE}.PluginInstaller", return_value=installer):
            from services.plugin.plugin_auto_upgrade_service import PluginAutoUpgradeService

            result = PluginAutoUpgradeService.backfill_strategy_categories("t1")
            expected_time = PluginAutoUpgradeService.default_upgrade_time_of_day("t1")

        assert result.created_count == len(TenantPluginAutoUpgradeStrategy.PluginCategory) - 1
        assert result.normalized is False
        installer.list_plugins.assert_not_called()
        assert tool_strategy.upgrade_time_of_day == expected_time
        created_strategies = [call.args[0] for call in session.add.call_args_list]
        model_strategy = next(
            strategy
            for strategy in created_strategies
            if strategy.category == TenantPluginAutoUpgradeStrategy.PluginCategory.MODEL
        )
        assert model_strategy.strategy_setting == TenantPluginAutoUpgradeStrategy.StrategySetting.LATEST
        assert model_strategy.upgrade_time_of_day == expected_time

    def test_default_upgrade_time_is_aligned_to_fifteen_minutes(self):
        from services.plugin.plugin_auto_upgrade_service import PluginAutoUpgradeService

        default_time = PluginAutoUpgradeService.default_upgrade_time_of_day("t1")

        assert default_time % (15 * 60) == 0
        assert 0 <= default_time < 24 * 60 * 60

    def test_creates_missing_categories_and_splits_known_plugins(self):
        p1, session = _patched_session()
        tool_strategy = SimpleNamespace(
            category=TenantPluginAutoUpgradeStrategy.PluginCategory.TOOL,
            strategy_setting=TenantPluginAutoUpgradeStrategy.StrategySetting.FIX_ONLY,
            upgrade_time_of_day=0,
            upgrade_mode=TenantPluginAutoUpgradeStrategy.UpgradeMode.EXCLUDE,
            exclude_plugins=["tool-plugin", "model-plugin", "unknown-plugin"],
            include_plugins=["model-plugin", "tool-plugin"],
        )
        model_strategy = SimpleNamespace(
            category=TenantPluginAutoUpgradeStrategy.PluginCategory.MODEL,
            strategy_setting=TenantPluginAutoUpgradeStrategy.StrategySetting.FIX_ONLY,
            upgrade_time_of_day=0,
            upgrade_mode=TenantPluginAutoUpgradeStrategy.UpgradeMode.EXCLUDE,
            exclude_plugins=["tool-plugin", "model-plugin", "unknown-plugin"],
            include_plugins=["model-plugin", "tool-plugin"],
        )
        session.scalars.return_value.all.return_value = [tool_strategy, model_strategy]

        installed_plugins = [
            SimpleNamespace(
                plugin_id="tool-plugin",
                declaration=SimpleNamespace(category=TenantPluginAutoUpgradeStrategy.PluginCategory.TOOL),
            ),
            SimpleNamespace(
                plugin_id="model-plugin",
                declaration=SimpleNamespace(category=TenantPluginAutoUpgradeStrategy.PluginCategory.MODEL),
            ),
        ]
        installer = MagicMock()
        installer.list_plugins.return_value = installed_plugins

        with p1, patch(f"{MODULE}.PluginInstaller", return_value=installer), patch(f"{MODULE}.logger") as logger:
            from services.plugin.plugin_auto_upgrade_service import PluginAutoUpgradeService

            result = PluginAutoUpgradeService.backfill_strategy_categories("t1")

        assert result.created_count == len(TenantPluginAutoUpgradeStrategy.PluginCategory) - 2
        assert result.normalized is True
        assert session.add.call_count == len(TenantPluginAutoUpgradeStrategy.PluginCategory) - 2
        assert tool_strategy.exclude_plugins == ["tool-plugin"]
        assert tool_strategy.include_plugins == ["tool-plugin"]
        assert model_strategy.exclude_plugins == ["model-plugin"]
        assert model_strategy.include_plugins == ["model-plugin"]
        logger.warning.assert_called_once_with(
            "Skipped unknown plugin IDs while backfilling plugin auto-upgrade strategies: "
            "tenant_id=%s, field=%s, plugin_ids=%s",
            "t1",
            "exclude_plugins",
            ["unknown-plugin"],
        )
