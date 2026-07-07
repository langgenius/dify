import inspect
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from flask import Flask
from werkzeug.exceptions import Forbidden, NotFound

import services
from controllers.console import console_ns
from controllers.console.app.error import ProviderNotInitializeError
from controllers.console.datasets.datasets_segments import (
    ChildChunkAddApi,
    ChildChunkBatchUpdatePayload,
    ChildChunkUpdateApi,
    DatasetDocumentSegmentAddApi,
    DatasetDocumentSegmentApi,
    DatasetDocumentSegmentBatchImportApi,
    DatasetDocumentSegmentListApi,
    DatasetDocumentSegmentUpdateApi,
)
from controllers.console.datasets.error import (
    ChildChunkDeleteIndexError,
    ChildChunkIndexingError,
    InvalidActionError,
)
from core.errors.error import LLMBadRequestError, ProviderTokenNotInitError
from core.rag.index_processor.constant.index_type import IndexStructureType
from fields.segment_fields import segment_response_with_summary
from libs.datetime_utils import naive_utc_now
from models.dataset import ChildChunk, DocumentSegment
from models.enums import SegmentStatus, SegmentType
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
    )
    segment.id = "seg-1"
    segment.answer = "a"
    segment.keywords = ["test"]
    segment.index_node_id = "n1"
    segment.index_node_hash = "h"
    segment.status = SegmentStatus.COMPLETED
    segment.created_at = naive_utc_now()
    segment.updated_at = naive_utc_now()
    segment.updated_by = "u1"
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
    )
    child_chunk.id = "cc-1"
    child_chunk.type = SegmentType.CUSTOMIZED
    child_chunk.created_at = naive_utc_now()
    child_chunk.updated_at = naive_utc_now()
    return child_chunk


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


def _bind_dataset_document(dataset, document, dataset_id: str = "ds-1", document_id: str = "doc-1"):
    dataset.id = dataset_id
    dataset.tenant_id = "tenant-1"
    document.id = document_id
    document.dataset_id = dataset_id
    document.tenant_id = "tenant-1"
    return document


def test_segment_response_with_summary():
    segment = _segment()

    with (
        patch("models.dataset.db.session.scalar", return_value=None),
        patch("models.dataset.db.session.execute", return_value=MagicMock(all=MagicMock(return_value=[]))),
    ):
        result = segment_response_with_summary(segment, "summary")

    assert result.summary == "summary"
    assert result.id == segment.id


class TestDatasetDocumentSegmentListApi:
    def test_get_success(self, app: Flask):
        api = DatasetDocumentSegmentListApi()
        method = inspect.unwrap(api.get)

        dataset = MagicMock()
        document = MagicMock()
        user = MagicMock()

        segment = _segment()

        pagination = MagicMock()
        pagination.items = [segment]
        pagination.total = 1
        pagination.pages = 1

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.datasets.datasets_segments.DatasetService.get_dataset",
                return_value=dataset,
            ),
            patch(
                "controllers.console.datasets.datasets_segments.DatasetService.check_dataset_permission",
                return_value=None,
            ),
            patch(
                "controllers.console.datasets.datasets_segments.DocumentService.get_document",
                return_value=document,
            ),
            patch(
                "controllers.console.datasets.datasets_segments.paginate_query",
                return_value=pagination,
            ),
            patch(
                "services.summary_index_service.SummaryIndexService.get_segments_summaries",
                return_value={},
            ),
            patch("models.dataset.db.session.scalar", return_value=None),
            patch("models.dataset.db.session.execute", return_value=MagicMock(all=MagicMock(return_value=[]))),
        ):
            response, status = method(api, "tenant-1", user, "ds-1", "doc-1")

        assert status == 200

    def test_get_dataset_not_found(self, app: Flask):
        api = DatasetDocumentSegmentListApi()
        method = inspect.unwrap(api.get)
        user = MagicMock()

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.datasets.datasets_segments.DatasetService.get_dataset",
                return_value=None,
            ),
        ):
            with pytest.raises(NotFound):
                method(api, "tenant-1", user, "ds-1", "doc-1")

    def test_get_permission_denied(self, app: Flask):
        api = DatasetDocumentSegmentListApi()
        method = inspect.unwrap(api.get)

        dataset = MagicMock()
        user = MagicMock()

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.datasets.datasets_segments.DatasetService.get_dataset",
                return_value=dataset,
            ),
            patch(
                "controllers.console.datasets.datasets_segments.DatasetService.check_dataset_permission",
                side_effect=services.errors.account.NoPermissionError("no access"),
            ),
        ):
            with pytest.raises(Forbidden):
                method(api, "tenant-1", user, "ds-1", "doc-1")


class TestDatasetDocumentSegmentApi:
    def test_patch_success(self, app: Flask):
        api = DatasetDocumentSegmentApi()
        method = inspect.unwrap(api.patch)

        user = MagicMock()
        user.is_dataset_editor = True

        dataset = MagicMock()
        dataset.indexing_technique = "economy"

        document = MagicMock()
        document.id = "doc-1"

        with (
            app.test_request_context("/?segment_id=s1&segment_id=s2"),
            patch(
                "controllers.console.datasets.datasets_segments.DatasetService.get_dataset",
                return_value=dataset,
            ),
            patch(
                "controllers.console.datasets.datasets_segments.DocumentService.get_document",
                return_value=document,
            ),
            patch(
                "controllers.console.datasets.datasets_segments.DatasetService.check_dataset_permission",
                return_value=None,
            ),
            patch(
                "controllers.console.datasets.datasets_segments.redis_client.get",
                return_value=None,
            ),
            patch(
                "controllers.console.datasets.datasets_segments.SegmentService.update_segments_status",
                return_value=None,
            ),
        ):
            response, status = method(api, "tenant-1", user, "ds-1", "doc-1", "enable")

        assert status == 200
        assert response["result"] == "success"

    def test_patch_document_indexing_in_progress(self, app: Flask):
        api = DatasetDocumentSegmentApi()
        method = inspect.unwrap(api.patch)

        user = MagicMock()
        user.is_dataset_editor = True

        dataset = MagicMock()
        dataset.indexing_technique = "economy"

        document = MagicMock()
        document.id = "doc-1"

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.datasets.datasets_segments.DatasetService.get_dataset",
                return_value=dataset,
            ),
            patch(
                "controllers.console.datasets.datasets_segments.DocumentService.get_document",
                return_value=document,
            ),
            patch(
                "controllers.console.datasets.datasets_segments.DatasetService.check_dataset_model_setting",
                return_value=None,
            ),
            patch(
                "controllers.console.datasets.datasets_segments.DatasetService.check_dataset_permission",
                return_value=None,
            ),
            patch(
                "controllers.console.datasets.datasets_segments.redis_client.get",
                return_value=b"running",
            ),
        ):
            with pytest.raises(InvalidActionError):
                method(api, "tenant-1", user, "ds-1", "doc-1", "disable")

    def test_patch_llm_bad_request(self, app: Flask):
        api = DatasetDocumentSegmentApi()
        method = inspect.unwrap(api.patch)

        user = MagicMock(is_dataset_editor=True)

        dataset = MagicMock(
            indexing_technique="high_quality",
            embedding_model_provider="openai",
            embedding_model="text-embed",
        )

        document = MagicMock(id="doc-1")

        with (
            app.test_request_context("/?segment_id=s1"),
            patch(
                "controllers.console.datasets.datasets_segments.DatasetService.get_dataset",
                return_value=dataset,
            ),
            patch(
                "controllers.console.datasets.datasets_segments.DocumentService.get_document",
                return_value=document,
            ),
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
                method(api, "tenant-1", user, "ds-1", "doc-1", "enable")

    def test_patch_provider_token_not_init(self, app: Flask):
        api = DatasetDocumentSegmentApi()
        method = inspect.unwrap(api.patch)

        user = MagicMock(is_dataset_editor=True)

        dataset = MagicMock(
            indexing_technique="high_quality",
            embedding_model_provider="openai",
            embedding_model="text-embed",
        )

        document = MagicMock(id="doc-1")

        with (
            app.test_request_context("/?segment_id=s1"),
            patch(
                "controllers.console.datasets.datasets_segments.DatasetService.get_dataset",
                return_value=dataset,
            ),
            patch(
                "controllers.console.datasets.datasets_segments.DocumentService.get_document",
                return_value=document,
            ),
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
                method(api, "tenant-1", user, "ds-1", "doc-1", "enable")


class TestDatasetDocumentSegmentAddApi:
    def test_post_success(self, app: Flask):
        api = DatasetDocumentSegmentAddApi()
        method = inspect.unwrap(api.post)

        payload = {"content": "hello"}

        user = MagicMock()
        user.is_dataset_editor = True

        dataset = MagicMock()
        dataset.indexing_technique = "economy"

        document = MagicMock()
        document.doc_form = IndexStructureType.PARAGRAPH_INDEX
        _bind_dataset_document(dataset, document)

        segment = _segment()

        with (
            app.test_request_context("/", json=payload),
            patch.object(type(console_ns), "payload", payload),
            patch(
                "controllers.console.datasets.datasets_segments.DatasetService.get_dataset",
                return_value=dataset,
            ),
            patch(
                "controllers.console.datasets.datasets_segments.DocumentService.get_document",
                return_value=document,
            ),
            patch(
                "controllers.console.datasets.datasets_segments.DatasetService.check_dataset_permission",
                return_value=None,
            ),
            patch(
                "controllers.console.datasets.datasets_segments.SegmentService.segment_create_args_validate",
                return_value=None,
            ),
            patch(
                "controllers.console.datasets.datasets_segments.SegmentService.create_segment",
                return_value=segment,
            ),
            patch(
                "controllers.console.datasets.datasets_segments.SummaryIndexService.get_segment_summary",
                return_value=None,
            ),
            patch("models.dataset.db.session.scalar", return_value=None),
            patch("models.dataset.db.session.execute", return_value=MagicMock(all=MagicMock(return_value=[]))),
        ):
            response, status = method(api, "tenant-1", user, "ds-1", "doc-1")

        assert status == 200
        assert response["data"]["id"] == "seg-1"

    def test_post_llm_bad_request(self, app: Flask):
        api = DatasetDocumentSegmentAddApi()
        method = inspect.unwrap(api.post)

        payload = {"content": "x"}

        user = MagicMock(is_dataset_editor=True)

        dataset = MagicMock(
            indexing_technique="high_quality",
            embedding_model_provider="openai",
            embedding_model="text-embed",
        )

        document = MagicMock()

        with (
            app.test_request_context("/", json=payload),
            patch.object(type(console_ns), "payload", payload),
            patch(
                "controllers.console.datasets.datasets_segments.DatasetService.get_dataset",
                return_value=dataset,
            ),
            patch(
                "controllers.console.datasets.datasets_segments.DocumentService.get_document",
                return_value=document,
            ),
            patch(
                "controllers.console.datasets.datasets_segments.ModelManager.get_model_instance",
                side_effect=LLMBadRequestError(),
            ),
        ):
            with pytest.raises(ProviderNotInitializeError):
                method(api, "tenant-1", user, "ds-1", "doc-1")

    def test_post_provider_token_not_init(self, app: Flask):
        api = DatasetDocumentSegmentAddApi()
        method = inspect.unwrap(api.post)

        payload = {"content": "x"}

        user = MagicMock(is_dataset_editor=True)

        dataset = MagicMock(
            indexing_technique="high_quality",
            embedding_model_provider="openai",
            embedding_model="text-embed",
        )

        document = MagicMock()

        with (
            app.test_request_context("/", json=payload),
            patch.object(type(console_ns), "payload", payload),
            patch(
                "controllers.console.datasets.datasets_segments.DatasetService.get_dataset",
                return_value=dataset,
            ),
            patch(
                "controllers.console.datasets.datasets_segments.DocumentService.get_document",
                return_value=document,
            ),
            patch(
                "controllers.console.datasets.datasets_segments.ModelManager.get_model_instance",
                side_effect=ProviderTokenNotInitError("token missing"),
            ),
        ):
            with pytest.raises(ProviderNotInitializeError):
                method(api, "tenant-1", user, "ds-1", "doc-1")


class TestDatasetDocumentSegmentUpdateApi:
    def test_patch_success(self, app: Flask):
        api = DatasetDocumentSegmentUpdateApi()
        method = inspect.unwrap(api.patch)

        payload = {"content": "updated"}

        user = MagicMock()
        user.is_dataset_editor = True

        dataset = MagicMock()
        dataset.indexing_technique = "economy"

        document = MagicMock()
        document.doc_form = IndexStructureType.PARAGRAPH_INDEX
        _bind_dataset_document(dataset, document)

        segment = _segment()

        with (
            app.test_request_context("/", json=payload),
            patch.object(type(console_ns), "payload", payload),
            patch(
                "controllers.console.datasets.datasets_segments.DatasetService.get_dataset",
                return_value=dataset,
            ),
            patch(
                "controllers.console.datasets.datasets_segments.DocumentService.get_document",
                return_value=document,
            ),
            patch(
                "controllers.console.datasets.datasets_segments.SegmentService.get_segment_by_ref",
                return_value=segment,
            ),
            patch(
                "controllers.console.datasets.datasets_segments.DatasetService.check_dataset_permission",
                return_value=None,
            ),
            patch(
                "controllers.console.datasets.datasets_segments.SegmentService.segment_create_args_validate",
                return_value=None,
            ),
            patch(
                "controllers.console.datasets.datasets_segments.SegmentService.update_segment",
                return_value=segment,
            ),
            patch(
                "controllers.console.datasets.datasets_segments.SummaryIndexService.get_segment_summary",
                return_value=None,
            ),
            patch("models.dataset.db.session.scalar", return_value=None),
            patch("models.dataset.db.session.execute", return_value=MagicMock(all=MagicMock(return_value=[]))),
        ):
            response, status = method(api, "tenant-1", user, "ds-1", "doc-1", "seg-1")

        assert status == 200
        assert "data" in response

    def test_patch_document_outside_dataset_is_not_found(self, app: Flask):
        api = DatasetDocumentSegmentUpdateApi()
        method = inspect.unwrap(api.patch)

        payload = {"content": "updated"}
        user = MagicMock(is_dataset_editor=True)
        dataset = MagicMock(id="ds-1", tenant_id="tenant-1", indexing_technique="economy")
        document = MagicMock(id="doc-1", dataset_id="other-dataset", tenant_id="tenant-1")

        with (
            app.test_request_context("/", json=payload),
            patch.object(type(console_ns), "payload", payload),
            patch(
                "controllers.console.datasets.datasets_segments.DatasetService.get_dataset",
                return_value=dataset,
            ),
            patch(
                "controllers.console.datasets.datasets_segments.DatasetService.check_dataset_model_setting",
                return_value=None,
            ),
            patch(
                "controllers.console.datasets.datasets_segments.DocumentService.get_document",
                return_value=document,
            ),
            patch(
                "controllers.console.datasets.datasets_segments.DatasetService.check_dataset_permission",
                return_value=None,
            ),
        ):
            with pytest.raises(NotFound):
                method(api, "tenant-1", user, "ds-1", "doc-1", "seg-1")

    def test_patch_segment_not_found(self, app: Flask):
        api = DatasetDocumentSegmentUpdateApi()
        method = inspect.unwrap(api.patch)

        payload = {"content": "updated"}
        user = MagicMock(is_dataset_editor=True)
        dataset = MagicMock(indexing_technique="economy")
        document = MagicMock()
        _bind_dataset_document(dataset, document)

        with (
            app.test_request_context("/", json=payload),
            patch.object(type(console_ns), "payload", payload),
            patch(
                "controllers.console.datasets.datasets_segments.DatasetService.get_dataset",
                return_value=dataset,
            ),
            patch(
                "controllers.console.datasets.datasets_segments.DatasetService.check_dataset_model_setting",
                return_value=None,
            ),
            patch(
                "controllers.console.datasets.datasets_segments.DocumentService.get_document",
                return_value=document,
            ),
            patch(
                "controllers.console.datasets.datasets_segments.DatasetService.check_dataset_permission",
                return_value=None,
            ),
            patch(
                "controllers.console.datasets.datasets_segments.SegmentService.get_segment_by_ref",
                return_value=None,
            ),
        ):
            with pytest.raises(NotFound):
                method(api, "tenant-1", user, "ds-1", "doc-1", "seg-1")

    def test_patch_llm_bad_request(self, app: Flask):
        api = DatasetDocumentSegmentUpdateApi()
        method = inspect.unwrap(api.patch)

        payload = {"content": "x"}

        user = MagicMock(is_dataset_editor=True)

        dataset = MagicMock(
            indexing_technique="high_quality",
            embedding_model_provider="openai",
            embedding_model="text-embed",
        )

        document = MagicMock()

        with (
            app.test_request_context("/", json=payload),
            patch.object(type(console_ns), "payload", payload),
            patch(
                "controllers.console.datasets.datasets_segments.DatasetService.get_dataset",
                return_value=dataset,
            ),
            patch(
                "controllers.console.datasets.datasets_segments.DocumentService.get_document",
                return_value=document,
            ),
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
                method(api, "tenant-1", user, "ds-1", "doc-1", "seg-1")


class TestDatasetDocumentSegmentBatchImportApi:
    def test_post_success(self, app: Flask):
        api = DatasetDocumentSegmentBatchImportApi()
        method = inspect.unwrap(api.post)

        payload = {"upload_file_id": "file-1"}

        upload_file = MagicMock(spec=UploadFile)
        upload_file.name = "test.csv"
        user = MagicMock(id="u1")

        with (
            app.test_request_context("/", json=payload),
            patch.object(type(console_ns), "payload", payload),
            patch(
                "controllers.console.datasets.datasets_segments.DatasetService.get_dataset",
                return_value=MagicMock(),
            ),
            patch(
                "controllers.console.datasets.datasets_segments.DocumentService.get_document",
                return_value=MagicMock(),
            ),
            patch(
                "controllers.console.datasets.datasets_segments.db.session.scalar",
                return_value=upload_file,
            ),
            patch(
                "controllers.console.datasets.datasets_segments.redis_client.setnx",
                return_value=True,
            ),
            patch(
                "controllers.console.datasets.datasets_segments.batch_create_segment_to_index_task.delay",
                return_value=None,
            ),
        ):
            response, status = method(api, "tenant-1", user, "ds-1", "doc-1")

        assert status == 200
        assert response["job_status"] == "waiting"

    def test_post_dataset_not_found(self, app: Flask):
        api = DatasetDocumentSegmentBatchImportApi()
        method = inspect.unwrap(api.post)

        payload = {"upload_file_id": "file-1"}
        user = MagicMock(id="u1")

        with (
            app.test_request_context("/", json=payload),
            patch.object(type(console_ns), "payload", payload),
            patch(
                "controllers.console.datasets.datasets_segments.DatasetService.get_dataset",
                return_value=None,
            ),
        ):
            with pytest.raises(NotFound):
                method(api, "tenant-1", user, "ds-1", "doc-1")

    def test_post_document_not_found(self, app: Flask):
        api = DatasetDocumentSegmentBatchImportApi()
        method = inspect.unwrap(api.post)

        payload = {"upload_file_id": "file-1"}
        user = MagicMock(id="u1")

        with (
            app.test_request_context("/", json=payload),
            patch.object(type(console_ns), "payload", payload),
            patch(
                "controllers.console.datasets.datasets_segments.DatasetService.get_dataset",
                return_value=MagicMock(),
            ),
            patch(
                "controllers.console.datasets.datasets_segments.DocumentService.get_document",
                return_value=None,
            ),
        ):
            with pytest.raises(NotFound):
                method(api, "tenant-1", user, "ds-1", "doc-1")

    def test_post_upload_file_not_found(self, app: Flask):
        api = DatasetDocumentSegmentBatchImportApi()
        method = inspect.unwrap(api.post)

        payload = {"upload_file_id": "file-1"}
        user = MagicMock(id="u1")

        with (
            app.test_request_context("/", json=payload),
            patch.object(type(console_ns), "payload", payload),
            patch(
                "controllers.console.datasets.datasets_segments.DatasetService.get_dataset",
                return_value=MagicMock(),
            ),
            patch(
                "controllers.console.datasets.datasets_segments.DocumentService.get_document",
                return_value=MagicMock(),
            ),
            patch(
                "controllers.console.datasets.datasets_segments.db.session.scalar",
                return_value=None,
            ),
        ):
            with pytest.raises(NotFound):
                method(api, "tenant-1", user, "ds-1", "doc-1")

    def test_post_invalid_file_type(self, app: Flask):
        api = DatasetDocumentSegmentBatchImportApi()
        method = inspect.unwrap(api.post)

        payload = {"upload_file_id": "file-1"}

        upload_file = MagicMock()
        upload_file.name = "test.txt"
        user = MagicMock(id="u1")

        with (
            app.test_request_context("/", json=payload),
            patch.object(type(console_ns), "payload", payload),
            patch(
                "controllers.console.datasets.datasets_segments.DatasetService.get_dataset",
                return_value=MagicMock(),
            ),
            patch(
                "controllers.console.datasets.datasets_segments.DocumentService.get_document",
                return_value=MagicMock(),
            ),
            patch(
                "controllers.console.datasets.datasets_segments.db.session.scalar",
                return_value=upload_file,
            ),
        ):
            with pytest.raises(ValueError):
                method(api, "tenant-1", user, "ds-1", "doc-1")

    def test_post_async_task_failure(self, app: Flask):
        api = DatasetDocumentSegmentBatchImportApi()
        method = inspect.unwrap(api.post)

        payload = {"upload_file_id": "file-1"}

        upload_file = MagicMock()
        upload_file.name = "test.csv"
        user = MagicMock(id="u1")

        with (
            app.test_request_context("/", json=payload),
            patch.object(type(console_ns), "payload", payload),
            patch(
                "controllers.console.datasets.datasets_segments.DatasetService.get_dataset",
                return_value=MagicMock(),
            ),
            patch(
                "controllers.console.datasets.datasets_segments.DocumentService.get_document",
                return_value=MagicMock(),
            ),
            patch(
                "controllers.console.datasets.datasets_segments.db.session.scalar",
                return_value=upload_file,
            ),
            patch(
                "controllers.console.datasets.datasets_segments.redis_client.setnx",
                side_effect=Exception("redis down"),
            ),
        ):
            response, status = method(api, "tenant-1", user, "ds-1", "doc-1")

        assert status == 500
        assert "error" in response

    def test_get_job_not_found_in_redis(self, app: Flask):
        api = DatasetDocumentSegmentBatchImportApi()
        method = inspect.unwrap(api.get)

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.datasets.datasets_segments.redis_client.get",
                return_value=None,
            ),
        ):
            with pytest.raises(ValueError):
                method(api, job_id="job-1")


class TestChildChunkAddApi:
    def test_patch_documents_batch_update_payload(self):
        api_doc = getattr(ChildChunkAddApi.patch, "__apidoc__")  # noqa: B009
        expected_model = ChildChunkBatchUpdatePayload.__name__

        assert [model.name for model in api_doc["expect"]] == [expected_model]

    def test_get_uses_default_pagination_for_malformed_ints(self, app: Flask):
        api = ChildChunkAddApi()
        method = inspect.unwrap(api.get)

        dataset = MagicMock()
        document = _bind_dataset_document(dataset, MagicMock())
        pagination = MagicMock(items=[], total=0, pages=0)

        with (
            app.test_request_context("/?page=bad&limit="),
            patch(
                "controllers.console.datasets.datasets_segments.DatasetService.get_dataset",
                return_value=dataset,
            ),
            patch(
                "controllers.console.datasets.datasets_segments.DatasetService.check_dataset_model_setting",
                return_value=None,
            ),
            patch(
                "controllers.console.datasets.datasets_segments.DocumentService.get_document",
                return_value=document,
            ),
            patch(
                "controllers.console.datasets.datasets_segments.SegmentService.get_segment_by_ref",
                return_value=MagicMock(),
            ),
            patch(
                "controllers.console.datasets.datasets_segments.SegmentService.get_child_chunks",
                return_value=pagination,
            ) as get_child_chunks,
        ):
            response, status = method(api, "tenant-1", "ds-1", "doc-1", "seg-1")

        assert status == 200
        assert response["page"] == 1
        assert response["limit"] == 20
        get_child_chunks.assert_called_once_with("seg-1", "doc-1", "ds-1", 1, 20, None)

    def test_post_success(self, app: Flask):
        api = ChildChunkAddApi()
        method = inspect.unwrap(api.post)

        payload = {"content": "child"}

        user = MagicMock()
        user.is_dataset_editor = True

        dataset = MagicMock()
        dataset.indexing_technique = "economy"

        document = MagicMock()
        _bind_dataset_document(dataset, document)
        segment = MagicMock()
        child_chunk = _child_chunk()

        with (
            app.test_request_context("/", json=payload),
            patch.object(type(console_ns), "payload", payload),
            patch(
                "controllers.console.datasets.datasets_segments.DatasetService.get_dataset",
                return_value=dataset,
            ),
            patch(
                "controllers.console.datasets.datasets_segments.DocumentService.get_document",
                return_value=document,
            ),
            patch(
                "controllers.console.datasets.datasets_segments.SegmentService.get_segment_by_ref",
                return_value=segment,
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
            response, status = method(api, "tenant-1", user, "ds-1", "doc-1", "seg-1")

        assert status == 200
        assert response["data"]["id"] == "cc-1"

    def test_post_child_chunk_indexing_error(self, app: Flask):
        api = ChildChunkAddApi()
        method = inspect.unwrap(api.post)

        payload = {"content": "child"}

        user = MagicMock(is_dataset_editor=True)

        dataset = MagicMock(indexing_technique="economy")
        document = MagicMock()
        _bind_dataset_document(dataset, document)
        segment = MagicMock()

        with (
            app.test_request_context("/", json=payload),
            patch.object(type(console_ns), "payload", payload),
            patch(
                "controllers.console.datasets.datasets_segments.DatasetService.get_dataset",
                return_value=dataset,
            ),
            patch(
                "controllers.console.datasets.datasets_segments.DocumentService.get_document",
                return_value=document,
            ),
            patch(
                "controllers.console.datasets.datasets_segments.SegmentService.get_segment_by_ref",
                return_value=segment,
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
                method(api, "tenant-1", user, "ds-1", "doc-1", "seg-1")

    def test_post_permission_denied(self, app: Flask):
        api = ChildChunkAddApi()
        method = inspect.unwrap(api.post)

        payload = {"content": "child"}
        user = MagicMock(is_dataset_editor=True)
        dataset = MagicMock(indexing_technique="economy")
        document = MagicMock()
        _bind_dataset_document(dataset, document)

        with (
            app.test_request_context("/", json=payload),
            patch.object(type(console_ns), "payload", payload),
            patch(
                "controllers.console.datasets.datasets_segments.DatasetService.get_dataset",
                return_value=dataset,
            ),
            patch(
                "controllers.console.datasets.datasets_segments.DocumentService.get_document",
                return_value=document,
            ),
            patch(
                "controllers.console.datasets.datasets_segments.DatasetService.check_dataset_permission",
                side_effect=services.errors.account.NoPermissionError("no access"),
            ),
        ):
            with pytest.raises(Forbidden):
                method(api, "tenant-1", user, "ds-1", "doc-1", "seg-1")


class TestChildChunkUpdateApi:
    def test_delete_success(self, app: Flask):
        api = ChildChunkUpdateApi()
        method = inspect.unwrap(api.delete)

        user = MagicMock()
        user.is_dataset_editor = True

        dataset = MagicMock()
        document = MagicMock()
        _bind_dataset_document(dataset, document)
        segment = MagicMock()
        child_chunk = MagicMock()

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.datasets.datasets_segments.DatasetService.get_dataset",
                return_value=dataset,
            ),
            patch(
                "controllers.console.datasets.datasets_segments.DocumentService.get_document",
                return_value=document,
            ),
            patch(
                "controllers.console.datasets.datasets_segments.SegmentService.get_segment_by_ref",
                return_value=segment,
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
                return_value=None,
            ),
        ):
            response, status = method(api, "tenant-1", user, "ds-1", "doc-1", "seg-1", "cc-1")

        assert status == 204
        assert response == ""

    def test_delete_child_chunk_index_error(self, app: Flask):
        api = ChildChunkUpdateApi()
        method = inspect.unwrap(api.delete)

        user = MagicMock(is_dataset_editor=True)

        dataset = MagicMock()
        document = MagicMock()
        _bind_dataset_document(dataset, document)
        segment = MagicMock()
        child_chunk = MagicMock()

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.datasets.datasets_segments.DatasetService.get_dataset",
                return_value=dataset,
            ),
            patch(
                "controllers.console.datasets.datasets_segments.DocumentService.get_document",
                return_value=document,
            ),
            patch(
                "controllers.console.datasets.datasets_segments.SegmentService.get_segment_by_ref",
                return_value=segment,
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
                method(api, "tenant-1", user, "ds-1", "doc-1", "seg-1", "cc-1")

    def test_delete_child_chunk_not_found(self, app: Flask):
        api = ChildChunkUpdateApi()
        method = inspect.unwrap(api.delete)

        user = MagicMock(is_dataset_editor=True)
        dataset = MagicMock()
        document = MagicMock()
        _bind_dataset_document(dataset, document)
        segment = MagicMock()

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.datasets.datasets_segments.DatasetService.get_dataset",
                return_value=dataset,
            ),
            patch(
                "controllers.console.datasets.datasets_segments.DocumentService.get_document",
                return_value=document,
            ),
            patch(
                "controllers.console.datasets.datasets_segments.SegmentService.get_segment_by_ref",
                return_value=segment,
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
                method(api, "tenant-1", user, "ds-1", "doc-1", "seg-1", "cc-1")

    def test_patch_child_chunk_not_found(self, app: Flask):
        api = ChildChunkUpdateApi()
        method = inspect.unwrap(api.patch)

        payload = {"content": "updated child"}
        user = MagicMock(is_dataset_editor=True)
        dataset = MagicMock()
        document = MagicMock()
        _bind_dataset_document(dataset, document)
        segment = MagicMock()

        with (
            app.test_request_context("/", json=payload),
            patch.object(type(console_ns), "payload", payload),
            patch(
                "controllers.console.datasets.datasets_segments.DatasetService.get_dataset",
                return_value=dataset,
            ),
            patch(
                "controllers.console.datasets.datasets_segments.DocumentService.get_document",
                return_value=document,
            ),
            patch(
                "controllers.console.datasets.datasets_segments.SegmentService.get_segment_by_ref",
                return_value=segment,
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
                method(api, "tenant-1", user, "ds-1", "doc-1", "seg-1", "cc-1")


class TestSegmentListAdvancedCases:
    def test_segment_list_with_keyword_filter(self, app: Flask):
        api = DatasetDocumentSegmentListApi()
        method = inspect.unwrap(api.get)

        dataset = MagicMock()
        document = MagicMock()
        user = MagicMock()

        segment = _segment()

        pagination = MagicMock(items=[segment], total=1, pages=1)

        with (
            app.test_request_context("/?keyword=test"),
            patch(
                "controllers.console.datasets.datasets_segments.DatasetService.get_dataset",
                return_value=dataset,
            ),
            patch(
                "controllers.console.datasets.datasets_segments.DatasetService.check_dataset_permission",
                return_value=None,
            ),
            patch(
                "controllers.console.datasets.datasets_segments.DocumentService.get_document",
                return_value=document,
            ),
            patch(
                "controllers.console.datasets.datasets_segments.paginate_query",
                return_value=pagination,
            ),
            patch(
                "services.summary_index_service.SummaryIndexService.get_segments_summaries",
                return_value={},
            ),
            patch("models.dataset.db.session.scalar", return_value=None),
            patch("models.dataset.db.session.execute", return_value=MagicMock(all=MagicMock(return_value=[]))),
        ):
            result = method(api, "tenant-1", user, "ds-1", "doc-1")

        if isinstance(result, tuple):
            response, status = result
        else:
            response, status = result, 200

        assert status == 200
        assert response["total"] == 1

    def test_segment_list_postgres_keyword_filter_handles_scalar_keywords(self, app: Flask):
        api = DatasetDocumentSegmentListApi()
        method = inspect.unwrap(api.get)

        dataset = MagicMock()
        document = MagicMock()
        user = MagicMock()
        pagination = MagicMock(items=[], total=0, pages=0)

        with (
            app.test_request_context("/?keyword=test"),
            patch(
                "controllers.console.datasets.datasets_segments.DatasetService.get_dataset",
                return_value=dataset,
            ),
            patch(
                "controllers.console.datasets.datasets_segments.DatasetService.check_dataset_permission",
                return_value=None,
            ),
            patch(
                "controllers.console.datasets.datasets_segments.DocumentService.get_document",
                return_value=document,
            ),
            patch(
                "controllers.console.datasets.datasets_segments.dify_config",
                SimpleNamespace(SQLALCHEMY_DATABASE_URI_SCHEME="postgresql"),
            ),
            patch(
                "controllers.console.datasets.datasets_segments.paginate_query",
                return_value=pagination,
            ) as paginate_mock,
        ):
            method(
                api,
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
        method = inspect.unwrap(api.get)
        user = MagicMock()

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.datasets.datasets_segments.DatasetService.get_dataset",
                return_value=MagicMock(),
            ),
            patch(
                "controllers.console.datasets.datasets_segments.DatasetService.check_dataset_permission",
                side_effect=services.errors.account.NoPermissionError("No permission"),
            ),
        ):
            with pytest.raises(Forbidden):
                method(api, "tenant-1", user, "ds-1", "doc-1")

    def test_segment_list_dataset_not_found(self, app: Flask):
        """Test segment list with dataset not found"""
        api = DatasetDocumentSegmentListApi()
        method = inspect.unwrap(api.get)
        user = MagicMock()

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.datasets.datasets_segments.DatasetService.get_dataset",
                return_value=None,
            ),
        ):
            with pytest.raises(NotFound):
                method(api, "tenant-1", user, "ds-1", "doc-1")


class TestSegmentOperationCases:
    def test_segment_add_with_provider_token_error(self, app: Flask):
        """Test segment add with provider token not initialized"""
        api = DatasetDocumentSegmentAddApi()
        method = inspect.unwrap(api.post)

        user = MagicMock(is_dataset_editor=True)
        dataset = MagicMock()
        document = MagicMock()

        payload = {"content": "new content", "answer": None}

        with (
            app.test_request_context("/", json=payload),
            patch.object(type(console_ns), "payload", payload),
            patch(
                "controllers.console.datasets.datasets_segments.DatasetService.get_dataset",
                return_value=dataset,
            ),
            patch(
                "controllers.console.datasets.datasets_segments.DocumentService.get_document",
                return_value=document,
            ),
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
                method(api, "tenant-1", user, "ds-1", "doc-1")

    def test_batch_import_with_document_not_found(self, app: Flask):
        """Test batch import with document not found"""
        api = DatasetDocumentSegmentBatchImportApi()
        method = inspect.unwrap(api.post)

        user = MagicMock(is_dataset_editor=True)
        dataset = MagicMock()

        payload = {"upload_file_id": "file-1"}

        with (
            app.test_request_context("/", json=payload),
            patch.object(type(console_ns), "payload", payload),
            patch(
                "controllers.console.datasets.datasets_segments.DatasetService.get_dataset",
                return_value=dataset,
            ),
            patch(
                "controllers.console.datasets.datasets_segments.DocumentService.get_document",
                return_value=None,
            ),
        ):
            with pytest.raises(NotFound):
                method(api, "tenant-1", user, "ds-1", "doc-1")

    def test_batch_import_with_invalid_file(self, app: Flask):
        """Test batch import with invalid file type"""
        api = DatasetDocumentSegmentBatchImportApi()
        method = inspect.unwrap(api.post)

        user = MagicMock(is_dataset_editor=True)
        dataset = MagicMock()
        document = MagicMock()
        upload_file = None  # File not found

        payload = {"upload_file_id": "file-1"}

        with (
            app.test_request_context("/", json=payload),
            patch.object(type(console_ns), "payload", payload),
            patch(
                "controllers.console.datasets.datasets_segments.DatasetService.get_dataset",
                return_value=dataset,
            ),
            patch(
                "controllers.console.datasets.datasets_segments.DocumentService.get_document",
                return_value=document,
            ),
            patch(
                "controllers.console.datasets.datasets_segments.db.session.scalar",
                return_value=upload_file,
            ),
        ):
            with pytest.raises(NotFound):
                method(api, "tenant-1", user, "ds-1", "doc-1")

    def test_batch_import_with_async_task_failure(self, app: Flask):
        api = DatasetDocumentSegmentBatchImportApi()
        method = inspect.unwrap(api.post)

        user = MagicMock(is_dataset_editor=True)
        dataset = MagicMock()
        document = MagicMock()
        upload_file = MagicMock(spec=UploadFile, extension="csv", id="file-1")
        upload_file.name = "test.csv"

        payload = {"upload_file_id": "file-1"}

        with (
            app.test_request_context("/", json=payload),
            patch.object(type(console_ns), "payload", payload),
            patch(
                "controllers.console.datasets.datasets_segments.DatasetService.get_dataset",
                return_value=dataset,
            ),
            patch(
                "controllers.console.datasets.datasets_segments.DocumentService.get_document",
                return_value=document,
            ),
            patch(
                "controllers.console.datasets.datasets_segments.db.session.scalar",
                return_value=upload_file,
            ),
            patch(
                "controllers.console.datasets.datasets_segments.DatasetService.check_dataset_permission",
                return_value=None,
            ),
            patch(
                "controllers.console.datasets.datasets_segments.batch_create_segment_to_index_task.delay",
                side_effect=Exception("Task failed"),
            ),
        ):
            response, status = method(api, "tenant-1", user, "ds-1", "doc-1")

        assert status == 500
        assert "error" in response

    def test_batch_import_get_job_not_found(self, app: Flask):
        api = DatasetDocumentSegmentBatchImportApi()
        method = inspect.unwrap(api.get)

        with (
            app.test_request_context("/?job_id=invalid-job"),
            patch(
                "controllers.console.datasets.datasets_segments.redis_client.get",
                return_value=None,
            ),
        ):
            with pytest.raises(ValueError):
                method(api, "invalid-job")
