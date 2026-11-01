import time
from datetime import UTC, datetime, timedelta, timezone

import pytest
from pydantic import TypeAdapter, ValidationError

from fields.timestamp import Timestamp


def test_timestamp_preserves_datetime_until_json_serialization() -> None:
    source = datetime(2026, 1, 12, 8, tzinfo=UTC)
    adapter = TypeAdapter(Timestamp)

    timestamp = adapter.validate_python(source)

    assert timestamp is source
    assert adapter.dump_python(timestamp, mode="json") == 1768204800
    assert adapter.json_schema(mode="serialization")["type"] == "integer"


@pytest.mark.parametrize("host_timezone", ["UTC", "Asia/Shanghai"])
@pytest.mark.parametrize(
    "source",
    [
        datetime(2026, 8, 20, 8),
        datetime(2026, 8, 20, 8, tzinfo=UTC),
        datetime(2026, 8, 20, 17, tzinfo=timezone(timedelta(hours=9))),
    ],
)
def test_timestamp_interprets_naive_values_as_utc_in_every_host_timezone(
    source: datetime, host_timezone: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    adapter = TypeAdapter(Timestamp)
    try:
        with monkeypatch.context() as timezone_environment:
            timezone_environment.setenv("TZ", host_timezone)
            time.tzset()

            assert adapter.dump_python(adapter.validate_python(source), mode="json") == 1787212800
    finally:
        time.tzset()


@pytest.mark.parametrize("value", [1768204800, 1768204800.5])
def test_timestamp_rejects_preconverted_numeric_values(value: int | float) -> None:
    with pytest.raises(ValidationError, match="Timestamp source must be a datetime"):
        TypeAdapter(Timestamp).validate_python(value)
