"""Metadata use cases with explicit ownership and persistence contracts."""

from collections.abc import Sequence
from typing import Protocol

from core.rag.index_processor.constant.built_in_field import BuiltInField
from machinery.context import RequestContext
from services.knowledge.dataset_access import DatasetAccess
from services.knowledge.metadata.contracts import MetadataList, MetadataOperation, MetadataRecord
from services.knowledge.resource_scope import DatasetRef


class MetadataInvalidActionError(ValueError):
    """Raised when a built-in metadata action is outside the supported command set."""


class MetadataInput(Protocol):
    @property
    def name(self) -> str: ...
    @property
    def type(self) -> str: ...


class MetadataOperationsInput(Protocol):
    @property
    def operation_data(self) -> Sequence[MetadataOperation]: ...


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

    def create_dataset_metadata(self, context: RequestContext, dataset_id: str, args: MetadataInput) -> MetadataRecord:
        """Create one field after resolving and authorizing its dataset."""
        ref = self.require_dataset(context, dataset_id)
        return self.create_metadata(ref, args, actor_id=context.account_id)

    def list_dataset_metadata(self, context: RequestContext, dataset_id: str) -> MetadataList:
        """List metadata fields for an accessible dataset."""
        return self.get_dataset_metadatas(self.require_dataset(context, dataset_id))

    def rename_dataset_metadata(
        self,
        context: RequestContext,
        dataset_id: str,
        metadata_id: str,
        *,
        name: str,
    ) -> MetadataRecord:
        """Rename one field after resolving and authorizing its dataset."""
        ref = self.require_dataset(context, dataset_id)
        return self.update_metadata_name(ref, metadata_id, name, actor_id=context.account_id)

    def delete_dataset_metadata(self, context: RequestContext, dataset_id: str, metadata_id: str) -> None:
        """Delete one field after resolving and authorizing its dataset."""
        self.delete_metadata(self.require_dataset(context, dataset_id), metadata_id)

    def list_dataset_built_in_fields(self, context: RequestContext, dataset_id: str) -> list[dict[str, str]]:
        """List built-in fields only when the referenced dataset is accessible."""
        self.require_dataset(context, dataset_id)
        return self.get_built_in_fields()

    def apply_dataset_built_in_field_action(
        self,
        context: RequestContext,
        dataset_id: str,
        *,
        action: str,
    ) -> None:
        """Apply a built-in-field action after resolving and authorizing the dataset."""
        ref = self.require_dataset(context, dataset_id)
        enabled = {"enable": True, "disable": False}.get(action)
        if enabled is None:
            raise MetadataInvalidActionError(f"Unsupported metadata action: {action}")
        self._store.set_built_in(ref, enabled=enabled)

    def update_dataset_documents_metadata(
        self,
        context: RequestContext,
        dataset_id: str,
        args: MetadataOperationsInput,
    ) -> None:
        """Apply a document metadata batch after resolving its dataset."""
        ref = self.require_dataset(context, dataset_id)
        self.update_documents_metadata(ref, args, actor_id=context.account_id)

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
