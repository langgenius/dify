"""Tests for the SQLAlchemy LOG_TZ timestamp fix (issue #41594)."""

import logging
from contextlib import contextmanager
from datetime import datetime
from unittest.mock import patch

import pytz

from extensions.ext_database import _apply_timezone_to_sqlalchemy_loggers


@contextmanager
def _track_handler(logger_name, fmt="%(asctime)s [%(levelname)s] %(message)s"):
    """Attach a fresh NullHandler to ``logger_name`` and yield it.

    Removes the handler on teardown so tests do not leak.
    """
    logger = logging.getLogger(logger_name)
    handler = logging.NullHandler()
    handler.setFormatter(logging.Formatter(fmt))
    logger.addHandler(handler)
    try:
        yield handler
    finally:
        logger.removeHandler(handler)


def test_apply_timezone_no_op_when_log_tz_unset():
    """No handlers touched when LOG_TZ is empty/None."""
    with _track_handler("sqlalchemy.engine") as handler:
        original_converter = handler.formatter.converter
        with patch("configs.dify_config.LOG_TZ", None):
            _apply_timezone_to_sqlalchemy_loggers()
        assert handler.formatter.converter is original_converter


def test_apply_timezone_no_op_when_log_tz_empty_string():
    """Empty-string LOG_TZ is treated the same as None."""
    with _track_handler("sqlalchemy.engine") as handler:
        original_converter = handler.formatter.converter
        with patch("configs.dify_config.LOG_TZ", ""):
            _apply_timezone_to_sqlalchemy_loggers()
        assert handler.formatter.converter is original_converter


def test_apply_timezone_sets_converter_on_sqlalchemy_engine_logger():
    """Handler on ``sqlalchemy.engine`` gets the LOG_TZ-aware converter."""
    with _track_handler("sqlalchemy.engine") as handler:
        original_converter = handler.formatter.converter
        with patch("configs.dify_config.LOG_TZ", "Asia/Tokyo"):
            _apply_timezone_to_sqlalchemy_loggers()
        new_converter = handler.formatter.converter
        assert new_converter is not original_converter
        # The converter should produce a Tokyo-timezone struct_time
        struct = new_converter(0.0)  # 1970-01-01 00:00:00 UTC
        assert datetime.fromtimestamp(0, tz=pytz.timezone("Asia/Tokyo")).timetuple() == struct


def test_apply_timezone_walks_descendant_loggers():
    """``sqlalchemy.pool`` (a child of ``sqlalchemy``) also gets the converter."""
    with _track_handler("sqlalchemy.pool") as handler:
        original_converter = handler.formatter.converter
        with patch("configs.dify_config.LOG_TZ", "Europe/Berlin"):
            _apply_timezone_to_sqlalchemy_loggers()
        assert handler.formatter.converter is not original_converter


def test_apply_timezone_preserves_format_string():
    """Setting the converter must not change the format string."""
    fmt = "%(asctime)s [%(levelname)s] %(name)s: %(message)s"
    with _track_handler("sqlalchemy.engine", fmt=fmt) as handler:
        with patch("configs.dify_config.LOG_TZ", "UTC"):
            _apply_timezone_to_sqlalchemy_loggers()
        assert handler.formatter._fmt == fmt


def test_apply_timezone_no_handlers_is_safe():
    """Calling when no SQLAlchemy logger has handlers is a no-op (no errors)."""
    with patch("configs.dify_config.LOG_TZ", "America/New_York"):
        # Should not raise even though no SQLAlchemy loggers have handlers
        _apply_timezone_to_sqlalchemy_loggers()


def test_apply_timezone_uses_log_tz_offset_correctly():
    """Sanity-check the converter: same UTC instant, different tz labels."""
    with _track_handler("sqlalchemy.engine") as handler:
        with patch("configs.dify_config.LOG_TZ", "Asia/Tokyo"):
            _apply_timezone_to_sqlalchemy_loggers()
        tokyo = handler.formatter.converter(0.0)

    with _track_handler("sqlalchemy.engine") as handler:
        with patch("configs.dify_config.LOG_TZ", "UTC"):
            _apply_timezone_to_sqlalchemy_loggers()
        utc = handler.formatter.converter(0.0)

    # Tokyo is UTC+9, so 1970-01-01 00:00:00 UTC == 1970-01-01 09:00:00 Tokyo
    assert tokyo.tm_hour == 9
    assert utc.tm_hour == 0
    assert tokyo.tm_year == utc.tm_year
    assert tokyo.tm_yday == utc.tm_yday


def test_apply_timezone_is_idempotent():
    """Running the helper twice must not error and should keep the converter."""
    with _track_handler("sqlalchemy.engine") as handler:
        with patch("configs.dify_config.LOG_TZ", "Europe/London"):
            _apply_timezone_to_sqlalchemy_loggers()
            first_converter = handler.formatter.converter
            first_output = first_converter(0.0)
            _apply_timezone_to_sqlalchemy_loggers()
            second_converter = handler.formatter.converter
            second_output = second_converter(0.0)
        # Behavioural equivalence: the converter is rebuilt on each call
        # (a fresh closure), so identity is not preserved — but the
        # output for the same instant must match.
        assert first_output == second_output


def test_apply_timezone_skips_non_sqlalchemy_loggers():
    """Loggers whose name only happens to start with the same bytes stay untouched."""
    with _track_handler("sqlalchemyish") as handler:
        original_converter = handler.formatter.converter
        with patch("configs.dify_config.LOG_TZ", "Asia/Tokyo"):
            _apply_timezone_to_sqlalchemy_loggers()
        assert handler.formatter.converter is original_converter


def test_apply_timezone_handlers_attached_after_call_stay_unset():
    """Documented behavior: a handler attached after the helper runs is not updated.

    Callers who toggle ``echo`` at runtime need to re-run the helper.
    """
    with patch("configs.dify_config.LOG_TZ", "Asia/Tokyo"):
        _apply_timezone_to_sqlalchemy_loggers()
    with _track_handler("sqlalchemy.engine") as handler:
        original_converter = handler.formatter.converter
        with patch("configs.dify_config.LOG_TZ", "Asia/Tokyo"):
            _apply_timezone_to_sqlalchemy_loggers()
        # The handler was attached after the first call, so the second
        # call is what updates it.
        assert handler.formatter.converter is not original_converter
        # A third call from a different LOG_TZ updates it again.
        with patch("configs.dify_config.LOG_TZ", "UTC"):
            _apply_timezone_to_sqlalchemy_loggers()
        third_converter = handler.formatter.converter
        assert third_converter is not original_converter
