from dataclasses import dataclass
from datetime import datetime
from typing import Literal
from unittest.mock import Mock, create_autospec

import pytest

from libs.helper import generate_text_hash
from machinery.context import RequestContext
from services.entities.knowledge_entities.segments import SegmentRecord
from services.knowledge.dataset_access import (
    AccessibleDataset,
    DatasetAccess,
    DatasetAccessDeniedError,
    DatasetAccessRecord,
    DatasetAccessSnapshot,
)
from services.knowledge.resource_scope import DatasetRef
from services.knowledge.segments.application import (
    ChildChunkNotFoundError,
    DatasetSegmentApplicationService,
    SegmentBatchImportDispatcher,
    SegmentBatchImportDispatchError,
    SegmentBatchImportNotFoundError,
    SegmentDatasetModelUnavailableError,
    SegmentDatasetNotFoundError,
    SegmentDatasetRecord,
    SegmentDetail,
    SegmentDocumentIndexingError,
    SegmentDocumentNotFoundError,
    SegmentDocumentRecord,
    SegmentEmbeddingModelUnavailableError,
    SegmentIndex,
    SegmentIndexingState,
    SegmentInvalidFileTypeError,
    SegmentListFilter,
    SegmentModelGuard,
    SegmentModelProviderError,
    SegmentNotFoundError,
    SegmentPage,
    SegmentPermissionDeniedError,
    SegmentScope,
    SegmentScopeReader,
    SegmentStatusUpdateError,
    SegmentStore,
    SegmentUploadCatalog,
    SegmentUploadFileNotFoundError,
)


@dataclass
class SegmentLimitsStub:
    SINGLE_CHUNK_ATTACHMENT_LIMIT: int = 10


def _context() -> RequestContext:
    return RequestContext(
        request_id="request-1",
        trace_id=None,
        account_id="account-1",
        active_workspace_id="workspace-1",
    )


def _dataset(
    *,
    indexing_technique: str = "economy",
) -> SegmentDatasetRecord:
    return SegmentDatasetRecord(
        id="dataset-1",
        workspace_id="workspace-1",
        indexing_technique=indexing_technique,
        embedding_model_provider="provider",
        embedding_model="model",
    )


def _document() -> SegmentDocumentRecord:
    return SegmentDocumentRecord(
        id="document-1",
        dataset_id="dataset-1",
        workspace_id="workspace-1",
        doc_form="text_model",
    )


def _snapshot() -> DatasetAccessSnapshot:
    return DatasetAccessSnapshot(
        DatasetAccessRecord("dataset-1", "workspace-1", "account-1", "all_team_members"), False
    )


def _scope(
    *,
    dataset: SegmentDatasetRecord | None = None,
    document: SegmentDocumentRecord | None = None,
) -> SegmentScope:
    return SegmentScope(
        dataset=_dataset() if dataset is None else dataset,
        document=_document() if document is None else document,
        access_snapshot=_snapshot(),
    )


type ServiceFixture = tuple[DatasetSegmentApplicationService, Mock, Mock, Mock, Mock, Mock, Mock]


def _service(scope: SegmentScope | None = None, *, uploads: SegmentUploadCatalog | None = None) -> ServiceFixture:
    dataset_access = create_autospec(DatasetAccess, instance=True, spec_set=True)
    dataset_access.check_access.return_value = AccessibleDataset(id="dataset-1", workspace_id="workspace-1")
    store = create_autospec(SegmentStore, instance=True, spec_set=True)
    scopes = create_autospec(SegmentScopeReader, instance=True, spec_set=True)
    scopes.get_segment_scope.return_value = scope or _scope()
    model_guard = create_autospec(SegmentModelGuard, instance=True, spec_set=True)
    indexing_state = create_autospec(SegmentIndexingState, instance=True, spec_set=True)
    indexing_state.is_document_indexing.return_value = False
    indexing_state.is_segment_indexing.return_value = False
    dispatcher = create_autospec(SegmentBatchImportDispatcher, instance=True, spec_set=True)
    service = DatasetSegmentApplicationService(
        dataset_access=dataset_access,
        store=store,
        limits=SegmentLimitsStub(),
        text_hash=generate_text_hash,
        index=create_autospec(SegmentIndex, instance=True, spec_set=True),
        uploads=uploads or create_autospec(SegmentUploadCatalog, instance=True, spec_set=True),
        scopes=scopes,
        model_guard=model_guard,
        indexing_state=indexing_state,
        batch_dispatcher=dispatcher,
        job_id_factory=lambda: "job-1",
    )
    return service, dataset_access, store, scopes, model_guard, indexing_state, dispatcher


def test_list_segments_uses_complete_owner_scope() -> None:
    service, dataset_access, store, scopes, _, _, _ = _service()
    expected = SegmentPage(items=(), total=0, total_pages=0, page=1, limit=20)
    store.list_segments.return_value = expected

    result = service.list_segments(
        _context(),
        dataset_id="dataset-1",
        document_id="document-1",
        query=SegmentListFilter(keyword="needle"),
    )

    assert result is expected
    assert scopes.get_segment_scope.call_args.kwargs == {
        "dataset_ref": DatasetRef("workspace-1", "dataset-1"),
        "document_id": "document-1",
        "actor_id": "account-1",
    }
    assert store.list_segments.call_args.args[0] == _document().ref
    dataset_access.check_access.assert_called_once_with(_context(), _snapshot())


@pytest.mark.parametrize(
    ("scope", "expected"),
    [
        (SegmentScope(None, None), SegmentDatasetNotFoundError),
        (SegmentScope(_dataset(), None, _snapshot()), SegmentDocumentNotFoundError),
    ],
)
def test_mutations_reject_invalid_scope_before_store_operation(
    scope: SegmentScope,
    expected: type[Exception],
) -> None:
    service, _, store, scopes, _, _, _ = _service(scope)

    with pytest.raises(expected):
        service.delete_segment(
            _context(),
            dataset_id="dataset-1",
            document_id="document-1",
            segment_id="segment-1",
        )

    store.delete_segments.assert_not_called()


@pytest.mark.parametrize(
    ("access_error", "expected"),
    [
        (DatasetAccessDeniedError(), SegmentPermissionDeniedError),
    ],
)
def test_dataset_access_errors_are_translated(
    access_error: Exception,
    expected: type[Exception],
) -> None:
    service, dataset_access, store, scopes, _, _, _ = _service()
    dataset_access.check_access.side_effect = access_error

    with pytest.raises(expected):
        service.delete_segment(
            _context(),
            dataset_id="dataset-1",
            document_id="document-1",
            segment_id="segment-1",
        )

    store.delete_segments.assert_not_called()


@pytest.mark.parametrize(
    ("kind", "method", "expected", "message"),
    [
        ("bad_request", "create_segment", SegmentEmbeddingModelUnavailableError, "No Embedding Model"),
        ("token", "create_segment", SegmentEmbeddingModelUnavailableError, "token missing"),
        ("bad_request", "delete_segment", SegmentDatasetModelUnavailableError, "No Embedding Model"),
        ("token", "delete_segment", SegmentDatasetModelUnavailableError, "dataset is unavailable"),
    ],
)
def test_model_failures_are_translated_per_use_case(
    kind: Literal["bad_request", "token"],
    method: str,
    expected: type[Exception],
    message: str,
) -> None:
    service, _, store, scopes, model_guard, _, _ = _service(_scope(dataset=_dataset(indexing_technique="high_quality")))
    model_guard.check.side_effect = SegmentModelProviderError(kind=kind, description="token missing")
    store.get_segment.return_value = None

    if method == "create_segment":

        def invoke() -> object:
            return service.create_segment(
                _context(),
                dataset_id="dataset-1",
                document_id="document-1",
                values={"content": "content"},
            )

    else:

        def invoke() -> object:
            return service.delete_segment(
                _context(),
                dataset_id="dataset-1",
                document_id="document-1",
                segment_id="segment-1",
            )

    with pytest.raises(expected, match=message):
        invoke()


def test_status_change_is_fenced_by_document_indexing_state() -> None:
    service, _, store, scopes, _, state, _ = _service()
    state.is_document_indexing.return_value = True

    with pytest.raises(SegmentDocumentIndexingError):
        service.change_segment_status(
            _context(),
            dataset_id="dataset-1",
            document_id="document-1",
            segment_ids=["segment-1"],
            action="disable",
        )

    store.save_segment.assert_not_called()


def test_status_change_translates_operation_failure() -> None:
    service, _, store, scopes, _, _, _ = _service()
    store.get_segments.side_effect = RuntimeError("failed")

    with pytest.raises(SegmentStatusUpdateError, match="failed"):
        service.change_segment_status(
            _context(),
            dataset_id="dataset-1",
            document_id="document-1",
            segment_ids=["segment-1"],
            action="enable",
        )


def test_update_and_delete_segment_map_missing_segment() -> None:
    service, _, store, scopes, _, _, _ = _service()
    store.get_segment.return_value = None

    with pytest.raises(SegmentNotFoundError):
        service.update_segment(
            _context(),
            dataset_id="dataset-1",
            document_id="document-1",
            segment_id="segment-1",
            values={"content": "content"},
        )
    with pytest.raises(SegmentNotFoundError):
        service.delete_segment(
            _context(),
            dataset_id="dataset-1",
            document_id="document-1",
            segment_id="segment-1",
        )


@pytest.mark.parametrize(
    ("filename", "expected"),
    [
        (None, SegmentUploadFileNotFoundError),
        ("segments.txt", SegmentInvalidFileTypeError),
    ],
)
def test_batch_import_validates_tenant_scoped_upload(filename: str | None, expected: type[Exception]) -> None:
    uploads = create_autospec(SegmentUploadCatalog, instance=True, spec_set=True)
    uploads.get_file_name.return_value = filename
    service, _, store, scopes, _, state, dispatcher = _service(uploads=uploads)

    with pytest.raises(expected):
        service.start_batch_import(
            _context(),
            dataset_id="dataset-1",
            document_id="document-1",
            upload_file_id="file-1",
        )

    assert uploads.get_file_name.call_args.kwargs["workspace_id"] == "workspace-1"
    state.set_batch_waiting.assert_not_called()
    dispatcher.dispatch.assert_not_called()


def test_batch_import_records_status_before_dispatch() -> None:
    uploads = create_autospec(SegmentUploadCatalog, instance=True, spec_set=True)
    uploads.get_file_name.return_value = "segments.CSV"
    service, _, store, scopes, _, state, dispatcher = _service(uploads=uploads)
    calls: list[str] = []
    state.set_batch_waiting.side_effect = lambda _job_id: calls.append("status")
    dispatcher.dispatch.side_effect = lambda **_kwargs: calls.append("dispatch")

    result = service.start_batch_import(
        _context(),
        dataset_id="dataset-1",
        document_id="document-1",
        upload_file_id="file-1",
    )

    assert result.job_id == "job-1"
    assert calls == ["status", "dispatch"]
    assert dispatcher.dispatch.call_args.kwargs["workspace_id"] == "workspace-1"


def test_batch_import_translates_dispatch_failure() -> None:
    uploads = create_autospec(SegmentUploadCatalog, instance=True, spec_set=True)
    uploads.get_file_name.return_value = "segments.csv"
    service, _, store, scopes, _, _, dispatcher = _service(uploads=uploads)
    dispatcher.dispatch.side_effect = RuntimeError("queue down")

    with pytest.raises(SegmentBatchImportDispatchError, match="queue down"):
        service.start_batch_import(
            _context(),
            dataset_id="dataset-1",
            document_id="document-1",
            upload_file_id="file-1",
        )


def test_batch_import_status_distinguishes_unknown_job() -> None:
    service, _, _, scopes, _, state, _ = _service()
    state.get_batch_status.return_value = None
    with pytest.raises(SegmentBatchImportNotFoundError):
        service.get_batch_import_status("missing")

    state.get_batch_status.return_value = "completed"
    assert service.get_batch_import_status("job-1").job_status == "completed"


def test_child_chunk_update_distinguishes_missing_parent_and_child() -> None:
    service, _, store, scopes, _, _, _ = _service()
    store.get_children.return_value = None
    with pytest.raises(SegmentNotFoundError):
        service.update_child_chunk(
            _context(),
            dataset_id="dataset-1",
            document_id="document-1",
            segment_id="segment-1",
            child_chunk_id="child-1",
            content="content",
        )

    store.get_children.return_value = ()
    with pytest.raises(ChildChunkNotFoundError):
        service.update_child_chunk(
            _context(),
            dataset_id="dataset-1",
            document_id="document-1",
            segment_id="segment-1",
            child_chunk_id="child-1",
            content="content",
        )


def test_create_segment_returns_store_detail() -> None:
    service, _, store, scopes, _, _, _ = _service()
    detail = SegmentDetail(
        data=SegmentRecord(
            id="segment-1",
            position=1,
            document_id="document-1",
            content="content",
            sign_content="content",
            answer=None,
            word_count=7,
            tokens=0,
            keywords=None,
            index_node_id=None,
            index_node_hash=None,
            hit_count=0,
            enabled=True,
            disabled_at=None,
            disabled_by=None,
            status="completed",
            created_by="account-1",
            created_at=datetime(2026, 1, 1),
            updated_at=datetime(2026, 1, 1),
            updated_by=None,
            indexing_at=None,
            completed_at=None,
            error=None,
            stopped_at=None,
            child_chunks=(),
            attachments=(),
            summary=None,
        ),
        doc_form="text_model",
    )
    store.get_segment.return_value = detail

    result = service.create_segment(
        _context(),
        dataset_id="dataset-1",
        document_id="document-1",
        values={"content": "content"},
    )

    assert result is detail
    assert store.save_segment.call_args.args[1]["created_by"] == _context().account_id
