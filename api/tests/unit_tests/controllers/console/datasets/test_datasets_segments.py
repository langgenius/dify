from datetime import datetime
from inspect import unwrap
from types import SimpleNamespace
from typing import Any, cast
from unittest.mock import MagicMock, call, patch

import pytest
from flask import Flask
from sqlalchemy.orm import Session
from werkzeug.exceptions import Forbidden, NotFound

import services
from controllers.common.controller_schemas import ChildChunkCreatePayload, ChildChunkUpdatePayload
from controllers.console import console_ns
from controllers.console.app.error import ProviderNotInitializeError
from controllers.console.datasets.datasets_segments import (
    BatchImportPayload,
    ChildChunkAddApi,
    ChildChunkBatchUpdatePayload,
    ChildChunkUpdateApi,
    DatasetDocumentSegmentAddApi,
    DatasetDocumentSegmentApi,
    DatasetDocumentSegmentBatchImportApi,
    DatasetDocumentSegmentListApi,
    DatasetDocumentSegmentUpdateApi,
    SegmentCreatePayload,
    SegmentUpdatePayload,
)
from controllers.console.datasets.error import ChildChunkDeleteIndexError, ChildChunkIndexingError, InvalidActionError
from core.errors.error import LLMBadRequestError, ProviderTokenNotInitError
from core.rag.index_processor.constant.index_type import IndexStructureType
from fields.segment_fields import segment_response_with_summary, segment_responses_with_summaries
from libs.datetime_utils import naive_utc_now
from models.account import Account, TenantAccountRole
from models.dataset import ChildChunk, Dataset, Document, DocumentSegment
from models.enums import PermissionEnum, SegmentStatus, SegmentType
from models.model import UploadFile
from services.errors.chunk import ChildChunkDeleteIndexError as ChildChunkDeleteIndexServiceError
from services.errors.chunk import ChildChunkIndexingError as ChildChunkIndexingServiceError


def _segment():
    segment = DocumentSegment(
        tenant_id="tenant-1",
        dataset_id="ds-1",
        document_id="doc-1",
        position=1,
        content="c",
        word_count=1,
        tokens=1,
        created_by="u1",
        answer="a",
        keywords=["test"],
        index_node_id="n1",
        index_node_hash="h",
        status=SegmentStatus.COMPLETED,
        updated_by="u1",
    )

    segment.id = "seg-1"
    segment.created_at = naive_utc_now()
    segment.updated_at = naive_utc_now()
    return segment


def _child_chunk():
    child_chunk = ChildChunk(
        tenant_id="tenant-1",
        dataset_id="ds-1",
        document_id="doc-1",
        segment_id="seg-1",
        position=1,
        content="child",
        word_count=1,
        created_by="u1",
        type=SegmentType.CUSTOMIZED,
    )
    child_chunk.id = "cc-1"
    child_chunk.created_at = naive_utc_now()
    child_chunk.updated_at = naive_utc_now()
    return child_chunk


def _account() -> Account:
    account = Account(name="Dataset Editor", email="dataset-editor@example.com")
    account.id = "u1"
    account.role = TenantAccountRole.OWNER
    return account


def _dataset(
    *,
    dataset_id: str = "ds-1",
    tenant_id: str = "tenant-1",
    indexing_technique: str = "economy",
    embedding_model_provider: str | None = None,
    embedding_model: str | None = None,
) -> Dataset:
    return Dataset(
        id=dataset_id,
        tenant_id=tenant_id,
        name="Dataset",
        description="",
        provider="vendor",
        permission=PermissionEnum.ONLY_ME,
        indexing_technique=indexing_technique,
        embedding_model_provider=embedding_model_provider,
        embedding_model=embedding_model,
        created_by="u1",
    )


def _document(
    *,
    document_id: str = "doc-1",
    dataset_id: str = "ds-1",
    tenant_id: str = "tenant-1",
    doc_form: IndexStructureType = IndexStructureType.PARAGRAPH_INDEX,
) -> Document:
    return Document(
        id=document_id,
        tenant_id=tenant_id,
        dataset_id=dataset_id,
        position=1,
        data_source_type="upload_file",
        batch="batch-1",
        name="Document",
        created_from="api",
        created_by="u1",
        doc_form=doc_form,
    )


def _upload_file(*, name: str = "test.csv", file_id: str = "test-file-id") -> UploadFile:
    upload_file = UploadFile(
        tenant_id="tenant-1",
        storage_type="opendal",
        key="test-key",
        name=name,
        size=0,
        extension=name.rsplit(".", maxsplit=1)[-1],
        mime_type="text/csv",
        created_by_role="account",
        created_by="u1",
        created_at=datetime.now(),
        used=False,
    )
    upload_file.id = file_id
    return upload_file


class SQLiteControllerTest:
    session: Session

    @pytest.fixture(autouse=True)
    def _use_sqlite_session(self, sqlite_session: Session) -> None:
        self.session = sqlite_session


def _segment_response_dict():
    return {
        "id": "seg-1",
        "position": 1,
        "document_id": "doc-1",
        "content": "c",
        "sign_content": "c",
        "answer": "a",
        "word_count": 1,
        "tokens": 1,
        "keywords": ["test"],
        "index_node_id": "n1",
        "index_node_hash": "h",
        "hit_count": 0,
        "enabled": True,
        "disabled_at": None,
        "disabled_by": None,
        "status": "completed",
        "created_by": "u1",
        "created_at": 1779678000,
        "updated_at": 1779678000,
        "updated_by": "u1",
        "indexing_at": None,
        "completed_at": None,
        "error": None,
        "stopped_at": None,
        "child_chunks": [],
        "attachments": [],
        "summary": None,
    }


def test_segment_response_with_summary(sqlite_session: Session):
    segment = _segment()
    with (
        patch.object(DocumentSegment, "get_child_chunks", autospec=True, return_value=[]) as get_child_chunks,
        patch.object(DocumentSegment, "get_attachments", autospec=True, return_value=[]) as get_attachments,
    ):
        result = segment_response_with_summary(segment, "summary", session=sqlite_session)
    assert result.summary == "summary"
    assert result.id == segment.id
    get_child_chunks.assert_called_once_with(segment, session=sqlite_session, include_full_doc=False)
    get_attachments.assert_called_once_with(segment, session=sqlite_session)


def test_segment_responses_with_summaries_reuses_caller_session(sqlite_session: Session):
    segments = [_segment(), _segment()]
    segments[1].id = "seg-2"
    expected_responses = [MagicMock(), MagicMock()]

    with patch(
        "fields.segment_fields.segment_response_with_summary", side_effect=expected_responses
    ) as serialize_segment:
        responses = segment_responses_with_summaries(
            segments,
            {"seg-1": "summary-1", "seg-2": None},
            session=sqlite_session,
        )

    assert responses == expected_responses
    assert serialize_segment.call_args_list == [
        call(segments[0], "summary-1", session=sqlite_session),
        call(segments[1], None, session=sqlite_session),
    ]


class TestDatasetDocumentSegmentListApi(SQLiteControllerTest):
    def test_get_success(self, app: Flask):
        api = DatasetDocumentSegmentListApi()
        method = unwrap(api.get)
        dataset = _dataset()
        document = _document()
        user = _account()
        segment = _segment()
        pagination = MagicMock()
        pagination.items = [segment]
        pagination.total = 1
        pagination.pages = 1
        with (
            app.test_request_context("/"),
            patch("controllers.console.datasets.datasets_segments.DatasetService.get_dataset", return_value=dataset),
            patch(
                "controllers.console.datasets.datasets_segments.DatasetService.check_dataset_permission",
                return_value=None,
            ),
            patch("controllers.console.datasets.datasets_segments.DocumentService.get_document", return_value=document),
            patch("controllers.console.datasets.datasets_segments.paginate_query", return_value=pagination),
            patch("services.summary_index_service.SummaryIndexService.get_segments_summaries", return_value={}),
        ):
            response, status = method(api, self.session, "tenant-1", user, "ds-1", "doc-1")
        assert status == 200

    def test_get_dataset_not_found(self, app: Flask):
        api = DatasetDocumentSegmentListApi()
        method = unwrap(api.get)
        user = _account()
        with (
            app.test_request_context("/"),
            patch("controllers.console.datasets.datasets_segments.DatasetService.get_dataset", return_value=None),
        ):
            with pytest.raises(NotFound):
                method(api, self.session, "tenant-1", user, "ds-1", "doc-1")

    def test_get_permission_denied(self, app: Flask):
        api = DatasetDocumentSegmentListApi()
        method = unwrap(api.get)
        dataset = _dataset()
        user = _account()
        with (
            app.test_request_context("/"),
            patch("controllers.console.datasets.datasets_segments.DatasetService.get_dataset", return_value=dataset),
            patch(
                "controllers.console.datasets.datasets_segments.DatasetService.check_dataset_permission",
                side_effect=services.errors.account.NoPermissionError("no access"),
            ),
        ):
            with pytest.raises(Forbidden):
                method(api, self.session, "tenant-1", user, "ds-1", "doc-1")


class TestDatasetDocumentSegmentApi(SQLiteControllerTest):
    def test_patch_success(self, app: Flask):
        api = DatasetDocumentSegmentApi()
        method = unwrap(api.patch)
        user = _account()
        dataset = _dataset()
        document = _document()
        with (
            app.test_request_context("/?segment_id=s1&segment_id=s2"),
            patch("controllers.console.datasets.datasets_segments.DatasetService.get_dataset", return_value=dataset),
            patch("controllers.console.datasets.datasets_segments.DocumentService.get_document", return_value=document),
            patch(
                "controllers.console.datasets.datasets_segments.DatasetService.check_dataset_permission",
                return_value=None,
            ),
            patch("controllers.console.datasets.datasets_segments.redis_client.get", return_value=None),
            patch(
                "controllers.console.datasets.datasets_segments.SegmentService.update_segments_status",
                return_value=None,
            ),
        ):
            response, status = method(api, self.session, "tenant-1", user, "ds-1", "doc-1", "enable")
        assert status == 200
        assert response["result"] == "success"

    def test_patch_document_indexing_in_progress(self, app: Flask):
        api = DatasetDocumentSegmentApi()
        method = unwrap(api.patch)
        user = _account()
        dataset = _dataset()
        document = _document()
        with (
            app.test_request_context("/"),
            patch("controllers.console.datasets.datasets_segments.DatasetService.get_dataset", return_value=dataset),
            patch("controllers.console.datasets.datasets_segments.DocumentService.get_document", return_value=document),
            patch(
                "controllers.console.datasets.datasets_segments.DatasetService.check_dataset_model_setting",
                return_value=None,
            ),
            patch(
                "controllers.console.datasets.datasets_segments.DatasetService.check_dataset_permission",
                return_value=None,
            ),
            patch("controllers.console.datasets.datasets_segments.redis_client.get", return_value=b"running"),
        ):
            with pytest.raises(InvalidActionError):
                method(api, self.session, "tenant-1", user, "ds-1", "doc-1", "disable")

    def test_patch_llm_bad_request(self, app: Flask):
        api = DatasetDocumentSegmentApi()
        method = unwrap(api.patch)
        user = _account()
        dataset = _dataset(
            indexing_technique="high_quality", embedding_model_provider="openai", embedding_model="text-embed"
        )
        document = _document()
        with (
            app.test_request_context("/?segment_id=s1"),
            patch("controllers.console.datasets.datasets_segments.DatasetService.get_dataset", return_value=dataset),
            patch("controllers.console.datasets.datasets_segments.DocumentService.get_document", return_value=document),
            patch(
                "controllers.console.datasets.datasets_segments.DatasetService.check_dataset_model_setting",
                return_value=None,
            ),
            patch(
                "controllers.console.datasets.datasets_segments.DatasetService.check_dataset_permission",
                return_value=None,
            ),
            patch(
                "controllers.console.datasets.datasets_segments.ModelManager.get_model_instance",
                side_effect=LLMBadRequestError(),
            ),
        ):
            with pytest.raises(ProviderNotInitializeError):
                method(api, self.session, "tenant-1", user, "ds-1", "doc-1", "enable")

    def test_patch_provider_token_not_init(self, app: Flask):
        api = DatasetDocumentSegmentApi()
        method = unwrap(api.patch)
        user = _account()
        dataset = _dataset(
            indexing_technique="high_quality", embedding_model_provider="openai", embedding_model="text-embed"
        )
        document = _document()
        with (
            app.test_request_context("/?segment_id=s1"),
            patch("controllers.console.datasets.datasets_segments.DatasetService.get_dataset", return_value=dataset),
            patch("controllers.console.datasets.datasets_segments.DocumentService.get_document", return_value=document),
            patch(
                "controllers.console.datasets.datasets_segments.DatasetService.check_dataset_model_setting",
                return_value=None,
            ),
            patch(
                "controllers.console.datasets.datasets_segments.DatasetService.check_dataset_permission",
                return_value=None,
            ),
            patch(
                "controllers.console.datasets.datasets_segments.ModelManager.get_model_instance",
                side_effect=ProviderTokenNotInitError("token missing"),
            ),
        ):
            with pytest.raises(ProviderNotInitializeError):
                method(api, self.session, "tenant-1", user, "ds-1", "doc-1", "enable")


class TestDatasetDocumentSegmentAddApi(SQLiteControllerTest):
    def test_post_success(self, app: Flask):
        api = DatasetDocumentSegmentAddApi()
        method = unwrap(api.post)
        payload = {"content": "hello"}
        user = _account()
        dataset = _dataset()
        document = _document()
        segment = _segment()
        with (
            app.test_request_context("/", json=payload),
            patch.object(type(console_ns), "payload", payload),
            patch("controllers.console.datasets.datasets_segments.DatasetService.get_dataset", return_value=dataset),
            patch("controllers.console.datasets.datasets_segments.DocumentService.get_document", return_value=document),
            patch(
                "controllers.console.datasets.datasets_segments.DatasetService.check_dataset_permission",
                return_value=None,
            ),
            patch(
                "controllers.console.datasets.datasets_segments.SegmentService.segment_create_args_validate",
                return_value=None,
            ),
            patch("controllers.console.datasets.datasets_segments.SegmentService.create_segment", return_value=segment),
            patch(
                "controllers.console.datasets.datasets_segments.SummaryIndexService.get_segment_summary",
                return_value=None,
            ),
        ):
            response, status = method(
                api, SegmentCreatePayload(content="test content"), self.session, "tenant-1", user, "ds-1", "doc-1"
            )
        assert status == 200
        assert response["data"]["id"] == "seg-1"

    def test_post_llm_bad_request(self, app: Flask):
        api = DatasetDocumentSegmentAddApi()
        method = unwrap(api.post)
        payload = {"content": "x"}
        user = _account()
        dataset = _dataset(
            indexing_technique="high_quality", embedding_model_provider="openai", embedding_model="text-embed"
        )
        document = _document()
        with (
            app.test_request_context("/", json=payload),
            patch.object(type(console_ns), "payload", payload),
            patch("controllers.console.datasets.datasets_segments.DatasetService.get_dataset", return_value=dataset),
            patch("controllers.console.datasets.datasets_segments.DocumentService.get_document", return_value=document),
            patch(
                "controllers.console.datasets.datasets_segments.ModelManager.get_model_instance",
                side_effect=LLMBadRequestError(),
            ),
        ):
            with pytest.raises(ProviderNotInitializeError):
                method(
                    api, SegmentCreatePayload(content="test content"), self.session, "tenant-1", user, "ds-1", "doc-1"
                )

    def test_post_provider_token_not_init(self, app: Flask):
        api = DatasetDocumentSegmentAddApi()
        method = unwrap(api.post)
        payload = {"content": "x"}
        user = _account()
        dataset = _dataset(
            indexing_technique="high_quality", embedding_model_provider="openai", embedding_model="text-embed"
        )
        document = _document()
        with (
            app.test_request_context("/", json=payload),
            patch.object(type(console_ns), "payload", payload),
            patch("controllers.console.datasets.datasets_segments.DatasetService.get_dataset", return_value=dataset),
            patch("controllers.console.datasets.datasets_segments.DocumentService.get_document", return_value=document),
            patch(
                "controllers.console.datasets.datasets_segments.ModelManager.get_model_instance",
                side_effect=ProviderTokenNotInitError("token missing"),
            ),
        ):
            with pytest.raises(ProviderNotInitializeError):
                method(
                    api, SegmentCreatePayload(content="test content"), self.session, "tenant-1", user, "ds-1", "doc-1"
                )


class TestDatasetDocumentSegmentUpdateApi(SQLiteControllerTest):
    def test_patch_success(self, app: Flask):
        api = DatasetDocumentSegmentUpdateApi()
        method = unwrap(api.patch)
        payload = {"content": "updated"}
        user = _account()
        dataset = _dataset()
        document = _document()
        segment = _segment()
        with (
            app.test_request_context("/", json=payload),
            patch.object(type(console_ns), "payload", payload),
            patch("controllers.console.datasets.datasets_segments.DatasetService.get_dataset", return_value=dataset),
            patch("controllers.console.datasets.datasets_segments.DocumentService.get_document", return_value=document),
            patch(
                "controllers.console.datasets.datasets_segments.SegmentService.get_segment_by_ref", return_value=segment
            ),
            patch(
                "controllers.console.datasets.datasets_segments.DatasetService.check_dataset_permission",
                return_value=None,
            ),
            patch(
                "controllers.console.datasets.datasets_segments.SegmentService.segment_create_args_validate",
                return_value=None,
            ),
            patch("controllers.console.datasets.datasets_segments.SegmentService.update_segment", return_value=segment),
            patch(
                "controllers.console.datasets.datasets_segments.SummaryIndexService.get_segment_summary",
                return_value=None,
            ),
        ):
            response, status = method(
                api,
                SegmentUpdatePayload(content="test content"),
                self.session,
                "tenant-1",
                user,
                "ds-1",
                "doc-1",
                "seg-1",
            )
        assert status == 200
        assert "data" in response

    def test_patch_document_outside_dataset_is_not_found(self, app: Flask):
        api = DatasetDocumentSegmentUpdateApi()
        method = unwrap(api.patch)
        payload = {"content": "updated"}
        user = _account()
        dataset = _dataset()
        document = _document(dataset_id="other-dataset")
        with (
            app.test_request_context("/", json=payload),
            patch.object(type(console_ns), "payload", payload),
            patch("controllers.console.datasets.datasets_segments.DatasetService.get_dataset", return_value=dataset),
            patch(
                "controllers.console.datasets.datasets_segments.DatasetService.check_dataset_model_setting",
                return_value=None,
            ),
            patch("controllers.console.datasets.datasets_segments.DocumentService.get_document", return_value=document),
            patch(
                "controllers.console.datasets.datasets_segments.DatasetService.check_dataset_permission",
                return_value=None,
            ),
        ):
            with pytest.raises(NotFound):
                method(
                    api,
                    SegmentUpdatePayload(content="test content"),
                    self.session,
                    "tenant-1",
                    user,
                    "ds-1",
                    "doc-1",
                    "seg-1",
                )

    def test_patch_segment_not_found(self, app: Flask):
        api = DatasetDocumentSegmentUpdateApi()
        method = unwrap(api.patch)
        payload = {"content": "updated"}
        user = _account()
        dataset = _dataset()
        document = _document()
        with (
            app.test_request_context("/", json=payload),
            patch.object(type(console_ns), "payload", payload),
            patch("controllers.console.datasets.datasets_segments.DatasetService.get_dataset", return_value=dataset),
            patch(
                "controllers.console.datasets.datasets_segments.DatasetService.check_dataset_model_setting",
                return_value=None,
            ),
            patch("controllers.console.datasets.datasets_segments.DocumentService.get_document", return_value=document),
            patch(
                "controllers.console.datasets.datasets_segments.DatasetService.check_dataset_permission",
                return_value=None,
            ),
            patch(
                "controllers.console.datasets.datasets_segments.SegmentService.get_segment_by_ref", return_value=None
            ),
        ):
            with pytest.raises(NotFound):
                method(
                    api,
                    SegmentUpdatePayload(content="test content"),
                    self.session,
                    "tenant-1",
                    user,
                    "ds-1",
                    "doc-1",
                    "seg-1",
                )

    def test_patch_llm_bad_request(self, app: Flask):
        api = DatasetDocumentSegmentUpdateApi()
        method = unwrap(api.patch)
        payload = {"content": "x"}
        user = _account()
        dataset = _dataset(
            indexing_technique="high_quality", embedding_model_provider="openai", embedding_model="text-embed"
        )
        document = _document()
        with (
            app.test_request_context("/", json=payload),
            patch.object(type(console_ns), "payload", payload),
            patch("controllers.console.datasets.datasets_segments.DatasetService.get_dataset", return_value=dataset),
            patch("controllers.console.datasets.datasets_segments.DocumentService.get_document", return_value=document),
            patch(
                "controllers.console.datasets.datasets_segments.DatasetService.check_dataset_model_setting",
                return_value=None,
            ),
            patch(
                "controllers.console.datasets.datasets_segments.DatasetService.check_dataset_permission",
                return_value=None,
            ),
            patch(
                "controllers.console.datasets.datasets_segments.ModelManager.get_model_instance",
                side_effect=LLMBadRequestError(),
            ),
        ):
            with pytest.raises(ProviderNotInitializeError):
                method(
                    api,
                    SegmentUpdatePayload(content="test content"),
                    self.session,
                    "tenant-1",
                    user,
                    "ds-1",
                    "doc-1",
                    "seg-1",
                )


class TestDatasetDocumentSegmentBatchImportApi(SQLiteControllerTest):
    def test_post_success(self, app: Flask):
        api = DatasetDocumentSegmentBatchImportApi()
        method = unwrap(api.post)
        payload = {"upload_file_id": "file-1"}
        upload_file = _upload_file()
        self.session.add(upload_file)
        self.session.commit()
        user = _account()
        dataset = _dataset()
        document = _document()
        with (
            app.test_request_context("/", json=payload),
            patch.object(type(console_ns), "payload", payload),
            patch(
                "controllers.console.datasets.datasets_segments.DatasetService.get_dataset_for_tenant",
                return_value=dataset,
            ) as get_dataset_for_tenant,
            patch(
                "controllers.console.datasets.datasets_segments.DatasetRefService.get_document_by_ref",
                return_value=document,
            ) as get_document_by_ref,
            patch("controllers.console.datasets.datasets_segments.redis_client.setnx", return_value=True),
            patch(
                "controllers.console.datasets.datasets_segments.batch_create_segment_to_index_task.delay",
                return_value=None,
            ),
        ):
            response, status = method(
                api,
                BatchImportPayload(upload_file_id="test-file-id"),
                self.session,
                "tenant-1",
                user,
                "ds-1",
                "doc-1",
            )
        assert status == 200
        assert response["job_status"] == "waiting"
        get_dataset_for_tenant.assert_called_once_with("ds-1", "tenant-1", session=self.session)
        document_ref = get_document_by_ref.call_args.args[0]
        assert document_ref.dataset.tenant_id == "tenant-1"
        assert document_ref.dataset.dataset_id == "ds-1"
        assert document_ref.document_id == "doc-1"

    def test_post_dataset_not_found(self, app: Flask):
        api = DatasetDocumentSegmentBatchImportApi()
        method = unwrap(api.post)
        payload = {"upload_file_id": "file-1"}
        user = _account()
        with (
            app.test_request_context("/", json=payload),
            patch.object(type(console_ns), "payload", payload),
            patch(
                "controllers.console.datasets.datasets_segments.DatasetService.get_dataset_for_tenant",
                return_value=None,
            ),
        ):
            with pytest.raises(NotFound):
                method(
                    api,
                    BatchImportPayload(upload_file_id="test-file-id"),
                    self.session,
                    "tenant-1",
                    user,
                    "ds-1",
                    "doc-1",
                )

    def test_post_document_not_found(self, app: Flask):
        api = DatasetDocumentSegmentBatchImportApi()
        method = unwrap(api.post)
        payload = {"upload_file_id": "file-1"}
        user = _account()
        with (
            app.test_request_context("/", json=payload),
            patch.object(type(console_ns), "payload", payload),
            patch(
                "controllers.console.datasets.datasets_segments.DatasetService.get_dataset_for_tenant",
                return_value=_dataset(),
            ),
            patch(
                "controllers.console.datasets.datasets_segments.DatasetRefService.get_document_by_ref",
                return_value=None,
            ),
        ):
            with pytest.raises(NotFound):
                method(
                    api,
                    BatchImportPayload(upload_file_id="test-file-id"),
                    self.session,
                    "tenant-1",
                    user,
                    "ds-1",
                    "doc-1",
                )

    def test_post_upload_file_not_found(self, app: Flask):
        api = DatasetDocumentSegmentBatchImportApi()
        method = unwrap(api.post)
        payload = {"upload_file_id": "file-1"}
        user = _account()
        with (
            app.test_request_context("/", json=payload),
            patch.object(type(console_ns), "payload", payload),
            patch(
                "controllers.console.datasets.datasets_segments.DatasetService.get_dataset_for_tenant",
                return_value=_dataset(),
            ),
            patch(
                "controllers.console.datasets.datasets_segments.DatasetRefService.get_document_by_ref",
                return_value=_document(),
            ),
        ):
            with pytest.raises(NotFound):
                method(
                    api,
                    BatchImportPayload(upload_file_id="test-file-id"),
                    self.session,
                    "tenant-1",
                    user,
                    "ds-1",
                    "doc-1",
                )

    def test_post_invalid_file_type(self, app: Flask):
        api = DatasetDocumentSegmentBatchImportApi()
        method = unwrap(api.post)
        payload = {"upload_file_id": "file-1"}
        upload_file = _upload_file(name="test.txt")
        self.session.add(upload_file)
        self.session.commit()
        user = _account()
        with (
            app.test_request_context("/", json=payload),
            patch.object(type(console_ns), "payload", payload),
            patch(
                "controllers.console.datasets.datasets_segments.DatasetService.get_dataset_for_tenant",
                return_value=_dataset(),
            ),
            patch(
                "controllers.console.datasets.datasets_segments.DatasetRefService.get_document_by_ref",
                return_value=_document(),
            ),
        ):
            with pytest.raises(ValueError):
                method(
                    api,
                    BatchImportPayload(upload_file_id="test-file-id"),
                    self.session,
                    "tenant-1",
                    user,
                    "ds-1",
                    "doc-1",
                )

    def test_post_async_task_failure(self, app: Flask):
        api = DatasetDocumentSegmentBatchImportApi()
        method = unwrap(api.post)
        payload = {"upload_file_id": "file-1"}
        upload_file = _upload_file()
        self.session.add(upload_file)
        self.session.commit()
        user = _account()
        with (
            app.test_request_context("/", json=payload),
            patch.object(type(console_ns), "payload", payload),
            patch(
                "controllers.console.datasets.datasets_segments.DatasetService.get_dataset_for_tenant",
                return_value=_dataset(),
            ),
            patch(
                "controllers.console.datasets.datasets_segments.DatasetRefService.get_document_by_ref",
                return_value=_document(),
            ),
            patch(
                "controllers.console.datasets.datasets_segments.redis_client.setnx", side_effect=Exception("redis down")
            ),
        ):
            response, status = method(
                api,
                BatchImportPayload(upload_file_id="test-file-id"),
                self.session,
                "tenant-1",
                user,
                "ds-1",
                "doc-1",
            )
        assert status == 500
        assert "error" in response

    def test_get_job_not_found_in_redis(self, app: Flask):
        api = DatasetDocumentSegmentBatchImportApi()
        method = unwrap(api.get)
        with (
            app.test_request_context("/"),
            patch("controllers.console.datasets.datasets_segments.redis_client.get", return_value=None),
        ):
            with pytest.raises(ValueError):
                method(api, job_id="job-1")


class TestChildChunkAddApi(SQLiteControllerTest):
    def test_patch_documents_batch_update_payload(self):
        patch_method = cast(Any, ChildChunkAddApi.patch)
        api_doc = cast(dict[str, Any], patch_method.__apidoc__)
        expected_model = ChildChunkBatchUpdatePayload.__name__
        assert [model.name for model in api_doc["expect"]] == [expected_model]

    def test_get_uses_default_pagination_for_malformed_ints(self, app: Flask):
        api = ChildChunkAddApi()
        method = unwrap(api.get)
        dataset = _dataset()
        document = _document()
        pagination = MagicMock(items=[], total=0, pages=0)
        with (
            app.test_request_context("/?page=bad&limit="),
            patch("controllers.console.datasets.datasets_segments.DatasetService.get_dataset", return_value=dataset),
            patch(
                "controllers.console.datasets.datasets_segments.DatasetService.check_dataset_model_setting",
                return_value=None,
            ),
            patch("controllers.console.datasets.datasets_segments.DocumentService.get_document", return_value=document),
            patch(
                "controllers.console.datasets.datasets_segments.SegmentService.get_segment_by_ref",
                return_value=_segment(),
            ),
            patch(
                "controllers.console.datasets.datasets_segments.SegmentService.get_child_chunks",
                return_value=pagination,
            ) as get_child_chunks,
        ):
            response, status = method(api, self.session, "tenant-1", "ds-1", "doc-1", "seg-1")
        assert status == 200
        assert response["page"] == 1
        assert response["limit"] == 20
        session = get_child_chunks.call_args.kwargs["session"]
        assert session is self.session
        assert get_child_chunks.call_args.args == ("seg-1", "doc-1", "ds-1", 1, 20, None)

    def test_post_success(self, app: Flask):
        api = ChildChunkAddApi()
        method = unwrap(api.post)
        payload = {"content": "child"}
        user = _account()
        dataset = _dataset()
        document = _document()
        segment = _segment()
        child_chunk = _child_chunk()
        with (
            app.test_request_context("/", json=payload),
            patch.object(type(console_ns), "payload", payload),
            patch("controllers.console.datasets.datasets_segments.DatasetService.get_dataset", return_value=dataset),
            patch("controllers.console.datasets.datasets_segments.DocumentService.get_document", return_value=document),
            patch(
                "controllers.console.datasets.datasets_segments.SegmentService.get_segment_by_ref", return_value=segment
            ),
            patch(
                "controllers.console.datasets.datasets_segments.DatasetService.check_dataset_permission",
                return_value=None,
            ),
            patch(
                "controllers.console.datasets.datasets_segments.SegmentService.create_child_chunk",
                return_value=child_chunk,
            ),
        ):
            response, status = method(
                api,
                ChildChunkCreatePayload(content="child"),
                self.session,
                "tenant-1",
                user,
                "ds-1",
                "doc-1",
                "seg-1",
            )
        assert status == 200
        assert response["data"]["id"] == "cc-1"

    def test_post_child_chunk_indexing_error(self, app: Flask):
        api = ChildChunkAddApi()
        method = unwrap(api.post)
        payload = {"content": "child"}
        user = _account()
        dataset = _dataset()
        document = _document()
        segment = _segment()
        with (
            app.test_request_context("/", json=payload),
            patch.object(type(console_ns), "payload", payload),
            patch("controllers.console.datasets.datasets_segments.DatasetService.get_dataset", return_value=dataset),
            patch("controllers.console.datasets.datasets_segments.DocumentService.get_document", return_value=document),
            patch(
                "controllers.console.datasets.datasets_segments.SegmentService.get_segment_by_ref", return_value=segment
            ),
            patch(
                "controllers.console.datasets.datasets_segments.DatasetService.check_dataset_permission",
                return_value=None,
            ),
            patch(
                "controllers.console.datasets.datasets_segments.SegmentService.create_child_chunk",
                side_effect=ChildChunkIndexingServiceError("fail"),
            ),
        ):
            with pytest.raises(ChildChunkIndexingError):
                method(
                    api,
                    ChildChunkCreatePayload(content="child"),
                    self.session,
                    "tenant-1",
                    user,
                    "ds-1",
                    "doc-1",
                    "seg-1",
                )

    def test_post_permission_denied(self, app: Flask):
        api = ChildChunkAddApi()
        method = unwrap(api.post)
        payload = {"content": "child"}
        user = _account()
        dataset = _dataset()
        document = _document()
        with (
            app.test_request_context("/", json=payload),
            patch.object(type(console_ns), "payload", payload),
            patch("controllers.console.datasets.datasets_segments.DatasetService.get_dataset", return_value=dataset),
            patch("controllers.console.datasets.datasets_segments.DocumentService.get_document", return_value=document),
            patch(
                "controllers.console.datasets.datasets_segments.DatasetService.check_dataset_permission",
                side_effect=services.errors.account.NoPermissionError("no access"),
            ),
        ):
            with pytest.raises(Forbidden):
                method(
                    api,
                    ChildChunkCreatePayload(content="child"),
                    self.session,
                    "tenant-1",
                    user,
                    "ds-1",
                    "doc-1",
                    "seg-1",
                )


class TestChildChunkUpdateApi(SQLiteControllerTest):
    def test_delete_success(self, app: Flask):
        api = ChildChunkUpdateApi()
        method = unwrap(api.delete)
        user = _account()
        dataset = _dataset()
        document = _document()
        segment = _segment()
        child_chunk = _child_chunk()
        with (
            app.test_request_context("/"),
            patch("controllers.console.datasets.datasets_segments.DatasetService.get_dataset", return_value=dataset),
            patch("controllers.console.datasets.datasets_segments.DocumentService.get_document", return_value=document),
            patch(
                "controllers.console.datasets.datasets_segments.SegmentService.get_segment_by_ref", return_value=segment
            ),
            patch(
                "controllers.console.datasets.datasets_segments.SegmentService.get_child_chunk_by_segment_ref",
                return_value=child_chunk,
            ),
            patch(
                "controllers.console.datasets.datasets_segments.DatasetService.check_dataset_permission",
                return_value=None,
            ),
            patch(
                "controllers.console.datasets.datasets_segments.SegmentService.delete_child_chunk", return_value=None
            ),
        ):
            response, status = method(api, self.session, "tenant-1", user, "ds-1", "doc-1", "seg-1", "cc-1")
        assert status == 204
        assert response == ""

    def test_delete_child_chunk_index_error(self, app: Flask):
        api = ChildChunkUpdateApi()
        method = unwrap(api.delete)
        user = _account()
        dataset = _dataset()
        document = _document()
        segment = _segment()
        child_chunk = _child_chunk()
        with (
            app.test_request_context("/"),
            patch("controllers.console.datasets.datasets_segments.DatasetService.get_dataset", return_value=dataset),
            patch("controllers.console.datasets.datasets_segments.DocumentService.get_document", return_value=document),
            patch(
                "controllers.console.datasets.datasets_segments.SegmentService.get_segment_by_ref", return_value=segment
            ),
            patch(
                "controllers.console.datasets.datasets_segments.SegmentService.get_child_chunk_by_segment_ref",
                return_value=child_chunk,
            ),
            patch(
                "controllers.console.datasets.datasets_segments.DatasetService.check_dataset_permission",
                return_value=None,
            ),
            patch(
                "controllers.console.datasets.datasets_segments.SegmentService.delete_child_chunk",
                side_effect=ChildChunkDeleteIndexServiceError("fail"),
            ),
        ):
            with pytest.raises(ChildChunkDeleteIndexError):
                method(api, self.session, "tenant-1", user, "ds-1", "doc-1", "seg-1", "cc-1")

    def test_delete_child_chunk_not_found(self, app: Flask):
        api = ChildChunkUpdateApi()
        method = unwrap(api.delete)
        user = _account()
        dataset = _dataset()
        document = _document()
        segment = _segment()
        with (
            app.test_request_context("/"),
            patch("controllers.console.datasets.datasets_segments.DatasetService.get_dataset", return_value=dataset),
            patch("controllers.console.datasets.datasets_segments.DocumentService.get_document", return_value=document),
            patch(
                "controllers.console.datasets.datasets_segments.SegmentService.get_segment_by_ref", return_value=segment
            ),
            patch(
                "controllers.console.datasets.datasets_segments.SegmentService.get_child_chunk_by_segment_ref",
                return_value=None,
            ),
            patch(
                "controllers.console.datasets.datasets_segments.DatasetService.check_dataset_permission",
                return_value=None,
            ),
        ):
            with pytest.raises(NotFound):
                method(api, self.session, "tenant-1", user, "ds-1", "doc-1", "seg-1", "cc-1")

    def test_patch_child_chunk_not_found(self, app: Flask):
        api = ChildChunkUpdateApi()
        method = unwrap(api.patch)
        payload = {"content": "updated child"}
        user = _account()
        dataset = _dataset()
        document = _document()
        segment = _segment()
        with (
            app.test_request_context("/", json=payload),
            patch.object(type(console_ns), "payload", payload),
            patch("controllers.console.datasets.datasets_segments.DatasetService.get_dataset", return_value=dataset),
            patch("controllers.console.datasets.datasets_segments.DocumentService.get_document", return_value=document),
            patch(
                "controllers.console.datasets.datasets_segments.SegmentService.get_segment_by_ref", return_value=segment
            ),
            patch(
                "controllers.console.datasets.datasets_segments.SegmentService.get_child_chunk_by_segment_ref",
                return_value=None,
            ),
            patch(
                "controllers.console.datasets.datasets_segments.DatasetService.check_dataset_permission",
                return_value=None,
            ),
        ):
            with pytest.raises(NotFound):
                method(
                    api,
                    ChildChunkUpdatePayload(content="updated child"),
                    self.session,
                    "tenant-1",
                    user,
                    "ds-1",
                    "doc-1",
                    "seg-1",
                    "cc-1",
                )


class TestSegmentListAdvancedCases(SQLiteControllerTest):
    def test_segment_list_with_keyword_filter(self, app: Flask):
        api = DatasetDocumentSegmentListApi()
        method = unwrap(api.get)
        dataset = _dataset()
        document = _document()
        user = _account()
        segment = _segment()
        pagination = MagicMock(items=[segment], total=1, pages=1)
        with (
            app.test_request_context("/?keyword=test"),
            patch("controllers.console.datasets.datasets_segments.DatasetService.get_dataset", return_value=dataset),
            patch(
                "controllers.console.datasets.datasets_segments.DatasetService.check_dataset_permission",
                return_value=None,
            ),
            patch("controllers.console.datasets.datasets_segments.DocumentService.get_document", return_value=document),
            patch("controllers.console.datasets.datasets_segments.paginate_query", return_value=pagination),
            patch("services.summary_index_service.SummaryIndexService.get_segments_summaries", return_value={}),
        ):
            result = method(api, self.session, "tenant-1", user, "ds-1", "doc-1")
        if isinstance(result, tuple):
            response, status = result
        else:
            response, status = (result, 200)
        assert status == 200
        assert response["total"] == 1

    def test_segment_list_postgres_keyword_filter_handles_scalar_keywords(self, app: Flask):
        api = DatasetDocumentSegmentListApi()
        method = unwrap(api.get)
        dataset = _dataset(dataset_id="22222222-2222-2222-2222-222222222222")
        document = _document(
            document_id="33333333-3333-3333-3333-333333333333",
            dataset_id=dataset.id,
        )
        user = _account()
        pagination = MagicMock(items=[], total=0, pages=0)
        with (
            app.test_request_context("/?keyword=test"),
            patch("controllers.console.datasets.datasets_segments.DatasetService.get_dataset", return_value=dataset),
            patch(
                "controllers.console.datasets.datasets_segments.DatasetService.check_dataset_permission",
                return_value=None,
            ),
            patch("controllers.console.datasets.datasets_segments.DocumentService.get_document", return_value=document),
            patch(
                "controllers.console.datasets.datasets_segments.dify_config",
                SimpleNamespace(SQLALCHEMY_DATABASE_URI_SCHEME="postgresql"),
            ),
            patch(
                "controllers.console.datasets.datasets_segments.paginate_query", return_value=pagination
            ) as paginate_mock,
        ):
            method(
                api,
                self.session,
                "11111111-1111-1111-1111-111111111111",
                user,
                "22222222-2222-2222-2222-222222222222",
                "33333333-3333-3333-3333-333333333333",
            )
        query = paginate_mock.call_args.args[0]
        sql = str(query.compile(compile_kwargs={"literal_binds": True}))
        assert "jsonb_array_elements_text(CASE" in sql
        assert "ELSE CAST('[]' AS JSONB)" in sql

    def test_segment_list_permission_denied(self, app: Flask):
        """Test segment list with permission denied"""
        api = DatasetDocumentSegmentListApi()
        method = unwrap(api.get)
        user = _account()
        with (
            app.test_request_context("/"),
            patch("controllers.console.datasets.datasets_segments.DatasetService.get_dataset", return_value=_dataset()),
            patch(
                "controllers.console.datasets.datasets_segments.DatasetService.check_dataset_permission",
                side_effect=services.errors.account.NoPermissionError("No permission"),
            ),
        ):
            with pytest.raises(Forbidden):
                method(api, self.session, "tenant-1", user, "ds-1", "doc-1")

    def test_segment_list_dataset_not_found(self, app: Flask):
        """Test segment list with dataset not found"""
        api = DatasetDocumentSegmentListApi()
        method = unwrap(api.get)
        user = _account()
        with (
            app.test_request_context("/"),
            patch("controllers.console.datasets.datasets_segments.DatasetService.get_dataset", return_value=None),
        ):
            with pytest.raises(NotFound):
                method(api, self.session, "tenant-1", user, "ds-1", "doc-1")


class TestSegmentOperationCases(SQLiteControllerTest):
    def test_segment_add_with_provider_token_error(self, app: Flask):
        """Test segment add with provider token not initialized"""
        api = DatasetDocumentSegmentAddApi()
        method = unwrap(api.post)
        user = _account()
        dataset = _dataset()
        document = _document()
        payload = {"content": "new content", "answer": None}
        with (
            app.test_request_context("/", json=payload),
            patch.object(type(console_ns), "payload", payload),
            patch("controllers.console.datasets.datasets_segments.DatasetService.get_dataset", return_value=dataset),
            patch("controllers.console.datasets.datasets_segments.DocumentService.get_document", return_value=document),
            patch(
                "controllers.console.datasets.datasets_segments.DatasetService.check_dataset_permission",
                return_value=None,
            ),
            patch(
                "controllers.console.datasets.datasets_segments.SegmentService.create_segment",
                side_effect=ProviderTokenNotInitError("Token not init"),
            ),
        ):
            with pytest.raises(ProviderTokenNotInitError):
                method(
                    api,
                    SegmentCreatePayload(content="test content"),
                    self.session,
                    "tenant-1",
                    user,
                    "ds-1",
                    "doc-1",
                )

    def test_batch_import_with_document_not_found(self, app: Flask):
        """Test batch import with document not found"""
        api = DatasetDocumentSegmentBatchImportApi()
        method = unwrap(api.post)
        user = _account()
        dataset = _dataset()
        payload = {"upload_file_id": "file-1"}
        with (
            app.test_request_context("/", json=payload),
            patch.object(type(console_ns), "payload", payload),
            patch(
                "controllers.console.datasets.datasets_segments.DatasetService.get_dataset_for_tenant",
                return_value=dataset,
            ),
            patch(
                "controllers.console.datasets.datasets_segments.DatasetRefService.get_document_by_ref",
                return_value=None,
            ),
        ):
            with pytest.raises(NotFound):
                method(
                    api,
                    BatchImportPayload(upload_file_id="test-file-id"),
                    self.session,
                    "tenant-1",
                    user,
                    "ds-1",
                    "doc-1",
                )

    def test_batch_import_with_invalid_file(self, app: Flask):
        """Test batch import with invalid file type"""
        api = DatasetDocumentSegmentBatchImportApi()
        method = unwrap(api.post)
        user = _account()
        dataset = _dataset()
        document = _document()
        payload = {"upload_file_id": "file-1"}
        with (
            app.test_request_context("/", json=payload),
            patch.object(type(console_ns), "payload", payload),
            patch(
                "controllers.console.datasets.datasets_segments.DatasetService.get_dataset_for_tenant",
                return_value=dataset,
            ),
            patch(
                "controllers.console.datasets.datasets_segments.DatasetRefService.get_document_by_ref",
                return_value=document,
            ),
        ):
            with pytest.raises(NotFound):
                method(
                    api,
                    BatchImportPayload(upload_file_id="test-file-id"),
                    self.session,
                    "tenant-1",
                    user,
                    "ds-1",
                    "doc-1",
                )

    def test_batch_import_with_async_task_failure(self, app: Flask):
        api = DatasetDocumentSegmentBatchImportApi()
        method = unwrap(api.post)
        user = _account()
        dataset = _dataset()
        document = _document()
        upload_file = _upload_file()
        self.session.add(upload_file)
        self.session.commit()
        payload = {"upload_file_id": "file-1"}
        with (
            app.test_request_context("/", json=payload),
            patch.object(type(console_ns), "payload", payload),
            patch(
                "controllers.console.datasets.datasets_segments.DatasetService.get_dataset_for_tenant",
                return_value=dataset,
            ),
            patch(
                "controllers.console.datasets.datasets_segments.DatasetRefService.get_document_by_ref",
                return_value=document,
            ),
            patch(
                "controllers.console.datasets.datasets_segments.batch_create_segment_to_index_task.delay",
                side_effect=Exception("Task failed"),
            ),
        ):
            response, status = method(
                api,
                BatchImportPayload(upload_file_id="test-file-id"),
                self.session,
                "tenant-1",
                user,
                "ds-1",
                "doc-1",
            )
        assert status == 500
        assert "error" in response

    def test_batch_import_get_job_not_found(self, app: Flask):
        api = DatasetDocumentSegmentBatchImportApi()
        method = unwrap(api.get)
        with (
            app.test_request_context("/?job_id=invalid-job"),
            patch("controllers.console.datasets.datasets_segments.redis_client.get", return_value=None),
        ):
            with pytest.raises(ValueError):
                method(api, "invalid-job")
