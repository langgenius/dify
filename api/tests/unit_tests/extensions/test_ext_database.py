from collections.abc import Callable, Iterator

import pytest
from sqlalchemy import Engine, create_engine
from sqlalchemy.pool import QueuePool

from core.db.connection_hold_monitor import ConnectionHoldMonitor
from dify_app import DifyApp
from extensions import ext_database
from extensions.ext_database import install_connection_hold_monitor
from models.engine import db


@pytest.fixture
def engine() -> Iterator[Engine]:
    engine = create_engine("sqlite://", poolclass=QueuePool, pool_size=2, max_overflow=0)
    yield engine
    engine.dispose()


def test_connection_hold_monitor_is_off_by_default(engine: Engine, config_overrides: Callable[..., None]) -> None:
    config_overrides(SQLALCHEMY_POOL_HOLD_WARNING_SECONDS=0)

    assert install_connection_hold_monitor(engine) is None


def test_connection_hold_monitor_watches_the_engine_pool_when_enabled(
    engine: Engine, config_overrides: Callable[..., None]
) -> None:
    config_overrides(SQLALCHEMY_POOL_HOLD_WARNING_SECONDS=2.5, SQLALCHEMY_POOL_SIZE=2, SQLALCHEMY_MAX_OVERFLOW=0)

    monitor = install_connection_hold_monitor(engine)

    assert monitor is not None
    with engine.connect():
        assert len(monitor.holds()) == 1
    assert monitor.holds() == []


def test_connection_hold_monitor_reports_a_full_pool_only_when_the_pool_has_a_limit(
    engine: Engine, config_overrides: Callable[..., None], caplog: pytest.LogCaptureFixture
) -> None:
    config_overrides(SQLALCHEMY_POOL_HOLD_WARNING_SECONDS=60, SQLALCHEMY_POOL_SIZE=0, SQLALCHEMY_MAX_OVERFLOW=0)
    monitor = install_connection_hold_monitor(engine)
    assert monitor is not None

    with engine.connect(), engine.connect():
        assert len(monitor.holds()) == 2

    assert [record for record in caplog.records if "fully checked out" in record.getMessage()] == []


@pytest.mark.parametrize(("setting", "installed"), [(0, False), (5, True)])
def test_init_app_installs_the_monitor_on_the_application_engine_when_enabled(
    config_overrides: Callable[..., None], monkeypatch: pytest.MonkeyPatch, setting: float, installed: bool
) -> None:
    config_overrides(SQLALCHEMY_POOL_HOLD_WARNING_SECONDS=setting)
    # The gevent reset hook registers a process-wide pool listener; it is not what this test is about.
    monkeypatch.setattr(ext_database, "_setup_gevent_compatibility", lambda: None)
    app = DifyApp(__name__)
    app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///:memory:"

    ext_database.init_app(app)

    monitor = app.extensions.get("connection_hold_monitor")
    assert isinstance(monitor, ConnectionHoldMonitor) is installed
    if isinstance(monitor, ConnectionHoldMonitor):
        with app.app_context(), db.engine.connect():
            assert len(monitor.holds()) == 1
        assert monitor.holds() == []
