from collections.abc import Sequence
from datetime import datetime

import pytest

from machinery.context import RequestContext
from services.knowledge.dataset_access import AccessibleDataset, DatasetAccessSnapshot
from services.knowledge.entities.knowledge_entities import MetadataArgs, MetadataOperationData
from services.knowledge.metadata.application import MetadataInvalidActionError, MetadataService
from services.knowledge.metadata.contracts import MetadataList, MetadataOperation, MetadataRecord
from services.knowledge.resource_scope import DatasetRef

CONTEXT = RequestContext(
    request_id="request-1",
    trace_id="trace-1",
    account_id="account-1",
    active_workspace_id="workspace-1",
)
REF = DatasetRef("workspace-1", "dataset-1")


class DatasetAccessStub:
    def __init__(self) -> None:
        self.request: tuple[RequestContext, str] | None = None

    def require_accessible(self, context: RequestContext, dataset_id: str) -> AccessibleDataset:
        self.request = context, dataset_id
        return AccessibleDataset(id=dataset_id, workspace_id=context.active_workspace_id)

    def check_access(self, context: RequestContext, snapshot: DatasetAccessSnapshot) -> AccessibleDataset:
        return AccessibleDataset(id=snapshot.dataset.id, workspace_id=context.active_workspace_id)


class MetadataStoreSpy:
    def __init__(self) -> None:
        self.call: tuple[object, ...] | None = None

    @staticmethod
    def _record(*, name: str = "author") -> MetadataRecord:
        return MetadataRecord(
            id="metadata-1",
            name=name,
            type="string",
            tenant_id=REF.tenant_id,
            dataset_id=REF.dataset_id,
            created_by=CONTEXT.account_id,
            created_at=datetime(2026, 1, 1),
            updated_by=None,
            updated_at=None,
        )

    def create(self, ref: DatasetRef, *, name: str, field_type: str, actor_id: str) -> MetadataRecord:
        self.call = "create", ref, name, field_type, actor_id
        return self._record(name=name)

    def rename(self, ref: DatasetRef, metadata_id: str, *, name: str, actor_id: str) -> MetadataRecord:
        self.call = "rename", ref, metadata_id, name, actor_id
        return self._record(name=name)

    def delete(self, ref: DatasetRef, metadata_id: str) -> MetadataRecord:
        self.call = "delete", ref, metadata_id
        return self._record()

    def set_built_in(self, ref: DatasetRef, *, enabled: bool) -> None:
        self.call = "set_built_in", ref, enabled

    def update_documents(self, ref: DatasetRef, operations: Sequence[MetadataOperation], *, actor_id: str) -> None:
        self.call = "update_documents", ref, operations, actor_id

    def list_fields(self, ref: DatasetRef) -> MetadataList:
        self.call = "list_fields", ref
        return {"doc_metadata": [], "built_in_field_enabled": False}


def _service() -> tuple[MetadataService, DatasetAccessStub, MetadataStoreSpy]:
    access = DatasetAccessStub()
    store = MetadataStoreSpy()
    return MetadataService(store=store, dataset_access=access), access, store


def test_create_dataset_metadata_resolves_scope_and_actor() -> None:
    service, access, store = _service()

    result = service.create_dataset_metadata(CONTEXT, REF.dataset_id, MetadataArgs(type="string", name="author"))

    assert access.request == (CONTEXT, REF.dataset_id)
    assert store.call == ("create", REF, "author", "string", CONTEXT.account_id)
    assert result.name == "author"


def test_dataset_metadata_mutations_resolve_scope_and_actor() -> None:
    service, _, store = _service()

    service.rename_dataset_metadata(CONTEXT, REF.dataset_id, "metadata-1", name="writer")
    assert store.call == ("rename", REF, "metadata-1", "writer", CONTEXT.account_id)

    service.delete_dataset_metadata(CONTEXT, REF.dataset_id, "metadata-1")
    assert store.call == ("delete", REF, "metadata-1")

    service.apply_dataset_built_in_field_action(CONTEXT, REF.dataset_id, action="enable")
    assert store.call == ("set_built_in", REF, True)


def test_unknown_built_in_field_action_is_rejected_after_authorization() -> None:
    service, access, store = _service()

    with pytest.raises(MetadataInvalidActionError, match="Unsupported metadata action: unknown"):
        service.apply_dataset_built_in_field_action(CONTEXT, REF.dataset_id, action="unknown")

    assert access.request == (CONTEXT, REF.dataset_id)
    assert store.call is None


def test_dataset_metadata_queries_resolve_scope() -> None:
    service, access, store = _service()

    assert service.list_dataset_metadata(CONTEXT, REF.dataset_id) == {
        "doc_metadata": [],
        "built_in_field_enabled": False,
    }
    assert store.call == ("list_fields", REF)

    fields = service.list_dataset_built_in_fields(CONTEXT, REF.dataset_id)
    assert access.request == (CONTEXT, REF.dataset_id)
    assert {field["name"] for field in fields} >= {"document_name", "uploader"}


def test_update_dataset_documents_metadata_resolves_scope_and_actor() -> None:
    service, _, store = _service()
    operations = MetadataOperationData(operation_data=[])

    service.update_dataset_documents_metadata(CONTEXT, REF.dataset_id, operations)

    assert store.call == ("update_documents", REF, operations.operation_data, CONTEXT.account_id)
