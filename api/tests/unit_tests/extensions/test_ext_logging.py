import logging
import sys
from datetime import datetime

import pytest
import pytz

from configs import dify_config
from extensions.ext_logging import apply_log_config_to_sqlalchemy_handlers

_SQLALCHEMY_ENGINE_LOGGER = "sqlalchemy.engine.Engine"


@pytest.fixture
def sqlalchemy_engine_handler():
    """Install the same kind of handler SQLAlchemy adds when ``SQLALCHEMY_ECHO`` is enabled."""
    logger = logging.getLogger(_SQLALCHEMY_ENGINE_LOGGER)
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s %(message)s"))
    logger.addHandler(handler)
    try:
        yield handler
    finally:
        logger.removeHandler(handler)


def test_apply_log_config_to_sqlalchemy_handlers_applies_format_and_timezone(
    sqlalchemy_engine_handler: logging.Handler, monkeypatch: pytest.MonkeyPatch
):
    monkeypatch.setattr(dify_config, "LOG_OUTPUT_FORMAT", "text")
    monkeypatch.setattr(dify_config, "LOG_TZ", "Asia/Tokyo")

    apply_log_config_to_sqlalchemy_handlers()

    formatter = sqlalchemy_engine_handler.formatter
    assert formatter is not None
    assert formatter._fmt == dify_config.LOG_FORMAT

    # The converter must report the configured timezone rather than the server default.
    seconds = datetime(2026, 1, 1, 12, 0, 0, tzinfo=pytz.utc).timestamp()
    expected = datetime.fromtimestamp(seconds, tz=pytz.timezone("Asia/Tokyo")).timetuple()
    assert formatter.converter(seconds) == expected  # type: ignore[misc]


def test_apply_log_config_to_sqlalchemy_handlers_without_timezone(
    sqlalchemy_engine_handler: logging.Handler, monkeypatch: pytest.MonkeyPatch
):
    monkeypatch.setattr(dify_config, "LOG_OUTPUT_FORMAT", "text")
    monkeypatch.setattr(dify_config, "LOG_TZ", None)

    apply_log_config_to_sqlalchemy_handlers()

    formatter = sqlalchemy_engine_handler.formatter
    assert formatter is not None
    assert formatter._fmt == dify_config.LOG_FORMAT


def test_apply_log_config_to_sqlalchemy_handlers_is_noop_without_handlers(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(dify_config, "LOG_OUTPUT_FORMAT", "text")
    monkeypatch.setattr(dify_config, "LOG_TZ", "Asia/Tokyo")

    # No handler is installed when echo is disabled, so nothing should be touched or raised.
    apply_log_config_to_sqlalchemy_handlers()

    assert logging.getLogger(_SQLALCHEMY_ENGINE_LOGGER).handlers == []
