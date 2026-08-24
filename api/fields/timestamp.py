from datetime import datetime
from typing import Annotated

from pydantic import BeforeValidator, Field, PlainSerializer


def _require_datetime(value: object) -> datetime:
    if not isinstance(value, datetime):
        raise ValueError("Timestamp source must be a datetime")
    return value


def _datetime_to_unix_seconds(value: datetime) -> int:
    return int(value.timestamp())


Timestamp = Annotated[
    datetime,
    BeforeValidator(_require_datetime),
    PlainSerializer(_datetime_to_unix_seconds, return_type=int, when_used="json"),
    Field(..., description="Unix timestamp in seconds"),
]
