from __future__ import annotations

import logging
import time

import pytest

from extensions import ext_logging
from tests.unit_tests.config_override import apply_config_overrides

# Captures a fixed instant so the test is timezone-independent of the host clock.
_FIXED_TS = 1_700_000_000  # 2023-11-14T22:13:20Z


def _make_handler_with_formatter() -> logging.Handler:
    """Build a StreamHandler with a default text formatter, mirroring what
    SQLAlchemy attaches to ``sqlalchemy.engine`` when ``SQLALCHEMY_ECHO`` is on.
    """
    handler = logging.StreamHandler()
    handler.setFormatter(logging.Formatter(fmt="%(asctime)s %(message)s"))
    return handler


class TestApplyTimezoneToSqlalchemyLoggers:
    def test_no_op_when_output_format_is_json(self, monkeypatch: pytest.MonkeyPatch):
        apply_config_overrides(monkeypatch, LOG_OUTPUT_FORMAT="json", LOG_TZ="Asia/Tokyo")
        handler = _make_handler_with_formatter()
        log = logging.getLogger("sqlalchemy.engine")
        log.addHandler(handler)
        try:
            ext_logging.apply_timezone_to_sqlalchemy_loggers()
            # JSON output: converter must remain the default (local time).
            assert handler.formatter.converter is logging.Formatter.converter
        finally:
            log.removeHandler(handler)

    def test_no_op_when_log_tz_is_unset(self, monkeypatch: pytest.MonkeyPatch):
        apply_config_overrides(monkeypatch, LOG_OUTPUT_FORMAT="text", LOG_TZ="")
        handler = _make_handler_with_formatter()
        log = logging.getLogger("sqlalchemy.engine")
        log.addHandler(handler)
        try:
            ext_logging.apply_timezone_to_sqlalchemy_loggers()
            assert handler.formatter.converter is logging.Formatter.converter
        finally:
            log.removeHandler(handler)

    def test_applies_timezone_converter_to_sqlalchemy_engine_handler(self, monkeypatch: pytest.MonkeyPatch):
        apply_config_overrides(monkeypatch, LOG_OUTPUT_FORMAT="text", LOG_TZ="Asia/Tokyo")
        handler = _make_handler_with_formatter()
        log = logging.getLogger("sqlalchemy.engine")
        log.addHandler(handler)
        try:
            ext_logging.apply_timezone_to_sqlalchemy_loggers()

            # The formatter's converter must now produce a Tokyo-time tuple
            # from a fixed timestamp, not local time.
            local_tuple = time.localtime(_FIXED_TS)
            tokyo_tuple = handler.formatter.converter(_FIXED_TS)
            assert tokyo_tuple != local_tuple

            # Sanity: the offset must be Tokyo (+09:00) at that instant.
            assert tokyo_tuple.tm_hour == 7
            assert time.strftime("%Y-%m-%d %H:%M:%S", tokyo_tuple) == "2023-11-15 07:13:20"
        finally:
            log.removeHandler(handler)

    def test_applies_timezone_to_subloggers(self, monkeypatch: pytest.MonkeyPatch):
        apply_config_overrides(monkeypatch, LOG_OUTPUT_FORMAT="text", LOG_TZ="Asia/Tokyo")
        engine_handler = _make_handler_with_formatter()
        pool_handler = _make_handler_with_formatter()
        log_engine = logging.getLogger("sqlalchemy.engine")
        log_pool = logging.getLogger("sqlalchemy.pool")
        log_engine.addHandler(engine_handler)
        log_pool.addHandler(pool_handler)
        try:
            ext_logging.apply_timezone_to_sqlalchemy_loggers()
            assert engine_handler.formatter.converter is not logging.Formatter.converter
            assert pool_handler.formatter.converter is not logging.Formatter.converter
        finally:
            log_engine.removeHandler(engine_handler)
            log_pool.removeHandler(pool_handler)

    def test_handles_handler_without_formatter(self, monkeypatch: pytest.MonkeyPatch):
        """A handler with no formatter must be left alone (we only patch
        existing ``logging.Formatter`` instances), and the call must not raise.
        """
        apply_config_overrides(monkeypatch, LOG_OUTPUT_FORMAT="text", LOG_TZ="Asia/Tokyo")
        handler = logging.StreamHandler()  # no formatter set
        assert handler.formatter is None
        log = logging.getLogger("sqlalchemy.engine")
        log.addHandler(handler)
        try:
            ext_logging.apply_timezone_to_sqlalchemy_loggers()  # must not raise
            assert handler.formatter is None
        finally:
            log.removeHandler(handler)

    def test_is_idempotent(self, monkeypatch: pytest.MonkeyPatch):
        apply_config_overrides(monkeypatch, LOG_OUTPUT_FORMAT="text", LOG_TZ="Asia/Tokyo")
        handler = _make_handler_with_formatter()
        log = logging.getLogger("sqlalchemy.engine")
        log.addHandler(handler)
        try:
            ext_logging.apply_timezone_to_sqlalchemy_loggers()
            converter_after_first_call = handler.formatter.converter
            ext_logging.apply_timezone_to_sqlalchemy_loggers()
            ext_logging.apply_timezone_to_sqlalchemy_loggers()
            # The converter must be stable across repeated calls (the same
            # ``time_converter`` closure rebinds each time, but the only
            # guarantee we need is that the formatter remains patched and
            # keeps producing a non-local tuple).
            assert handler.formatter.converter is not logging.Formatter.converter
            assert handler.formatter.converter(_FIXED_TS)[3] == 7  # hour in Tokyo
            del converter_after_first_call
        finally:
            log.removeHandler(handler)
