import datetime
from inspect import unwrap
from types import SimpleNamespace
from unittest.mock import MagicMock, create_autospec, patch
from uuid import UUID

import pytest
from werkzeug.exceptions import Forbidden, NotFound

from controllers.common.errors import InvalidArgumentError, NotFoundError
from controllers.console.app.error import ProviderNotInitializeError
from controllers.console.datasets import datasets_document as controller
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
    DocumentMetadataUpdatePayload,
    DocumentPauseApi,
    DocumentPipelineExecutionLogApi,
    DocumentProcessingApi,
    DocumentRecoverApi,
    DocumentRenameApi,
    DocumentRenamePayload,
    DocumentRetryApi,
    DocumentRetryPayload,
    DocumentStatusApi,
    DocumentSummaryStatusApi,
    GenerateSummaryPayload,
    GetProcessRuleApi,
    WebsiteDocumentSyncApi,
)
from controllers.console.datasets.error import (
    DatasetAccessDeniedRequestError,
    DocumentAlreadyFinishedError,
    DocumentIndexingError,
    IndexingEstimateError,
    InvalidActionError,
    InvalidMetadataError,
)
from machinery.context import RequestContext
from services.knowledge.dataset_access import DatasetAccessDeniedError, DatasetNotFoundError
from services.knowledge.documents.application import (
    DatasetDocumentApplicationService,
    DocumentIndexingStateError,
    DocumentInvalidActionError,
    DocumentListFilter,
    DocumentNotFoundError,
    DocumentProviderError,
)
from services.knowledge.indexing.estimate import (
    EstimateDocumentAlreadyFinishedError,
    EstimateDocumentNotFoundError,
    EstimateSourceNotFoundError,
    IndexingEstimateCredentialUnavailableError,
    IndexingEstimateExecutionError,
    IndexingEstimateProviderUnavailableError,
    UnsupportedEstimateSourceError,
)

CONTEXT = RequestContext("request-1", None, "account-1", "tenant-1")
DS = UUID(int=1)
DOC = UUID(int=2)


@pytest.fixture
def documents(monkeypatch):
    documents = create_autospec(DatasetDocumentApplicationService, instance=True, spec_set=True)
    monkeypatch.setattr(
        controller, "application_services", lambda: SimpleNamespace(knowledge=SimpleNamespace(documents=documents))
    )
    monkeypatch.setattr(controller, "check_knowledge_rate_limit", lambda: None)
    return documents


@pytest.mark.parametrize(
    ("resource", "verb", "operation", "kwargs"),
    [
        (GetProcessRuleApi, "get", "get_process_rule", {}),
        (DatasetDocumentListApi, "get", "list_documents", {"dataset_id": DS}),
        (DatasetDocumentListApi, "post", "create_documents", {"dataset_id": DS}),
        (DatasetDocumentListApi, "delete", "delete_documents", {"dataset_id": DS}),
        (DatasetInitApi, "post", "initialize_dataset", {}),
        (DocumentBatchIndexingStatusApi, "get", "get_batch_indexing_status", {"dataset_id": DS, "batch": "batch-1"}),
        (DocumentIndexingStatusApi, "get", "get_indexing_status", {"dataset_id": DS, "document_id": DOC}),
        (DocumentApi, "get", "get_document", {"dataset_id": DS, "document_id": DOC}),
        (DocumentApi, "delete", "delete_document", {"dataset_id": DS, "document_id": DOC}),
        (DocumentDownloadApi, "get", "get_download_url", {"dataset_id": DS, "document_id": DOC}),
        (DocumentBatchDownloadZipApi, "post", "build_download_zip", {"dataset_id": DS}),
        (
            DocumentProcessingApi,
            "patch",
            "update_processing",
            {"dataset_id": DS, "document_id": DOC, "action": "pause"},
        ),
        (
            DocumentMetadataApi,
            "put",
            "update_metadata",
            {
                "dataset_id": DS,
                "document_id": DOC,
                "req_data": DocumentMetadataUpdatePayload(doc_type="book", doc_metadata={"title": "Book"}),
            },
        ),
        (DocumentStatusApi, "patch", "change_status", {"dataset_id": DS, "action": "enable"}),
        (DocumentPauseApi, "patch", "pause_document", {"dataset_id": DS, "document_id": DOC}),
        (DocumentRecoverApi, "patch", "recover_document", {"dataset_id": DS, "document_id": DOC}),
        (
            DocumentRetryApi,
            "post",
            "retry_documents",
            {"dataset_id": DS, "req_data": DocumentRetryPayload(document_ids=[str(DOC)])},
        ),
        (
            DocumentRenameApi,
            "post",
            "rename_document",
            {"dataset_id": DS, "document_id": DOC, "req_data": DocumentRenamePayload(name="New name")},
        ),
        (WebsiteDocumentSyncApi, "get", "sync_website", {"dataset_id": DS, "document_id": DOC}),
        (DocumentPipelineExecutionLogApi, "get", "get_execution_log", {"dataset_id": DS, "document_id": DOC}),
        (
            DocumentGenerateSummaryApi,
            "post",
            "generate_summary",
            {"dataset_id": DS, "req_data": GenerateSummaryPayload(document_list=[str(DOC)])},
        ),
        (DocumentSummaryStatusApi, "get", "get_summary_status", {"dataset_id": DS, "document_id": DOC}),
    ],
)
def test_endpoints_pass_request_context_and_map_application_errors(app, documents, resource, verb, operation, kwargs):
    getattr(documents, operation).side_effect = DocumentNotFoundError("Document not found.")
    with app.test_request_context(
        "/?document_id=" + str(DOC), json={"indexing_technique": "economy", "document_ids": [str(DOC)]}
    ):
        with pytest.raises(NotFound):
            unwrap(getattr(resource, verb))(resource(), request_context=CONTEXT, **kwargs)
    called = getattr(documents, operation)
    assert called.call_count == 1
    assert called.call_args.args == (CONTEXT,)
    if "dataset_id" in kwargs:
        assert called.call_args.kwargs["dataset_id"] == str(DS)
    if "document_id" in kwargs:
        assert called.call_args.kwargs["document_id"] == str(DOC)


@pytest.mark.parametrize(("fetch", "expected"), [("true", True), ("YES", True), ("false", False), ("invalid", False)])
def test_list_preserves_filters_pagination_and_fetch_parsing(app, documents, fetch, expected):
    documents.list_documents.return_value = {"data": [], "has_more": False, "page": 2, "limit": 3, "total": 3}
    with app.test_request_context(f"/?page=2&limit=3&keyword=needle&status=available&sort=hit_count&fetch={fetch}"):
        response = unwrap(DatasetDocumentListApi.get)(DatasetDocumentListApi(), CONTEXT, DS)
    documents.list_documents.assert_called_once_with(
        CONTEXT,
        dataset_id=str(DS),
        query=DocumentListFilter(
            page=2, limit=3, search="needle", status="available", sort="hit_count", fetch=expected
        ),
    )
    assert response == {"data": [], "has_more": False, "page": 2, "limit": 3, "total": 3}


@pytest.mark.parametrize("metadata", ["only", "without", "all"])
def test_document_detail_metadata_projection_and_raw_source(app, documents, metadata):
    documents.get_document.return_value = {
        "id": str(DOC),
        "doc_type": "others",
        "doc_metadata": [],
        "name": "Name",
        "data_source_info": {"file_path": "/path/to/local/file"},
        "data_source_detail_dict": {},
    }
    with app.test_request_context(f"/?metadata={metadata}"):
        response, status = unwrap(DocumentApi.get)(DocumentApi(), CONTEXT, DS, DOC)
    assert status == 200
    documents.get_document.assert_called_once_with(
        CONTEXT, dataset_id=str(DS), document_id=str(DOC), metadata_only=metadata == "only"
    )
    if metadata == "only":
        assert response == {"id": str(DOC), "doc_type": "others", "doc_metadata": []}
    else:
        assert response["data_source_info"] == {"file_path": "/path/to/local/file"}
        assert ("doc_metadata" in response) is (metadata == "all")


def test_invalid_metadata_fails_before_application_call(app, documents):
    with app.test_request_context("/?metadata=invalid"), pytest.raises(InvalidMetadataError):
        unwrap(DocumentApi.get)(DocumentApi(), CONTEXT, DS, DOC)
    documents.get_document.assert_not_called()


@pytest.mark.parametrize(
    ("resource", "verb", "kwargs"),
    [
        (DocumentApi, "delete", {"document_id": DOC}),
        (DatasetDocumentListApi, "delete", {}),
        (DocumentPauseApi, "patch", {"document_id": DOC}),
        (DocumentRecoverApi, "patch", {"document_id": DOC}),
        (DocumentRetryApi, "post", {"req_data": DocumentRetryPayload(document_ids=[str(DOC)])}),
    ],
)
@pytest.mark.usefixtures("documents")
def test_no_content_mutations_return_empty_204(app, resource, verb, kwargs):
    with app.test_request_context("/?document_id=" + str(DOC)):
        result = unwrap(getattr(resource, verb))(resource(), request_context=CONTEXT, dataset_id=DS, **kwargs)
    assert result == ("", 204)


@pytest.mark.parametrize(
    ("resource", "verb", "operation", "kwargs"),
    [
        (DocumentProcessingApi, "patch", "update_processing", {"document_id": DOC, "action": "resume"}),
        (DocumentStatusApi, "patch", "change_status", {"action": "disable"}),
        (WebsiteDocumentSyncApi, "get", "sync_website", {"document_id": DOC}),
        (
            DocumentGenerateSummaryApi,
            "post",
            "generate_summary",
            {"req_data": GenerateSummaryPayload(document_list=[str(DOC)])},
        ),
    ],
)
def test_success_mutations_return_success_response(app, documents, resource, verb, operation, kwargs):
    with app.test_request_context("/?document_id=" + str(DOC)):
        result = unwrap(getattr(resource, verb))(resource(), request_context=CONTEXT, dataset_id=DS, **kwargs)
    assert result == ({"result": "success"}, 200)
    assert getattr(documents, operation).call_count == 1


@pytest.mark.parametrize("resource", [DatasetInitApi, DatasetDocumentListApi])
def test_creation_serializes_materialized_dataset_and_documents(app, documents, resource):
    operation = documents.initialize_dataset if resource is DatasetInitApi else documents.create_documents
    operation.return_value = {
        "dataset": {"id": str(DS), "name": "Dataset", "created_at": datetime.datetime(2024, 1, 1, tzinfo=datetime.UTC)},
        "documents": [
            {
                "id": str(DOC),
                "name": "Document",
                "data_source_detail_dict": {},
                "data_source_info_dict": {},
                "doc_metadata_details": [],
            }
        ],
        "batch": "batch-1",
    }
    with app.test_request_context("/", json={"indexing_technique": "economy"}):
        response = unwrap(resource.post)(
            resource(), request_context=CONTEXT, **({} if resource is DatasetInitApi else {"dataset_id": DS})
        )
    assert response["dataset"]["created_at"] == 1704067200
    assert response["documents"][0]["data_source_info"] == {}
    assert response["documents"][0]["doc_metadata"] == []
    assert response["batch"] == "batch-1"


@pytest.mark.parametrize("resource", [DocumentIndexingStatusApi, DocumentBatchIndexingStatusApi])
def test_indexing_status_keeps_timestamps_counts_and_error_fields(app, documents, resource):
    value = {
        "id": str(DOC),
        "indexing_status": "paused",
        "completed_segments": 2,
        "total_segments": 3,
        **dict.fromkeys(
            (
                "processing_started_at",
                "parsing_completed_at",
                "cleaning_completed_at",
                "splitting_completed_at",
                "completed_at",
                "paused_at",
                "error",
                "stopped_at",
            )
        ),
    }
    value["processing_started_at"] = datetime.datetime(2024, 1, 1, tzinfo=datetime.UTC)
    batch = resource is DocumentBatchIndexingStatusApi
    operation = documents.get_batch_indexing_status if batch else documents.get_indexing_status
    operation.return_value = {"data": [value]} if batch else value
    with app.test_request_context("/"):
        response = unwrap(resource.get)(
            resource(),
            request_context=CONTEXT,
            dataset_id=DS,
            **({"batch": "batch-1"} if batch else {"document_id": DOC}),
        )
    row = response["data"][0] if batch else response
    assert row["indexing_status"] == "paused"
    assert row["processing_started_at"] == 1704067200
    assert row["completed_segments"] == 2
    assert row["total_segments"] == 3


@pytest.mark.parametrize(
    ("error", "http_error"),
    [
        (DatasetNotFoundError(), NotFound),
        (DocumentNotFoundError("missing"), NotFound),
        (DatasetAccessDeniedError(), Forbidden),
        (DocumentIndexingStateError("indexing"), DocumentIndexingError),
        (DocumentInvalidActionError("invalid"), InvalidActionError),
        (DocumentProviderError("provider", kind="uninitialized"), ProviderNotInitializeError),
    ],
)
def test_document_errors_are_mapped_at_transport_boundary(error, http_error):
    with pytest.raises(http_error):
        controller._raise_document_error(error)


def test_unexpected_error_is_not_hidden():
    error = RuntimeError("unexpected")
    with pytest.raises(RuntimeError) as raised:
        controller._raise_document_error(error)
    assert raised.value is error


class TestIndexingEstimateExceptionMapping:
    @staticmethod
    def _registry(method_name: str, error: Exception) -> SimpleNamespace:
        estimates = MagicMock()
        getattr(estimates, method_name).side_effect = error
        return SimpleNamespace(knowledge=SimpleNamespace(indexing_estimates=estimates))

    @pytest.mark.parametrize(
        ("error", "expected_http_error"),
        [
            (DatasetNotFoundError(), NotFoundError),
            (EstimateDocumentNotFoundError(), NotFoundError),
            (EstimateSourceNotFoundError("source-1"), NotFoundError),
            (IndexingEstimateCredentialUnavailableError(), NotFoundError),
            (DatasetAccessDeniedError(), DatasetAccessDeniedRequestError),
            (EstimateDocumentAlreadyFinishedError(), DocumentAlreadyFinishedError),
            (UnsupportedEstimateSourceError("unsupported"), InvalidArgumentError),
            (IndexingEstimateProviderUnavailableError(), ProviderNotInitializeError),
            (IndexingEstimateExecutionError(), IndexingEstimateError),
        ],
    )
    def test_document_estimate_maps_application_errors(
        self,
        error: Exception,
        expected_http_error: type[Exception],
    ) -> None:
        api = DocumentIndexingEstimateApi()
        method = unwrap(api.get)
        context = RequestContext("request-1", None, "account-1", "workspace-1")
        registry = self._registry("estimate_document", error)

        with patch(
            "controllers.console.datasets.datasets_document.application_services",
            return_value=registry,
        ):
            with pytest.raises(expected_http_error):
                method(api, context, UUID(int=1), UUID(int=2))

    @pytest.mark.parametrize(
        ("error", "expected_http_error"),
        [
            (DatasetNotFoundError(), NotFoundError),
            (EstimateDocumentNotFoundError(), NotFoundError),
            (EstimateSourceNotFoundError("source-1"), NotFoundError),
            (IndexingEstimateCredentialUnavailableError(), NotFoundError),
            (DatasetAccessDeniedError(), DatasetAccessDeniedRequestError),
            (EstimateDocumentAlreadyFinishedError(), DocumentAlreadyFinishedError),
            (UnsupportedEstimateSourceError("unsupported"), InvalidArgumentError),
            (IndexingEstimateProviderUnavailableError(), ProviderNotInitializeError),
            (IndexingEstimateExecutionError(), IndexingEstimateError),
        ],
    )
    def test_batch_estimate_maps_application_errors(
        self,
        error: Exception,
        expected_http_error: type[Exception],
    ) -> None:
        api = DocumentBatchIndexingEstimateApi()
        method = unwrap(api.get)
        context = RequestContext("request-1", None, "account-1", "workspace-1")
        registry = self._registry("estimate_batch", error)

        with patch(
            "controllers.console.datasets.datasets_document.application_services",
            return_value=registry,
        ):
            with pytest.raises(expected_http_error):
                method(api, context, UUID(int=1), "unknown-batch")
