"""Test that the AliyunLogStorePG port-connectivity logger captures the traceback.

Cycle 21 (sibling of #41066 / merged in #41068): `logger.debug("...: %s", str(e))`
sites in `extensions/logstore/aliyun_logstore_pg.py` were converted to
`logger.debug("...", exc_info=True)` so the traceback is captured at the
same log level rather than being silently dropped. This test exercises one
of the modified sites — `_check_port_connectivity` — to confirm the fix
shape is correct: the captured log record has a non-empty traceback.
"""

from __future__ import annotations

from unittest.mock import patch

import pytest

from extensions.logstore.aliyun_logstore_pg import AliyunLogStorePG


def test_check_port_connectivity_captures_traceback_on_exception(caplog: pytest.LogCaptureFixture) -> None:
    """A socket failure during the port check must produce a log record with exc_info set.

    Before cycle 21: the record was logged as
    `Port connectivity check failed for host:port: <str(exception)>` with no
    traceback. After cycle 21: the record is logged as
    `Port connectivity check failed for host:port` with `exc_info=True`, so
    the traceback is part of the log record (and the host/port are still
    included via the format args).
    """
    store = AliyunLogStorePG(
        access_key_id="ak",
        access_key_secret="sk",
        endpoint="https://example.com",
        project_name="p",
    )

    with (
        patch("extensions.logstore.aliyun_logstore_pg.socket.socket", side_effect=OSError("boom")),
        caplog.at_level("DEBUG", logger="extensions.logstore.aliyun_logstore_pg"),
    ):
        result = store._check_port_connectivity("example.invalid", 9999)

    assert result is False

    matching_records = [r for r in caplog.records if r.name == "extensions.logstore.aliyun_logstore_pg"]
    assert len(matching_records) == 1
    record = matching_records[0]
    assert record.levelname == "DEBUG"
    assert record.exc_info is not None
    formatted = caplog.text
    assert "Port connectivity check failed for example.invalid:9999" in formatted
    assert "Traceback (most recent call last)" in formatted
    assert "OSError: boom" in formatted
    # The exception is captured via the traceback, not interpolated into the
    # format string — so the message text is the short form, not the long one.
    assert "boom" not in record.getMessage()
