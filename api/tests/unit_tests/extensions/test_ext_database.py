from collections.abc import Callable, Iterator

import pytest
from sqlalchemy import Engine, create_engine
from sqlalchemy.pool import QueuePool

from extensions.ext_database import install_connection_hold_monitor


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
