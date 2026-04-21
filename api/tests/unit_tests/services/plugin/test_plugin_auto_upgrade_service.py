from unittest.mock import MagicMock, patch

from models.account import TenantPluginAutoUpgradeStrategy

MODULE = "services.plugin.plugin_auto_upgrade_service"


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

            result = PluginAutoUpgradeService.get_strategy("t1")

        assert result is strategy

    def test_returns_none_when_not_found(self):
        p1, session = _patched_session()
        session.scalar.return_value = None

        with p1:
            from services.plugin.plugin_auto_upgrade_service import PluginAutoUpgradeService

            result = PluginAutoUpgradeService.get_strategy("t1")

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
            patch(f"{MODULE}.PluginAutoUpgradeService.change_strategy") as cs,
        ):
            strat_cls.StrategySetting.FIX_ONLY = "fix_only"
            strat_cls.UpgradeMode.EXCLUDE = "exclude"
            cs.return_value = True
            from services.plugin.plugin_auto_upgrade_service import PluginAutoUpgradeService

            result = PluginAutoUpgradeService.exclude_plugin("t1", "plugin-1")

        assert result is True
        cs.assert_called_once()

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

            result = PluginAutoUpgradeService.exclude_plugin("t1", "p-new")

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

            result = PluginAutoUpgradeService.exclude_plugin("t1", "p1")

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

            result = PluginAutoUpgradeService.exclude_plugin("t1", "p1")

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

            PluginAutoUpgradeService.exclude_plugin("t1", "p1")

        assert existing.exclude_plugins == ["p1"]
