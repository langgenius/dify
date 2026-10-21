"""Real application logging initialization and SQL telemetry routes; no SQL IO."""

import io
import logging
from collections.abc import Iterator
from datetime import UTC, datetime

import pytest

from configs.feature import LoggingConfig
from dify_app import DifyApp
from extensions import ext_logging
from libs.sensitive_http_telemetry import (
    SensitiveHttpLogFilter,
    SensitiveHttpTelemetryUnavailable,
    assert_sensitive_http_telemetry_ready,
    sensitive_http_telemetry,
)
from tests.helpers.unit.config_override import apply_config_overrides, config_overrides_context
from tests.unit_tests.logging_helpers import protect_existing_log_routes


@pytest.fixture
def application_logging(monkeypatch: pytest.MonkeyPatch) -> Iterator[io.StringIO]:
    """Own actual app sinks and restore the original process logging configuration."""
    from libs.sensitive_http_telemetry import _HTTP_LOGGERS

    protect_existing_log_routes(monkeypatch, emitters=(*_HTTP_LOGGERS, "sqlalchemy"))
    root = logging.getLogger()
    engine = logging.getLogger("sqlalchemy.engine")
    root_handlers, root_level = root.handlers, root.level
    engine_handlers, engine_level, engine_propagation = engine.handlers, engine.level, engine.propagate
    output = io.StringIO()
    original_filters = {handler: handler.filters[:] for handler in root_handlers}
    # Pytest reattaches its capture sinks at call time; they are test-owned too.
    for handler in root_handlers:
        handler.addFilter(SensitiveHttpLogFilter())
    # Avoid basicConfig(force=True) closing pytest's existing sinks.
    root.handlers = []
    engine.handlers = []
    engine.setLevel(logging.NOTSET)
    engine.propagate = False
    apply_config_overrides(monkeypatch, LOG_FILE=None, LOG_LEVEL="INFO", LOG_OUTPUT_FORMAT="text", LOG_TZ="")
    monkeypatch.setattr(ext_logging.sys, "stdout", output)
    try:
        ext_logging.init_app(DifyApp(__name__))
        owned_handlers = root.handlers[:]
        yield output
    finally:
        for handler in owned_handlers:
            handler.close()
        for handler, filters in original_filters.items():
            handler.filters = filters
        root.handlers = root_handlers
        root.setLevel(root_level)
        engine.handlers = engine_handlers
        engine.setLevel(engine_level)
        engine.propagate = engine_propagation


def test_normal_app_logging_protects_sql_errors_and_preserves_warning_threshold(
    application_logging: io.StringIO,
) -> None:
    engine = logging.getLogger("sqlalchemy.engine")
    assert_sensitive_http_telemetry_ready(additional_emitters=("sqlalchemy",))
    assert engine.propagate is True
    assert engine.level == logging.WARNING
    with sensitive_http_telemetry(additional_emitters=("sqlalchemy",)):
        engine.error("PRIVATE_SQL_ERROR_CANARY_5a6b")
    engine.info("ordinary-sql-info-suppressed")
    engine.warning("ordinary-sql-warning-visible")
    output = application_logging.getvalue()
    assert "PRIVATE_SQL_ERROR_CANARY_5a6b" not in output
    assert "ordinary-sql-info-suppressed" not in output
    assert "ordinary-sql-warning-visible" in output


@pytest.mark.usefixtures("application_logging")
def test_custom_unprotected_sql_sink_still_refuses_after_normal_init() -> None:
    assert_sensitive_http_telemetry_ready(additional_emitters=("sqlalchemy",))
    engine = logging.getLogger("sqlalchemy.engine")
    custom = logging.StreamHandler(io.StringIO())
    engine.addHandler(custom)
    try:
        with pytest.raises(SensitiveHttpTelemetryUnavailable):
            assert_sensitive_http_telemetry_ready(additional_emitters=("sqlalchemy",))
    finally:
        engine.removeHandler(custom)
        custom.close()


@pytest.mark.parametrize(
    ("configured", "expected_local_time"),
    [
        ("utc", "2026-01-15 12:00:00"),
        ("asia/shanghai", "2026-01-15 20:00:00"),
    ],
)
def test_apply_timezone_uses_validated_logging_config(configured: str, expected_local_time: str) -> None:
    logging_config = LoggingConfig(LOG_TZ=configured)
    assert logging_config.LOG_TZ is not None

    handler = logging.StreamHandler()
    handler.setFormatter(logging.Formatter("%(asctime)s", datefmt="%Y-%m-%d %H:%M:%S"))
    try:
        with config_overrides_context(LOG_TZ=logging_config.LOG_TZ):
            ext_logging._apply_timezone([handler])

        record = logging.LogRecord(__name__, logging.INFO, __file__, 1, "timezone check", (), None)
        record.created = datetime(2026, 1, 15, 12, tzinfo=UTC).timestamp()

        assert handler.format(record) == expected_local_time
    finally:
        handler.close()
