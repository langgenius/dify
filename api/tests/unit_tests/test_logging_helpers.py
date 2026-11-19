"""The test logging helper must not leave logging's level cache behind after undo."""

import logging

import pytest
import sqlalchemy  # noqa: F401 - creates the SQLAlchemy loggers the helper qualifies

from tests.unit_tests.logging_helpers import protect_existing_log_routes


@pytest.mark.parametrize("name", ["sqlalchemy.engine.Engine", "sqlalchemy.pool.impl.QueuePool"])
def test_protected_debug_window_leaves_no_cached_enablement_after_undo(name: str) -> None:
    """A DEBUG window must end with monkeypatch: later tests must not log SQL rows.

    Direct ``Logger.level`` patches bypass ``setLevel``'s cache clear. Before the
    helper reset the cache on undo, these loggers kept answering True for DEBUG and
    later tests captured every SQL parameter, including tracing secrets.
    """
    logger = logging.getLogger(name)
    with pytest.MonkeyPatch.context() as monkeypatch:
        protect_existing_log_routes(monkeypatch, emitters=("sqlalchemy",))
        monkeypatch.setattr(logging.getLogger(), "level", logging.DEBUG)
        assert logger.isEnabledFor(logging.DEBUG)
        assert logger.isEnabledFor(logging.INFO)

    for level in (logging.DEBUG, logging.INFO):
        assert logger.isEnabledFor(level) is (logger.getEffectiveLevel() <= level)
