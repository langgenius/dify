import logging
from unittest.mock import patch

import pytest

from extensions.logstore.aliyun_logstore_pg import AliyunLogStorePG

LOGGER_NAME = "extensions.logstore.aliyun_logstore_pg"


@pytest.fixture
def logstore_pg() -> AliyunLogStorePG:
    return AliyunLogStorePG(
        access_key_id="ak",
        access_key_secret="sk",
        endpoint="https://cn-hangzhou.log.aliyuncs.com",
        project_name="project-1",
    )


def test_port_connectivity_failure_logs_traceback_at_debug(
    logstore_pg: AliyunLogStorePG, caplog: pytest.LogCaptureFixture
) -> None:
    """A failed port check logs the traceback via exc_info instead of inlining str(exception)."""
    with (
        patch(
            "extensions.logstore.aliyun_logstore_pg.socket.socket",
            side_effect=OSError("network unreachable"),
        ),
        caplog.at_level(logging.DEBUG, logger=LOGGER_NAME),
    ):
        assert logstore_pg._check_port_connectivity("sls.example.com", 10100) is False

    record = next(r for r in caplog.records if r.name == LOGGER_NAME)

    # The level is unchanged by the exc_info fix: these stay at DEBUG.
    assert record.levelno == logging.DEBUG

    # The traceback is attached to the record rather than discarded.
    assert record.exc_info is not None
    _, exc_value, exc_traceback = record.exc_info
    assert isinstance(exc_value, OSError)
    assert exc_traceback is not None
    assert "Traceback (most recent call last)" in caplog.text
    assert "OSError: network unreachable" in caplog.text

    # The host/port args are preserved, and the exception is no longer inlined into the message.
    assert record.getMessage() == "Port connectivity check failed for sls.example.com:10100"
    assert "network unreachable" not in record.getMessage()
