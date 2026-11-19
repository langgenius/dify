"""Framework-neutral metadata contracts shared across application and persistence layers."""

import math
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Protocol, TypedDict

from services.errors.metadata import InvalidMetadataValueError


def validate_metadata_value(*, field_name: str, field_type: str, value: object) -> None:
    """Validate one persisted value without coercing it to another JSON scalar type."""
    if value is None:
        return

    match field_type:
        case "string":
            valid = isinstance(value, str)
        case "number" | "time":
            valid = not isinstance(value, bool) and isinstance(value, (int, float))
            if valid and isinstance(value, float):
                valid = math.isfinite(value)
        case _:
            valid = False

    if not valid:
        raise InvalidMetadataValueError(f"Metadata field '{field_name}' requires a {field_type} value or null.")


class MetadataValue(Protocol):
    @property
    def id(self) -> str: ...

    @property
    def value(self) -> str | int | float | None: ...


class MetadataOperation(Protocol):
    @property
    def document_id(self) -> str: ...

    @property
    def metadata_list(self) -> Sequence[MetadataValue]: ...

    @property
    def partial_update(self) -> bool: ...


@dataclass(frozen=True)
class MetadataRecord:
    id: str
    name: str
    type: str
    tenant_id: str
    dataset_id: str
    created_by: str
    created_at: datetime
    updated_by: str | None
    updated_at: datetime | None


class MetadataFieldSummary(TypedDict):
    id: str
    name: str
    type: str
    count: int


class MetadataList(TypedDict):
    doc_metadata: list[MetadataFieldSummary]
    built_in_field_enabled: bool
