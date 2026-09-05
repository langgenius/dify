from contextlib import AbstractContextManager
from dataclasses import dataclass
from datetime import UTC, datetime
from inspect import unwrap
from unittest.mock import create_autospec, patch

import pytest
from flask import Flask
from werkzeug.exceptions import Forbidden, NotFound

from controllers.common.controller_schemas import ChildChunkCreatePayload, ChildChunkUpdatePayload
from controllers.console.app.error import ProviderNotInitializeError
from controllers.console.datasets.datasets_segments import (
    BatchImportPayload,
    ChildChunkAddApi,
    ChildChunkBatchUpdatePayload,
    ChildChunkUpdateApi,
    DatasetDocumentSegmentAddApi,
    DatasetDocumentSegmentApi,
    DatasetDocumentSegmentBatchImportApi,
    DatasetDocumentSegmentBatchImportStatusApi,
    DatasetDocumentSegmentListApi,
    DatasetDocumentSegmentUpdateApi,
    SegmentCreatePayload,
    SegmentUpdatePayload,
    _raise_segment_error,
)
from controllers.console.datasets.error import ChildChunkDeleteIndexError, ChildChunkIndexingError, InvalidActionError
from machinery.context import RequestContext
from services.entities.knowledge_entities.segments import ChildChunkRecord, ChildChunkUpdateArgs, SegmentRecord
from services.knowledge.segments.application import (
    ChildChunkDeleteIndexApplicationError,
    ChildChunkIndexingApplicationError,
    ChildChunkNotFoundError,
    ChildChunkPage,
    DatasetSegmentApplicationService,
    SegmentBatchImport,
    SegmentBatchImportDispatchError,
    SegmentBatchImportNotFoundError,
    SegmentDatasetModelUnavailableError,
    SegmentDatasetNotFoundError,
    SegmentDetail,
    SegmentDocumentIndexingError,
    SegmentDocumentNotFoundError,
    SegmentEmbeddingModelUnavailableError,
    SegmentInvalidFileTypeError,
    SegmentListFilter,
    SegmentNotFoundError,
    SegmentPage,
    SegmentPermissionDeniedError,
    SegmentStatusUpdateError,
    SegmentUploadFileNotFoundError,
)


def _context() -> RequestContext:
    return RequestContext(
        request_id="request-1",
        trace_id=None,
        account_id="account-1",
        active_workspace_id="tenant-1",
    )


def _child_chunk_data() -> ChildChunkRecord:
    now = datetime(2026, 1, 1, tzinfo=UTC)
    return ChildChunkRecord.model_validate(
        {
            "id": "child-1",
            "segment_id": "segment-1",
            "content": "child",
            "position": 1,
            "word_count": 5,
            "type": "customized",
            "created_at": now,
            "updated_at": now,
        }
    )


def _segment_data() -> SegmentRecord:
    now = datetime(2026, 1, 1, tzinfo=UTC)
    return SegmentRecord.model_validate(
        {
            "id": "segment-1",
            "position": 1,
            "document_id": "document-1",
            "content": "content",
            "sign_content": "content",
            "answer": None,
            "word_count": 7,
            "tokens": 2,
            "keywords": [],
            "index_node_id": "node-1",
            "index_node_hash": "hash",
            "hit_count": 0,
            "enabled": True,
            "disabled_at": None,
            "disabled_by": None,
            "status": "completed",
            "created_by": "account-1",
            "created_at": now,
            "updated_at": now,
            "updated_by": None,
            "indexing_at": None,
            "completed_at": now,
            "error": None,
            "stopped_at": None,
            "child_chunks": [],
            "attachments": [],
            "summary": None,
        }
    )


@dataclass(frozen=True)
class KnowledgeServiceStub:
    segments: DatasetSegmentApplicationService


@dataclass(frozen=True)
class ApplicationServiceStub:
    knowledge: KnowledgeServiceStub


def _patch_services(segments: DatasetSegmentApplicationService) -> AbstractContextManager[object]:
    return patch(
        "controllers.console.datasets.datasets_segments.application_services",
        return_value=ApplicationServiceStub(knowledge=KnowledgeServiceStub(segments=segments)),
    )


def test_list_segments_delegates_typed_query_and_serializes_page(app: Flask) -> None:
    segments = create_autospec(DatasetSegmentApplicationService, instance=True, spec_set=True)
    segments.list_segments.return_value = SegmentPage(
        items=(_segment_data(),), total=1, total_pages=1, page=2, limit=10
    )
    method = unwrap(DatasetDocumentSegmentListApi.get)

    with (
        app.test_request_context("/?status=completed&limit=10&page=2&enabled=true&keyword=needle"),
        _patch_services(segments),
    ):
        response, status = method(DatasetDocumentSegmentListApi(), _context(), "dataset-1", "document-1")

    assert status == 200
    assert response["data"][0]["id"] == "segment-1"
    assert response["data"][0]["created_at"] == 1767225600
    assert response["data"][0]["keywords"] == []
    assert response["data"][0]["disabled_at"] is None
    query = segments.list_segments.call_args.kwargs["query"]
    assert query == SegmentListFilter(
        page=2,
        limit=10,
        statuses=("completed",),
        enabled="true",
        keyword="needle",
    )


def test_delete_segments_delegates_all_selected_ids(app: Flask) -> None:
    segments = create_autospec(DatasetSegmentApplicationService, instance=True, spec_set=True)
    method = unwrap(DatasetDocumentSegmentListApi.delete)

    with app.test_request_context("/?segment_id=one&segment_id=two"), _patch_services(segments):
        response, status = method(DatasetDocumentSegmentListApi(), _context(), "dataset-1", "document-1")

    assert (response, status) == ("", 204)
    assert segments.delete_segments.call_args.kwargs["segment_ids"] == ["one", "two"]


@pytest.mark.parametrize("action", ["enable", "disable"])
def test_change_segment_status_delegates_action(app: Flask, action: str) -> None:
    segments = create_autospec(DatasetSegmentApplicationService, instance=True, spec_set=True)
    method = unwrap(DatasetDocumentSegmentApi.patch)

    with app.test_request_context("/?segment_id=one"), _patch_services(segments):
        response, status = method(DatasetDocumentSegmentApi(), _context(), "dataset-1", "document-1", action)

    assert status == 200
    assert response == {"result": "success"}
    assert segments.change_segment_status.call_args.kwargs["action"] == action


@pytest.mark.parametrize("action", ["typo", "ENABLE", "enable "])
def test_change_segment_status_rejects_unknown_action_before_service_call(app: Flask, action: str) -> None:
    segments = create_autospec(DatasetSegmentApplicationService, instance=True, spec_set=True)
    method = unwrap(DatasetDocumentSegmentApi.patch)

    with (
        app.test_request_context("/?segment_id=one"),
        _patch_services(segments),
        pytest.raises(InvalidActionError) as error,
    ):
        method(DatasetDocumentSegmentApi(), _context(), "dataset-1", "document-1", action)

    assert error.value.code == 400
    segments.change_segment_status.assert_not_called()


def test_create_segment_delegates_payload_and_serializes_detail(app: Flask) -> None:
    segments = create_autospec(DatasetSegmentApplicationService, instance=True, spec_set=True)
    segments.create_segment.return_value = SegmentDetail(data=_segment_data(), doc_form="text_model")
    method = unwrap(DatasetDocumentSegmentAddApi.post)

    with app.test_request_context("/"), _patch_services(segments):
        response, status = method(
            DatasetDocumentSegmentAddApi(),
            SegmentCreatePayload(content="content"),
            _context(),
            "dataset-1",
            "document-1",
        )

    assert status == 200
    assert response["data"]["id"] == "segment-1"
    assert segments.create_segment.call_args.kwargs["values"] == {"content": "content"}


def test_update_and_delete_segment_delegate_owned_ids(app: Flask) -> None:
    segments = create_autospec(DatasetSegmentApplicationService, instance=True, spec_set=True)
    segments.update_segment.return_value = SegmentDetail(data=_segment_data(), doc_form="text_model")

    with app.test_request_context("/"), _patch_services(segments):
        update_response, update_status = unwrap(DatasetDocumentSegmentUpdateApi.patch)(
            DatasetDocumentSegmentUpdateApi(),
            SegmentUpdatePayload(content="updated"),
            _context(),
            "dataset-1",
            "document-1",
            "segment-1",
        )
        delete_response, delete_status = unwrap(DatasetDocumentSegmentUpdateApi.delete)(
            DatasetDocumentSegmentUpdateApi(),
            _context(),
            "dataset-1",
            "document-1",
            "segment-1",
        )

    assert update_status == 200
    assert update_response["data"]["content"] == "content"
    assert (delete_response, delete_status) == ("", 204)
    assert segments.update_segment.call_args.kwargs["segment_id"] == "segment-1"
    assert segments.delete_segment.call_args.kwargs["segment_id"] == "segment-1"


def test_batch_import_delegates_and_preserves_dispatch_failure_response(app: Flask) -> None:
    segments = create_autospec(DatasetSegmentApplicationService, instance=True, spec_set=True)
    segments.start_batch_import.return_value = SegmentBatchImport(job_id="job-1", job_status="waiting")
    method = unwrap(DatasetDocumentSegmentBatchImportApi.post)

    with app.test_request_context("/"), _patch_services(segments):
        response, status = method(
            DatasetDocumentSegmentBatchImportApi(),
            BatchImportPayload(upload_file_id="file-1"),
            _context(),
            "dataset-1",
            "document-1",
        )
    assert status == 200
    assert response == {"job_id": "job-1", "job_status": "waiting"}

    segments.start_batch_import.side_effect = SegmentBatchImportDispatchError("redis down")
    with app.test_request_context("/"), _patch_services(segments):
        response, status = method(
            DatasetDocumentSegmentBatchImportApi(),
            BatchImportPayload(upload_file_id="file-1"),
            _context(),
            "dataset-1",
            "document-1",
        )
    assert (response, status) == ({"error": "redis down"}, 500)


def test_batch_import_status_preserves_missing_job_contract(app: Flask) -> None:
    segments = create_autospec(DatasetSegmentApplicationService, instance=True, spec_set=True)
    method = unwrap(DatasetDocumentSegmentBatchImportStatusApi.get)

    segments.get_batch_import_status.side_effect = SegmentBatchImportNotFoundError("The job does not exist.")
    with app.test_request_context("/"), _patch_services(segments), pytest.raises(ValueError):
        method(DatasetDocumentSegmentBatchImportStatusApi(), _context(), "job-1")

    segments.get_batch_import_status.side_effect = None
    segments.get_batch_import_status.return_value = SegmentBatchImport(job_id="job-1", job_status="completed")
    with app.test_request_context("/"), _patch_services(segments):
        response, status = method(DatasetDocumentSegmentBatchImportStatusApi(), _context(), "job-1")
    assert status == 200
    assert response == {"job_id": "job-1", "job_status": "completed"}


def test_child_chunk_create_and_list_delegate(app: Flask) -> None:
    segments = create_autospec(DatasetSegmentApplicationService, instance=True, spec_set=True)
    segments.create_child_chunk.return_value = _child_chunk_data()
    segments.list_child_chunks.return_value = ChildChunkPage(
        items=(_child_chunk_data(),), total=1, total_pages=1, page=1, limit=20
    )

    with app.test_request_context("/"), _patch_services(segments):
        create_response, create_status = unwrap(ChildChunkAddApi.post)(
            ChildChunkAddApi(),
            ChildChunkCreatePayload(content="child"),
            _context(),
            "dataset-1",
            "document-1",
            "segment-1",
        )
        list_response, list_status = unwrap(ChildChunkAddApi.get)(
            ChildChunkAddApi(), _context(), "dataset-1", "document-1", "segment-1"
        )

    assert create_status == list_status == 200
    assert create_response["data"]["id"] == "child-1"
    assert create_response["data"]["created_at"] == 1767225600
    assert list_response["data"][0]["id"] == "child-1"


def test_child_chunk_mutations_delegate(app: Flask) -> None:
    segments = create_autospec(DatasetSegmentApplicationService, instance=True, spec_set=True)
    segments.update_child_chunks.return_value = (_child_chunk_data(),)
    segments.update_child_chunk.return_value = _child_chunk_data()
    chunks = [ChildChunkUpdateArgs(id="child-1", content="updated")]

    with app.test_request_context("/"), _patch_services(segments):
        batch_response, batch_status = unwrap(ChildChunkAddApi.patch)(
            ChildChunkAddApi(),
            ChildChunkBatchUpdatePayload(chunks=chunks),
            _context(),
            "dataset-1",
            "document-1",
            "segment-1",
        )
        update_response, update_status = unwrap(ChildChunkUpdateApi.patch)(
            ChildChunkUpdateApi(),
            ChildChunkUpdatePayload(content="updated"),
            _context(),
            "dataset-1",
            "document-1",
            "segment-1",
            "child-1",
        )
        delete_response, delete_status = unwrap(ChildChunkUpdateApi.delete)(
            ChildChunkUpdateApi(),
            _context(),
            "dataset-1",
            "document-1",
            "segment-1",
            "child-1",
        )

    assert batch_status == update_status == 200
    assert batch_response["data"][0]["id"] == "child-1"
    assert update_response["data"]["id"] == "child-1"
    assert (delete_response, delete_status) == ("", 204)


@pytest.mark.parametrize(
    ("error", "expected"),
    [
        (SegmentDatasetNotFoundError(), NotFound),
        (SegmentDocumentNotFoundError(), NotFound),
        (SegmentNotFoundError(), NotFound),
        (ChildChunkNotFoundError(), NotFound),
        (SegmentUploadFileNotFoundError(), NotFound),
        (SegmentPermissionDeniedError(), Forbidden),
        (SegmentEmbeddingModelUnavailableError(), ProviderNotInitializeError),
        (SegmentDatasetModelUnavailableError(), ValueError),
        (SegmentDocumentIndexingError(), InvalidActionError),
        (SegmentStatusUpdateError(), InvalidActionError),
        (SegmentInvalidFileTypeError(), ValueError),
        (ChildChunkIndexingApplicationError(), ChildChunkIndexingError),
        (ChildChunkDeleteIndexApplicationError(), ChildChunkDeleteIndexError),
    ],
)
def test_segment_application_errors_map_to_existing_http_contract(error: Exception, expected: type[Exception]) -> None:
    with pytest.raises(expected):
        _raise_segment_error(error)
