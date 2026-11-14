"""ConnectionHoldMonitor against a real SQLAlchemy queue pool, with a clock the test advances."""

import logging
from collections.abc import Callable, Iterator

import pytest
from sqlalchemy import Connection, Engine, create_engine
from sqlalchemy.pool import QueuePool

from core.db.connection_hold_monitor import ConnectionHoldMonitor

MONITOR_LOGGER = "core.db.connection_hold_monitor"
THIS_FILE = "tests/unit_tests/core/db/test_connection_hold_monitor.py"


@pytest.fixture
def engine() -> Iterator[Engine]:
    engine = create_engine("sqlite://", poolclass=QueuePool, pool_size=3, max_overflow=0)
    yield engine
    engine.dispose()


@pytest.fixture
def clock() -> tuple[Callable[[], float], Callable[[float], None]]:
    """Return ``(read, advance)`` for a clock that only moves when the test advances it."""
    now = [1000.0]

    def read() -> float:
        return now[0]

    def advance(seconds: float) -> None:
        now[0] += seconds

    return read, advance


def _borrow(engine: Engine) -> Connection:
    return engine.connect()


def _warnings(caplog: pytest.LogCaptureFixture) -> list[str]:
    return [record.getMessage() for record in caplog.records if record.name == MONITOR_LOGGER]


def test_reports_where_a_long_held_connection_was_checked_out(
    engine: Engine, clock: tuple[Callable[[], float], Callable[[float], None]], caplog: pytest.LogCaptureFixture
) -> None:
    read, advance = clock
    ConnectionHoldMonitor(warn_after_seconds=5, clock=read).install(engine.pool)
    caplog.set_level(logging.WARNING, logger=MONITOR_LOGGER)

    connection = _borrow(engine)
    advance(7.5)
    connection.close()

    (message,) = _warnings(caplog)
    assert "held for 7.5 s (limit 5.0 s)" in message
    assert f"checked out at {THIS_FILE}:" in message
    assert " in _borrow, called from " in message
    assert " in test_reports_where_a_long_held_connection_was_checked_out" in message


def test_stays_quiet_when_the_connection_returns_within_the_limit(
    engine: Engine, clock: tuple[Callable[[], float], Callable[[float], None]], caplog: pytest.LogCaptureFixture
) -> None:
    read, advance = clock
    ConnectionHoldMonitor(warn_after_seconds=5, clock=read).install(engine.pool)
    caplog.set_level(logging.WARNING, logger=MONITOR_LOGGER)

    connection = _borrow(engine)
    advance(4.9)
    connection.close()

    assert _warnings(caplog) == []


def test_holds_lists_connections_until_they_are_returned_or_detached(
    engine: Engine, clock: tuple[Callable[[], float], Callable[[float], None]]
) -> None:
    read, advance = clock
    monitor = ConnectionHoldMonitor(warn_after_seconds=5, clock=read)
    monitor.install(engine.pool)

    first = _borrow(engine)
    advance(1)
    second = _borrow(engine)
    third = _borrow(engine)
    assert [hold.since for hold in monitor.holds()] == [1000.0, 1001.0, 1001.0]

    first.close()
    second.detach()
    assert [hold.since for hold in monitor.holds()] == [1001.0]
    assert monitor.describe_holders().startswith(f"1 x {THIS_FILE}:")

    second.close()
    third.close()
    assert monitor.holds() == []
    assert monitor.describe_holders() == "none"


def test_names_the_holders_when_every_pooled_connection_is_checked_out(
    engine: Engine, clock: tuple[Callable[[], float], Callable[[float], None]], caplog: pytest.LogCaptureFixture
) -> None:
    read, advance = clock
    ConnectionHoldMonitor(warn_after_seconds=60, capacity=3, clock=read).install(engine.pool)
    caplog.set_level(logging.WARNING, logger=MONITOR_LOGGER)

    connections = [_borrow(engine), _borrow(engine)]
    assert _warnings(caplog) == []
    advance(12)
    connections.append(_borrow(engine))

    (message,) = _warnings(caplog)
    assert "fully checked out (3 of 3)" in message
    assert f"Holders: 3 x {THIS_FILE}:" in message
    assert "(oldest 12.0 s)" in message
    for connection in connections:
        connection.close()


def test_limits_reports_per_checkout_site_and_counts_the_ones_left_out(
    engine: Engine, clock: tuple[Callable[[], float], Callable[[float], None]], caplog: pytest.LogCaptureFixture
) -> None:
    read, advance = clock
    ConnectionHoldMonitor(warn_after_seconds=1, report_interval_seconds=10, clock=read).install(engine.pool)
    caplog.set_level(logging.WARNING, logger=MONITOR_LOGGER)

    for _ in range(3):
        connection = _borrow(engine)
        advance(2)
        connection.close()
    assert len(_warnings(caplog)) == 1

    advance(10)
    connection = _borrow(engine)
    advance(2)
    connection.close()

    messages = _warnings(caplog)
    assert len(messages) == 2
    assert messages[0].endswith("0 similar reports left out")
    assert messages[1].endswith("2 similar reports left out")


def test_limits_pool_reports_and_counts_the_ones_left_out(
    engine: Engine, clock: tuple[Callable[[], float], Callable[[float], None]], caplog: pytest.LogCaptureFixture
) -> None:
    read, advance = clock
    ConnectionHoldMonitor(warn_after_seconds=60, capacity=1, report_interval_seconds=10, clock=read).install(
        engine.pool
    )
    caplog.set_level(logging.WARNING, logger=MONITOR_LOGGER)

    for _ in range(3):
        _borrow(engine).close()
    advance(10)
    _borrow(engine).close()

    messages = _warnings(caplog)
    assert len(messages) == 2
    assert "0 earlier reports left out" in messages[0]
    assert "2 earlier reports left out" in messages[1]
