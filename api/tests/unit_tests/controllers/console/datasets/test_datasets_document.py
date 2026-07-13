import datetime
import inspect
from unittest.mock import ANY, MagicMock, patch

import pytest
from flask import Flask
from werkzeug.exceptions import Forbidden, NotFound

import services
from controllers.console import console_ns
from controllers.console.datasets.datasets_document import (
    DatasetDocumentListApi,
    DatasetInitApi,
    DocumentApi,
    DocumentBatchDownloadZipApi,
    DocumentBatchIndexingEstimateApi,
    DocumentBatchIndexingStatusApi,
    DocumentDownloadApi,
    DocumentGenerateSummaryApi,
    DocumentIndexingEstimateApi,
    DocumentIndexingStatusApi,
    DocumentMetadataApi,
    DocumentPipelineExecutionLogApi,
    DocumentProcessingApi,
    DocumentRenameApi,
    DocumentRetryApi,
    DocumentStatusApi,
    DocumentSummaryStatusApi,
    GetProcessRuleApi,
)
from controllers.console.datasets.error import (
    DocumentAlreadyFinishedError,
    DocumentIndexingError,
    IndexingEstimateError,
    InvalidActionError,
    InvalidMetadataError,
)
from core.entities.knowledge_entities import IndexingEstimate
from core.rag.index_processor.constant.index_type import IndexStructureType
from models.dataset import Dataset
from models.dataset import Document as DatasetDocument
from models.enums import DataSourceType, DocumentCreatedFrom, IndexingStatus


def make_serializable_document(**overrides):
    attrs = {
        "id": "doc-1",
        "position": 1,
        "data_source_type": "upload_file",
        "data_source_info_dict": {"upload_file_id": "file-1"},
        "data_source_detail_dict": {},
        "dataset_process_rule_id": None,
        "name": "Document",
        "created_from": "web",
        "created_by": "u1",
        "created_at": None,
        "tokens": None,
        "indexing_status": "completed",
        "error": None,
        "enabled": True,
        "disabled_at": None,
        "disabled_by": None,
        "archived": False,
        "display_status": "available",
        "word_count": None,
        "hit_count": 0,
        "doc_form": "text_model",
        "doc_metadata_details": None,
        "summary_index_status": None,
        "need_summary": False,
        "process_rule_dict": None,
        "completed_segments": None,
        "total_segments": None,
    }
    attrs.update(overrides)
    document = MagicMock(spec_set=list(attrs))
    document.configure_mock(**attrs)
    return document


def make_document_detail(**overrides):
    attrs = {
        "id": "doc-1",
        "position": 1,
        "data_source_type": "upload_file",
        "data_source_info_dict": {"upload_file_id": "file-1"},
        "data_source_detail_dict": {},
        "dataset_process_rule_id": None,
        "dataset_process_rule": None,
        "name": "Document",
        "created_from": "web",
        "created_by": "u1",
        "created_at": datetime.datetime(2024, 1, 1, tzinfo=datetime.UTC),
        "tokens": 10,
        "indexing_status": "completed",
        "completed_at": None,
        "updated_at": None,
        "indexing_latency": None,
        "error": None,
        "enabled": True,
        "disabled_at": None,
        "disabled_by": None,
        "archived": False,
        "doc_type": "others",
        "doc_metadata_details": [],
        "segment_count": 0,
        "average_segment_length": 0,
        "hit_count": 0,
        "display_status": "available",
        "doc_form": "text_model",
        "doc_language": "English",
        "need_summary": False,
    }
    attrs.update(overrides)
    document = MagicMock(spec_set=list(attrs))
    document.configure_mock(**attrs)
    return document


def make_dataset(**overrides):
    attrs = {
        "id": "ds-1",
        "tenant_id": "tenant-1",
        "name": "Dataset",
        "indexing_technique": "economy",
        "chunk_structure": IndexStructureType.PARAGRAPH_INDEX,
        "created_by": "u1",
        "summary_index_setting": {"enable": True},
    }
    attrs.update(overrides)
    return Dataset(**attrs)


def make_document(**overrides):
    attrs = {
        "id": "doc-1",
        "tenant_id": "tenant-1",
        "dataset_id": "ds-1",
        "position": 1,
        "data_source_type": DataSourceType.UPLOAD_FILE,
        "data_source_info": None,
        "batch": "batch-1",
        "name": "Document",
        "created_from": DocumentCreatedFrom.WEB,
        "created_by": "u1",
        "indexing_status": IndexingStatus.COMPLETED,
        "enabled": True,
        "archived": False,
        "doc_metadata": None,
        "doc_form": IndexStructureType.PARAGRAPH_INDEX,
        "need_summary": False,
    }
    attrs.update(overrides)
    return DatasetDocument(**attrs)


@pytest.fixture
def tenant_ctx():
    return (MagicMock(is_dataset_editor=True, id="u1"), "tenant-1")


@pytest.fixture
def patch_tenant(tenant_ctx):
    return tenant_ctx


@pytest.fixture
def dataset():
    return make_dataset()


@pytest.fixture
def document():
    return MagicMock(
        id="doc-1",
        tenant_id="tenant-1",
        indexing_status=IndexingStatus.INDEXING,
        data_source_type=DataSourceType.UPLOAD_FILE,
        data_source_info_dict={"upload_file_id": "file-1"},
        doc_form=IndexStructureType.PARAGRAPH_INDEX,
        archived=False,
        is_paused=False,
        dataset_process_rule=None,
    )


@pytest.fixture
def patch_dataset(dataset):
    with patch(
        "controllers.console.datasets.datasets_document.DatasetService.get_dataset",
        return_value=dataset,
    ):
        yield


@pytest.fixture
def patch_permission():
    with patch(
        "controllers.console.datasets.datasets_document.DatasetService.check_dataset_permission",
        return_value=None,
    ):
        yield


class TestGetProcessRuleApi:
    def test_get_default_success(self, app: Flask, patch_tenant):
        api = GetProcessRuleApi()
        method = inspect.unwrap(api.get)
        user, _ = patch_tenant

        with app.test_request_context("/"):
            response = method(api, user)

        assert "rules" in response

    def test_get_with_document_preserves_legacy_segmentation_delimiter(self, app: Flask, patch_tenant):
        api = GetProcessRuleApi()
        method = inspect.unwrap(api.get)
        user, _ = patch_tenant

        document = MagicMock(dataset_id="ds-1")
        process_rule = MagicMock(
            mode="custom",
            rules_dict={"segmentation": {"delimiter": "---", "max_tokens": 123}},
        )

        with (
            app.test_request_context("/?document_id=doc-1"),
            patch(
                "controllers.console.datasets.datasets_document.db.get_or_404",
                return_value=document,
            ),
            patch(
                "controllers.console.datasets.datasets_document.DatasetService.get_dataset",
                return_value=MagicMock(),
            ),
            patch(
                "controllers.console.datasets.datasets_document.DatasetService.check_dataset_permission",
                return_value=None,
            ),
            patch(
                "controllers.console.datasets.datasets_document.db.session.scalar",
                return_value=process_rule,
            ),
        ):
            response = method(api, user)

        assert response["rules"]["segmentation"]["separator"] == "---"
        assert response["rules"]["segmentation"]["max_tokens"] == 123
        assert "delimiter" not in response["rules"]["segmentation"]

    def test_get_with_document_dataset_not_found(self, app: Flask, patch_tenant):
        api = GetProcessRuleApi()
        method = inspect.unwrap(api.get)
        user, _ = patch_tenant

        document = MagicMock(dataset_id="ds-1")

        with (
            app.test_request_context("/?document_id=doc-1"),
            patch(
                "controllers.console.datasets.datasets_document.db.get_or_404",
                return_value=document,
            ),
            patch(
                "controllers.console.datasets.datasets_document.DatasetService.get_dataset",
                return_value=None,
            ),
        ):
            with pytest.raises(NotFound):
                method(api, user)


class TestDatasetDocumentListApi:
    def test_get_with_fetch_true_counts_segments(self, app: Flask, patch_tenant, patch_dataset, patch_permission):
        api = DatasetDocumentListApi()
        method = inspect.unwrap(api.get)
        user, tenant_id = patch_tenant

        doc = make_serializable_document()
        pagination = MagicMock(items=[doc], total=1)

        with (
            app.test_request_context("/?fetch=true"),
            patch(
                "controllers.console.datasets.datasets_document.paginate_query",
                return_value=pagination,
            ),
            patch(
                "controllers.console.datasets.datasets_document.db.session.scalar",
                return_value=2,
            ),
            patch(
                "controllers.console.datasets.datasets_document.DocumentService.enrich_documents_with_summary_index_status",
                return_value=None,
            ),
        ):
            resp = method(api, tenant_id, user, "ds-1")

        assert resp["data"][0]["id"] == "doc-1"
        assert resp["data"][0]["completed_segments"] == 2
        assert resp["data"][0]["total_segments"] == 2

    def test_get_with_search_status_and_created_at_sort(
        self, app: Flask, patch_tenant, patch_dataset, patch_permission
    ):
        api = DatasetDocumentListApi()
        method = inspect.unwrap(api.get)
        user, tenant_id = patch_tenant

        pagination = MagicMock(items=[make_serializable_document()], total=1)

        with (
            app.test_request_context("/?keyword=test&status=enabled&sort=created_at"),
            patch(
                "controllers.console.datasets.datasets_document.paginate_query",
                return_value=pagination,
            ),
            patch(
                "controllers.console.datasets.datasets_document.DocumentService.apply_display_status_filter",
                side_effect=lambda q, s: q,
            ),
            patch(
                "controllers.console.datasets.datasets_document.DocumentService.enrich_documents_with_summary_index_status",
                return_value=None,
            ),
        ):
            resp = method(api, tenant_id, user, "ds-1")

        assert resp["total"] == 1

    def test_get_success(self, app: Flask, patch_tenant, patch_dataset, patch_permission):
        api = DatasetDocumentListApi()
        method = inspect.unwrap(api.get)
        user, tenant_id = patch_tenant

        pagination = MagicMock(items=[make_serializable_document()], total=1)

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.datasets.datasets_document.paginate_query",
                return_value=pagination,
            ),
            patch(
                "controllers.console.datasets.datasets_document.DocumentService.enrich_documents_with_summary_index_status",
                return_value=None,
            ),
        ):
            response = method(api, tenant_id, user, "ds-1")

        assert response["total"] == 1
        assert response["data"][0]["id"] == "doc-1"
        assert "completed_segments" not in response["data"][0]
        assert "total_segments" not in response["data"][0]

    def test_post_success(self, app: Flask, patch_tenant, patch_dataset, patch_permission):
        api = DatasetDocumentListApi()
        method = inspect.unwrap(api.post)
        user, _ = patch_tenant

        payload = {"indexing_technique": "economy"}
        created_dataset = make_dataset()
        created_document = make_document()

        with (
            app.test_request_context("/", json=payload),
            patch.object(type(console_ns), "payload", payload),
            patch(
                "controllers.console.datasets.datasets_document.DatasetService.get_dataset",
                return_value=created_dataset,
            ),
            patch(
                "controllers.console.datasets.datasets_document.DocumentService.document_create_args_validate",
                return_value=None,
            ),
            patch(
                "controllers.console.datasets.datasets_document.DocumentService.save_document_with_dataset_id",
                return_value=([created_document], "batch-1"),
            ),
            patch("models.dataset.db.session.scalar", return_value=0),
        ):
            response = method(api, user, "ds-1")

        assert "documents" in response
        assert response["dataset"]["id"] == "ds-1"
        assert response["documents"][0]["id"] == "doc-1"
        assert response["documents"][0]["data_source_info"] == {}
        assert response["documents"][0]["doc_metadata"] == []
        assert "data_source_info_dict" not in response["documents"][0]
        assert "doc_metadata_details" not in response["documents"][0]

    def test_post_forbidden(self, app: Flask):
        api = DatasetDocumentListApi()
        method = inspect.unwrap(api.post)

        user = MagicMock(is_dataset_editor=False)

        with (
            app.test_request_context("/", json={}),
            patch.object(type(console_ns), "payload", {}),
            patch(
                "controllers.console.datasets.datasets_document.DatasetService.get_dataset",
                return_value=MagicMock(),
            ),
        ):
            with pytest.raises(Forbidden):
                method(api, user, "ds-1")

    def test_get_with_fetch_true_and_invalid_fetch(self, app: Flask, patch_tenant, patch_dataset, patch_permission):
        api = DatasetDocumentListApi()
        method = inspect.unwrap(api.get)
        user, tenant_id = patch_tenant

        pagination = MagicMock(items=[make_serializable_document()], total=1)

        with (
            app.test_request_context("/?fetch=maybe"),
            patch(
                "controllers.console.datasets.datasets_document.paginate_query",
                return_value=pagination,
            ),
            patch(
                "controllers.console.datasets.datasets_document.DocumentService.enrich_documents_with_summary_index_status",
                return_value=None,
            ),
        ):
            response = method(api, tenant_id, user, "ds-1")

        assert response["total"] == 1

    def test_get_sort_hit_count(self, app: Flask, patch_tenant, patch_dataset, patch_permission):
        api = DatasetDocumentListApi()
        method = inspect.unwrap(api.get)
        user, tenant_id = patch_tenant

        pagination = MagicMock(items=[], total=0)

        with (
            app.test_request_context("/?sort=hit_count"),
            patch(
                "controllers.console.datasets.datasets_document.paginate_query",
                return_value=pagination,
            ),
            patch(
                "controllers.console.datasets.datasets_document.DocumentService.enrich_documents_with_summary_index_status",
                return_value=None,
            ),
        ):
            response = method(api, tenant_id, user, "ds-1")

        assert response["total"] == 0


class TestDatasetInitApi:
    def test_post_success_serializes_created_dataset_and_documents(self, app: Flask, patch_tenant):
        api = DatasetInitApi()
        method = inspect.unwrap(api.post)
        user, tenant_id = patch_tenant

        payload = {"indexing_technique": "economy"}
        created_dataset = make_dataset()
        created_document = make_document(id="doc-init")

        with (
            app.test_request_context("/", json=payload),
            patch.object(type(console_ns), "payload", payload),
            patch(
                "controllers.console.datasets.datasets_document.DocumentService.document_create_args_validate",
                return_value=None,
            ),
            patch(
                "controllers.console.datasets.datasets_document.DocumentService.save_document_without_dataset_id",
                return_value=(created_dataset, [created_document], "batch-init"),
            ),
            patch("models.dataset.db.session.scalar", return_value=0),
        ):
            response = method(api, tenant_id, user)

        assert response["dataset"]["id"] == "ds-1"
        assert response["documents"][0]["id"] == "doc-init"
        assert response["documents"][0]["data_source_info"] == {}
        assert response["documents"][0]["doc_metadata"] == []
        assert response["batch"] == "batch-init"


class TestDocumentApi:
    def test_get_success(self, app: Flask, patch_tenant):
        api = DocumentApi()
        method = inspect.unwrap(api.get)
        user, tenant_id = patch_tenant

        document = make_document_detail()

        with (
            app.test_request_context("/"),
            patch.object(api, "get_document", return_value=document),
            patch(
                "controllers.console.datasets.datasets_document.DatasetService.get_process_rules",
                return_value={},
            ),
        ):
            response, status = method(api, tenant_id, user, "ds-1", "doc-1")

        assert status == 200

    def test_get_invalid_metadata(self, app: Flask, patch_tenant):
        api = DocumentApi()
        method = inspect.unwrap(api.get)
        user, tenant_id = patch_tenant

        with app.test_request_context("/?metadata=wrong"), patch.object(api, "get_document", return_value=MagicMock()):
            with pytest.raises(InvalidMetadataError):
                method(api, tenant_id, user, "ds-1", "doc-1")

    def test_delete_success(self, app: Flask, patch_tenant, patch_dataset):
        api = DocumentApi()
        method = inspect.unwrap(api.delete)
        user, tenant_id = patch_tenant

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.datasets.datasets_document.DatasetService.check_dataset_model_setting",
                return_value=None,
            ),
            patch.object(api, "get_document", return_value=MagicMock()),
            patch(
                "controllers.console.datasets.datasets_document.DocumentService.delete_document",
                return_value=None,
            ),
        ):
            response, status = method(api, tenant_id, user, "ds-1", "doc-1")

        assert status == 204

    def test_delete_indexing_error(self, app: Flask, patch_tenant, patch_dataset):
        api = DocumentApi()
        method = inspect.unwrap(api.delete)
        user, tenant_id = patch_tenant

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.datasets.datasets_document.DatasetService.check_dataset_model_setting",
                return_value=None,
            ),
            patch.object(api, "get_document", return_value=MagicMock()),
            patch(
                "controllers.console.datasets.datasets_document.DocumentService.delete_document",
                side_effect=services.errors.document.DocumentIndexingError(),
            ),
        ):
            with pytest.raises(DocumentIndexingError):
                method(api, tenant_id, user, "ds-1", "doc-1")


class TestDocumentDownloadApi:
    def test_download_success(self, app: Flask, patch_tenant):
        api = DocumentDownloadApi()
        method = inspect.unwrap(api.get)
        user, tenant_id = patch_tenant

        document = MagicMock()

        with (
            app.test_request_context("/"),
            patch.object(api, "get_document", return_value=document),
            patch(
                "controllers.console.datasets.datasets_document.DocumentService.get_document_download_url",
                return_value="url",
            ),
        ):
            response = method(api, tenant_id, user, "ds-1", "doc-1")

        assert response["url"] == "url"


class TestDocumentProcessingApi:
    def test_processing_forbidden_when_not_editor(self, app: Flask):
        api = DocumentProcessingApi()
        method = inspect.unwrap(api.patch)

        user = MagicMock(is_dataset_editor=False)

        with (
            app.test_request_context("/"),
            patch.object(api, "get_document", return_value=MagicMock()),
        ):
            with pytest.raises(Forbidden):
                method(api, "tenant-1", user, "ds-1", "doc-1", "pause")

    def test_resume_from_error_state(self, app: Flask, patch_tenant):
        api = DocumentProcessingApi()
        method = inspect.unwrap(api.patch)
        user, tenant_id = patch_tenant

        doc = MagicMock(indexing_status=IndexingStatus.ERROR, is_paused=True)

        with (
            app.test_request_context("/"),
            patch.object(api, "get_document", return_value=doc),
            patch(
                "controllers.console.datasets.datasets_document.db.session.commit",
                return_value=None,
            ),
        ):
            _, status = method(api, tenant_id, user, "ds-1", "doc-1", "resume")

        assert status == 200

    def test_resume_success(self, app: Flask, patch_tenant):
        api = DocumentProcessingApi()
        method = inspect.unwrap(api.patch)
        user, tenant_id = patch_tenant

        document = MagicMock(indexing_status=IndexingStatus.PAUSED, is_paused=True)

        with (
            app.test_request_context("/"),
            patch.object(api, "get_document", return_value=document),
            patch(
                "controllers.console.datasets.datasets_document.db.session.commit",
                return_value=None,
            ),
        ):
            response, status = method(api, tenant_id, user, "ds-1", "doc-1", "resume")

        assert status == 200

    def test_pause_success(self, app: Flask, patch_tenant):
        api = DocumentProcessingApi()
        method = inspect.unwrap(api.patch)
        user, tenant_id = patch_tenant

        document = MagicMock(indexing_status="indexing")

        with (
            app.test_request_context("/"),
            patch.object(api, "get_document", return_value=document),
            patch(
                "controllers.console.datasets.datasets_document.db.session.commit",
                return_value=None,
            ),
        ):
            response, status = method(api, tenant_id, user, "ds-1", "doc-1", "pause")

        assert status == 200

    def test_pause_invalid(self, app: Flask, patch_tenant):
        api = DocumentProcessingApi()
        method = inspect.unwrap(api.patch)
        user, tenant_id = patch_tenant

        document = MagicMock(indexing_status=IndexingStatus.COMPLETED)

        with app.test_request_context("/"), patch.object(api, "get_document", return_value=document):
            with pytest.raises(InvalidActionError):
                method(api, tenant_id, user, "ds-1", "doc-1", "pause")


class TestDocumentMetadataApi:
    def test_put_metadata_schema_filtering(self, app: Flask, patch_tenant):
        api = DocumentMetadataApi()
        method = inspect.unwrap(api.put)
        user, tenant_id = patch_tenant

        doc = MagicMock()

        payload = {
            "doc_type": "invoice",
            "doc_metadata": {"amount": 10, "invalid": "x"},
        }

        schema = {"amount": int}

        with (
            app.test_request_context("/", json=payload),
            patch.object(api, "get_document", return_value=doc),
            patch(
                "controllers.console.datasets.datasets_document.DocumentService.DOCUMENT_METADATA_SCHEMA",
                {"invoice": schema},
            ),
            patch(
                "controllers.console.datasets.datasets_document.db.session.commit",
                return_value=None,
            ),
        ):
            method(api, tenant_id, user, "ds-1", "doc-1")

        assert doc.doc_metadata == {"amount": 10}

    def test_put_success(self, app: Flask, patch_tenant):
        api = DocumentMetadataApi()
        method = inspect.unwrap(api.put)
        user, tenant_id = patch_tenant

        document = MagicMock()

        payload = {"doc_type": "others", "doc_metadata": {"a": 1}}

        with (
            app.test_request_context("/", json=payload),
            patch.object(api, "get_document", return_value=document),
            patch(
                "controllers.console.datasets.datasets_document.DocumentService.DOCUMENT_METADATA_SCHEMA",
                {"others": {}},
            ),
            patch(
                "controllers.console.datasets.datasets_document.db.session.commit",
                return_value=None,
            ),
        ):
            response, status = method(api, tenant_id, user, "ds-1", "doc-1")

        assert status == 200

    def test_put_invalid_payload(self, app: Flask, patch_tenant):
        api = DocumentMetadataApi()
        method = inspect.unwrap(api.put)
        user, tenant_id = patch_tenant

        with app.test_request_context("/", json={}), patch.object(api, "get_document", return_value=MagicMock()):
            with pytest.raises(ValueError):
                method(api, tenant_id, user, "ds-1", "doc-1")

    def test_put_invalid_doc_type(self, app: Flask, patch_tenant):
        api = DocumentMetadataApi()
        method = inspect.unwrap(api.put)
        user, tenant_id = patch_tenant

        payload = {"doc_type": "invalid", "doc_metadata": {}}

        with (
            app.test_request_context("/", json=payload),
            patch.object(api, "get_document", return_value=MagicMock()),
            patch(
                "controllers.console.datasets.datasets_document.DocumentService.DOCUMENT_METADATA_SCHEMA",
                {"others": {}},
            ),
        ):
            with pytest.raises(ValueError):
                method(api, tenant_id, user, "ds-1", "doc-1")


class TestDocumentStatusApi:
    def test_patch_success(self, app: Flask, patch_tenant, patch_dataset):
        api = DocumentStatusApi()
        method = inspect.unwrap(api.patch)
        user, _ = patch_tenant

        with (
            app.test_request_context("/?document_id=doc-1"),
            patch(
                "controllers.console.datasets.datasets_document.DatasetService.check_dataset_model_setting",
                return_value=None,
            ),
            patch(
                "controllers.console.datasets.datasets_document.DatasetService.check_dataset_permission",
                return_value=None,
            ),
            patch(
                "controllers.console.datasets.datasets_document.DocumentService.batch_update_document_status",
                return_value=None,
            ),
        ):
            response, status = method(api, user, "ds-1", "enable")

        assert status == 200

    def test_patch_invalid_action(self, app: Flask, patch_tenant, patch_dataset):
        api = DocumentStatusApi()
        method = inspect.unwrap(api.patch)
        user, _ = patch_tenant

        with (
            app.test_request_context("/?document_id=doc-1"),
            patch(
                "controllers.console.datasets.datasets_document.DatasetService.check_dataset_model_setting",
                return_value=None,
            ),
            patch(
                "controllers.console.datasets.datasets_document.DatasetService.check_dataset_permission",
                return_value=None,
            ),
            patch(
                "controllers.console.datasets.datasets_document.DocumentService.batch_update_document_status",
                side_effect=ValueError("x"),
            ),
        ):
            with pytest.raises(InvalidActionError):
                method(api, user, "ds-1", "enable")


class TestDocumentRetryApi:
    def test_retry_archived_document_skipped(self, app: Flask, patch_tenant, patch_dataset):
        api = DocumentRetryApi()
        method = inspect.unwrap(api.post)

        payload = {"document_ids": ["doc-1"]}

        doc = MagicMock(indexing_status="indexing")

        with (
            app.test_request_context("/", json=payload),
            patch.object(type(console_ns), "payload", payload),
            patch(
                "controllers.console.datasets.datasets_document.DocumentService.get_document",
                return_value=doc,
            ),
            patch(
                "controllers.console.datasets.datasets_document.DocumentService.check_archived",
                return_value=True,
            ),
            patch(
                "controllers.console.datasets.datasets_document.DocumentService.retry_document",
            ) as retry_mock,
        ):
            resp, status = method(api, "ds-1")

        assert status == 204
        retry_mock.assert_called_once_with("ds-1", [], ANY)

    def test_retry_success(self, app: Flask, patch_tenant, patch_dataset):
        api = DocumentRetryApi()
        method = inspect.unwrap(api.post)

        payload = {"document_ids": ["doc-1"]}

        document = MagicMock(indexing_status=IndexingStatus.INDEXING, archived=False)

        with (
            app.test_request_context("/", json=payload),
            patch.object(type(console_ns), "payload", payload),
            patch(
                "controllers.console.datasets.datasets_document.DocumentService.get_document",
                return_value=document,
            ),
            patch(
                "controllers.console.datasets.datasets_document.DocumentService.check_archived",
                return_value=False,
            ),
            patch(
                "controllers.console.datasets.datasets_document.DocumentService.retry_document",
                return_value=None,
            ) as retry_mock,
        ):
            response, status = method(api, "ds-1")

        assert status == 204
        retry_mock.assert_called_once_with("ds-1", [document], ANY)

    def test_retry_skips_completed_document(self, app: Flask, patch_tenant, patch_dataset):
        api = DocumentRetryApi()
        method = inspect.unwrap(api.post)

        payload = {"document_ids": ["doc-1"]}

        document = MagicMock(indexing_status=IndexingStatus.COMPLETED, archived=False)

        with (
            app.test_request_context("/", json=payload),
            patch.object(type(console_ns), "payload", payload),
            patch(
                "controllers.console.datasets.datasets_document.DocumentService.get_document",
                return_value=document,
            ),
            patch(
                "controllers.console.datasets.datasets_document.DocumentService.retry_document",
                return_value=None,
            ) as retry_mock,
        ):
            response, status = method(api, "ds-1")

        assert status == 204
        retry_mock.assert_called_once_with("ds-1", [], ANY)


class TestDocumentPipelineExecutionLogApi:
    def test_get_log_success(self, app: Flask, patch_tenant, patch_dataset):
        api = DocumentPipelineExecutionLogApi()
        method = inspect.unwrap(api.get)

        log = MagicMock(
            datasource_info="{}",
            datasource_type="file",
            input_data={},
            datasource_node_id="n1",
        )

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.datasets.datasets_document.DocumentService.get_document",
                return_value=MagicMock(),
            ),
            patch(
                "controllers.console.datasets.datasets_document.db.session.scalar",
                return_value=log,
            ),
        ):
            response, status = method(api, "ds-1", "doc-1")

        assert status == 200


class TestDocumentGenerateSummaryApi:
    def test_generate_summary_missing_documents(self, app: Flask, patch_tenant, patch_permission):
        api = DocumentGenerateSummaryApi()
        method = inspect.unwrap(api.post)
        user, _ = patch_tenant

        dataset = MagicMock(
            indexing_technique="high_quality",
            summary_index_setting={"enable": True},
        )

        payload = {"document_list": ["doc-1", "doc-2"]}

        with (
            app.test_request_context("/", json=payload),
            patch.object(type(console_ns), "payload", payload),
            patch(
                "controllers.console.datasets.datasets_document.DatasetService.get_dataset",
                return_value=dataset,
            ),
            patch(
                "controllers.console.datasets.datasets_document.DocumentService.get_documents_by_ids",
                return_value=[MagicMock(id="doc-1")],
            ),
        ):
            with pytest.raises(NotFound):
                method(api, user, "ds-1")

    def test_generate_not_enabled(self, app: Flask, patch_tenant, patch_permission):
        api = DocumentGenerateSummaryApi()
        method = inspect.unwrap(api.post)
        user, _ = patch_tenant

        dataset = MagicMock(indexing_technique="high_quality", summary_index_setting={"enable": False})

        payload = {"document_list": ["doc-1"]}

        with (
            app.test_request_context("/", json=payload),
            patch.object(type(console_ns), "payload", payload),
            patch(
                "controllers.console.datasets.datasets_document.DatasetService.get_dataset",
                return_value=dataset,
            ),
        ):
            with pytest.raises(ValueError):
                method(api, user, "ds-1")

    def test_generate_summary_success_with_qa_skip(self, app: Flask, patch_tenant, patch_permission):
        api = DocumentGenerateSummaryApi()
        method = inspect.unwrap(api.post)
        user, _ = patch_tenant

        dataset = MagicMock(
            indexing_technique="high_quality",
            summary_index_setting={"enable": True},
        )

        doc1 = MagicMock(id="doc-1", doc_form=IndexStructureType.QA_INDEX)
        doc2 = MagicMock(id="doc-2", doc_form=IndexStructureType.PARAGRAPH_INDEX)

        payload = {"document_list": ["doc-1", "doc-2"]}

        with (
            app.test_request_context("/", json=payload),
            patch.object(type(console_ns), "payload", payload),
            patch(
                "controllers.console.datasets.datasets_document.DatasetService.get_dataset",
                return_value=dataset,
            ),
            patch(
                "controllers.console.datasets.datasets_document.DocumentService.get_documents_by_ids",
                return_value=[doc1, doc2],
            ),
            patch(
                "controllers.console.datasets.datasets_document.generate_summary_index_task.delay",
                return_value=None,
            ),
        ):
            response, status = method(api, user, "ds-1")

        assert status == 200


class TestDocumentSummaryStatusApi:
    def test_get_success(self, app: Flask, patch_tenant, patch_permission):
        api = DocumentSummaryStatusApi()
        method = inspect.unwrap(api.get)
        user, _ = patch_tenant

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.datasets.datasets_document.DatasetService.get_dataset",
                return_value=MagicMock(),
            ),
            patch(
                "services.summary_index_service.SummaryIndexService.get_document_summary_status_detail",
                return_value={
                    "total_segments": 1,
                    "summary_status": {"timeout": 1},
                    "summaries": [
                        {
                            "segment_id": "segment-1",
                            "segment_position": 1,
                            "status": "timeout",
                        }
                    ],
                },
            ),
        ):
            response, status = method(api, user, "ds-1", "doc-1")

        assert status == 200
        assert response["summary_status"]["timeout"] == 1
        assert response["summaries"][0]["status"] == "timeout"


class TestDocumentIndexingEstimateApi:
    def test_indexing_estimate_file_not_found(self, app: Flask, patch_tenant):
        api = DocumentIndexingEstimateApi()
        method = inspect.unwrap(api.get)
        user, tenant_id = patch_tenant

        document = MagicMock(
            indexing_status=IndexingStatus.INDEXING,
            data_source_type=DataSourceType.UPLOAD_FILE,
            data_source_info_dict={"upload_file_id": "file-1"},
            tenant_id="tenant-1",
            doc_form=IndexStructureType.PARAGRAPH_INDEX,
            dataset_process_rule=None,
        )

        with (
            app.test_request_context("/"),
            patch.object(api, "get_document", return_value=document),
            patch(
                "controllers.console.datasets.datasets_document.db.session.scalar",
                return_value=None,
            ),
        ):
            with pytest.raises(NotFound):
                method(api, tenant_id, user, "ds-1", "doc-1")

    def test_indexing_estimate_generic_exception(self, app: Flask, patch_tenant):
        api = DocumentIndexingEstimateApi()
        method = inspect.unwrap(api.get)
        user, tenant_id = patch_tenant

        document = MagicMock(
            indexing_status=IndexingStatus.INDEXING,
            data_source_type=DataSourceType.UPLOAD_FILE,
            data_source_info_dict={"upload_file_id": "file-1"},
            tenant_id="tenant-1",
            doc_form=IndexStructureType.PARAGRAPH_INDEX,
            dataset_process_rule=None,
        )

        upload_file = MagicMock()

        mock_indexing_runner = MagicMock()
        mock_indexing_runner.indexing_estimate.side_effect = RuntimeError("Some indexing error")

        with (
            app.test_request_context("/"),
            patch.object(api, "get_document", return_value=document),
            patch(
                "controllers.console.datasets.datasets_document.db.session.scalar",
                return_value=upload_file,
            ),
            patch(
                "controllers.console.datasets.datasets_document.ExtractSetting",
                return_value=MagicMock(),
            ),
            patch(
                "controllers.console.datasets.datasets_document.IndexingRunner",
                return_value=mock_indexing_runner,
            ),
        ):
            with pytest.raises(IndexingEstimateError):
                method(api, tenant_id, user, "ds-1", "doc-1")

    def test_get_finished(self, app: Flask, patch_tenant):
        api = DocumentIndexingEstimateApi()
        method = inspect.unwrap(api.get)
        user, tenant_id = patch_tenant

        document = MagicMock(indexing_status=IndexingStatus.COMPLETED)

        with app.test_request_context("/"), patch.object(api, "get_document", return_value=document):
            with pytest.raises(DocumentAlreadyFinishedError):
                method(api, tenant_id, user, "ds-1", "doc-1")


class TestDocumentBatchDownloadZipApi:
    def test_post_no_documents(self, app: Flask, patch_tenant):
        api = DocumentBatchDownloadZipApi()
        method = inspect.unwrap(api.post)
        user, tenant_id = patch_tenant

        payload: dict[str, list[str]] = {"document_ids": []}

        with app.test_request_context("/", json=payload), patch.object(type(console_ns), "payload", payload):
            with pytest.raises(ValueError):
                method(api, tenant_id, user, "ds-1")


class TestDatasetDocumentListApiDelete:
    def test_delete_success(self, app: Flask, patch_tenant, patch_dataset):
        """Test successful deletion of documents"""
        api = DatasetDocumentListApi()
        method = inspect.unwrap(api.delete)

        with (
            app.test_request_context("/?document_id=doc-1&document_id=doc-2"),
            patch(
                "controllers.console.datasets.datasets_document.DatasetService.check_dataset_model_setting",
                return_value=None,
            ),
            patch(
                "controllers.console.datasets.datasets_document.DocumentService.delete_documents",
                return_value=None,
            ),
        ):
            response, status = method(api, "ds-1")

        assert status == 204

    def test_delete_indexing_error(self, app: Flask, patch_tenant, patch_dataset):
        """Test deletion with indexing error"""
        api = DatasetDocumentListApi()
        method = inspect.unwrap(api.delete)

        with (
            app.test_request_context("/?document_id=doc-1"),
            patch(
                "controllers.console.datasets.datasets_document.DatasetService.check_dataset_model_setting",
                return_value=None,
            ),
            patch(
                "controllers.console.datasets.datasets_document.DocumentService.delete_documents",
                side_effect=services.errors.document.DocumentIndexingError(),
            ),
        ):
            with pytest.raises(DocumentIndexingError):
                method(api, "ds-1")

    def test_delete_dataset_not_found(self, app: Flask, patch_tenant):
        """Test deletion when dataset not found"""
        api = DatasetDocumentListApi()
        method = inspect.unwrap(api.delete)

        with (
            app.test_request_context("/?document_id=doc-1"),
            patch(
                "controllers.console.datasets.datasets_document.DatasetService.get_dataset",
                return_value=None,
            ),
        ):
            with pytest.raises(NotFound):
                method(api, "ds-1")


class TestDocumentBatchIndexingEstimateApi:
    def test_batch_indexing_estimate_website(self, app: Flask, patch_tenant):
        api = DocumentBatchIndexingEstimateApi()
        method = inspect.unwrap(api.get)
        user, tenant_id = patch_tenant

        doc = MagicMock(
            indexing_status=IndexingStatus.INDEXING,
            data_source_type=DataSourceType.WEBSITE_CRAWL,
            data_source_info_dict={
                "provider": "firecrawl",
                "job_id": "j1",
                "url": "https://x.com",
                "mode": "single",
                "only_main_content": True,
            },
            doc_form=IndexStructureType.PARAGRAPH_INDEX,
        )

        with (
            app.test_request_context("/"),
            patch.object(api, "get_batch_documents", return_value=[doc]),
            patch(
                "controllers.console.datasets.datasets_document.IndexingRunner.indexing_estimate",
                return_value=IndexingEstimate(total_segments=2, preview=[]),
            ),
        ):
            resp, status = method(api, tenant_id, user, "ds-1", "batch-1")

        assert status == 200

    def test_batch_indexing_estimate_notion(self, app: Flask, patch_tenant):
        api = DocumentBatchIndexingEstimateApi()
        method = inspect.unwrap(api.get)
        user, tenant_id = patch_tenant

        doc = MagicMock(
            indexing_status=IndexingStatus.INDEXING,
            data_source_type=DataSourceType.NOTION_IMPORT,
            data_source_info_dict={
                "credential_id": "c1",
                "notion_workspace_id": "w1",
                "notion_page_id": "p1",
                "type": "page",
            },
            doc_form=IndexStructureType.PARAGRAPH_INDEX,
        )

        with (
            app.test_request_context("/"),
            patch.object(api, "get_batch_documents", return_value=[doc]),
            patch(
                "controllers.console.datasets.datasets_document.IndexingRunner.indexing_estimate",
                return_value=IndexingEstimate(total_segments=1, preview=[]),
            ),
        ):
            resp, status = method(api, tenant_id, user, "ds-1", "batch-1")

        assert status == 200

    def test_batch_estimate_unsupported_datasource(self, app: Flask, patch_tenant):
        api = DocumentBatchIndexingEstimateApi()
        method = inspect.unwrap(api.get)
        user, tenant_id = patch_tenant

        document = MagicMock(
            indexing_status=IndexingStatus.INDEXING,
            data_source_type="unknown",
            data_source_info_dict={},
            doc_form=IndexStructureType.PARAGRAPH_INDEX,
        )

        with app.test_request_context("/"), patch.object(api, "get_batch_documents", return_value=[document]):
            with pytest.raises(ValueError):
                method(api, tenant_id, user, "ds-1", "batch-1")

    def test_get_batch_estimate_invalid_batch(self, app: Flask, patch_tenant):
        """Test batch estimation with invalid batch"""
        api = DocumentBatchIndexingEstimateApi()
        method = inspect.unwrap(api.get)
        user, tenant_id = patch_tenant

        with app.test_request_context("/"), patch.object(api, "get_batch_documents", side_effect=NotFound()):
            with pytest.raises(NotFound):
                method(api, tenant_id, user, "ds-1", "invalid-batch")


class TestDocumentBatchIndexingStatusApi:
    def test_get_batch_status_success_serializes_status_shape(self, app: Flask, patch_tenant):
        api = DocumentBatchIndexingStatusApi()
        method = inspect.unwrap(api.get)
        user, _ = patch_tenant

        document = MagicMock(
            id="doc-1",
            indexing_status=IndexingStatus.COMPLETED,
            is_paused=False,
            processing_started_at=None,
            parsing_completed_at=None,
            cleaning_completed_at=None,
            splitting_completed_at=None,
            completed_at=None,
            paused_at=None,
            error=None,
            stopped_at=None,
        )

        with (
            app.test_request_context("/"),
            patch.object(api, "get_batch_documents", return_value=[document]),
            patch(
                "controllers.console.datasets.datasets_document.db.session.scalar",
                side_effect=[2, 3],
            ),
        ):
            response = method(api, user, "ds-1", "batch-1")

        assert response == {
            "data": [
                {
                    "id": "doc-1",
                    "indexing_status": "completed",
                    "processing_started_at": None,
                    "parsing_completed_at": None,
                    "cleaning_completed_at": None,
                    "splitting_completed_at": None,
                    "completed_at": None,
                    "paused_at": None,
                    "error": None,
                    "stopped_at": None,
                    "completed_segments": 2,
                    "total_segments": 3,
                }
            ]
        }

    def test_get_batch_status_invalid_batch(self, app: Flask, patch_tenant):
        """Test batch status with invalid batch"""
        api = DocumentBatchIndexingStatusApi()
        method = inspect.unwrap(api.get)
        user, _ = patch_tenant

        with app.test_request_context("/"), patch.object(api, "get_batch_documents", side_effect=NotFound()):
            with pytest.raises(NotFound):
                method(api, user, "ds-1", "invalid-batch")


class TestDocumentIndexingStatusApi:
    def test_get_status_success_serializes_status_shape(self, app: Flask, patch_tenant):
        api = DocumentIndexingStatusApi()
        method = inspect.unwrap(api.get)
        user, tenant_id = patch_tenant

        document = MagicMock(
            id="doc-1",
            indexing_status=IndexingStatus.INDEXING,
            is_paused=False,
            processing_started_at=None,
            parsing_completed_at=None,
            cleaning_completed_at=None,
            splitting_completed_at=None,
            completed_at=None,
            paused_at=None,
            error=None,
            stopped_at=None,
        )

        with (
            app.test_request_context("/"),
            patch.object(api, "get_document", return_value=document),
            patch(
                "controllers.console.datasets.datasets_document.db.session.scalar",
                side_effect=[1, 4],
            ),
        ):
            response = method(api, tenant_id, user, "ds-1", "doc-1")

        assert response["id"] == "doc-1"
        assert response["indexing_status"] == "indexing"
        assert response["completed_segments"] == 1
        assert response["total_segments"] == 4

    def test_get_status_document_not_found(self, app: Flask, patch_tenant):
        """Test getting status for non-existent document"""
        api = DocumentIndexingStatusApi()
        method = inspect.unwrap(api.get)
        user, tenant_id = patch_tenant

        with app.test_request_context("/"), patch.object(api, "get_document", side_effect=NotFound()):
            with pytest.raises(NotFound):
                method(api, tenant_id, user, "ds-1", "invalid-doc")


class TestDocumentRenameApi:
    def test_post_success_serializes_document_shape(self, app: Flask, patch_tenant):
        api = DocumentRenameApi()
        method = inspect.unwrap(api.post)
        user, _ = patch_tenant

        payload = {"name": "Renamed Document"}
        renamed_document = make_document(id="doc-renamed", name="Renamed Document")

        with (
            app.test_request_context("/", json=payload),
            patch.object(type(console_ns), "payload", payload),
            patch(
                "controllers.console.datasets.datasets_document.DatasetService.get_dataset",
                return_value=make_dataset(),
            ),
            patch(
                "controllers.console.datasets.datasets_document.DatasetService.check_dataset_operator_permission",
                return_value=None,
            ),
            patch(
                "controllers.console.datasets.datasets_document.DocumentService.rename_document",
                return_value=renamed_document,
            ),
            patch("models.dataset.db.session.scalar", return_value=0),
        ):
            response = method(api, user, "ds-1", "doc-1")

        assert response["id"] == "doc-renamed"
        assert response["name"] == "Renamed Document"
        assert response["data_source_info"] == {}
        assert response["doc_metadata"] == []
        assert "data_source_info_dict" not in response


class TestDocumentApiMetadata:
    def test_get_with_only_option(self, app: Flask, patch_tenant):
        """Test get with 'only' metadata option"""
        api = DocumentApi()
        method = inspect.unwrap(api.get)
        user, tenant_id = patch_tenant

        document = make_document_detail(doc_metadata_details=[])

        with (
            app.test_request_context("/?metadata=only"),
            patch.object(api, "get_document", return_value=document),
            patch(
                "controllers.console.datasets.datasets_document.DatasetService.get_process_rules",
                return_value={},
            ),
        ):
            response, status = method(api, tenant_id, user, "ds-1", "doc-1")

        assert status == 200

    def test_get_with_without_option(self, app: Flask, patch_tenant):
        """Test get with 'without' metadata option"""
        api = DocumentApi()
        method = inspect.unwrap(api.get)
        user, tenant_id = patch_tenant

        document = make_document_detail()

        with (
            app.test_request_context("/?metadata=without"),
            patch.object(api, "get_document", return_value=document),
            patch(
                "controllers.console.datasets.datasets_document.DatasetService.get_process_rules",
                return_value={},
            ),
        ):
            response, status = method(api, tenant_id, user, "ds-1", "doc-1")

        assert status == 200


class TestDocumentGenerateSummaryApiSuccess:
    def test_generate_not_enabled_high_quality(self, app: Flask, patch_tenant, patch_permission):
        """Test summary generation on non-high-quality dataset"""
        api = DocumentGenerateSummaryApi()
        method = inspect.unwrap(api.post)
        user, _ = patch_tenant

        dataset = MagicMock(indexing_technique="economy", summary_index_setting={"enable": True})

        payload = {"document_list": ["doc-1"]}

        with (
            app.test_request_context("/", json=payload),
            patch.object(type(console_ns), "payload", payload),
            patch(
                "controllers.console.datasets.datasets_document.DatasetService.get_dataset",
                return_value=dataset,
            ),
        ):
            with pytest.raises(ValueError):
                method(api, user, "ds-1")


class TestDocumentProcessingApiResume:
    def test_resume_invalid_status(self, app: Flask, patch_tenant):
        """Test resume on non-paused document"""
        api = DocumentProcessingApi()
        method = inspect.unwrap(api.patch)
        user, tenant_id = patch_tenant

        document = MagicMock(indexing_status=IndexingStatus.COMPLETED, is_paused=False)

        with app.test_request_context("/"), patch.object(api, "get_document", return_value=document):
            with pytest.raises(InvalidActionError):
                method(api, tenant_id, user, "ds-1", "doc-1", "resume")


class TestDocumentPermissionCases:
    def test_document_batch_get_permission_denied(self, app: Flask, patch_tenant):
        api = DocumentBatchIndexingEstimateApi()
        method = inspect.unwrap(api.get)
        user, tenant_id = patch_tenant

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.datasets.datasets_document.DatasetService.get_dataset",
                return_value=MagicMock(),
            ),
            patch(
                "controllers.console.datasets.datasets_document.DatasetService.check_dataset_permission",
                side_effect=services.errors.account.NoPermissionError("No permission"),
            ),
        ):
            with pytest.raises(Forbidden):
                method(api, tenant_id, user, "ds-1", "batch-1")

    def test_document_batch_get_documents_not_found(self, app: Flask, patch_tenant):
        api = DocumentBatchIndexingEstimateApi()
        method = inspect.unwrap(api.get)
        user, tenant_id = patch_tenant

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.datasets.datasets_document.DatasetService.get_dataset",
                return_value=MagicMock(),
            ),
            patch(
                "controllers.console.datasets.datasets_document.DatasetService.check_dataset_permission",
                return_value=None,
            ),
            patch.object(api, "get_batch_documents", return_value=None),
        ):
            response, status = method(api, tenant_id, user, "ds-1", "batch-1")

        assert status == 200
        assert response == {
            "tokens": 0,
            "total_price": 0,
            "currency": "USD",
            "total_segments": 0,
            "preview": [],
        }

    def test_document_tenant_mismatch(self, app: Flask):
        api = DocumentApi()
        method = inspect.unwrap(api.get)

        user = MagicMock(is_dataset_editor=True)
        document = MagicMock(
            tenant_id="other-tenant",
            dataset_process_rule=None,
        )

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.datasets.datasets_document.DatasetService.get_dataset",
                return_value=MagicMock(),
            ),
            patch(
                "controllers.console.datasets.datasets_document.DocumentService.get_document",
                return_value=document,
            ),
            patch(
                "controllers.console.datasets.datasets_document.DatasetService.get_process_rules",
                return_value={},
            ),
        ):
            with pytest.raises(Forbidden):
                method(api, "tenant-1", user, "ds-1", "doc-1")

    def test_process_rule_get_by_document_success(self, app: Flask, patch_tenant):
        api = GetProcessRuleApi()
        method = inspect.unwrap(api.get)
        user, _ = patch_tenant

        document = MagicMock(dataset_id="ds-1")
        process_rule = MagicMock(mode="custom", rules_dict={"a": 1})

        with (
            app.test_request_context("/?document_id=doc-1"),
            patch(
                "controllers.console.datasets.datasets_document.db.get_or_404",
                return_value=document,
            ),
            patch(
                "controllers.console.datasets.datasets_document.DatasetService.get_dataset",
                return_value=MagicMock(),
            ),
            patch(
                "controllers.console.datasets.datasets_document.DatasetService.check_dataset_permission",
                return_value=None,
            ),
            patch(
                "controllers.console.datasets.datasets_document.db.session.scalar",
                return_value=process_rule,
            ),
        ):
            result = method(api, user)

        if isinstance(result, tuple):
            response, status = result
        else:
            response, status = result, 200

        assert status == 200
        assert response["mode"] == "custom"

    def test_process_rule_permission_denied(self, app: Flask):
        api = GetProcessRuleApi()
        method = inspect.unwrap(api.get)

        user = MagicMock(is_dataset_editor=True)
        document = MagicMock(dataset_id="ds-1")

        with (
            app.test_request_context("/?document_id=doc-1"),
            patch(
                "controllers.console.datasets.datasets_document.db.get_or_404",
                return_value=document,
            ),
            patch(
                "controllers.console.datasets.datasets_document.DatasetService.get_dataset",
                return_value=MagicMock(),
            ),
            patch(
                "controllers.console.datasets.datasets_document.DatasetService.check_dataset_permission",
                side_effect=services.errors.account.NoPermissionError("No permission"),
            ),
        ):
            with pytest.raises(Forbidden):
                method(api, user)


class TestDocumentListAdvancedCases:
    def test_document_list_with_multiple_sort_options(self, app: Flask, patch_tenant, patch_dataset, patch_permission):
        """Test document list with different sort options"""
        api = DatasetDocumentListApi()
        method = inspect.unwrap(api.get)
        user, tenant_id = patch_tenant

        pagination = MagicMock(items=[make_serializable_document()], total=1)

        with (
            app.test_request_context("/?sort=updated_at"),
            patch(
                "controllers.console.datasets.datasets_document.paginate_query",
                return_value=pagination,
            ),
            patch(
                "controllers.console.datasets.datasets_document.DocumentService.enrich_documents_with_summary_index_status",
                return_value=None,
            ),
        ):
            response = method(api, tenant_id, user, "ds-1")

        assert response["total"] == 1

    def test_document_metadata_with_schema_validation(self, app: Flask, patch_tenant):
        """Test document metadata update with schema validation"""
        api = DocumentMetadataApi()
        method = inspect.unwrap(api.put)
        user, tenant_id = patch_tenant

        doc = MagicMock()
        payload = {
            "doc_type": "contract",
            "doc_metadata": {"amount": 5000, "currency": "USD", "invalid_field": "x"},
        }

        schema = {"amount": int, "currency": str}

        with (
            app.test_request_context("/", json=payload),
            patch.object(api, "get_document", return_value=doc),
            patch(
                "controllers.console.datasets.datasets_document.DocumentService.DOCUMENT_METADATA_SCHEMA",
                {"contract": schema},
            ),
            patch(
                "controllers.console.datasets.datasets_document.db.session.commit",
                return_value=None,
            ),
        ):
            response, status = method(api, tenant_id, user, "ds-1", "doc-1")

            assert status == 200
            assert doc.doc_metadata == {"amount": 5000, "currency": "USD"}


class TestDocumentIndexingEdgeCases:
    def test_document_indexing_with_extraction_setting(self, app: Flask, patch_tenant):
        api = DocumentIndexingEstimateApi()
        method = inspect.unwrap(api.get)
        user, tenant_id = patch_tenant

        document = MagicMock(
            indexing_status=IndexingStatus.INDEXING,
            data_source_type=DataSourceType.UPLOAD_FILE,
            data_source_info_dict={"upload_file_id": "file-1"},
            tenant_id="tenant-1",
            doc_form=IndexStructureType.PARAGRAPH_INDEX,
            dataset_process_rule=None,
        )

        upload_file = MagicMock()

        with (
            app.test_request_context("/"),
            patch.object(api, "get_document", return_value=document),
            patch(
                "controllers.console.datasets.datasets_document.db.session.scalar",
                return_value=upload_file,
            ),
            patch(
                "controllers.console.datasets.datasets_document.ExtractSetting",
                return_value=MagicMock(),
            ),
            patch(
                "controllers.console.datasets.datasets_document.IndexingRunner.indexing_estimate",
                return_value=IndexingEstimate(total_segments=5, preview=[]),
            ),
        ):
            response, status = method(api, tenant_id, user, "ds-1", "doc-1")

        assert status == 200
