import datetime as _datasets_document_datetime
import json
from datetime import datetime as _datasets_document_download_datetime
from inspect import unwrap
from io import BytesIO
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, create_autospec, patch
from uuid import UUID
from zipfile import ZipFile

import pytest
from flask import send_file
from sqlalchemy import event
from werkzeug.exceptions import Forbidden, NotFound

from controllers.common.errors import InvalidArgumentError, NotFoundError
from controllers.common.rbac import DatasetByDocument, DatasetId, RBACPermission
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
    ArchivedDocumentImmutableError,
    DatasetAccessDeniedRequestError,
    DocumentAlreadyFinishedError,
    DocumentIndexingError,
    IndexingEstimateError,
    InvalidActionError,
    InvalidMetadataError,
)
from machinery.context import RequestContext
from models.dataset import Dataset, Document
from models.model import UploadFile
from services.knowledge.dataset_access import (
    AccessibleDataset,
    DatasetAccess,
    DatasetAccessDeniedError,
    DatasetNotFoundError,
)
from services.knowledge.documents.adapters import SQLAlchemyDocumentOperations
from services.knowledge.documents.application import (
    DatasetDocumentApplicationService,
    DocumentArchivedError,
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
from tests.helpers.unit.controllers.rbac_introspection import rbac_checks

_DATASETS_DOCUMENT_CONTEXT = RequestContext("request-1", None, "account-1", "tenant-1")
DS = UUID(int=1)
DOC = UUID(int=2)


class TestDatasetsDocumentCases:
    @staticmethod
    @pytest.fixture
    def documents(monkeypatch):
        documents = create_autospec(DatasetDocumentApplicationService, instance=True, spec_set=True)
        monkeypatch.setattr(
            controller, "application_services", lambda: SimpleNamespace(knowledge=SimpleNamespace(documents=documents))
        )
        monkeypatch.setattr(controller, "check_knowledge_rate_limit", lambda: None)
        return documents

    @staticmethod
    def test_process_rule_authorizes_document_dataset_before_read(app, documents):
        with (
            app.test_request_context(f"/?document_id={DOC}"),
            patch.object(controller, "enforce_rbac_checks", side_effect=Forbidden) as enforce_checks,
            pytest.raises(Forbidden),
        ):
            unwrap(GetProcessRuleApi.get)(GetProcessRuleApi(), _DATASETS_DOCUMENT_CONTEXT)

        enforce_checks.assert_called_once()
        kwargs = enforce_checks.call_args.kwargs
        assert kwargs["tenant_id"] == _DATASETS_DOCUMENT_CONTEXT.active_workspace_id
        assert kwargs["account_id"] == _DATASETS_DOCUMENT_CONTEXT.account_id
        assert kwargs["path_args"] == {"document_id": str(DOC)}
        [check] = kwargs["checks"]
        assert check.scene is RBACPermission.DATASET_READONLY
        assert isinstance(check.locator, DatasetByDocument)
        documents.get_process_rule.assert_not_called()

    @staticmethod
    def test_default_process_rule_does_not_require_dataset_permission(app, documents):
        documents.get_process_rule.return_value = {
            "mode": "automatic",
            "rules": {},
            "limits": {"indexing_max_segmentation_tokens_length": 4000},
        }
        with app.test_request_context("/"), patch.object(controller, "enforce_rbac_checks") as enforce_checks:
            unwrap(GetProcessRuleApi.get)(GetProcessRuleApi(), _DATASETS_DOCUMENT_CONTEXT)
        enforce_checks.assert_not_called()
        documents.get_process_rule.assert_called_once_with(_DATASETS_DOCUMENT_CONTEXT, document_id=None)

    @staticmethod
    @pytest.mark.parametrize(
        ("resource", "verb", "operation", "kwargs"),
        [
            (GetProcessRuleApi, GetProcessRuleApi.get, lambda service: service.get_process_rule, {}),
            (
                DatasetDocumentListApi,
                DatasetDocumentListApi.get,
                lambda service: service.list_documents,
                {"dataset_id": DS},
            ),
            (
                DatasetDocumentListApi,
                DatasetDocumentListApi.post,
                lambda service: service.create_documents,
                {"dataset_id": DS},
            ),
            (
                DatasetDocumentListApi,
                DatasetDocumentListApi.delete,
                lambda service: service.delete_documents,
                {"dataset_id": DS},
            ),
            (DatasetInitApi, DatasetInitApi.post, lambda service: service.initialize_dataset, {}),
            (
                DocumentBatchIndexingStatusApi,
                DocumentBatchIndexingStatusApi.get,
                lambda service: service.get_batch_indexing_status,
                {"dataset_id": DS, "batch": "batch-1"},
            ),
            (
                DocumentIndexingStatusApi,
                DocumentIndexingStatusApi.get,
                lambda service: service.get_indexing_status,
                {"dataset_id": DS, "document_id": DOC},
            ),
            (
                DocumentApi,
                DocumentApi.get,
                lambda service: service.get_document,
                {"dataset_id": DS, "document_id": DOC},
            ),
            (
                DocumentApi,
                DocumentApi.delete,
                lambda service: service.delete_document,
                {"dataset_id": DS, "document_id": DOC},
            ),
            (
                DocumentDownloadApi,
                DocumentDownloadApi.get,
                lambda service: service.get_download_url,
                {"dataset_id": DS, "document_id": DOC},
            ),
            (
                DocumentBatchDownloadZipApi,
                DocumentBatchDownloadZipApi.post,
                lambda service: service.build_download_zip,
                {"dataset_id": DS},
            ),
            (
                DocumentProcessingApi,
                DocumentProcessingApi.patch,
                lambda service: service.update_processing,
                {"dataset_id": DS, "document_id": DOC, "action": "pause"},
            ),
            (
                DocumentMetadataApi,
                DocumentMetadataApi.put,
                lambda service: service.update_metadata,
                {
                    "dataset_id": DS,
                    "document_id": DOC,
                    "req_data": DocumentMetadataUpdatePayload(doc_type="book", doc_metadata={"title": "Book"}),
                },
            ),
            (
                DocumentStatusApi,
                DocumentStatusApi.patch,
                lambda service: service.change_status,
                {"dataset_id": DS, "action": "enable"},
            ),
            (
                DocumentPauseApi,
                DocumentPauseApi.patch,
                lambda service: service.pause_document,
                {"dataset_id": DS, "document_id": DOC},
            ),
            (
                DocumentRecoverApi,
                DocumentRecoverApi.patch,
                lambda service: service.recover_document,
                {"dataset_id": DS, "document_id": DOC},
            ),
            (
                DocumentRetryApi,
                DocumentRetryApi.post,
                lambda service: service.retry_documents,
                {"dataset_id": DS, "req_data": DocumentRetryPayload(document_ids=[str(DOC)])},
            ),
            (
                DocumentRenameApi,
                DocumentRenameApi.post,
                lambda service: service.rename_document,
                {"dataset_id": DS, "document_id": DOC, "req_data": DocumentRenamePayload(name="New name")},
            ),
            (
                WebsiteDocumentSyncApi,
                WebsiteDocumentSyncApi.get,
                lambda service: service.sync_website,
                {"dataset_id": DS, "document_id": DOC},
            ),
            (
                DocumentPipelineExecutionLogApi,
                DocumentPipelineExecutionLogApi.get,
                lambda service: service.get_execution_log,
                {"dataset_id": DS, "document_id": DOC},
            ),
            (
                DocumentGenerateSummaryApi,
                DocumentGenerateSummaryApi.post,
                lambda service: service.generate_summary,
                {"dataset_id": DS, "req_data": GenerateSummaryPayload(document_list=[str(DOC)])},
            ),
            (
                DocumentSummaryStatusApi,
                DocumentSummaryStatusApi.get,
                lambda service: service.get_summary_status,
                {"dataset_id": DS, "document_id": DOC},
            ),
        ],
    )
    def test_endpoints_pass_request_context_and_map_application_errors(
        app, documents, resource, verb, operation, kwargs
    ):
        operation(documents).side_effect = DocumentNotFoundError("Document not found.")
        with (
            app.test_request_context(
                "/?document_id=" + str(DOC), json={"indexing_technique": "economy", "document_ids": [str(DOC)]}
            ),
            pytest.raises(NotFound),
        ):
            unwrap(verb)(resource(), request_context=_DATASETS_DOCUMENT_CONTEXT, **kwargs)
        called = operation(documents)
        assert called.call_count == 1
        assert called.call_args.args == (_DATASETS_DOCUMENT_CONTEXT,)
        if "dataset_id" in kwargs:
            assert called.call_args.kwargs["dataset_id"] == str(DS)
        if "document_id" in kwargs:
            assert called.call_args.kwargs["document_id"] == str(DOC)

    @staticmethod
    @pytest.mark.parametrize(
        ("fetch", "expected"), [("true", True), ("YES", True), ("false", False), ("invalid", False)]
    )
    def test_list_preserves_filters_pagination_and_fetch_parsing(app, documents, fetch, expected):
        documents.list_documents.return_value = {"data": [], "has_more": False, "page": 2, "limit": 3, "total": 3}
        with app.test_request_context(f"/?page=2&limit=3&keyword=needle&status=available&sort=hit_count&fetch={fetch}"):
            response = unwrap(DatasetDocumentListApi.get)(DatasetDocumentListApi(), _DATASETS_DOCUMENT_CONTEXT, DS)
        documents.list_documents.assert_called_once_with(
            _DATASETS_DOCUMENT_CONTEXT,
            dataset_id=str(DS),
            query=DocumentListFilter(
                page=2, limit=3, search="needle", status="available", sort="hit_count", fetch=expected
            ),
        )
        assert response == {"data": [], "has_more": False, "page": 2, "limit": 3, "total": 3}

    @staticmethod
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
            response, status = unwrap(DocumentApi.get)(DocumentApi(), _DATASETS_DOCUMENT_CONTEXT, DS, DOC)
        assert status == 200
        documents.get_document.assert_called_once_with(
            _DATASETS_DOCUMENT_CONTEXT, dataset_id=str(DS), document_id=str(DOC), metadata_only=metadata == "only"
        )
        if metadata == "only":
            assert response == {"id": str(DOC), "doc_type": "others", "doc_metadata": []}
        else:
            assert response["data_source_info"] == {"file_path": "/path/to/local/file"}
            assert ("doc_metadata" in response) is (metadata == "all")

    @staticmethod
    def test_invalid_metadata_fails_before_application_call(app, documents):
        with app.test_request_context("/?metadata=invalid"), pytest.raises(InvalidMetadataError):
            unwrap(DocumentApi.get)(DocumentApi(), _DATASETS_DOCUMENT_CONTEXT, DS, DOC)
        documents.get_document.assert_not_called()

    @staticmethod
    @pytest.mark.parametrize(
        ("resource", "verb", "kwargs"),
        [
            (DocumentApi, DocumentApi.delete, {"document_id": DOC}),
            (DatasetDocumentListApi, DatasetDocumentListApi.delete, {}),
            (DocumentPauseApi, DocumentPauseApi.patch, {"document_id": DOC}),
            (DocumentRecoverApi, DocumentRecoverApi.patch, {"document_id": DOC}),
            (DocumentRetryApi, DocumentRetryApi.post, {"req_data": DocumentRetryPayload(document_ids=[str(DOC)])}),
        ],
    )
    @pytest.mark.usefixtures("documents")
    def test_no_content_mutations_return_empty_204(app, resource, verb, kwargs):
        with app.test_request_context("/?document_id=" + str(DOC)):
            result = unwrap(verb)(resource(), request_context=_DATASETS_DOCUMENT_CONTEXT, dataset_id=DS, **kwargs)
        assert result == ("", 204)

    @staticmethod
    @pytest.mark.parametrize(
        ("resource", "verb", "operation", "kwargs"),
        [
            (
                DocumentProcessingApi,
                DocumentProcessingApi.patch,
                lambda service: service.update_processing,
                {"document_id": DOC, "action": "resume"},
            ),
            (DocumentStatusApi, DocumentStatusApi.patch, lambda service: service.change_status, {"action": "disable"}),
            (
                WebsiteDocumentSyncApi,
                WebsiteDocumentSyncApi.get,
                lambda service: service.sync_website,
                {"document_id": DOC},
            ),
            (
                DocumentGenerateSummaryApi,
                DocumentGenerateSummaryApi.post,
                lambda service: service.generate_summary,
                {"req_data": GenerateSummaryPayload(document_list=[str(DOC)])},
            ),
        ],
    )
    def test_success_mutations_return_success_response(app, documents, resource, verb, operation, kwargs):
        with app.test_request_context("/?document_id=" + str(DOC)):
            result = unwrap(verb)(resource(), request_context=_DATASETS_DOCUMENT_CONTEXT, dataset_id=DS, **kwargs)
        assert result == ({"result": "success"}, 200)
        assert operation(documents).call_count == 1

    @staticmethod
    @pytest.mark.parametrize("resource", [DatasetInitApi, DatasetDocumentListApi])
    def test_creation_serializes_materialized_dataset_and_documents(app, documents, resource):
        operation = documents.initialize_dataset if resource is DatasetInitApi else documents.create_documents
        operation.return_value = {
            "dataset": {
                "id": str(DS),
                "name": "Dataset",
                "created_at": _datasets_document_datetime.datetime(2024, 1, 1, tzinfo=_datasets_document_datetime.UTC),
            },
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
                resource(),
                request_context=_DATASETS_DOCUMENT_CONTEXT,
                **({} if resource is DatasetInitApi else {"dataset_id": DS}),
            )
        assert response["dataset"]["created_at"] == 1704067200
        assert response["documents"][0]["data_source_info"] == {}
        assert response["documents"][0]["doc_metadata"] == []
        assert response["batch"] == "batch-1"

    @staticmethod
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
        value["processing_started_at"] = _datasets_document_datetime.datetime(
            2024, 1, 1, tzinfo=_datasets_document_datetime.UTC
        )
        batch = resource is DocumentBatchIndexingStatusApi
        operation = documents.get_batch_indexing_status if batch else documents.get_indexing_status
        operation.return_value = {"data": [value]} if batch else value
        with app.test_request_context("/"):
            response = unwrap(resource.get)(
                resource(),
                request_context=_DATASETS_DOCUMENT_CONTEXT,
                dataset_id=DS,
                **({"batch": "batch-1"} if batch else {"document_id": DOC}),
            )
        row = response["data"][0] if batch else response
        assert row["indexing_status"] == "paused"
        assert row["processing_started_at"] == 1704067200
        assert row["completed_segments"] == 2
        assert row["total_segments"] == 3

    @staticmethod
    @pytest.mark.parametrize(
        ("translate", "error", "http_error"),
        [
            (controller._raise_document_error, DatasetNotFoundError(), NotFound),
            (controller._raise_document_error, DocumentNotFoundError("missing"), NotFound),
            (controller._raise_document_error, DatasetAccessDeniedError(), Forbidden),
            (controller._raise_document_indexing_error, DocumentIndexingStateError("indexing"), DocumentIndexingError),
            (
                controller._raise_document_indexing_error,
                DocumentProviderError("provider", kind="uninitialized"),
                ProviderNotInitializeError,
            ),
            (controller._raise_document_action_error, DocumentInvalidActionError("invalid"), InvalidActionError),
            (controller._raise_document_status_error, DocumentInvalidActionError("invalid"), InvalidActionError),
            (controller._raise_document_status_error, DocumentIndexingStateError("indexing"), DocumentIndexingError),
            (controller._raise_document_archive_error, DocumentArchivedError(), ArchivedDocumentImmutableError),
            (controller._raise_document_archive_error, DocumentIndexingStateError("indexing"), DocumentIndexingError),
            # Every narrow translator falls back to the shared scope mapping.
            (controller._raise_document_archive_error, DatasetNotFoundError(), NotFound),
        ],
    )
    def test_document_errors_are_mapped_at_transport_boundary(translate, error, http_error):
        with pytest.raises(http_error):
            translate(error)

    @staticmethod
    def test_scope_translator_does_not_map_other_operations_errors():
        error = DocumentInvalidActionError("invalid")
        with pytest.raises(DocumentInvalidActionError) as raised:
            controller._raise_document_error(error)
        assert raised.value is error

    @staticmethod
    def test_unexpected_error_is_not_hidden():
        error = RuntimeError("unexpected")
        with pytest.raises(RuntimeError) as raised:
            controller._raise_document_error(error)
        assert raised.value is error

    class TestIndexingEstimateExceptionMapping:
        @staticmethod
        def _registry(method_name: str, error: Exception) -> SimpleNamespace:
            estimates = MagicMock()
            method = estimates.estimate_document if method_name == "estimate_document" else estimates.estimate_batch
            method.side_effect = error
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

            with (
                patch(
                    "controllers.console.datasets.datasets_document.application_services",
                    return_value=registry,
                ),
                pytest.raises(expected_http_error),
            ):
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

            with (
                patch(
                    "controllers.console.datasets.datasets_document.application_services",
                    return_value=registry,
                ),
                pytest.raises(expected_http_error),
            ):
                method(api, context, UUID(int=1), "unknown-batch")

    @staticmethod
    @pytest.mark.parametrize(
        "method",
        [
            DatasetDocumentListApi.get,
            DocumentBatchIndexingStatusApi.get,
            DocumentIndexingStatusApi.get,
            DocumentApi.get,
            DocumentPipelineExecutionLogApi.get,
            DocumentSummaryStatusApi.get,
        ],
    )
    def test_document_read_routes_require_dataset_readonly_permission(method) -> None:
        [check] = rbac_checks(method)

        assert check.scene is RBACPermission.DATASET_READONLY
        assert isinstance(check.locator, DatasetId)

    @staticmethod
    @pytest.mark.parametrize(
        "method",
        [DocumentIndexingEstimateApi.get, DocumentBatchIndexingEstimateApi.get],
    )
    def test_document_indexing_estimates_require_dataset_use_permission(method) -> None:
        [check] = rbac_checks(method)

        assert check.scene is RBACPermission.DATASET_USE
        assert isinstance(check.locator, DatasetId)

    @staticmethod
    @pytest.mark.parametrize(
        ("method", "expected_scene"),
        [
            (DatasetDocumentListApi.post, RBACPermission.DATASET_USE),
            (DatasetDocumentListApi.delete, RBACPermission.DATASET_DELETE_FILE),
            (DocumentApi.delete, RBACPermission.DATASET_DELETE_FILE),
            (DocumentBatchDownloadZipApi.post, RBACPermission.DATASET_DOCUMENT_DOWNLOAD),
        ],
    )
    def test_document_mutation_routes_require_operation_specific_permissions(method, expected_scene) -> None:
        [check] = rbac_checks(method)

        assert check.scene is expected_scene
        assert isinstance(check.locator, DatasetId)


"""Document downloads through the controller, application service, and SQLite adapter."""


_DATASETS_DOCUMENT_DOWNLOAD_CONTEXT = RequestContext("request-1", None, "actor-1", "tenant-1")
DOC_ID = str(UUID(int=1))
FILE_ID = str(UUID(int=2))


def _document(**values):
    return Document(
        **{
            "id": DOC_ID,
            "tenant_id": "tenant-1",
            "dataset_id": "dataset-1",
            "position": 1,
            "data_source_type": "upload_file",
            "data_source_info": json.dumps({"upload_file_id": FILE_ID}),
            "batch": "batch-1",
            "name": "document.txt",
            "created_from": "web",
            "created_by": "actor-1",
            **values,
        }
    )


class TestDatasetsDocumentDownloadCases:
    @staticmethod
    @pytest.fixture(autouse=True)
    def downloads(monkeypatch, sqlite_session_factory):
        with sqlite_session_factory.begin() as session:
            session.add(Dataset(id="dataset-1", tenant_id="tenant-1", name="Dataset", created_by="actor-1"))
            session.add(_document())
            upload = UploadFile(
                tenant_id="tenant-1",
                storage_type="local",
                key="key-1",
                name="document.txt",
                size=5,
                extension="txt",
                mime_type="text/plain",
                created_by_role="account",
                created_by="actor-1",
                created_at=_datasets_document_download_datetime(2024, 1, 1),
                used=False,
            )
            upload.id = FILE_ID
            session.add(upload)
        access = create_autospec(DatasetAccess, instance=True, spec_set=True)
        access.require_accessible.return_value = AccessibleDataset("dataset-1", "tenant-1")
        documents = DatasetDocumentApplicationService(
            dataset_access=access,
            operations=SQLAlchemyDocumentOperations(session_factory=sqlite_session_factory),
            metadata_schema={},
        )
        monkeypatch.setattr(
            controller, "application_services", lambda: SimpleNamespace(knowledge=SimpleNamespace(documents=documents))
        )
        return documents

    @staticmethod
    def test_document_download_returns_signed_url(app, monkeypatch):
        from services.knowledge import dataset_service

        signed = []

        def sign(**kwargs):
            signed.append(kwargs)
            return "https://files.example/download"

        monkeypatch.setattr(dataset_service.file_helpers, "get_signed_file_url", sign)
        with app.test_request_context("/"):
            result = unwrap(controller.DocumentDownloadApi.get)(
                controller.DocumentDownloadApi(), _DATASETS_DOCUMENT_DOWNLOAD_CONTEXT, "dataset-1", DOC_ID
            )
        assert result == {"url": "https://files.example/download"}
        assert signed == [{"upload_file_id": FILE_ID, "as_attachment": True}]

    @staticmethod
    @pytest.mark.parametrize(
        "values",
        [
            {"data_source_type": "website_crawl"},
            {"data_source_info": "{}"},
            {"data_source_info": json.dumps({"upload_file_id": "missing"})},
            {"tenant_id": "foreign"},
            {"dataset_id": "foreign"},
        ],
    )
    def test_invalid_or_foreign_document_is_not_downloadable(app, sqlite_session_factory, values):
        with sqlite_session_factory.begin() as session:
            document = session.get(Document, DOC_ID)
            for key, value in values.items():
                setattr(document, key, value)
        with app.test_request_context("/"), pytest.raises(NotFound):
            unwrap(controller.DocumentDownloadApi.get)(
                controller.DocumentDownloadApi(), _DATASETS_DOCUMENT_DOWNLOAD_CONTEXT, "dataset-1", DOC_ID
            )

    @staticmethod
    def test_cross_tenant_upload_file_is_not_signed(app, sqlite_session_factory):
        with sqlite_session_factory.begin() as session:
            session.get(UploadFile, FILE_ID).tenant_id = "foreign"
        with app.test_request_context("/"), pytest.raises(NotFound):
            unwrap(controller.DocumentDownloadApi.get)(
                controller.DocumentDownloadApi(), _DATASETS_DOCUMENT_DOWNLOAD_CONTEXT, "dataset-1", DOC_ID
            )

    @staticmethod
    def test_zip_is_readable_and_cleanup_waits_for_response_close(app, monkeypatch, sqlite_engine):
        from services import file_service

        paths = []
        checked_out = set()

        def checkout(_connection, record, _proxy):
            checked_out.add(record)

        def checkin(_connection, record):
            checked_out.discard(record)

        def load(key, *, stream):
            assert not checked_out, "storage I/O must run after the read transaction closes"
            assert key == "key-1"
            assert stream is True
            return iter([b"hello"])

        def send(path, **kwargs):
            paths.append(Path(path))
            return send_file(path, **kwargs)

        monkeypatch.setattr(file_service.storage, "load", load)
        monkeypatch.setattr(controller, "send_file", send)
        event.listen(sqlite_engine, "checkout", checkout)
        event.listen(sqlite_engine, "checkin", checkin)
        try:
            with app.test_request_context("/", json={"document_ids": [DOC_ID]}):
                response = unwrap(controller.DocumentBatchDownloadZipApi.post)(
                    controller.DocumentBatchDownloadZipApi(), _DATASETS_DOCUMENT_DOWNLOAD_CONTEXT, "dataset-1"
                )
                assert paths[0].exists()
                response.direct_passthrough = False
                with ZipFile(BytesIO(response.get_data())) as archive:
                    assert archive.read("document.txt") == b"hello"
                response.close()
            assert not paths[0].exists()
        finally:
            event.remove(sqlite_engine, "checkout", checkout)
            event.remove(sqlite_engine, "checkin", checkin)

    @staticmethod
    def test_zip_cleanup_when_response_creation_fails(app, monkeypatch):
        from services import file_service

        paths = []
        monkeypatch.setattr(file_service.storage, "load", lambda *_args, **_kwargs: iter([b"hello"]))

        def fail_send(path, **_kwargs):
            paths.append(Path(path))
            raise RuntimeError("response failed")

        monkeypatch.setattr(controller, "send_file", fail_send)
        with (
            app.test_request_context("/", json={"document_ids": [DOC_ID]}),
            pytest.raises(RuntimeError, match="response failed"),
        ):
            unwrap(controller.DocumentBatchDownloadZipApi.post)(
                controller.DocumentBatchDownloadZipApi(), _DATASETS_DOCUMENT_DOWNLOAD_CONTEXT, "dataset-1"
            )
        assert paths
        assert not paths[0].exists()

    @staticmethod
    def test_zip_rejects_non_upload_document(app, sqlite_session_factory):
        with sqlite_session_factory.begin() as session:
            session.get(Document, DOC_ID).data_source_type = "website_crawl"
        with app.test_request_context("/", json={"document_ids": [DOC_ID]}), pytest.raises(NotFound):
            unwrap(controller.DocumentBatchDownloadZipApi.post)(
                controller.DocumentBatchDownloadZipApi(), _DATASETS_DOCUMENT_DOWNLOAD_CONTEXT, "dataset-1"
            )
