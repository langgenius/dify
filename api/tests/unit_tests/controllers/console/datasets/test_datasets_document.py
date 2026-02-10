from unittest.mock import MagicMock, patch

import pytest
from werkzeug.exceptions import Forbidden, NotFound

import services
from controllers.console import console_ns
from controllers.console.datasets.datasets_document import (
    DatasetDocumentListApi,
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


def unwrap(func):
    while hasattr(func, "__wrapped__"):
        func = func.__wrapped__
    return func


@pytest.fixture
def tenant_ctx():
    return (MagicMock(is_dataset_editor=True, id="u1"), "tenant-1")


@pytest.fixture
def patch_tenant(tenant_ctx):
    with patch(
        "controllers.console.datasets.datasets_document.current_account_with_tenant",
        return_value=tenant_ctx,
    ):
        yield


@pytest.fixture
def dataset():
    return MagicMock(id="ds-1", indexing_technique="economy", summary_index_setting={"enable": True})


@pytest.fixture
def document():
    return MagicMock(
        id="doc-1",
        tenant_id="tenant-1",
        indexing_status="indexing",
        data_source_type="upload_file",
        data_source_info_dict={"upload_file_id": "file-1"},
        doc_form="text",
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
    def test_get_default_success(self, app, patch_tenant):
        api = GetProcessRuleApi()
        method = unwrap(api.get)

        with app.test_request_context("/"):
            response = method(api)

        assert "rules" in response

    def test_get_with_document_dataset_not_found(self, app, patch_tenant):
        api = GetProcessRuleApi()
        method = unwrap(api.get)

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
                method(api)


class TestDatasetDocumentListApi:
    def test_get_with_fetch_true_counts_segments(self, app, patch_tenant, patch_dataset, patch_permission):
        api = DatasetDocumentListApi()
        method = unwrap(api.get)

        doc = MagicMock(id="doc-1")
        pagination = MagicMock(items=[doc], total=1)

        count_mock = MagicMock(return_value=2)

        with (
            app.test_request_context("/?fetch=true"),
            patch(
                "controllers.console.datasets.datasets_document.db.paginate",
                return_value=pagination,
            ),
            patch(
                "controllers.console.datasets.datasets_document.db.session.query",
                return_value=MagicMock(where=lambda *a, **k: MagicMock(count=count_mock)),
            ),
            patch(
                "controllers.console.datasets.datasets_document.DocumentService.enrich_documents_with_summary_index_status",
                return_value=None,
            ),
            patch(
                "controllers.console.datasets.datasets_document.marshal",
                return_value=[{"id": "doc-1"}],
            ),
        ):
            resp = method(api, "ds-1")

        assert resp["data"]

    def test_get_with_search_status_and_created_at_sort(self, app, patch_tenant, patch_dataset, patch_permission):
        api = DatasetDocumentListApi()
        method = unwrap(api.get)

        pagination = MagicMock(items=[MagicMock()], total=1)

        with (
            app.test_request_context("/?keyword=test&status=enabled&sort=created_at"),
            patch(
                "controllers.console.datasets.datasets_document.db.paginate",
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
            patch(
                "controllers.console.datasets.datasets_document.marshal",
                return_value=[{"id": "doc-1"}],
            ),
        ):
            resp = method(api, "ds-1")

        assert resp["total"] == 1

    def test_get_success(self, app, patch_tenant, patch_dataset, patch_permission):
        api = DatasetDocumentListApi()
        method = unwrap(api.get)

        pagination = MagicMock(items=[MagicMock()], total=1)

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.datasets.datasets_document.db.paginate",
                return_value=pagination,
            ),
            patch(
                "controllers.console.datasets.datasets_document.DocumentService.enrich_documents_with_summary_index_status",
                return_value=None,
            ),
            patch(
                "controllers.console.datasets.datasets_document.marshal",
                return_value=[{"id": "doc-1"}],
            ),
        ):
            response = method(api, "ds-1")

        assert response["total"] == 1

    def test_post_success(self, app, patch_tenant, patch_dataset, patch_permission):
        api = DatasetDocumentListApi()
        method = unwrap(api.post)

        payload = {"indexing_technique": "economy"}

        with (
            app.test_request_context("/", json=payload),
            patch.object(type(console_ns), "payload", payload),
            patch(
                "controllers.console.datasets.datasets_document.DocumentService.document_create_args_validate",
                return_value=None,
            ),
            patch(
                "controllers.console.datasets.datasets_document.DocumentService.save_document_with_dataset_id",
                return_value=([MagicMock()], "batch-1"),
            ),
        ):
            response = method(api, "ds-1")

        assert "documents" in response

    def test_post_forbidden(self, app):
        api = DatasetDocumentListApi()
        method = unwrap(api.post)

        user = MagicMock(is_dataset_editor=False)

        with (
            app.test_request_context("/", json={}),
            patch.object(type(console_ns), "payload", {}),
            patch(
                "controllers.console.datasets.datasets_document.current_account_with_tenant",
                return_value=(user, "tenant-1"),
            ),
            patch(
                "controllers.console.datasets.datasets_document.DatasetService.get_dataset",
                return_value=MagicMock(),
            ),
        ):
            with pytest.raises(Forbidden):
                method(api, "ds-1")

    def test_get_with_fetch_true_and_invalid_fetch(self, app, patch_tenant, patch_dataset, patch_permission):
        api = DatasetDocumentListApi()
        method = unwrap(api.get)

        pagination = MagicMock(items=[MagicMock()], total=1)

        with (
            app.test_request_context("/?fetch=maybe"),
            patch(
                "controllers.console.datasets.datasets_document.db.paginate",
                return_value=pagination,
            ),
            patch(
                "controllers.console.datasets.datasets_document.DocumentService.enrich_documents_with_summary_index_status",
                return_value=None,
            ),
            patch(
                "controllers.console.datasets.datasets_document.marshal",
                return_value=[{"id": "doc-1"}],
            ),
        ):
            response = method(api, "ds-1")

        assert response["total"] == 1

    def test_get_sort_hit_count(self, app, patch_tenant, patch_dataset, patch_permission):
        api = DatasetDocumentListApi()
        method = unwrap(api.get)

        pagination = MagicMock(items=[], total=0)

        with (
            app.test_request_context("/?sort=hit_count"),
            patch(
                "controllers.console.datasets.datasets_document.db.paginate",
                return_value=pagination,
            ),
            patch(
                "controllers.console.datasets.datasets_document.DocumentService.enrich_documents_with_summary_index_status",
                return_value=None,
            ),
        ):
            response = method(api, "ds-1")

        assert response["total"] == 0


class TestDocumentApi:
    def test_get_success(self, app, patch_tenant):
        api = DocumentApi()
        method = unwrap(api.get)

        document = MagicMock(dataset_process_rule=None)

        with (
            app.test_request_context("/"),
            patch.object(api, "get_document", return_value=document),
            patch(
                "controllers.console.datasets.datasets_document.DatasetService.get_process_rules",
                return_value={},
            ),
        ):
            response, status = method(api, "ds-1", "doc-1")

        assert status == 200

    def test_get_invalid_metadata(self, app, patch_tenant):
        api = DocumentApi()
        method = unwrap(api.get)

        with app.test_request_context("/?metadata=wrong"), patch.object(api, "get_document", return_value=MagicMock()):
            with pytest.raises(InvalidMetadataError):
                method(api, "ds-1", "doc-1")

    def test_delete_success(self, app, patch_tenant, patch_dataset):
        api = DocumentApi()
        method = unwrap(api.delete)

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
            response, status = method(api, "ds-1", "doc-1")

        assert status == 204

    def test_delete_indexing_error(self, app, patch_tenant, patch_dataset):
        api = DocumentApi()
        method = unwrap(api.delete)

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
                method(api, "ds-1", "doc-1")


class TestDocumentDownloadApi:
    def test_download_success(self, app, patch_tenant):
        api = DocumentDownloadApi()
        method = unwrap(api.get)

        document = MagicMock()

        with (
            app.test_request_context("/"),
            patch.object(api, "get_document", return_value=document),
            patch(
                "controllers.console.datasets.datasets_document.DocumentService.get_document_download_url",
                return_value="url",
            ),
        ):
            response = method(api, "ds-1", "doc-1")

        assert response["url"] == "url"


class TestDocumentProcessingApi:
    def test_processing_forbidden_when_not_editor(self, app):
        api = DocumentProcessingApi()
        method = unwrap(api.patch)

        user = MagicMock(is_dataset_editor=False)

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.datasets.datasets_document.current_account_with_tenant",
                return_value=(user, "tenant"),
            ),
            patch.object(api, "get_document", return_value=MagicMock()),
        ):
            with pytest.raises(Forbidden):
                method(api, "ds-1", "doc-1", "pause")

    def test_resume_from_error_state(self, app, patch_tenant):
        api = DocumentProcessingApi()
        method = unwrap(api.patch)

        doc = MagicMock(indexing_status="error", is_paused=True)

        with (
            app.test_request_context("/"),
            patch.object(api, "get_document", return_value=doc),
            patch(
                "controllers.console.datasets.datasets_document.db.session.commit",
                return_value=None,
            ),
        ):
            _, status = method(api, "ds-1", "doc-1", "resume")

        assert status == 200

    def test_resume_success(self, app, patch_tenant):
        api = DocumentProcessingApi()
        method = unwrap(api.patch)

        document = MagicMock(indexing_status="paused", is_paused=True)

        with (
            app.test_request_context("/"),
            patch.object(api, "get_document", return_value=document),
            patch(
                "controllers.console.datasets.datasets_document.db.session.commit",
                return_value=None,
            ),
        ):
            response, status = method(api, "ds-1", "doc-1", "resume")

        assert status == 200

    def test_pause_success(self, app, patch_tenant):
        api = DocumentProcessingApi()
        method = unwrap(api.patch)

        document = MagicMock(indexing_status="indexing")

        with (
            app.test_request_context("/"),
            patch.object(api, "get_document", return_value=document),
            patch(
                "controllers.console.datasets.datasets_document.db.session.commit",
                return_value=None,
            ),
        ):
            response, status = method(api, "ds-1", "doc-1", "pause")

        assert status == 200

    def test_pause_invalid(self, app, patch_tenant):
        api = DocumentProcessingApi()
        method = unwrap(api.patch)

        document = MagicMock(indexing_status="completed")

        with app.test_request_context("/"), patch.object(api, "get_document", return_value=document):
            with pytest.raises(InvalidActionError):
                method(api, "ds-1", "doc-1", "pause")


class TestDocumentMetadataApi:
    def test_put_metadata_schema_filtering(self, app, patch_tenant):
        api = DocumentMetadataApi()
        method = unwrap(api.put)

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
            method(api, "ds-1", "doc-1")

        assert doc.doc_metadata == {"amount": 10}

    def test_put_success(self, app, patch_tenant):
        api = DocumentMetadataApi()
        method = unwrap(api.put)

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
            response, status = method(api, "ds-1", "doc-1")

        assert status == 200

    def test_put_invalid_payload(self, app, patch_tenant):
        api = DocumentMetadataApi()
        method = unwrap(api.put)

        with app.test_request_context("/", json={}), patch.object(api, "get_document", return_value=MagicMock()):
            with pytest.raises(ValueError):
                method(api, "ds-1", "doc-1")

    def test_put_invalid_doc_type(self, app, patch_tenant):
        api = DocumentMetadataApi()
        method = unwrap(api.put)

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
                method(api, "ds-1", "doc-1")


class TestDocumentStatusApi:
    def test_patch_success(self, app, patch_tenant, patch_dataset):
        api = DocumentStatusApi()
        method = unwrap(api.patch)

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
            response, status = method(api, "ds-1", "enable")

        assert status == 200

    def test_patch_invalid_action(self, app, patch_tenant, patch_dataset):
        api = DocumentStatusApi()
        method = unwrap(api.patch)

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
                method(api, "ds-1", "enable")


class TestDocumentRetryApi:
    def test_retry_archived_document_skipped(self, app, patch_tenant, patch_dataset):
        api = DocumentRetryApi()
        method = unwrap(api.post)

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
        retry_mock.assert_called_once_with("ds-1", [])

    def test_retry_success(self, app, patch_tenant, patch_dataset):
        api = DocumentRetryApi()
        method = unwrap(api.post)

        payload = {"document_ids": ["doc-1"]}

        document = MagicMock(indexing_status="indexing", archived=False)

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
        retry_mock.assert_called_once_with("ds-1", [document])

    def test_retry_skips_completed_document(self, app, patch_tenant, patch_dataset):
        api = DocumentRetryApi()
        method = unwrap(api.post)

        payload = {"document_ids": ["doc-1"]}

        document = MagicMock(indexing_status="completed", archived=False)

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
        retry_mock.assert_called_once_with("ds-1", [])


class TestDocumentPipelineExecutionLogApi:
    def test_get_log_success(self, app, patch_tenant, patch_dataset):
        api = DocumentPipelineExecutionLogApi()
        method = unwrap(api.get)

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
                "controllers.console.datasets.datasets_document.db.session.query",
                return_value=MagicMock(
                    filter_by=lambda **k: MagicMock(order_by=lambda *a: MagicMock(first=lambda: log))
                ),
            ),
        ):
            response, status = method(api, "ds-1", "doc-1")

        assert status == 200


class TestDocumentGenerateSummaryApi:
    def test_generate_summary_missing_documents(self, app, patch_tenant, patch_permission):
        api = DocumentGenerateSummaryApi()
        method = unwrap(api.post)

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
                method(api, "ds-1")

    def test_generate_not_enabled(self, app, patch_tenant, patch_permission):
        api = DocumentGenerateSummaryApi()
        method = unwrap(api.post)

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
                method(api, "ds-1")

    def test_generate_summary_success_with_qa_skip(self, app, patch_tenant, patch_permission):
        api = DocumentGenerateSummaryApi()
        method = unwrap(api.post)

        dataset = MagicMock(
            indexing_technique="high_quality",
            summary_index_setting={"enable": True},
        )

        doc1 = MagicMock(id="doc-1", doc_form="qa_model")
        doc2 = MagicMock(id="doc-2", doc_form="text")

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
            response, status = method(api, "ds-1")

        assert status == 200


class TestDocumentSummaryStatusApi:
    def test_get_success(self, app, patch_tenant, patch_permission):
        api = DocumentSummaryStatusApi()
        method = unwrap(api.get)

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.datasets.datasets_document.DatasetService.get_dataset",
                return_value=MagicMock(),
            ),
            patch(
                "services.summary_index_service.SummaryIndexService.get_document_summary_status_detail",
                return_value={"total_segments": 0},
            ),
        ):
            response, status = method(api, "ds-1", "doc-1")

        assert status == 200


class TestDocumentIndexingEstimateApi:
    def test_indexing_estimate_file_not_found(self, app, patch_tenant):
        api = DocumentIndexingEstimateApi()
        method = unwrap(api.get)

        document = MagicMock(
            indexing_status="indexing",
            data_source_type="upload_file",
            data_source_info_dict={"upload_file_id": "file-1"},
            tenant_id="tenant-1",
            doc_form="text",
            dataset_process_rule=None,
        )

        query_mock = MagicMock()
        query_mock.where.return_value.first.return_value = None

        with (
            app.test_request_context("/"),
            patch.object(api, "get_document", return_value=document),
            patch(
                "controllers.console.datasets.datasets_document.db.session.query",
                return_value=query_mock,
            ),
        ):
            with pytest.raises(NotFound):
                method(api, "ds-1", "doc-1")

    def test_indexing_estimate_generic_exception(self, app, patch_tenant):
        api = DocumentIndexingEstimateApi()
        method = unwrap(api.get)

        document = MagicMock(
            indexing_status="indexing",
            data_source_type="upload_file",
            data_source_info_dict={"upload_file_id": "file-1"},
            tenant_id="tenant-1",
            doc_form="text",
            dataset_process_rule=None,
        )

        upload_file = MagicMock()

        mock_indexing_runner = MagicMock()
        mock_indexing_runner.indexing_estimate.side_effect = RuntimeError("Some indexing error")

        with (
            app.test_request_context("/"),
            patch.object(api, "get_document", return_value=document),
            patch(
                "controllers.console.datasets.datasets_document.db.session.query",
                return_value=MagicMock(
                    where=MagicMock(return_value=MagicMock(first=MagicMock(return_value=upload_file)))
                ),
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
                method(api, "ds-1", "doc-1")

    def test_get_finished(self, app, patch_tenant):
        api = DocumentIndexingEstimateApi()
        method = unwrap(api.get)

        document = MagicMock(indexing_status="completed")

        with app.test_request_context("/"), patch.object(api, "get_document", return_value=document):
            with pytest.raises(DocumentAlreadyFinishedError):
                method(api, "ds-1", "doc-1")


class TestDocumentBatchDownloadZipApi:
    def test_post_no_documents(self, app, patch_tenant):
        api = DocumentBatchDownloadZipApi()
        method = unwrap(api.post)

        payload = {"document_ids": []}

        with app.test_request_context("/", json=payload), patch.object(type(console_ns), "payload", payload):
            with pytest.raises(ValueError):
                method(api, "ds-1")


class TestDatasetDocumentListApiDelete:
    def test_delete_success(self, app, patch_tenant, patch_dataset):
        """Test successful deletion of documents"""
        api = DatasetDocumentListApi()
        method = unwrap(api.delete)

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

    def test_delete_indexing_error(self, app, patch_tenant, patch_dataset):
        """Test deletion with indexing error"""
        api = DatasetDocumentListApi()
        method = unwrap(api.delete)

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

    def test_delete_dataset_not_found(self, app, patch_tenant):
        """Test deletion when dataset not found"""
        api = DatasetDocumentListApi()
        method = unwrap(api.delete)

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
    def test_batch_indexing_estimate_website(self, app, patch_tenant):
        api = DocumentBatchIndexingEstimateApi()
        method = unwrap(api.get)

        doc = MagicMock(
            indexing_status="indexing",
            data_source_type="website_crawl",
            data_source_info_dict={
                "provider": "firecrawl",
                "job_id": "j1",
                "url": "https://x.com",
                "mode": "single",
                "only_main_content": True,
            },
            doc_form="text",
        )

        with (
            app.test_request_context("/"),
            patch.object(api, "get_batch_documents", return_value=[doc]),
            patch(
                "controllers.console.datasets.datasets_document.IndexingRunner.indexing_estimate",
                return_value=MagicMock(model_dump=lambda: {"tokens": 2}),
            ),
        ):
            resp, status = method(api, "ds-1", "batch-1")

        assert status == 200

    def test_batch_indexing_estimate_notion(self, app, patch_tenant):
        api = DocumentBatchIndexingEstimateApi()
        method = unwrap(api.get)

        doc = MagicMock(
            indexing_status="indexing",
            data_source_type="notion_import",
            data_source_info_dict={
                "credential_id": "c1",
                "notion_workspace_id": "w1",
                "notion_page_id": "p1",
                "type": "page",
            },
            doc_form="text",
        )

        with (
            app.test_request_context("/"),
            patch.object(api, "get_batch_documents", return_value=[doc]),
            patch(
                "controllers.console.datasets.datasets_document.IndexingRunner.indexing_estimate",
                return_value=MagicMock(model_dump=lambda: {"tokens": 1}),
            ),
        ):
            resp, status = method(api, "ds-1", "batch-1")

        assert status == 200

    def test_batch_estimate_unsupported_datasource(self, app, patch_tenant):
        api = DocumentBatchIndexingEstimateApi()
        method = unwrap(api.get)

        document = MagicMock(
            indexing_status="indexing",
            data_source_type="unknown",
            data_source_info_dict={},
            doc_form="text",
        )

        with app.test_request_context("/"), patch.object(api, "get_batch_documents", return_value=[document]):
            with pytest.raises(ValueError):
                method(api, "ds-1", "batch-1")

    def test_get_batch_estimate_invalid_batch(self, app, patch_tenant):
        """Test batch estimation with invalid batch"""
        api = DocumentBatchIndexingEstimateApi()
        method = unwrap(api.get)

        with app.test_request_context("/"), patch.object(api, "get_batch_documents", side_effect=NotFound()):
            with pytest.raises(NotFound):
                method(api, "ds-1", "invalid-batch")


class TestDocumentBatchIndexingStatusApi:
    def test_get_batch_status_invalid_batch(self, app, patch_tenant):
        """Test batch status with invalid batch"""
        api = DocumentBatchIndexingStatusApi()
        method = unwrap(api.get)

        with app.test_request_context("/"), patch.object(api, "get_batch_documents", side_effect=NotFound()):
            with pytest.raises(NotFound):
                method(api, "ds-1", "invalid-batch")


class TestDocumentIndexingStatusApi:
    def test_get_status_document_not_found(self, app, patch_tenant):
        """Test getting status for non-existent document"""
        api = DocumentIndexingStatusApi()
        method = unwrap(api.get)

        with app.test_request_context("/"), patch.object(api, "get_document", side_effect=NotFound()):
            with pytest.raises(NotFound):
                method(api, "ds-1", "invalid-doc")


class TestDocumentApiMetadata:
    def test_get_with_only_option(self, app, patch_tenant):
        """Test get with 'only' metadata option"""
        api = DocumentApi()
        method = unwrap(api.get)

        document = MagicMock(dataset_process_rule=None, doc_metadata_details=[])

        with (
            app.test_request_context("/?metadata=only"),
            patch.object(api, "get_document", return_value=document),
            patch(
                "controllers.console.datasets.datasets_document.DatasetService.get_process_rules",
                return_value={},
            ),
        ):
            response, status = method(api, "ds-1", "doc-1")

        assert status == 200

    def test_get_with_without_option(self, app, patch_tenant):
        """Test get with 'without' metadata option"""
        api = DocumentApi()
        method = unwrap(api.get)

        document = MagicMock(dataset_process_rule=None)

        with (
            app.test_request_context("/?metadata=without"),
            patch.object(api, "get_document", return_value=document),
            patch(
                "controllers.console.datasets.datasets_document.DatasetService.get_process_rules",
                return_value={},
            ),
        ):
            response, status = method(api, "ds-1", "doc-1")

        assert status == 200


class TestDocumentGenerateSummaryApiSuccess:
    def test_generate_not_enabled_high_quality(self, app, patch_tenant, patch_permission):
        """Test summary generation on non-high-quality dataset"""
        api = DocumentGenerateSummaryApi()
        method = unwrap(api.post)

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
                method(api, "ds-1")


class TestDocumentProcessingApiResume:
    def test_resume_invalid_status(self, app, patch_tenant):
        """Test resume on non-paused document"""
        api = DocumentProcessingApi()
        method = unwrap(api.patch)

        document = MagicMock(indexing_status="completed", is_paused=False)

        with app.test_request_context("/"), patch.object(api, "get_document", return_value=document):
            with pytest.raises(InvalidActionError):
                method(api, "ds-1", "doc-1", "resume")


class TestDocumentPermissionCases:
    def test_document_batch_get_permission_denied(self, app, patch_tenant):
        api = DocumentBatchIndexingEstimateApi()
        method = unwrap(api.get)

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
                method(api, "ds-1", "batch-1")

    def test_document_batch_get_documents_not_found(self, app, patch_tenant):
        api = DocumentBatchIndexingEstimateApi()
        method = unwrap(api.get)

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
            response, status = method(api, "ds-1", "batch-1")

        assert status == 200
        assert response == {
            "tokens": 0,
            "total_price": 0,
            "currency": "USD",
            "total_segments": 0,
            "preview": [],
        }

    def test_document_tenant_mismatch(self, app):
        api = DocumentApi()
        method = unwrap(api.get)

        user = MagicMock(is_dataset_editor=True)
        document = MagicMock(
            tenant_id="other-tenant",
            dataset_process_rule=None,
        )

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.datasets.datasets_document.current_account_with_tenant",
                return_value=(user, "tenant-1"),
            ),
            patch(
                "controllers.console.datasets.datasets_document.DatasetService.get_dataset",
                return_value=MagicMock(),  # ✅ prevents real DB call
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
                method(api, "ds-1", "doc-1")

    def test_process_rule_get_by_document_success(self, app, patch_tenant):
        api = GetProcessRuleApi()
        method = unwrap(api.get)

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
                "controllers.console.datasets.datasets_document.db.session.query",
                return_value=MagicMock(
                    where=lambda *a: MagicMock(
                        order_by=lambda *b: MagicMock(limit=lambda n: MagicMock(one_or_none=lambda: process_rule))
                    )
                ),
            ),
        ):
            result = method(api)

        if isinstance(result, tuple):
            response, status = result
        else:
            response, status = result, 200

        assert status == 200
        assert response["mode"] == "custom"

    def test_process_rule_permission_denied(self, app):
        api = GetProcessRuleApi()
        method = unwrap(api.get)

        document = MagicMock(dataset_id="ds-1")

        with (
            app.test_request_context("/?document_id=doc-1"),
            patch(
                "controllers.console.datasets.datasets_document.current_account_with_tenant",
                return_value=(MagicMock(is_dataset_editor=True), "tenant-1"),
            ),
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
                method(api)


class TestDocumentListAdvancedCases:
    def test_document_list_with_multiple_sort_options(self, app, patch_tenant, patch_dataset, patch_permission):
        """Test document list with different sort options"""
        api = DatasetDocumentListApi()
        method = unwrap(api.get)

        pagination = MagicMock(items=[MagicMock()], total=1)

        with (
            app.test_request_context("/?sort=updated_at"),
            patch(
                "controllers.console.datasets.datasets_document.db.paginate",
                return_value=pagination,
            ),
            patch(
                "controllers.console.datasets.datasets_document.DocumentService.enrich_documents_with_summary_index_status",
                return_value=None,
            ),
            patch(
                "controllers.console.datasets.datasets_document.marshal",
                return_value=[{"id": "doc-1"}],
            ),
        ):
            response = method(api, "ds-1")

        assert response["total"] == 1

    def test_document_metadata_with_schema_validation(self, app, patch_tenant):
        """Test document metadata update with schema validation"""
        api = DocumentMetadataApi()
        method = unwrap(api.put)

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
            response, status = method(api, "ds-1", "doc-1")

            assert status == 200
            assert doc.doc_metadata == {"amount": 5000, "currency": "USD"}


class TestDocumentIndexingEdgeCases:
    def test_document_indexing_with_extraction_setting(self, app, patch_tenant):
        api = DocumentIndexingEstimateApi()
        method = unwrap(api.get)

        document = MagicMock(
            indexing_status="indexing",
            data_source_type="upload_file",
            data_source_info_dict={"upload_file_id": "file-1"},
            tenant_id="tenant-1",
            doc_form="text",
            dataset_process_rule=None,
        )

        upload_file = MagicMock()

        with (
            app.test_request_context("/"),
            patch.object(api, "get_document", return_value=document),
            patch(
                "controllers.console.datasets.datasets_document.db.session.query",
                return_value=MagicMock(where=lambda *a: MagicMock(first=lambda: upload_file)),
            ),
            patch(
                "controllers.console.datasets.datasets_document.ExtractSetting",
                return_value=MagicMock(),
            ),
            patch(
                "controllers.console.datasets.datasets_document.IndexingRunner.indexing_estimate",
                return_value=MagicMock(model_dump=lambda: {"tokens": 5}),
            ),
        ):
            response, status = method(api, "ds-1", "doc-1")

        assert status == 200
