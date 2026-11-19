"""Metadata use cases with explicit ownership and persistence contracts."""

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Protocol, TypedDict

from core.rag.index_processor.constant.built_in_field import BuiltInField
from machinery.context import RequestContext
from services.knowledge.dataset_access import DatasetAccess
from services.knowledge.resource_scope import DatasetRef


class MetadataInput(Protocol):
    @property
    def name(self) -> str: ...
    @property
    def type(self) -> str: ...


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


class MetadataOperationsInput(Protocol):
    @property
    def operation_data(self) -> Sequence[MetadataOperation]: ...


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


class MetadataStore(Protocol):
    """Own bounded transactions and recheck the complete dataset owner chain."""

    def create(self, ref: DatasetRef, *, name: str, field_type: str, actor_id: str) -> MetadataRecord: ...
    def rename(self, ref: DatasetRef, metadata_id: str, *, name: str, actor_id: str) -> MetadataRecord: ...
    def delete(self, ref: DatasetRef, metadata_id: str) -> MetadataRecord: ...
    def set_built_in(self, ref: DatasetRef, *, enabled: bool) -> None: ...
    def update_documents(self, ref: DatasetRef, operations: Sequence[MetadataOperation], *, actor_id: str) -> None: ...
    def list_fields(self, ref: DatasetRef) -> MetadataList: ...


class MetadataService:
    def __init__(self, *, store: MetadataStore, dataset_access: DatasetAccess) -> None:
        self._store = store
        self._access = dataset_access

    def require_dataset(self, context: RequestContext, dataset_id: str) -> DatasetRef:
        dataset = self._access.require_accessible(context, dataset_id)
        return DatasetRef(dataset.workspace_id, dataset.id)

    @staticmethod
    def _validate_name(name: str) -> None:
        if len(name) > 255:
            raise ValueError("Metadata name cannot exceed 255 characters.")
        if name in BuiltInField:
            raise ValueError("Metadata name already exists in Built-in fields.")

    def create_metadata(self, ref: DatasetRef, args: MetadataInput, *, actor_id: str) -> MetadataRecord:
        self._validate_name(args.name)
        return self._store.create(ref, name=args.name, field_type=args.type, actor_id=actor_id)

    def update_metadata_name(self, ref: DatasetRef, metadata_id: str, name: str, *, actor_id: str) -> MetadataRecord:
        self._validate_name(name)
        return self._store.rename(ref, metadata_id, name=name, actor_id=actor_id)

    def delete_metadata(self, ref: DatasetRef, metadata_id: str) -> MetadataRecord:
        return self._store.delete(ref, metadata_id)

    @staticmethod
    def get_built_in_fields() -> list[dict[str, str]]:
        return [
            {
                "name": field.value,
                "type": "time" if field in (BuiltInField.upload_date, BuiltInField.last_update_date) else "string",
            }
            for field in BuiltInField
        ]

    def enable_built_in_field(self, ref: DatasetRef) -> None:
        self._store.set_built_in(ref, enabled=True)

    def disable_built_in_field(self, ref: DatasetRef) -> None:
        self._store.set_built_in(ref, enabled=False)

    def update_documents_metadata(self, ref: DatasetRef, args: MetadataOperationsInput, *, actor_id: str) -> None:
        self._store.update_documents(ref, args.operation_data, actor_id=actor_id)

    def get_dataset_metadatas(self, ref: DatasetRef) -> MetadataList:
        return self._store.list_fields(ref)
