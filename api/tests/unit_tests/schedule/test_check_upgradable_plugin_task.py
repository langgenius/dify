"""Plugin batch pacing must not occupy the worker between batches."""

import importlib.util
import sys
import time
from collections.abc import Iterator
from pathlib import Path
from threading import Event
from types import ModuleType
from uuid import uuid4

import pytest
from celery import Celery
from celery.contrib.testing.worker import start_worker
from sqlalchemy.orm import Session

from models.account import (
    TenantPluginAutoUpgradeCategory,
    TenantPluginAutoUpgradeMode,
    TenantPluginAutoUpgradeStrategy,
    TenantPluginAutoUpgradeStrategySetting,
)
from tests.unit_tests.celery_fixtures import preserve_celery_apps

pytestmark = pytest.mark.usefixtures(preserve_celery_apps.__name__)


@pytest.fixture
def poller(monkeypatch: pytest.MonkeyPatch, sqlite_session: Session) -> Iterator[ModuleType]:
    # Load this scheduler against a real, isolated Celery owner, not the runtime
    # app initializer. Restore the app module and close the owner after each test.
    celery = Celery("plugin-pacing-test", broker="memory://", set_as_current=False)
    application = ModuleType("app")
    application.__dict__["celery"] = celery
    monkeypatch.setitem(sys.modules, "app", application)
    path = Path(__file__).parents[3] / "schedule/check_upgradable_plugin_task.py"
    spec = importlib.util.spec_from_file_location("plugin_pacing_test_schedule", path)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    monkeypatch.setattr(module.db, "session", sqlite_session)
    monkeypatch.setattr(module, "fetch_global_plugin_manifest", lambda *_args: 1)
    yield module
    celery.close()


@pytest.mark.parametrize("count", [0, 1, 20, 21, 24, 41])
def test_batches_are_paced_without_sleeping_in_worker(
    poller: ModuleType, sqlite_session: Session, monkeypatch: pytest.MonkeyPatch, count: int
) -> None:
    monkeypatch.setattr(poller.time, "time", lambda: 3600.0)
    strategies = [
        TenantPluginAutoUpgradeStrategy(
            tenant_id=str(uuid4()),
            category=TenantPluginAutoUpgradeCategory.TOOL,
            strategy_setting=TenantPluginAutoUpgradeStrategySetting.FIX_ONLY,
            upgrade_time_of_day=3700,
            upgrade_mode=TenantPluginAutoUpgradeMode.EXCLUDE,
            exclude_plugins=["langgenius/example"],
        )
        for _ in range(count)
    ]
    sqlite_session.add_all(strategies)
    sqlite_session.commit()
    calls: list[tuple[tuple[object, ...], float]] = []

    def publish(args: tuple[object, ...], kwargs: dict[str, object] | None = None, *, countdown: float = 0) -> None:
        assert not kwargs
        calls.append((args, countdown))

    def no_worker_sleep(_seconds: float) -> None:
        pytest.fail("Plugin poller must release the worker slot instead of sleeping between batches")

    task = poller.check_task.process_tenant_plugin_autoupgrade_check_task
    monkeypatch.setattr(task, "apply_async", publish)
    monkeypatch.setattr(poller.time, "sleep", no_worker_sleep)
    poller.check_upgradable_plugin_task.run()
    assert len(calls) == count
    batches = (count + 19) // 20
    for index, (args, countdown) in enumerate(calls):
        assert countdown == (index // 20) * 900 / batches
        assert args[1:] == (
            TenantPluginAutoUpgradeStrategySetting.FIX_ONLY,
            3700,
            TenantPluginAutoUpgradeMode.EXCLUDE,
            ["langgenius/example"],
            [],
            TenantPluginAutoUpgradeCategory.TOOL,
        )
    assert {args[0] for args, _ in calls} == {strategy.tenant_id for strategy in strategies}


def test_single_worker_runs_ready_task_before_delayed_plugin_batch(
    poller: ModuleType, sqlite_session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    now = int(time.time() % 86400) - 20
    strategies = [TenantPluginAutoUpgradeStrategy(tenant_id=str(uuid4()), upgrade_time_of_day=now) for _ in range(21)]
    sqlite_session.add_all(strategies)
    sqlite_session.commit()
    celery = poller.check_upgradable_plugin_task.app
    celery.conf.update(
        result_backend="cache+memory://",
        worker_prefetch_multiplier=1,
        worker_timer_precision=0.05,
        broker_transport_options={"polling_interval": 0.05},
    )
    # Pytest owns logging sinks; the embedded worker must not replace them.
    monkeypatch.setattr(type(celery.log), "_setup", type(celery.log)._setup)
    monkeypatch.setattr(celery.log, "setup", lambda **_kwargs: None)
    order: list[str] = []
    done = Event()

    @celery.task(name="plugin-pacing-synthetic-child", queue="plugin")
    def child(tenant_id: str, *_args: object) -> None:
        order.append(tenant_id)
        if len(order) == 22:
            done.set()

    @celery.task(name="plugin-pacing-synthetic-builder", queue="dify_builder")
    def ready() -> None:
        order.append("builder")
        if len(order) == 22:
            done.set()

    publisher = ModuleType("synthetic_plugin_tasks")
    publisher.__dict__["process_tenant_plugin_autoupgrade_check_task"] = child
    monkeypatch.setattr(poller, "check_task", publisher)
    # Same two-batch shape as Dev, with a bounded ten-second delayed batch.
    monkeypatch.setattr(poller, "AUTO_UPGRADE_MINIMAL_CHECKING_INTERVAL", 20)
    with start_worker(celery, pool="solo", concurrency=1, queues=("plugin", "dify_builder"), perform_ping_check=False):
        poller.check_upgradable_plugin_task.apply_async().get(timeout=5)
        ready.apply_async()
        assert done.wait(20), order
    assert len(order) == 22
    assert set(order) == {"builder", *(strategy.tenant_id for strategy in strategies)}
    assert order.index("builder") < 21
