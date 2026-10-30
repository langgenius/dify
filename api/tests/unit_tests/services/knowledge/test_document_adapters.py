import json
from dataclasses import dataclass
from datetime import datetime
from typing import NoReturn
from unittest.mock import create_autospec, patch

import pytest
from sqlalchemy.orm import Session, sessionmaker

from core.errors.error import ModelCurrentlyNotSupportError, ProviderTokenNotInitError, QuotaExceededError
from core.rag.index_processor.constant.index_type import IndexStructureType
from enums.creator import CreatorUserRole
from machinery.context import RequestContext
from models.dataset import Dataset, DatasetProcessRule, Document
from models.enums import DataSourceType, DocumentCreatedFrom, IndexingStatus, ProcessRuleMode
from repositories.knowledge.document_repository import SQLAlchemyDocumentRepository
from services.entities.upload_file import FileUploadActor
from services.errors.file import FileTooLargeError
from services.file_adapters import build_file_service
from services.file_service import FileService
from services.knowledge.documents import adapters as document_adapters
from services.knowledge.documents.adapters import (
    CeleryDocumentTaskDispatcher,
    DocumentModelConfigurationAdapter,
    DocumentUploadAdapter,
    SQLAlchemyDocumentOperations,
)
from services.knowledge.documents.application import (
    DocumentListFilter,
    DocumentModelConfigurationGateway,
    DocumentNotFoundError,
    DocumentProviderError,
    DocumentUploadError,
)
from services.knowledge.documents.contracts import DocumentBatchCleanupJob, DocumentCleanupJob, DocumentIndexingJobs
from services.knowledge.entities.model_configuration import DatasetModelConfiguration, EmbeddingModelConfiguration
from services.knowledge.entities.resource_scope import DatasetRef
from tests.helpers.unit.model_factories import make_tenant, make_upload_file

REF = DatasetRef("tenant-1", "dataset-1")


def test_document_cleanup_preserves_legacy_single_task_arguments() -> None:
    cleanup = DocumentCleanupJob("document-1", "dataset-1", "text_model", "file-1")

    with patch("tasks.clean_document_task.clean_document_task.delay") as task:
        CeleryDocumentTaskDispatcher().cleanup(REF, cleanup)

    task.assert_called_once_with("document-1", "dataset-1", "text_model", "file-1")


def test_document_cleanup_preserves_legacy_batch_task_arguments() -> None:
    cleanup = DocumentBatchCleanupJob(
        ("document-1", "document-2"),
        "dataset-1",
        "hierarchical_model",
        ("file-1", "file-2"),
    )

    with patch("tasks.batch_clean_document_task.batch_clean_document_task.delay") as task:
        CeleryDocumentTaskDispatcher().cleanup(REF, cleanup)

    task.assert_called_once_with(
        ["document-1", "document-2"],
        "dataset-1",
        "hierarchical_model",
        ["file-1", "file-2"],
    )


def test_removed_notion_documents_use_the_shared_batch_cleanup_dispatch() -> None:
    cleanup = DocumentBatchCleanupJob(
        ("document-1", "document-2"),
        "dataset-1",
        "hierarchical_model",
        ("file-1", "file-2"),
    )
    jobs = DocumentIndexingJobs(dataset=REF, removed_notion_cleanup=cleanup)

    with patch("tasks.batch_clean_document_task.batch_clean_document_task.delay") as task:
        CeleryDocumentTaskDispatcher().dispatch_indexing(jobs, priority=False)

    task.assert_called_once_with(
        ["document-1", "document-2"],
        "dataset-1",
        "hierarchical_model",
        ["file-1", "file-2"],
    )


def test_document_retry_preserves_the_established_task_message() -> None:
    with patch("tasks.retry_document_indexing_task.retry_document_indexing_task.delay") as task:
        CeleryDocumentTaskDispatcher().retry(
            REF,
            ("document-1", "document-2"),
            actor_id="actor-1",
        )

    task.assert_called_once_with("dataset-1", ["document-1", "document-2"], "actor-1")


def test_website_sync_preserves_the_established_task_message() -> None:
    with patch("tasks.sync_website_document_indexing_task.sync_website_document_indexing_task.delay") as task:
        CeleryDocumentTaskDispatcher().sync_website(REF.document("document-1"))

    task.assert_called_once_with("dataset-1", "document-1")


def test_status_dispatch_attempts_every_document_and_reports_only_failures() -> None:
    attempts: list[str] = []

    def dispatch(document_id: str) -> None:
        attempts.append(document_id)
        if document_id == "document-1":
            raise RuntimeError("broker unavailable")

    with patch("tasks.add_document_to_index_task.add_document_to_index_task.delay", side_effect=dispatch):
        failed = CeleryDocumentTaskDispatcher().change_status(
            ("document-1", "document-2", "document-3"),
            action="enable",
        )

    assert attempts == ["document-1", "document-2", "document-3"]
    assert failed == ("document-1",)


def _dataset() -> Dataset:
    return Dataset(
        id="dataset-1",
        tenant_id="tenant-1",
        name="Dataset",
        created_by="actor-1",
        maintainer="actor-1",
        indexing_technique="economy",
        chunk_structure="text_model",
    )


def _document(**values: object) -> Document:
    document = Document(
        id="document-1",
        tenant_id="tenant-1",
        dataset_id="dataset-1",
        position=1,
        data_source_type=DataSourceType.LOCAL_FILE,
        data_source_info=json.dumps({"file_path": "/path/to/file"}),
        batch="batch-1",
        name="Document",
        created_from=DocumentCreatedFrom.WEB,
        created_by="actor-1",
        indexing_status=IndexingStatus.COMPLETED,
        doc_form=IndexStructureType.PARAGRAPH_INDEX,
        enabled=True,
        archived=False,
        word_count=10,
    )
    document.created_at = datetime(2024, 1, 1)
    for key, value in values.items():
        setattr(document, key, value)
    return document


@pytest.fixture
def operations(sqlite_session_factory: sessionmaker[Session]) -> SQLAlchemyDocumentOperations:
    with sqlite_session_factory.begin() as session:
        session.add_all([make_tenant(tenant_id="tenant-1"), _dataset(), _document()])
    return SQLAlchemyDocumentOperations(
        session_factory=sqlite_session_factory,
        documents=SQLAlchemyDocumentRepository(session_factory=sqlite_session_factory),
        files=build_file_service(session_factory=sqlite_session_factory),
    )


@pytest.mark.parametrize("foreign", [{"tenant_id": "other"}, {"dataset_id": "other"}])
def test_document_detail_rejects_incorrect_owner(
    operations: SQLAlchemyDocumentOperations,
    sqlite_session_factory: sessionmaker[Session],
    foreign: dict[str, str],
) -> None:
    with sqlite_session_factory.begin() as session:
        session.add(_document(id="foreign", **foreign))

    with pytest.raises(DocumentNotFoundError):
        operations.get_detail(REF.document("foreign"), metadata_only=False)


def test_listing_filters_by_complete_owner_chain(
    operations: SQLAlchemyDocumentOperations,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    with sqlite_session_factory.begin() as session:
        session.add_all(
            [
                _document(id="matching", name="Needle", position=2),
                _document(id="disabled", name="Needle", enabled=False),
                _document(id="foreign", name="Needle", tenant_id="other"),
                _document(id="other-dataset", name="Needle", dataset_id="other"),
            ]
        )

    result = operations.list_documents(REF, DocumentListFilter(search="Needle", status="available", fetch=True))

    assert result["total"] == 1
    assert result["data"][0]["id"] == "matching"


@pytest.mark.parametrize(
    ("query", "expected_page", "expected_limit"),
    [
        (DocumentListFilter(page=0, limit=20), 1, 20),
        (DocumentListFilter(page=1, limit=0), 1, 1),
        (DocumentListFilter(page=1, limit=-3), 1, 1),
        (DocumentListFilter(page=1, limit=1000), 1, 100),
    ],
)
def test_listing_reports_clamped_pagination(
    operations: SQLAlchemyDocumentOperations,
    query: DocumentListFilter,
    expected_page: int,
    expected_limit: int,
) -> None:
    result = operations.list_documents(REF, query)
    assert result["page"] == expected_page
    assert result["limit"] == expected_limit


def test_detail_is_materialized_before_session_closes(operations: SQLAlchemyDocumentOperations) -> None:
    result = operations.get_detail(REF.document("document-1"), metadata_only=False)

    assert result["id"] == "document-1"
    assert result["data_source_info"] == {"file_path": "/path/to/file"}
    assert result["document_process_rule"] is None
    assert result["created_at"] == int(datetime(2024, 1, 1).timestamp())


def test_metadata_only_avoids_loading_full_details(operations: SQLAlchemyDocumentOperations) -> None:
    with patch("services.knowledge.documents.adapters.get_document_source_detail") as source:
        result = operations.get_detail(REF.document("document-1"), metadata_only=True)

    assert set(result) == {"id", "doc_type", "doc_metadata"}
    source.assert_not_called()


@pytest.mark.parametrize("rules", [None, {"segmentation": {"delimiter": "\\n", "max_tokens": 500}}])
def test_process_rule_preserves_null_and_legacy_delimiter(
    operations: SQLAlchemyDocumentOperations,
    sqlite_session_factory: sessionmaker[Session],
    rules: dict[str, object] | None,
) -> None:
    with sqlite_session_factory.begin() as session:
        session.add(
            DatasetProcessRule(
                dataset_id="dataset-1",
                mode=ProcessRuleMode.CUSTOM,
                rules=json.dumps(rules) if rules else None,
                created_by="actor-1",
            )
        )

    result = operations.get_process_rule(REF)
    assert result["mode"] == "custom"
    assert result["rules"] == rules


def test_download_url_resolves_scoped_upload_file(
    operations: SQLAlchemyDocumentOperations,
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    with sqlite_session_factory.begin() as session:
        document = session.get_one(Document, "document-1")
        document.data_source_type = DataSourceType.UPLOAD_FILE
        document.data_source_info = json.dumps({"upload_file_id": "upload-1"})
        session.add(
            make_upload_file(file_id="upload-1", tenant_id="tenant-1", name="document.txt", created_by="actor-1")
        )
    signed_ids: list[str] = []

    def signed_url(*, upload_file_id: str, as_attachment: bool) -> str:
        assert as_attachment is True
        signed_ids.append(upload_file_id)
        return "https://files.example/document"

    monkeypatch.setattr(document_adapters.file_helpers, "get_signed_file_url", signed_url)

    assert operations.get_download_url(REF.document("document-1")) == "https://files.example/document"
    assert signed_ids == ["upload-1"]


@dataclass(frozen=True)
class StoredUpload:
    id: str


class RecordingFiles:
    def __init__(self) -> None:
        self.text_uploads: list[tuple[FileUploadActor, str, str, str]] = []
        self.file_uploads: list[tuple[FileUploadActor, str, str, bytes, str, frozenset[str], int]] = []
        self.file_error: Exception | None = None

    def upload_text(self, *, actor: FileUploadActor, tenant_id: str, text: str, text_name: str) -> StoredUpload:
        self.text_uploads.append((actor, tenant_id, text, text_name))
        return StoredUpload("text-upload")

    def upload_file(
        self,
        *,
        actor: FileUploadActor,
        tenant_id: str,
        filename: str,
        content: bytes,
        mimetype: str,
        allowed_extensions: frozenset[str],
        default_file_size_limit: int,
    ) -> StoredUpload:
        if self.file_error is not None:
            raise self.file_error
        self.file_uploads.append(
            (actor, tenant_id, filename, content, mimetype, allowed_extensions, default_file_size_limit)
        )
        return StoredUpload("file-upload")


def test_upload_adapter_uses_request_actor_and_tenant(monkeypatch: pytest.MonkeyPatch) -> None:
    files = RecordingFiles()
    file_service = create_autospec(FileService, instance=True, spec_set=True)
    file_service.upload_text.side_effect = files.upload_text
    file_service.upload_file.side_effect = files.upload_file
    uploads = DocumentUploadAdapter(files=file_service)
    context = RequestContext("request", None, "actor-1", "tenant-1")
    monkeypatch.setattr(document_adapters.FeatureService, "get_knowledge_file_size_limit", lambda _tenant_id: 25)

    assert uploads.upload_text(context, name="Guide", text="contents") == "text-upload"
    assert (
        uploads.upload_file(context, filename="guide.txt", content=b"contents", mimetype="text/plain") == "file-upload"
    )
    text_actor, text_tenant_id, text, text_name = files.text_uploads[0]
    assert text_actor.id == "actor-1"
    assert (text_tenant_id, text, text_name) == ("tenant-1", "contents", "Guide")
    actor, tenant_id, filename, content, mimetype, allowed_extensions, size_limit = files.file_uploads[0]
    assert actor.id == "actor-1"
    assert actor.creator_role == CreatorUserRole.ACCOUNT
    assert (tenant_id, filename, content, mimetype, size_limit) == (
        "tenant-1",
        "guide.txt",
        b"contents",
        "text/plain",
        25,
    )
    assert "txt" in allowed_extensions


def test_upload_adapter_translates_file_service_failures(monkeypatch: pytest.MonkeyPatch) -> None:
    files = RecordingFiles()
    files.file_error = FileTooLargeError("25 MB limit")
    file_service = create_autospec(FileService, instance=True, spec_set=True)
    file_service.upload_text.side_effect = files.upload_text
    file_service.upload_file.side_effect = files.upload_file
    uploads = DocumentUploadAdapter(files=file_service)
    context = RequestContext("request", None, "actor-1", "tenant-1")
    monkeypatch.setattr(document_adapters.FeatureService, "get_knowledge_file_size_limit", lambda _tenant_id: 25)

    with pytest.raises(DocumentUploadError) as raised:
        uploads.upload_file(context, filename="guide.txt", content=b"contents", mimetype="text/plain")

    assert raised.value.kind == "too_large"
    assert raised.value.description == "25 MB limit"


class FailingModelConfiguration:
    def __init__(self, error: Exception) -> None:
        self._error = error

    def _raise(self) -> NoReturn:
        raise self._error

    def resolve_default_embedding_model(self, *, tenant_id: str) -> EmbeddingModelConfiguration:
        del tenant_id
        self._raise()

    def resolve_embedding_model(self, *, tenant_id: str, provider: str, model: str) -> EmbeddingModelConfiguration:
        del tenant_id, provider, model
        self._raise()

    def validate_embedding_model(self, *, tenant_id: str, provider: str, model: str) -> None:
        del tenant_id, provider, model
        self._raise()

    def validate_reranking_model(self, *, tenant_id: str, provider: str, model: str) -> None:
        del tenant_id, provider, model
        self._raise()

    def validate_dataset_model(
        self, *, configuration: DatasetModelConfiguration, dataset_unavailable: bool = True
    ) -> None:
        del configuration, dataset_unavailable
        self._raise()


@pytest.mark.parametrize(
    ("error", "operation", "kind"),
    [
        (ProviderTokenNotInitError("missing"), "default", "uninitialized"),
        (QuotaExceededError(), "embedding", "quota"),
        (ModelCurrentlyNotSupportError(), "reranking", "unsupported"),
    ],
)
def test_document_model_adapter_preserves_provider_error_contract(error: Exception, operation: str, kind: str) -> None:
    failing = FailingModelConfiguration(error)
    model_gateway = create_autospec(DocumentModelConfigurationGateway, instance=True, spec_set=True)
    model_gateway.resolve_default_embedding_model.side_effect = failing.resolve_default_embedding_model
    model_gateway.resolve_embedding_model.side_effect = failing.resolve_embedding_model
    model_gateway.validate_embedding_model.side_effect = failing.validate_embedding_model
    model_gateway.validate_reranking_model.side_effect = failing.validate_reranking_model
    model_gateway.validate_dataset_model.side_effect = failing.validate_dataset_model
    models = DocumentModelConfigurationAdapter(models=model_gateway)
    operations = {
        "default": lambda: models.resolve_default_embedding_model(tenant_id="tenant-1"),
        "embedding": lambda: models.resolve_embedding_model(
            tenant_id="tenant-1", provider="provider", model="embedding"
        ),
        "reranking": lambda: models.validate_reranking_model(
            tenant_id="tenant-1", provider="provider", model="reranker"
        ),
    }

    with pytest.raises(DocumentProviderError) as raised:
        operations[operation]()

    assert raised.value.kind == kind


def test_document_model_adapter_keeps_shared_validation_value_errors() -> None:
    failing = FailingModelConfiguration(ValueError("missing"))
    model_gateway = create_autospec(DocumentModelConfigurationGateway, instance=True, spec_set=True)
    model_gateway.validate_dataset_model.side_effect = failing.validate_dataset_model
    models = DocumentModelConfigurationAdapter(models=model_gateway)
    configuration = DatasetModelConfiguration("tenant-1", "high_quality", "provider", "embedding")

    with pytest.raises(ValueError, match="missing") as raised:
        models.validate_dataset_model(configuration=configuration)

    assert not isinstance(raised.value, DocumentProviderError)
