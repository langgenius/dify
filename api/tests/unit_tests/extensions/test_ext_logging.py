import logging
from datetime import UTC, datetime

import pytest

from configs.feature import LoggingConfig
from extensions.ext_logging import _apply_timezone
from tests.helpers.unit.config_override import config_overrides_context


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
            _apply_timezone([handler])

        record = logging.LogRecord(__name__, logging.INFO, __file__, 1, "timezone check", (), None)
        record.created = datetime(2026, 1, 15, 12, tzinfo=UTC).timestamp()

        assert handler.format(record) == expected_local_time
    finally:
        handler.close()
