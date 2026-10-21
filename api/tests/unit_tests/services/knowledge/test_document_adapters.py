import json
from dataclasses import dataclass
from datetime import datetime
from typing import NoReturn, cast
from unittest.mock import patch

import pytest
from sqlalchemy import Engine, event, select
from sqlalchemy.orm import Session, sessionmaker

from controllers.console.datasets.datasets_document import DocumentDetailResponse, DocumentWithSegmentsListResponse
from core.errors.error import ModelCurrentlyNotSupportError, ProviderTokenNotInitError, QuotaExceededError
from core.rag.index_processor.constant.index_type import IndexTechniqueType
from machinery.context import RequestContext
from models.dataset import Dataset, DatasetProcessRule, Document, DocumentPipelineExecutionLog, DocumentSegment
from models.enums import CreatorUserRole, IndexingStatus, ProcessRuleMode, SegmentStatus
from models.knowledge_task import KnowledgeTaskOutbox
from repositories.knowledge.dataset_repository import SQLAlchemyDatasetRepository
from repositories.knowledge.document_repository import SQLAlchemyDocumentRepository
from repositories.knowledge.task_outbox_repository import SQLAlchemyKnowledgeTaskStore
from repositories.knowledge.upload_file_repository import SQLAlchemyKnowledgeUploadRepository
from services.errors.file import FileTooLargeError
from services.file_service import FileService, FileUploadActor
from services.knowledge.documents import adapters as document_adapters
from services.knowledge.documents.adapters import (
    DocumentModelConfigurationAdapter,
    DocumentUploadAdapter,
    SQLAlchemyDocumentOperations,
)
from services.knowledge.documents.application import (
    DocumentModelConfigurationGateway,
    DocumentNotFoundError,
    DocumentProviderError,
    DocumentUploadError,
)
from services.knowledge.documents.contracts import (
    DocumentListFilter,
    DocumentPersistenceArchivedError,
    DocumentPersistenceNotFoundError,
    DocumentStatusAction,
)
from services.knowledge.entities.model_configuration import (
    DatasetModelConfiguration,
    EmbeddingModelConfiguration,
)
from services.knowledge.resource_scope import DatasetRef
from services.knowledge.task_outbox.contracts import (
    KnowledgeTaskExecutionLeaseLostError,
    KnowledgeTaskFailureDisposition,
)
from services.knowledge.task_outbox.gateway import wake_knowledge_task_dispatcher_after_commit
from tests.unit_tests.model_factories import make_upload_file

REF = DatasetRef("tenant-1", "dataset-1")


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
        self,
        *,
        configuration: DatasetModelConfiguration,
        dataset_unavailable: bool = True,
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
def test_document_model_adapter_preserves_provider_error_contract(
    error: Exception,
    operation: str,
    kind: str,
) -> None:
    models = DocumentModelConfigurationAdapter(
        models=cast(DocumentModelConfigurationGateway, FailingModelConfiguration(error))
    )
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
    models = DocumentModelConfigurationAdapter(
        models=cast(DocumentModelConfigurationGateway, FailingModelConfiguration(ValueError("missing")))
    )
    configuration = DatasetModelConfiguration("tenant-1", "high_quality", "provider", "embedding")

    with pytest.raises(ValueError, match="missing") as raised:
        models.validate_dataset_model(configuration=configuration)

    assert not isinstance(raised.value, DocumentProviderError)


def _dataset(**values: object) -> Dataset:
    row = Dataset(
        id="dataset-1",
        tenant_id="tenant-1",
        name="Dataset",
        created_by="actor-1",
        maintainer="actor-1",
        indexing_technique="economy",
        chunk_structure="text_model",
    )
    for key, value in values.items():
        setattr(row, key, value)
    return row


def _document(**values: object) -> Document:
    return Document(
        **{
            "id": "document-1",
            "tenant_id": "tenant-1",
            "dataset_id": "dataset-1",
            "position": 1,
            "data_source_type": "local_file",
            "data_source_info": json.dumps({"file_path": "/path/to/file"}),
            "batch": "batch-1",
            "name": "Document",
            "created_from": "web",
            "created_by": "actor-1",
            "indexing_status": IndexingStatus.COMPLETED,
            "doc_form": "text_model",
            "enabled": True,
            "archived": False,
            "word_count": 10,
            "created_at": datetime(2024, 1, 1),
            **values,
        }
    )


def _segment(
    segment_id: str,
    *,
    tenant_id: str = "tenant-1",
    dataset_id: str = "dataset-1",
    document_id: str = "document-1",
    status: SegmentStatus = SegmentStatus.COMPLETED,
    completed_at: datetime | None = datetime(2024, 1, 1),
    hit_count: int = 0,
) -> DocumentSegment:
    segment = DocumentSegment(
        tenant_id=tenant_id,
        dataset_id=dataset_id,
        document_id=document_id,
        position=1,
        content="content",
        word_count=7,
        tokens=2,
        created_by="actor-1",
        status=status,
        completed_at=completed_at,
        hit_count=hit_count,
    )
    segment.id = segment_id
    return segment


@pytest.fixture
def operations(sqlite_session_factory: sessionmaker[Session]) -> SQLAlchemyDocumentOperations:
    with sqlite_session_factory.begin() as session:
        session.add_all([_dataset(), _document()])
    return SQLAlchemyDocumentOperations(
        session_factory=sqlite_session_factory,
        documents=SQLAlchemyDocumentRepository(session_factory=sqlite_session_factory),
        uploads=SQLAlchemyKnowledgeUploadRepository(session_factory=sqlite_session_factory),
    )


@pytest.mark.parametrize("foreign", [{"tenant_id": "other"}, {"dataset_id": "other"}])
def test_document_reads_and_writes_reject_incorrect_owner(
    operations: SQLAlchemyDocumentOperations, sqlite_session_factory: sessionmaker[Session], foreign: dict[str, str]
) -> None:
    with sqlite_session_factory.begin() as session:
        session.add(_document(id="foreign", **foreign))
    ref = REF.document("foreign")
    assert SQLAlchemyDocumentRepository(session_factory=sqlite_session_factory).get_state(ref) is None
    with pytest.raises(DocumentNotFoundError):
        operations.get_detail(ref, metadata_only=False)
    documents = SQLAlchemyDocumentRepository(session_factory=sqlite_session_factory)
    with pytest.raises(DocumentPersistenceNotFoundError, match="Document not found"):
        documents.update_metadata(
            ref,
            doc_type="book",
            doc_metadata={"title": "changed"},
            updated_at=datetime(2026, 1, 1),
        )
    with pytest.raises(DocumentPersistenceNotFoundError, match="Document not found"):
        documents.rename_document(ref, "changed")
    with sqlite_session_factory() as session:
        document = session.get(Document, "foreign")
        assert document is not None
        assert document.name == "Document"


def test_document_lookup_uses_active_workspace(
    operations: SQLAlchemyDocumentOperations, sqlite_session_factory: sessionmaker[Session]
) -> None:
    del operations
    documents = SQLAlchemyDocumentRepository(session_factory=sqlite_session_factory)
    assert documents.find_ref(workspace_id="other", document_id="document-1") is None
    assert documents.find_ref(workspace_id="tenant-1", document_id="document-1") == REF.document("document-1")
    assert documents.get_state(REF.document("document-1")) is not None
    assert [state.id for state in documents.get_states(REF, ["document-1", "missing"])] == ["document-1"]


@pytest.mark.parametrize(
    ("enabled", "archived", "task_action", "status_action"),
    [
        (True, False, "add", "enable"),
        (False, False, "remove", "disable"),
        (True, True, "remove", "archive"),
        (True, False, "add", "un_archive"),
    ],
)
def test_terminal_document_index_failure_is_projected_and_repeated_action_recovers(
    sqlite_session_factory: sessionmaker[Session],
    sqlite_engine: Engine,
    enabled: bool,
    archived: bool,
    task_action: str,
    status_action: DocumentStatusAction,
) -> None:
    failed_generation = "11111111-1111-1111-1111-111111111111"
    recovered_generation = "22222222-2222-2222-2222-222222222222"
    with sqlite_session_factory.begin() as session:
        session.add_all(
            [
                _dataset(),
                _document(
                    indexing_generation=failed_generation,
                    enabled=enabled,
                    archived=archived,
                    completed_at=datetime(2026, 1, 1),
                    error="stale processing failure",
                ),
                KnowledgeTaskOutbox(
                    tenant_id=REF.tenant_id,
                    dataset_id=REF.dataset_id,
                    document_id="document-1",
                    resource_id="document-1",
                    task_kind="document_index_state",
                    payload={"document_id": "document-1", "generation": failed_generation, "action": task_action},
                    status="executing",
                    execution_attempts=10,
                    claim_id="33333333-3333-3333-3333-333333333333",
                ),
            ]
        )

    disposition = SQLAlchemyKnowledgeTaskStore(session_factory=sqlite_session_factory).requeue_task_failure(
        intent_id=_document_state_intent_id(sqlite_session_factory),
        execution_id="33333333-3333-3333-3333-333333333333",
        available_at=datetime(2026, 1, 1),
        error="provider unavailable",
    )
    assert disposition == KnowledgeTaskFailureDisposition.FAILED

    operations = SQLAlchemyDocumentOperations(
        session_factory=sqlite_session_factory,
        documents=SQLAlchemyDocumentRepository(session_factory=sqlite_session_factory),
        uploads=SQLAlchemyKnowledgeUploadRepository(session_factory=sqlite_session_factory),
    )
    statements: list[str] = []

    def record_outbox_query(
        _conn: object, _cursor: object, statement: str, _parameters: object, _context: object, _many: bool
    ) -> None:
        if "knowledge_task_outbox" in statement:
            statements.append(statement)

    event.listen(sqlite_engine, "before_cursor_execute", record_outbox_query)
    try:
        failed_result = operations.list_documents(REF, DocumentListFilter())
    finally:
        event.remove(sqlite_engine, "before_cursor_execute", record_outbox_query)

    assert len(statements) == 1
    failed_document = failed_result["data"][0]
    assert failed_document["enabled"] is enabled
    assert failed_document["indexing_state"] == "failed"
    assert failed_document["error"] == "provider unavailable"
    assert "indexing_state_error" not in failed_document
    detail = operations.get_detail(REF.document("document-1"), metadata_only=False)
    assert detail["indexing_state"] == "failed"
    assert detail["error"] == "provider unavailable"
    status = operations.get_indexing_status(REF.document("document-1"))
    assert status["indexing_state"] == "failed"
    assert status["error"] == "provider unavailable"
    batch_status = operations.get_batch_indexing_status(REF, "batch-1")["data"][0]
    assert batch_status["indexing_state"] == "failed"
    assert batch_status["error"] == "provider unavailable"

    mutation = SQLAlchemyDocumentRepository(session_factory=sqlite_session_factory).change_status(
        REF,
        ["document-1"],
        action=status_action,
        actor_id="actor-1",
        generations={"document-1": recovered_generation},
    )
    assert mutation.indexing_document_ids == ("document-1",)

    recovered_document = operations.list_documents(REF, DocumentListFilter())["data"][0]
    assert recovered_document["enabled"] is enabled
    assert recovered_document["indexing_state"] == "pending"
    assert recovered_document["error"] is None


def test_completed_current_state_intent_preserves_document_processing_error(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    generation = "11111111-1111-1111-1111-111111111111"
    with sqlite_session_factory.begin() as session:
        session.add_all(
            [
                _dataset(),
                _document(indexing_generation=generation, error="content parse warning"),
                KnowledgeTaskOutbox(
                    tenant_id=REF.tenant_id,
                    dataset_id=REF.dataset_id,
                    document_id="document-1",
                    resource_id="document-1",
                    task_kind="document_index_state",
                    payload={"document_id": "document-1", "generation": generation, "action": "add"},
                    status="completed",
                ),
            ]
        )
    operations = SQLAlchemyDocumentOperations(
        session_factory=sqlite_session_factory,
        documents=SQLAlchemyDocumentRepository(session_factory=sqlite_session_factory),
        uploads=SQLAlchemyKnowledgeUploadRepository(session_factory=sqlite_session_factory),
    )

    document = operations.list_documents(REF, DocumentListFilter())["data"][0]

    assert document["indexing_state"] == "completed"
    assert document["error"] == "content parse warning"


def _document_state_intent_id(sqlite_session_factory: sessionmaker[Session]) -> str:
    with sqlite_session_factory() as session:
        intent_id = session.scalar(
            select(KnowledgeTaskOutbox.id).where(KnowledgeTaskOutbox.task_kind == "document_index_state")
        )
    assert intent_id is not None
    return intent_id


def test_document_creation_defaults_are_owned_by_dataset_repository(
    operations: SQLAlchemyDocumentOperations, sqlite_session_factory: sessionmaker[Session]
) -> None:
    del operations
    defaults = SQLAlchemyDatasetRepository(
        revoke_keys_after_commit=lambda _session, _tokens: None,
        session_factory=sqlite_session_factory,
        wake_after_commit=lambda _session: None,
    ).get_document_creation_defaults(REF)

    assert defaults is not None
    assert defaults.chunk_structure == "text_model"
    assert defaults.indexing_technique == "economy"


def test_listing_filters_scope_and_materializes_values(
    operations: SQLAlchemyDocumentOperations, sqlite_session_factory: sessionmaker[Session]
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
    response = DocumentWithSegmentsListResponse.model_validate(result).model_dump(mode="json")
    assert response["total"] == 1
    assert response["data"][0]["id"] == "matching"
    assert response["data"][0]["data_source_info"] == {"file_path": "/path/to/file"}
    assert response["data"][0]["completed_segments"] == 0
    assert response["data"][0]["total_segments"] == 0


def test_listing_hit_count_sort_and_exact_last_page(
    operations: SQLAlchemyDocumentOperations, sqlite_session_factory: sessionmaker[Session]
) -> None:
    with sqlite_session_factory.begin() as session:
        session.add_all(
            [
                _document(id="popular", position=2),
                _segment("segment-1", hit_count=1),
                _segment("segment-2", document_id="popular", hit_count=10),
                _segment("foreign", tenant_id="other", hit_count=1000),
            ]
        )
    first = operations.list_documents(REF, DocumentListFilter(sort="-hit_count", limit=1))
    last = operations.list_documents(REF, DocumentListFilter(sort="-hit_count", limit=1, page=2))
    assert [row["id"] for row in first["data"]] == ["popular"]
    assert first["has_more"] is True
    assert last["has_more"] is False
    assert last["total"] == 2


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


def test_download_url_resolves_scoped_upload_file(
    operations: SQLAlchemyDocumentOperations,
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    with sqlite_session_factory.begin() as session:
        document = session.get(Document, "document-1")
        assert document is not None
        document.data_source_type = "upload_file"
        document.data_source_info = json.dumps({"upload_file_id": "upload-1"})
        session.add(
            make_upload_file(
                file_id="upload-1",
                tenant_id="tenant-1",
                name="document.txt",
                created_by="actor-1",
            )
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
        self.text_uploads: list[tuple[str, str, str, str]] = []
        self.file_uploads: list[tuple[FileUploadActor, str, str, bytes, str, str, int]] = []
        self.file_error: Exception | None = None

    def upload_text(self, *, text: str, text_name: str, user_id: str, tenant_id: str) -> StoredUpload:
        self.text_uploads.append((text, text_name, user_id, tenant_id))
        return StoredUpload("text-upload")

    def upload_file_for_actor(
        self,
        *,
        actor: FileUploadActor,
        resource_tenant_id: str,
        filename: str,
        content: bytes,
        mimetype: str,
        source: str,
        default_file_size_limit: int,
    ) -> StoredUpload:
        if self.file_error is not None:
            raise self.file_error
        self.file_uploads.append(
            (actor, resource_tenant_id, filename, content, mimetype, source, default_file_size_limit)
        )
        return StoredUpload("file-upload")


def test_upload_adapter_keeps_request_identity_out_of_file_service(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    files = RecordingFiles()
    uploads = DocumentUploadAdapter(files=cast(FileService, files))
    context = RequestContext("request", None, "actor-1", "tenant-1")
    monkeypatch.setattr(document_adapters.FeatureService, "get_knowledge_file_size_limit", lambda _tenant_id: 25)

    assert uploads.upload_text(context, name="Guide", text="contents") == "text-upload"
    assert (
        uploads.upload_file(context, filename="guide.txt", content=b"contents", mimetype="text/plain") == "file-upload"
    )
    assert files.text_uploads == [("contents", "Guide", "actor-1", "tenant-1")]
    actor, tenant_id, filename, content, mimetype, source, size_limit = files.file_uploads[0]
    assert actor.id == "actor-1"
    assert actor.creator_role == CreatorUserRole.ACCOUNT
    assert (tenant_id, filename, content, mimetype, source, size_limit) == (
        "tenant-1",
        "guide.txt",
        b"contents",
        "text/plain",
        "datasets",
        25,
    )


def test_upload_adapter_translates_file_service_failures(monkeypatch: pytest.MonkeyPatch) -> None:
    files = RecordingFiles()
    files.file_error = FileTooLargeError("25 MB limit")
    uploads = DocumentUploadAdapter(files=cast(FileService, files))
    context = RequestContext("request", None, "actor-1", "tenant-1")
    monkeypatch.setattr(document_adapters.FeatureService, "get_knowledge_file_size_limit", lambda _tenant_id: 25)

    with pytest.raises(DocumentUploadError) as raised:
        uploads.upload_file(context, filename="guide.txt", content=b"contents", mimetype="text/plain")

    assert raised.value.kind == "too_large"
    assert raised.value.description == "25 MB limit"


def test_status_counts_use_one_aggregate_and_complete_owner_chain(
    operations: SQLAlchemyDocumentOperations, sqlite_session_factory: sessionmaker[Session], sqlite_engine: Engine
) -> None:
    with sqlite_session_factory.begin() as session:
        session.add_all(
            [
                _segment("complete"),
                _segment("waiting", completed_at=None),
                _segment("excluded", status=SegmentStatus.RE_SEGMENT),
                _segment("foreign", tenant_id="other"),
                _segment("wrong-dataset", dataset_id="other"),
                _document(id="second", is_paused=True, indexing_status=IndexingStatus.INDEXING),
            ]
        )
    statements: list[str] = []

    def record(
        _conn: object, _cursor: object, statement: str, _parameters: object, _context: object, _many: bool
    ) -> None:
        statements.append(statement)

    event.listen(sqlite_engine, "before_cursor_execute", record)
    try:
        result = operations.get_batch_indexing_status(REF, "batch-1")
    finally:
        event.remove(sqlite_engine, "before_cursor_execute", record)
    rows = {row["id"]: row for row in result["data"]}
    assert rows["document-1"]["completed_segments"] == 1
    assert rows["document-1"]["total_segments"] == 2
    assert rows["second"]["indexing_status"] == "paused"
    assert sum("FROM document_segments" in statement for statement in statements) == 1


def test_unknown_batch_is_not_found(operations: SQLAlchemyDocumentOperations) -> None:
    with pytest.raises(DocumentNotFoundError):
        operations.get_batch_indexing_status(REF, "missing")


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


def test_detail_is_serializable_after_session_closes(operations: SQLAlchemyDocumentOperations) -> None:
    result = operations.get_detail(REF.document("document-1"), metadata_only=False)
    response = DocumentDetailResponse.model_validate(result).model_dump(mode="json")
    assert response["id"] == "document-1"
    assert response["data_source_info"] == {"file_path": "/path/to/file"}
    assert result["data_source_detail_dict"] == {}
    assert response["document_process_rule"] is None
    assert response["created_at"] == int(datetime(2024, 1, 1).timestamp())


def test_delete_does_not_require_embedding_credentials(
    operations: SQLAlchemyDocumentOperations,
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    dispatched: list[str] = []
    with sqlite_session_factory.begin() as session:
        dataset = session.get(Dataset, "dataset-1")
        assert dataset is not None
        dataset.indexing_technique = IndexTechniqueType.HIGH_QUALITY
        dataset.embedding_model = None
        dataset.embedding_model_provider = None
    monkeypatch.setattr(
        "services.knowledge.task_outbox.gateway.wake_knowledge_task_dispatcher",
        lambda: dispatched.append("wake") or True,
    )

    del operations
    SQLAlchemyDocumentRepository(
        session_factory=sqlite_session_factory,
        wake_after_commit=wake_knowledge_task_dispatcher_after_commit,
    ).delete_document(REF.document("document-1"))

    with sqlite_session_factory() as session:
        assert session.get(Document, "document-1") is None
        intent = session.scalar(
            select(KnowledgeTaskOutbox).where(
                KnowledgeTaskOutbox.task_kind == "document_cleanup",
                KnowledgeTaskOutbox.document_id == "document-1",
            )
        )
        assert intent is not None
        assert intent.status == "pending"
        assert intent.payload["dataset_id"] == "dataset-1"
    assert dispatched == ["wake"]


def test_metadata_only_avoids_loading_full_details(operations: SQLAlchemyDocumentOperations) -> None:
    with patch("services.knowledge.documents.adapters.get_document_source_detail") as source:
        result = operations.get_detail(REF.document("document-1"), metadata_only=True)
    assert set(result) == {"id", "doc_type", "doc_metadata"}
    source.assert_not_called()


def test_metadata_update_is_committed_before_returning(
    operations: SQLAlchemyDocumentOperations, sqlite_session_factory: sessionmaker[Session]
) -> None:
    del operations
    SQLAlchemyDocumentRepository(session_factory=sqlite_session_factory).update_metadata(
        REF.document("document-1"),
        doc_type="book",
        doc_metadata={"title": "Updated"},
        updated_at=datetime(2026, 1, 2),
    )
    with sqlite_session_factory() as session:
        document = session.get(Document, "document-1")
        assert document is not None
        assert document.doc_type == "book"
        assert document.doc_metadata == {"title": "Updated"}


def test_latest_pipeline_log_and_empty_result(
    operations: SQLAlchemyDocumentOperations, sqlite_session_factory: sessionmaker[Session]
) -> None:
    assert operations.get_execution_log(REF.document("document-1")) == {}
    with sqlite_session_factory.begin() as session:
        for year in [2024, 2025]:
            row = DocumentPipelineExecutionLog(
                pipeline_id="pipeline-1",
                document_id="document-1",
                datasource_type="local_file",
                datasource_info=json.dumps({"year": year}),
                datasource_node_id="node-1",
                input_data={"year": year},
                created_by="actor-1",
            )
            row.created_at = datetime(year, 1, 1)
            session.add(row)
    result = operations.get_execution_log(REF.document("document-1"))
    assert result["datasource_info"] == {"year": 2025}
    assert result["input_data"] == {"year": 2025}


def test_enable_summary_only_updates_requested_owner(
    operations: SQLAlchemyDocumentOperations, sqlite_session_factory: sessionmaker[Session]
) -> None:
    with sqlite_session_factory.begin() as session:
        document = session.get(Document, "document-1")
        assert document is not None
        document.indexing_generation = "generation-1"
        session.add(_document(id="foreign", tenant_id="other", need_summary=False))
    del operations
    SQLAlchemyDocumentRepository(
        session_factory=sqlite_session_factory,
        wake_after_commit=lambda _session: None,
    ).enable_summary(REF, ["document-1", "foreign"])
    with sqlite_session_factory() as session:
        document = session.get(Document, "document-1")
        foreign = session.get(Document, "foreign")
        assert document is not None
        assert foreign is not None
        assert document.need_summary is True
        assert foreign.need_summary is False
        intents = session.scalars(
            select(KnowledgeTaskOutbox).where(KnowledgeTaskOutbox.task_kind == "document_summary_index")
        ).all()
        assert len(intents) == 1
        assert intents[0].document_id == "document-1"
        assert intents[0].payload == {
            "tenant_id": REF.tenant_id,
            "dataset_id": REF.dataset_id,
            "document_id": "document-1",
            "expected_generation": "generation-1",
            "segment_ids": None,
            "expected_indexing_technique": "economy",
            "expected_embedding_model_provider": None,
            "expected_embedding_model": None,
            "expected_summary_index_setting": None,
        }


def test_enable_summary_rolls_back_flag_and_intent_when_commit_fails(
    operations: SQLAlchemyDocumentOperations, sqlite_session_factory: sessionmaker[Session]
) -> None:
    del operations

    def reject_commit(_session: Session) -> None:
        raise RuntimeError("commit failed")

    event.listen(sqlite_session_factory.class_, "before_commit", reject_commit)
    try:
        with pytest.raises(RuntimeError, match="commit failed"):
            SQLAlchemyDocumentRepository(session_factory=sqlite_session_factory).enable_summary(REF, ["document-1"])
    finally:
        event.remove(sqlite_session_factory.class_, "before_commit", reject_commit)

    with sqlite_session_factory() as session:
        document = session.get(Document, "document-1")
        assert document is not None
        assert document.need_summary is False
        assert (
            session.scalar(
                select(KnowledgeTaskOutbox.id).where(KnowledgeTaskOutbox.task_kind == "document_summary_index")
            )
            is None
        )


@pytest.mark.parametrize("generation", [None, "generation-1"])
def test_enqueue_summary_indexes_persists_exact_generation(
    sqlite_session_factory: sessionmaker[Session],
    generation: str | None,
) -> None:
    with sqlite_session_factory.begin() as session:
        session.add_all(
            [
                _dataset(indexing_technique="high_quality", summary_index_setting={"enable": True}),
                _document(indexing_generation=generation, need_summary=True),
            ]
        )

    count = SQLAlchemyDocumentRepository(session_factory=sqlite_session_factory).enqueue_summary_indexes(
        REF,
        {"document-1": generation},
    )

    assert count == 1
    with sqlite_session_factory() as session:
        intent = session.scalar(
            select(KnowledgeTaskOutbox).where(KnowledgeTaskOutbox.task_kind == "document_summary_index")
        )
        assert intent is not None
        assert intent.payload["expected_generation"] == generation


def test_enqueue_summary_indexes_rolls_back_when_parent_execution_loses_lease(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    with sqlite_session_factory.begin() as session:
        session.add_all(
            [
                _dataset(indexing_technique="high_quality", summary_index_setting={"enable": True}),
                _document(indexing_generation="generation-1", need_summary=True),
            ]
        )

    ownership_checks = 0

    def lose_lease_after_staging() -> None:
        nonlocal ownership_checks
        ownership_checks += 1
        if ownership_checks == 2:
            raise KnowledgeTaskExecutionLeaseLostError("lost")

    with pytest.raises(KnowledgeTaskExecutionLeaseLostError, match="lost"):
        SQLAlchemyDocumentRepository(session_factory=sqlite_session_factory).enqueue_summary_indexes(
            REF,
            {"document-1": "generation-1"},
            assert_owned=lose_lease_after_staging,
        )

    assert ownership_checks == 2
    with sqlite_session_factory() as session:
        assert (
            session.scalar(
                select(KnowledgeTaskOutbox.id).where(KnowledgeTaskOutbox.task_kind == "document_summary_index")
            )
            is None
        )


def test_status_change_commits_state_and_matching_generation_intent(
    operations: SQLAlchemyDocumentOperations, sqlite_session_factory: sessionmaker[Session]
) -> None:
    del operations
    with sqlite_session_factory.begin() as session:
        document = session.get(Document, "document-1")
        assert document is not None
        document.completed_at = datetime(2026, 1, 1)

    mutation = SQLAlchemyDocumentRepository(session_factory=sqlite_session_factory).change_status(
        REF,
        ["document-1"],
        action="disable",
        actor_id="actor-1",
        generations={"document-1": "generation-1"},
    )

    assert mutation.indexing_document_ids == ("document-1",)
    with sqlite_session_factory() as session:
        document = session.get(Document, "document-1")
        assert document is not None
        assert document.enabled is False
        assert document.disabled_by == "actor-1"
        assert document.indexing_generation == "generation-1"
        intent = session.scalar(
            select(KnowledgeTaskOutbox).where(KnowledgeTaskOutbox.task_kind == "document_index_state")
        )
        assert intent is not None
        assert intent.payload == {"document_id": "document-1", "generation": "generation-1", "action": "remove"}


def test_recover_and_sync_persist_generation_with_durable_intents(
    operations: SQLAlchemyDocumentOperations, sqlite_session_factory: sessionmaker[Session]
) -> None:
    del operations
    repository = SQLAlchemyDocumentRepository(session_factory=sqlite_session_factory)
    with sqlite_session_factory.begin() as session:
        document = session.get(Document, "document-1")
        assert document is not None
        document.is_paused = True
        document.paused_by = "actor-1"
        document.paused_at = datetime(2026, 1, 1)
        document.data_source_type = "website_crawl"
        document.data_source_info = json.dumps({"url": "https://example.com", "mode": "crawl"})

    repository.recover_document(REF.document("document-1"), generation="recover-generation")
    repository.sync_website(REF.document("document-1"), generation="sync-generation")

    with sqlite_session_factory() as session:
        document = session.get(Document, "document-1")
        assert document is not None
        assert document.is_paused is False
        assert document.indexing_generation == "sync-generation"
        assert document.data_source_info_dict["mode"] == "scrape"
        intents = {
            intent.task_kind: intent.payload
            for intent in session.scalars(
                select(KnowledgeTaskOutbox).where(
                    KnowledgeTaskOutbox.task_kind.in_(("document_index_recover", "document_index_sync"))
                )
            )
        }
        assert intents["document_index_recover"]["generation"] == "recover-generation"
        assert intents["document_index_sync"]["generation"] == "sync-generation"


def test_sync_website_rolls_back_state_and_intent_when_commit_fails(
    operations: SQLAlchemyDocumentOperations,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    del operations
    with sqlite_session_factory.begin() as session:
        document = session.get(Document, "document-1")
        assert document is not None
        document.data_source_type = "website_crawl"
        document.data_source_info = json.dumps({"url": "https://example.com", "mode": "crawl"})

    def reject_commit(_session: Session) -> None:
        raise RuntimeError("commit failed")

    event.listen(sqlite_session_factory.class_, "before_commit", reject_commit)
    try:
        with pytest.raises(RuntimeError, match="commit failed"):
            SQLAlchemyDocumentRepository(session_factory=sqlite_session_factory).sync_website(
                REF.document("document-1"),
                generation="sync-generation",
            )
    finally:
        event.remove(sqlite_session_factory.class_, "before_commit", reject_commit)

    with sqlite_session_factory() as session:
        document = session.get(Document, "document-1")
        assert document is not None
        assert document.indexing_generation != "sync-generation"
        assert document.data_source_info_dict["mode"] == "crawl"
        assert (
            session.scalar(select(KnowledgeTaskOutbox.id).where(KnowledgeTaskOutbox.task_kind == "document_index_sync"))
            is None
        )


def test_sync_website_rechecks_archived_after_lock_without_rotating_generation(
    operations: SQLAlchemyDocumentOperations,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    del operations
    with sqlite_session_factory.begin() as session:
        document = session.get(Document, "document-1")
        assert document is not None
        document.data_source_type = "website_crawl"
        document.data_source_info = json.dumps({"url": "https://example.com", "mode": "crawl"})
        document.archived = True
        document.indexing_generation = "archive-generation"

    with pytest.raises(DocumentPersistenceArchivedError, match="archived"):
        SQLAlchemyDocumentRepository(session_factory=sqlite_session_factory).sync_website(
            REF.document("document-1"),
            generation="sync-generation",
        )

    with sqlite_session_factory() as session:
        document = session.get(Document, "document-1")
        assert document is not None
        assert document.indexing_generation == "archive-generation"
        assert document.data_source_info_dict["mode"] == "crawl"
        assert session.scalar(select(KnowledgeTaskOutbox.id)) is None


def test_sync_website_keeps_the_durable_intent_when_broker_wakeup_fails(
    operations: SQLAlchemyDocumentOperations,
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    del operations
    with sqlite_session_factory.begin() as session:
        document = session.get(Document, "document-1")
        assert document is not None
        document.data_source_type = "website_crawl"
        document.data_source_info = json.dumps({"url": "https://example.com", "mode": "crawl"})

    monkeypatch.setattr(
        "services.knowledge.task_outbox.gateway.wake_knowledge_task_dispatcher",
        lambda: False,
    )
    SQLAlchemyDocumentRepository(
        session_factory=sqlite_session_factory,
        wake_after_commit=wake_knowledge_task_dispatcher_after_commit,
    ).sync_website(REF.document("document-1"), generation="sync-generation")

    with sqlite_session_factory() as session:
        intent = session.scalar(
            select(KnowledgeTaskOutbox).where(KnowledgeTaskOutbox.task_kind == "document_index_sync")
        )
        assert intent is not None
        assert intent.payload == {
            "dataset_id": REF.dataset_id,
            "document_id": "document-1",
            "generation": "sync-generation",
            "source": "website",
        }
