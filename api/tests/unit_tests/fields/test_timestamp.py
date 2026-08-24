from datetime import UTC, datetime

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


@pytest.mark.parametrize("value", [1768204800, 1768204800.5])
def test_timestamp_rejects_preconverted_numeric_values(value: int | float) -> None:
    with pytest.raises(ValidationError, match="Timestamp source must be a datetime"):
        TypeAdapter(Timestamp).validate_python(value)
