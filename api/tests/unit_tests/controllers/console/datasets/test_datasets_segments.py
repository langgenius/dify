from unittest.mock import MagicMock, patch

import pytest
from werkzeug.exceptions import Forbidden, NotFound

import services
from controllers.console import console_ns
from controllers.console.app.error import ProviderNotInitializeError
from controllers.console.datasets.datasets_segments import (
    ChildChunkAddApi,
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
from models.dataset import ChildChunk, DocumentSegment
from models.model import UploadFile


def unwrap(func):
    while hasattr(func, "__wrapped__"):
        func = func.__wrapped__
    return func


class TestDatasetDocumentSegmentListApi:
    def test_get_success(self, app):
        api = DatasetDocumentSegmentListApi()
        method = unwrap(api.get)

        dataset = MagicMock()
        document = MagicMock()

        segment = MagicMock(spec=DocumentSegment)
        segment.id = "seg-1"

        pagination = MagicMock()
        pagination.items = [segment]
        pagination.total = 1
        pagination.pages = 1

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.datasets.datasets_segments.current_account_with_tenant",
                return_value=(MagicMock(), "tenant-1"),
            ),
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
                "controllers.console.datasets.datasets_segments.db.paginate",
                return_value=pagination,
            ),
            patch(
                "services.summary_index_service.SummaryIndexService.get_segments_summaries",
                return_value={},
            ),
            patch(
                "controllers.console.datasets.datasets_segments.marshal",
                return_value={"id": "seg-1"},
            ),
        ):
            response, status = method(api, "ds-1", "doc-1")

        assert status == 200

    def test_get_dataset_not_found(self, app):
        api = DatasetDocumentSegmentListApi()
        method = unwrap(api.get)

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.datasets.datasets_segments.current_account_with_tenant",
                return_value=(MagicMock(), "tenant-1"),
            ),
            patch(
                "controllers.console.datasets.datasets_segments.DatasetService.get_dataset",
                return_value=None,
            ),
        ):
            with pytest.raises(NotFound):
                method(api, "ds-1", "doc-1")

    def test_get_permission_denied(self, app):
        api = DatasetDocumentSegmentListApi()
        method = unwrap(api.get)

        dataset = MagicMock()

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.datasets.datasets_segments.current_account_with_tenant",
                return_value=(MagicMock(), "tenant-1"),
            ),
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
                method(api, "ds-1", "doc-1")


class TestDatasetDocumentSegmentApi:
    def test_patch_success(self, app):
        api = DatasetDocumentSegmentApi()
        method = unwrap(api.patch)

        user = MagicMock()
        user.is_dataset_editor = True

        dataset = MagicMock()
        dataset.indexing_technique = "economy"

        document = MagicMock()
        document.id = "doc-1"

        with (
            app.test_request_context("/?segment_id=s1&segment_id=s2"),
            patch(
                "controllers.console.datasets.datasets_segments.current_account_with_tenant",
                return_value=(user, "tenant-1"),
            ),
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
            response, status = method(api, "ds-1", "doc-1", "enable")

        assert status == 200
        assert response["result"] == "success"

    def test_patch_document_indexing_in_progress(self, app):
        api = DatasetDocumentSegmentApi()
        method = unwrap(api.patch)

        user = MagicMock()
        user.is_dataset_editor = True

        dataset = MagicMock()
        dataset.indexing_technique = "economy"

        document = MagicMock()
        document.id = "doc-1"

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.datasets.datasets_segments.current_account_with_tenant",
                return_value=(user, "tenant-1"),
            ),
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
                return_value=b"running",
            ),
        ):
            with pytest.raises(InvalidActionError):
                method(api, "ds-1", "doc-1", "disable")

    def test_patch_llm_bad_request(self, app):
        api = DatasetDocumentSegmentApi()
        method = unwrap(api.patch)

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
                "controllers.console.datasets.datasets_segments.current_account_with_tenant",
                return_value=(user, "tenant-1"),
            ),
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
                "controllers.console.datasets.datasets_segments.ModelManager.get_model_instance",
                side_effect=LLMBadRequestError(),
            ),
        ):
            with pytest.raises(ValueError):
                method(api, "ds-1", "doc-1", "enable")

    def test_patch_provider_token_not_init(self, app):
        api = DatasetDocumentSegmentApi()
        method = unwrap(api.patch)

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
                "controllers.console.datasets.datasets_segments.current_account_with_tenant",
                return_value=(user, "tenant-1"),
            ),
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
                "controllers.console.datasets.datasets_segments.ModelManager.get_model_instance",
                side_effect=ProviderTokenNotInitError("token missing"),
            ),
        ):
            with pytest.raises(ValueError):
                method(api, "ds-1", "doc-1", "enable")


class TestDatasetDocumentSegmentAddApi:
    def test_post_success(self, app):
        api = DatasetDocumentSegmentAddApi()
        method = unwrap(api.post)

        payload = {"content": "hello"}

        user = MagicMock()
        user.is_dataset_editor = True

        dataset = MagicMock()
        dataset.indexing_technique = "economy"

        document = MagicMock()
        document.doc_form = "text"

        segment = MagicMock()
        segment.id = "seg-1"

        with (
            app.test_request_context("/", json=payload),
            patch.object(type(console_ns), "payload", payload),
            patch(
                "controllers.console.datasets.datasets_segments.current_account_with_tenant",
                return_value=(user, "tenant-1"),
            ),
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
                "controllers.console.datasets.datasets_segments.marshal",
                return_value={"id": "seg-1"},
            ),
            patch(
                "controllers.console.datasets.datasets_segments._get_segment_with_summary",
                return_value={"id": "seg-1"},
            ),
        ):
            response, status = method(api, "ds-1", "doc-1")

        assert status == 200
        assert response["data"]["id"] == "seg-1"

    def test_post_llm_bad_request(self, app):
        api = DatasetDocumentSegmentAddApi()
        method = unwrap(api.post)

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
                "controllers.console.datasets.datasets_segments.current_account_with_tenant",
                return_value=(user, "tenant-1"),
            ),
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
                method(api, "ds-1", "doc-1")

    def test_post_provider_token_not_init(self, app):
        api = DatasetDocumentSegmentAddApi()
        method = unwrap(api.post)

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
                "controllers.console.datasets.datasets_segments.current_account_with_tenant",
                return_value=(user, "tenant-1"),
            ),
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
                method(api, "ds-1", "doc-1")


class TestDatasetDocumentSegmentUpdateApi:
    def test_patch_success(self, app):
        api = DatasetDocumentSegmentUpdateApi()
        method = unwrap(api.patch)

        payload = {"content": "updated"}

        user = MagicMock()
        user.is_dataset_editor = True

        dataset = MagicMock()
        dataset.indexing_technique = "economy"

        document = MagicMock()
        document.doc_form = "text"

        segment = MagicMock()

        with (
            app.test_request_context("/", json=payload),
            patch.object(type(console_ns), "payload", payload),
            patch(
                "controllers.console.datasets.datasets_segments.current_account_with_tenant",
                return_value=(user, "tenant-1"),
            ),
            patch(
                "controllers.console.datasets.datasets_segments.DatasetService.get_dataset",
                return_value=dataset,
            ),
            patch(
                "controllers.console.datasets.datasets_segments.DocumentService.get_document",
                return_value=document,
            ),
            patch(
                "controllers.console.datasets.datasets_segments.db.session.query",
                return_value=MagicMock(where=lambda *a, **k: MagicMock(first=lambda: segment)),
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
                "controllers.console.datasets.datasets_segments._get_segment_with_summary",
                return_value={"id": "seg-1"},
            ),
        ):
            response, status = method(api, "ds-1", "doc-1", "seg-1")

        assert status == 200
        assert "data" in response

    def test_patch_llm_bad_request(self, app):
        api = DatasetDocumentSegmentUpdateApi()
        method = unwrap(api.patch)

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
                "controllers.console.datasets.datasets_segments.current_account_with_tenant",
                return_value=(user, "tenant-1"),
            ),
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
            with pytest.raises(ValueError):
                method(api, "ds-1", "doc-1", "seg-1")


class TestDatasetDocumentSegmentBatchImportApi:
    def test_post_success(self, app):
        api = DatasetDocumentSegmentBatchImportApi()
        method = unwrap(api.post)

        payload = {"upload_file_id": "file-1"}

        upload_file = MagicMock(spec=UploadFile)
        upload_file.name = "test.csv"

        with (
            app.test_request_context("/", json=payload),
            patch.object(type(console_ns), "payload", payload),
            patch(
                "controllers.console.datasets.datasets_segments.current_account_with_tenant",
                return_value=(MagicMock(id="u1"), "tenant-1"),
            ),
            patch(
                "controllers.console.datasets.datasets_segments.DatasetService.get_dataset",
                return_value=MagicMock(),
            ),
            patch(
                "controllers.console.datasets.datasets_segments.DocumentService.get_document",
                return_value=MagicMock(),
            ),
            patch(
                "controllers.console.datasets.datasets_segments.db.session.query",
                return_value=MagicMock(where=lambda *a, **k: MagicMock(first=lambda: upload_file)),
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
            response, status = method(api, "ds-1", "doc-1")

        assert status == 200
        assert response["job_status"] == "waiting"

    def test_post_dataset_not_found(self, app):
        api = DatasetDocumentSegmentBatchImportApi()
        method = unwrap(api.post)

        payload = {"upload_file_id": "file-1"}

        with (
            app.test_request_context("/", json=payload),
            patch.object(type(console_ns), "payload", payload),
            patch(
                "controllers.console.datasets.datasets_segments.current_account_with_tenant",
                return_value=(MagicMock(id="u1"), "tenant-1"),
            ),
            patch(
                "controllers.console.datasets.datasets_segments.DatasetService.get_dataset",
                return_value=None,
            ),
        ):
            with pytest.raises(NotFound):
                method(api, "ds-1", "doc-1")

    def test_post_document_not_found(self, app):
        api = DatasetDocumentSegmentBatchImportApi()
        method = unwrap(api.post)

        payload = {"upload_file_id": "file-1"}

        with (
            app.test_request_context("/", json=payload),
            patch.object(type(console_ns), "payload", payload),
            patch(
                "controllers.console.datasets.datasets_segments.current_account_with_tenant",
                return_value=(MagicMock(id="u1"), "tenant-1"),
            ),
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
                method(api, "ds-1", "doc-1")

    def test_post_upload_file_not_found(self, app):
        api = DatasetDocumentSegmentBatchImportApi()
        method = unwrap(api.post)

        payload = {"upload_file_id": "file-1"}

        with (
            app.test_request_context("/", json=payload),
            patch.object(type(console_ns), "payload", payload),
            patch(
                "controllers.console.datasets.datasets_segments.current_account_with_tenant",
                return_value=(MagicMock(id="u1"), "tenant-1"),
            ),
            patch(
                "controllers.console.datasets.datasets_segments.DatasetService.get_dataset",
                return_value=MagicMock(),
            ),
            patch(
                "controllers.console.datasets.datasets_segments.DocumentService.get_document",
                return_value=MagicMock(),
            ),
            patch(
                "controllers.console.datasets.datasets_segments.db.session.query",
                return_value=MagicMock(where=lambda *a, **k: MagicMock(first=lambda: None)),
            ),
        ):
            with pytest.raises(NotFound):
                method(api, "ds-1", "doc-1")

    def test_post_invalid_file_type(self, app):
        api = DatasetDocumentSegmentBatchImportApi()
        method = unwrap(api.post)

        payload = {"upload_file_id": "file-1"}

        upload_file = MagicMock()
        upload_file.name = "test.txt"

        with (
            app.test_request_context("/", json=payload),
            patch.object(type(console_ns), "payload", payload),
            patch(
                "controllers.console.datasets.datasets_segments.current_account_with_tenant",
                return_value=(MagicMock(id="u1"), "tenant-1"),
            ),
            patch(
                "controllers.console.datasets.datasets_segments.DatasetService.get_dataset",
                return_value=MagicMock(),
            ),
            patch(
                "controllers.console.datasets.datasets_segments.DocumentService.get_document",
                return_value=MagicMock(),
            ),
            patch(
                "controllers.console.datasets.datasets_segments.db.session.query",
                return_value=MagicMock(where=lambda *a, **k: MagicMock(first=lambda: upload_file)),
            ),
        ):
            with pytest.raises(ValueError):
                method(api, "ds-1", "doc-1")

    def test_post_async_task_failure(self, app):
        api = DatasetDocumentSegmentBatchImportApi()
        method = unwrap(api.post)

        payload = {"upload_file_id": "file-1"}

        upload_file = MagicMock()
        upload_file.name = "test.csv"

        with (
            app.test_request_context("/", json=payload),
            patch.object(type(console_ns), "payload", payload),
            patch(
                "controllers.console.datasets.datasets_segments.current_account_with_tenant",
                return_value=(MagicMock(id="u1"), "tenant-1"),
            ),
            patch(
                "controllers.console.datasets.datasets_segments.DatasetService.get_dataset",
                return_value=MagicMock(),
            ),
            patch(
                "controllers.console.datasets.datasets_segments.DocumentService.get_document",
                return_value=MagicMock(),
            ),
            patch(
                "controllers.console.datasets.datasets_segments.db.session.query",
                return_value=MagicMock(where=lambda *a, **k: MagicMock(first=lambda: upload_file)),
            ),
            patch(
                "controllers.console.datasets.datasets_segments.redis_client.setnx",
                side_effect=Exception("redis down"),
            ),
        ):
            response, status = method(api, "ds-1", "doc-1")

        assert status == 500
        assert "error" in response

    def test_get_job_not_found_in_redis(self, app):
        api = DatasetDocumentSegmentBatchImportApi()
        method = unwrap(api.get)

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
    def test_post_success(self, app):
        api = ChildChunkAddApi()
        method = unwrap(api.post)

        payload = {"content": "child"}

        user = MagicMock()
        user.is_dataset_editor = True

        dataset = MagicMock()
        dataset.indexing_technique = "economy"

        document = MagicMock()
        segment = MagicMock()
        child_chunk = MagicMock(spec=ChildChunk)

        with (
            app.test_request_context("/", json=payload),
            patch.object(type(console_ns), "payload", payload),
            patch(
                "controllers.console.datasets.datasets_segments.current_account_with_tenant",
                return_value=(user, "tenant-1"),
            ),
            patch(
                "controllers.console.datasets.datasets_segments.DatasetService.get_dataset",
                return_value=dataset,
            ),
            patch(
                "controllers.console.datasets.datasets_segments.DocumentService.get_document",
                return_value=document,
            ),
            patch(
                "controllers.console.datasets.datasets_segments.db.session.query",
                return_value=MagicMock(where=lambda *a, **k: MagicMock(first=lambda: segment)),
            ),
            patch(
                "controllers.console.datasets.datasets_segments.DatasetService.check_dataset_permission",
                return_value=None,
            ),
            patch(
                "controllers.console.datasets.datasets_segments.SegmentService.create_child_chunk",
                return_value=child_chunk,
            ),
            patch(
                "controllers.console.datasets.datasets_segments.marshal",
                return_value={"id": "cc-1"},
            ),
        ):
            response, status = method(api, "ds-1", "doc-1", "seg-1")

        assert status == 200
        assert response["data"]["id"] == "cc-1"

    def test_post_child_chunk_indexing_error(self, app):
        api = ChildChunkAddApi()
        method = unwrap(api.post)

        payload = {"content": "child"}

        user = MagicMock(is_dataset_editor=True)

        dataset = MagicMock(indexing_technique="economy")
        document = MagicMock()
        segment = MagicMock()

        with (
            app.test_request_context("/", json=payload),
            patch.object(type(console_ns), "payload", payload),
            patch(
                "controllers.console.datasets.datasets_segments.current_account_with_tenant",
                return_value=(user, "tenant-1"),
            ),
            patch(
                "controllers.console.datasets.datasets_segments.DatasetService.get_dataset",
                return_value=dataset,
            ),
            patch(
                "controllers.console.datasets.datasets_segments.DocumentService.get_document",
                return_value=document,
            ),
            patch(
                "controllers.console.datasets.datasets_segments.db.session.query",
                return_value=MagicMock(where=lambda *a, **k: MagicMock(first=lambda: segment)),
            ),
            patch(
                "controllers.console.datasets.datasets_segments.DatasetService.check_dataset_permission",
                return_value=None,
            ),
            patch(
                "controllers.console.datasets.datasets_segments.SegmentService.create_child_chunk",
                side_effect=services.errors.chunk.ChildChunkIndexingError("fail"),
            ),
        ):
            with pytest.raises(ChildChunkIndexingError):
                method(api, "ds-1", "doc-1", "seg-1")


class TestChildChunkUpdateApi:
    def test_delete_success(self, app):
        api = ChildChunkUpdateApi()
        method = unwrap(api.delete)

        user = MagicMock()
        user.is_dataset_editor = True

        dataset = MagicMock()
        document = MagicMock()
        segment = MagicMock()
        child_chunk = MagicMock()

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.datasets.datasets_segments.current_account_with_tenant",
                return_value=(user, "tenant-1"),
            ),
            patch(
                "controllers.console.datasets.datasets_segments.DatasetService.get_dataset",
                return_value=dataset,
            ),
            patch(
                "controllers.console.datasets.datasets_segments.DocumentService.get_document",
                return_value=document,
            ),
            patch(
                "controllers.console.datasets.datasets_segments.db.session.query",
                side_effect=[
                    MagicMock(where=lambda *a, **k: MagicMock(first=lambda: segment)),
                    MagicMock(where=lambda *a, **k: MagicMock(first=lambda: child_chunk)),
                ],
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
            response, status = method(api, "ds-1", "doc-1", "seg-1", "cc-1")

        assert status == 204
        assert response["result"] == "success"

    def test_delete_child_chunk_index_error(self, app):
        api = ChildChunkUpdateApi()
        method = unwrap(api.delete)

        user = MagicMock(is_dataset_editor=True)

        dataset = MagicMock()
        document = MagicMock()
        segment = MagicMock()
        child_chunk = MagicMock()

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.datasets.datasets_segments.current_account_with_tenant",
                return_value=(user, "tenant-1"),
            ),
            patch(
                "controllers.console.datasets.datasets_segments.DatasetService.get_dataset",
                return_value=dataset,
            ),
            patch(
                "controllers.console.datasets.datasets_segments.DocumentService.get_document",
                return_value=document,
            ),
            patch(
                "controllers.console.datasets.datasets_segments.db.session.query",
                side_effect=[
                    MagicMock(where=lambda *a, **k: MagicMock(first=lambda: segment)),
                    MagicMock(where=lambda *a, **k: MagicMock(first=lambda: child_chunk)),
                ],
            ),
            patch(
                "controllers.console.datasets.datasets_segments.DatasetService.check_dataset_permission",
                return_value=None,
            ),
            patch(
                "controllers.console.datasets.datasets_segments.SegmentService.delete_child_chunk",
                side_effect=services.errors.chunk.ChildChunkDeleteIndexError("fail"),
            ),
        ):
            with pytest.raises(ChildChunkDeleteIndexError):
                method(api, "ds-1", "doc-1", "seg-1", "cc-1")


class TestSegmentListAdvancedCases:
    def test_segment_list_with_keyword_filter(self, app):
        api = DatasetDocumentSegmentListApi()
        method = unwrap(api.get)

        dataset = MagicMock()
        document = MagicMock()

        segment = MagicMock(spec=DocumentSegment)
        segment.id = "seg-1"
        segment.keywords = ["test"]
        segment.enabled = True

        pagination = MagicMock(items=[segment], total=1, pages=1)

        with (
            app.test_request_context("/?keyword=test"),
            patch(
                "controllers.console.datasets.datasets_segments.current_account_with_tenant",
                return_value=(MagicMock(), "tenant-1"),
            ),
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
                "controllers.console.datasets.datasets_segments.db.paginate",
                return_value=pagination,
            ),
            patch(
                "services.summary_index_service.SummaryIndexService.get_segments_summaries",
                return_value={},
            ),
        ):
            result = method(api, "ds-1", "doc-1")

        if isinstance(result, tuple):
            response, status = result
        else:
            response, status = result, 200

        assert status == 200
        assert response["total"] == 1

    def test_segment_list_permission_denied(self, app):
        """Test segment list with permission denied"""
        api = DatasetDocumentSegmentListApi()
        method = unwrap(api.get)

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.datasets.datasets_segments.current_account_with_tenant",
                return_value=(MagicMock(), "tenant-1"),
            ),
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
                method(api, "ds-1", "doc-1")

    def test_segment_list_dataset_not_found(self, app):
        """Test segment list with dataset not found"""
        api = DatasetDocumentSegmentListApi()
        method = unwrap(api.get)

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.datasets.datasets_segments.current_account_with_tenant",
                return_value=(MagicMock(), "tenant-1"),
            ),
            patch(
                "controllers.console.datasets.datasets_segments.DatasetService.get_dataset",
                return_value=None,
            ),
        ):
            with pytest.raises(NotFound):
                method(api, "ds-1", "doc-1")


class TestSegmentOperationCases:
    def test_segment_add_with_provider_token_error(self, app):
        """Test segment add with provider token not initialized"""
        api = DatasetDocumentSegmentAddApi()
        method = unwrap(api.post)

        user = MagicMock(is_dataset_editor=True)
        dataset = MagicMock()
        document = MagicMock()

        payload = {"content": "new content", "answer": None}

        with (
            app.test_request_context("/", json=payload),
            patch.object(type(console_ns), "payload", payload),
            patch(
                "controllers.console.datasets.datasets_segments.current_account_with_tenant",
                return_value=(user, "tenant-1"),
            ),
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
                method(api, "ds-1", "doc-1")

    def test_batch_import_with_document_not_found(self, app):
        """Test batch import with document not found"""
        api = DatasetDocumentSegmentBatchImportApi()
        method = unwrap(api.post)

        user = MagicMock(is_dataset_editor=True)
        dataset = MagicMock()

        payload = {"upload_file_id": "file-1"}

        with (
            app.test_request_context("/", json=payload),
            patch.object(type(console_ns), "payload", payload),
            patch(
                "controllers.console.datasets.datasets_segments.current_account_with_tenant",
                return_value=(user, "tenant-1"),
            ),
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
                method(api, "ds-1", "doc-1")

    def test_batch_import_with_invalid_file(self, app):
        """Test batch import with invalid file type"""
        api = DatasetDocumentSegmentBatchImportApi()
        method = unwrap(api.post)

        user = MagicMock(is_dataset_editor=True)
        dataset = MagicMock()
        document = MagicMock()
        upload_file = None  # File not found

        payload = {"upload_file_id": "file-1"}

        with (
            app.test_request_context("/", json=payload),
            patch.object(type(console_ns), "payload", payload),
            patch(
                "controllers.console.datasets.datasets_segments.current_account_with_tenant",
                return_value=(user, "tenant-1"),
            ),
            patch(
                "controllers.console.datasets.datasets_segments.DatasetService.get_dataset",
                return_value=dataset,
            ),
            patch(
                "controllers.console.datasets.datasets_segments.DocumentService.get_document",
                return_value=document,
            ),
            patch(
                "controllers.console.datasets.datasets_segments.db.session.query",
                return_value=MagicMock(where=lambda *a, **k: MagicMock(first=lambda: upload_file)),
            ),
        ):
            with pytest.raises(NotFound):
                method(api, "ds-1", "doc-1")

    def test_batch_import_with_async_task_failure(self, app):
        api = DatasetDocumentSegmentBatchImportApi()
        method = unwrap(api.post)

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
                "controllers.console.datasets.datasets_segments.current_account_with_tenant",
                return_value=(user, "tenant-1"),
            ),
            patch(
                "controllers.console.datasets.datasets_segments.DatasetService.get_dataset",
                return_value=dataset,
            ),
            patch(
                "controllers.console.datasets.datasets_segments.DocumentService.get_document",
                return_value=document,
            ),
            patch(
                "controllers.console.datasets.datasets_segments.db.session.query",
                return_value=MagicMock(where=lambda *a, **k: MagicMock(first=lambda: upload_file)),
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
            response, status = method(api, "ds-1", "doc-1")

        assert status == 500
        assert "error" in response

    def test_batch_import_get_job_not_found(self, app):
        api = DatasetDocumentSegmentBatchImportApi()
        method = unwrap(api.get)

        user = MagicMock(is_dataset_editor=True)

        with (
            app.test_request_context("/?job_id=invalid-job"),
            patch(
                "controllers.console.datasets.datasets_segments.current_account_with_tenant",
                return_value=(user, "tenant-1"),
            ),
            patch(
                "controllers.console.datasets.datasets_segments.redis_client.get",
                return_value=None,
            ),
        ):
            with pytest.raises(ValueError):
                method(api, "invalid-job")
