from collections.abc import Callable
from contextlib import AbstractContextManager
from dataclasses import dataclass
from datetime import datetime
from inspect import unwrap
from typing import Never
from unittest.mock import create_autospec, patch
from uuid import UUID

import pytest
from flask import Flask
from pydantic import ValidationError

from controllers.common.controller_schemas import ChildChunkCreatePayload, ChildChunkUpdatePayload
from controllers.common.errors import ForbiddenError, NotFoundError
from controllers.service_api.dataset.error import InvalidActionError
from controllers.service_api.dataset.segment import (
    ChildChunkApi,
    DatasetChildChunkApi,
    DatasetSegmentApi,
    SegmentApi,
    _raise_child_chunk_create_error,
    _raise_child_chunk_write_error,
    _raise_segment_error,
)
from fields.service_api.segment import (
    ChildChunkListQuery,
    SegmentCreateItemPayload,
    SegmentCreatePayload,
    SegmentListQuery,
    SegmentUpdatePayload,
)
from machinery.context import RequestContext
from services.errors.chunk import ChildChunkIndexingError
from services.knowledge.entities.segments import ChildChunkRecord, SegmentRecord, SegmentUpdateArgs
from services.knowledge.segments.application import (
    ChildChunkIndexingApplicationError,
    DatasetSegmentApplicationService,
    SegmentDatasetNotFoundError,
    SegmentDocumentDisabledError,
    SegmentDocumentIndexingError,
    SegmentDocumentNotCompletedError,
    SegmentDocumentNotFoundError,
    SegmentNotFoundError,
    SegmentPermissionDeniedError,
)
from services.knowledge.segments.contracts import (
    ChildChunkPage,
    SegmentDetail,
    SegmentListFilter,
    SegmentPage,
)

_DATASET_ID = UUID("10000000-0000-0000-0000-000000000001")
_DOCUMENT_ID = UUID("20000000-0000-0000-0000-000000000002")
_SEGMENT_ID = UUID("30000000-0000-0000-0000-000000000003")
_CHILD_ID = UUID("40000000-0000-0000-0000-000000000004")


@dataclass(frozen=True)
class KnowledgeServicesStub:
    segments: DatasetSegmentApplicationService


@dataclass(frozen=True)
class ApplicationServicesStub:
    knowledge: KnowledgeServicesStub


def _context() -> RequestContext:
    return RequestContext("request-1", None, "account-1", "workspace-1")


def _segment_record() -> SegmentRecord:
    return SegmentRecord(
        id=str(_SEGMENT_ID),
        position=1,
        document_id=str(_DOCUMENT_ID),
        content="content",
        sign_content="signed",
        answer=None,
        word_count=7,
        tokens=2,
        keywords=("keyword",),
        index_node_id="node-1",
        index_node_hash="hash-1",
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
    )


def _child_record() -> ChildChunkRecord:
    return ChildChunkRecord(
        id=str(_CHILD_ID),
        segment_id=str(_SEGMENT_ID),
        content="child",
        position=1,
        word_count=5,
        type="customized",
        created_at=datetime(2026, 1, 1),
        updated_at=datetime(2026, 1, 1),
    )


def _services(segments: DatasetSegmentApplicationService) -> AbstractContextManager[object]:
    return patch(
        "controllers.service_api.dataset.segment.application_services",
        return_value=ApplicationServicesStub(KnowledgeServicesStub(segments)),
    )


def test_payloads_validate_content_and_defaults() -> None:
    assert SegmentCreatePayload(segments=[SegmentCreateItemPayload(content="text")]).segments[0].content == "text"
    assert SegmentListQuery().status == []
    assert ChildChunkListQuery().limit == 20
    with pytest.raises(ValueError, match="Content is empty"):
        SegmentCreateItemPayload(content="  ")


def test_list_segments_delegates_typed_query(app: Flask) -> None:
    segments = create_autospec(DatasetSegmentApplicationService, instance=True, spec_set=True)
    segments.list_segments_requiring_embedding_model.return_value = SegmentPage(
        items=(_segment_record(),),
        total=1,
        total_pages=1,
        page=2,
        limit=10,
        doc_form="text_model",
    )
    with (
        app.test_request_context("/?status=completed&limit=10&page=2&keyword=needle"),
        _services(segments),
    ):
        response, status = SegmentApi().get(_context(), _DATASET_ID, _DOCUMENT_ID)

    assert status == 200
    assert response["data"][0]["id"] == str(_SEGMENT_ID)
    assert response["has_more"] is False
    query = segments.list_segments_requiring_embedding_model.call_args.kwargs["query"]
    assert query == SegmentListFilter(page=2, limit=10, statuses=("completed",), keyword="needle")


def test_create_segments_delegates_batch_and_serializes(app: Flask) -> None:
    segments = create_autospec(DatasetSegmentApplicationService, instance=True, spec_set=True)
    segments.create_segments.return_value = (SegmentDetail(_segment_record(), "text_model"),)
    with (
        app.test_request_context("/", method="POST", json={"segments": [{"content": "content"}]}),
        _services(segments),
    ):
        response, status = SegmentApi().post(_context(), _DATASET_ID, _DOCUMENT_ID)

    assert status == 200
    assert response["doc_form"] == "text_model"
    assert response["data"][0]["content"] == "content"
    assert segments.create_segments.call_args.kwargs["values"] == [{"content": "content"}]


def test_segment_detail_handlers_delegate_without_persistence(app: Flask) -> None:
    segments = create_autospec(DatasetSegmentApplicationService, instance=True, spec_set=True)
    detail = SegmentDetail(_segment_record(), "text_model")
    segments.get_segment.return_value = detail
    segments.update_segment.return_value = detail

    with app.test_request_context("/"), _services(segments):
        response, status = DatasetSegmentApi().get(_context(), _DATASET_ID, _DOCUMENT_ID, _SEGMENT_ID)
    assert status == 200
    assert response["data"]["id"] == str(_SEGMENT_ID)

    method = unwrap(DatasetSegmentApi.post)
    payload = SegmentUpdatePayload(segment=SegmentUpdateArgs(content="updated"))
    with app.test_request_context("/", method="POST"), _services(segments):
        response, status = method(DatasetSegmentApi(), payload, _context(), _DATASET_ID, _DOCUMENT_ID, _SEGMENT_ID)
    assert status == 200
    assert segments.update_segment.call_args.kwargs["values"] == {"content": "updated"}


def test_update_payload_rejects_status_and_content_mutation() -> None:
    with pytest.raises(ValidationError, match="Enabled cannot be updated together"):
        SegmentUpdatePayload(segment=SegmentUpdateArgs(enabled=False, content="ignored"))


def test_existing_segment_update_does_not_require_paid_segment_plan() -> None:
    create_policy = vars(SegmentApi)["post"].__dataset_admission_policy__
    update_policy = vars(DatasetSegmentApi)["post"].__dataset_admission_policy__

    assert create_policy.require_paid_segments is True
    assert update_policy.require_paid_segments is False
    assert update_policy.billing_resources == ("vector_space",)


def test_delete_segment_returns_no_content(app: Flask) -> None:
    segments = create_autospec(DatasetSegmentApplicationService, instance=True, spec_set=True)
    with app.test_request_context("/", method="DELETE"), _services(segments):
        response = DatasetSegmentApi().delete(_context(), _DATASET_ID, _DOCUMENT_ID, _SEGMENT_ID)

    assert response == ("", 204)
    assert segments.delete_segment.call_args.kwargs["segment_id"] == str(_SEGMENT_ID)


def test_child_chunk_handlers_delegate_and_serialize(app: Flask) -> None:
    segments = create_autospec(DatasetSegmentApplicationService, instance=True, spec_set=True)
    child = _child_record()
    segments.create_child_chunk.return_value = child
    segments.list_child_chunks.return_value = ChildChunkPage((child,), 1, 1, 1, 20)
    segments.update_child_chunk.return_value = child.model_copy(update={"content": "updated"})

    create = unwrap(ChildChunkApi.post)
    with app.test_request_context("/", method="POST"), _services(segments):
        response, status = create(
            ChildChunkApi(),
            ChildChunkCreatePayload(content="child"),
            _context(),
            _DATASET_ID,
            _DOCUMENT_ID,
            _SEGMENT_ID,
        )
    assert status == 200
    assert response["data"]["content"] == "child"

    with app.test_request_context("/?page=1&limit=20"), _services(segments):
        response, status = ChildChunkApi().get(_context(), _DATASET_ID, _DOCUMENT_ID, _SEGMENT_ID)
    assert status == 200
    assert response["total"] == 1

    update = unwrap(DatasetChildChunkApi.patch)
    with app.test_request_context("/", method="PATCH"), _services(segments):
        response, status = update(
            DatasetChildChunkApi(),
            ChildChunkUpdatePayload(content="updated"),
            _context(),
            _DATASET_ID,
            _DOCUMENT_ID,
            _SEGMENT_ID,
            _CHILD_ID,
        )
    assert status == 200
    assert response["data"]["content"] == "updated"

    with app.test_request_context("/", method="DELETE"), _services(segments):
        response = DatasetChildChunkApi().delete(_context(), _DATASET_ID, _DOCUMENT_ID, _SEGMENT_ID, _CHILD_ID)
    assert response == ("", 204)


@pytest.mark.parametrize(
    ("error", "expected", "message"),
    [
        (SegmentDatasetNotFoundError(), NotFoundError, "Dataset not found."),
        (SegmentDocumentNotFoundError(), NotFoundError, "Document not found."),
        (SegmentDocumentNotCompletedError(), NotFoundError, "Document is not completed."),
        (SegmentDocumentDisabledError(), NotFoundError, "Document is disabled."),
        (SegmentNotFoundError(), NotFoundError, "Segment not found."),
        (SegmentPermissionDeniedError("denied"), ForbiddenError, "denied"),
        (SegmentDocumentIndexingError("Segment is indexing"), InvalidActionError, "Segment is indexing"),
    ],
)
def test_domain_errors_are_translated_at_transport(error: Exception, expected: type[Exception], message: str) -> None:
    with pytest.raises(expected, match=message):
        _raise_segment_error(error)


@pytest.mark.parametrize("translate", [_raise_child_chunk_create_error, _raise_child_chunk_write_error])
def test_child_indexing_error_is_translated_at_transport(translate: Callable[[Exception], Never]) -> None:
    with pytest.raises(ChildChunkIndexingError, match="Segment is indexing"):
        translate(ChildChunkIndexingApplicationError("Segment is indexing"))
