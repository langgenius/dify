"""UUID validation types without framework or persistence dependencies."""

import uuid
from typing import Annotated
from uuid import UUID

from pydantic import AfterValidator, WithJsonSchema


def uuid_value(value: str | UUID) -> str:
    if isinstance(value, UUID):
        return str(value)

    if value == "":
        return str(value)

    try:
        uuid_obj = uuid.UUID(value)
        return str(uuid_obj)
    except ValueError as caught_error:
        error = f"{value} is not a valid uuid."
        raise ValueError(error) from caught_error


def _strict_uuid(value: str | UUID) -> str:
    if not value:
        raise ValueError("must be a non-empty valid UUID")
    try:
        return uuid_value(value)
    except ValueError as exc:
        raise ValueError("must be a valid UUID") from exc


UUIDStr = Annotated[
    str,
    AfterValidator(_strict_uuid),
    WithJsonSchema({"format": "uuid", "type": "string"}),
]
