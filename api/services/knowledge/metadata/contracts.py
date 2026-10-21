"""Framework-neutral metadata contracts shared across application and persistence layers."""

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Protocol, TypedDict


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
