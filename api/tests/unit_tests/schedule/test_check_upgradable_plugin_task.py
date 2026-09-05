"""Unit tests for ``check_upgradable_plugin_task`` strategy selection.

The task dispatches upgrade checks for auto-upgrade strategies whose
``upgrade_time_of_day`` falls inside the current checking window. Sessions
are provided by the shared SQLite session factory, which proves the task no
longer depends on the global Flask-SQLAlchemy session.
"""

import time
import uuid
from unittest.mock import patch

import pytest
from sqlalchemy.orm import Session, sessionmaker

import schedule.check_upgradable_plugin_task as check_upgradable_module
from models.account import TenantPluginAutoUpgradeStrategy, TenantPluginAutoUpgradeStrategySetting
from schedule.check_upgradable_plugin_task import (
    AUTO_UPGRADE_MINIMAL_CHECKING_INTERVAL,
    check_upgradable_plugin_task,
)


def _make_strategy(
    *, upgrade_time_of_day: int, setting: TenantPluginAutoUpgradeStrategySetting
) -> TenantPluginAutoUpgradeStrategy:
    return TenantPluginAutoUpgradeStrategy(
        tenant_id=str(uuid.uuid4()),
        strategy_setting=setting,
        upgrade_time_of_day=upgrade_time_of_day,
    )


@pytest.fixture
def seeded_strategies(sqlite_session_factory: sessionmaker[Session]) -> dict[str, str]:
    """Seed strategies covering each branch of the selection window."""
    window_start = int(time.time() % 86400 - 30)
    in_window = window_start + 60
    out_of_window = window_start + AUTO_UPGRADE_MINIMAL_CHECKING_INTERVAL + 3600

    strategies = {
        "in_window": _make_strategy(
            upgrade_time_of_day=in_window, setting=TenantPluginAutoUpgradeStrategySetting.FIX_ONLY
        ),
        "out_of_window": _make_strategy(
            upgrade_time_of_day=out_of_window, setting=TenantPluginAutoUpgradeStrategySetting.FIX_ONLY
        ),
        "disabled": _make_strategy(
            upgrade_time_of_day=in_window, setting=TenantPluginAutoUpgradeStrategySetting.DISABLED
        ),
    }
    with sqlite_session_factory() as session:
        for strategy in strategies.values():
            session.add(strategy)
        session.commit()
    return {label: strategy.tenant_id for label, strategy in strategies.items()}


def test_dispatches_only_in_window_enabled_strategies(seeded_strategies: dict[str, str]) -> None:
    with (
        patch.object(check_upgradable_module, "fetch_global_plugin_manifest"),
        patch.object(
            check_upgradable_module.check_task, "process_tenant_plugin_autoupgrade_check_task"
        ) as mock_check_task,
    ):
        check_upgradable_plugin_task()

    dispatched_tenants = [call.args[0] for call in mock_check_task.delay.call_args_list]
    assert dispatched_tenants == [seeded_strategies["in_window"]]
