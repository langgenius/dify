import json
from datetime import datetime, timedelta

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from core.rag.index_processor.constant.index_type import IndexStructureType
from libs.datetime_utils import naive_utc_now
from models.dataset import (
    Dataset,
    DatasetProcessRule,
    Document,
    DocumentPipelineExecutionLog,
    DocumentSegment,
    DocumentSegmentSummary,
    Pipeline,
)
from models.enums import (
    DataSourceType,
    DocumentCreatedFrom,
    IndexingStatus,
    ProcessRuleMode,
    SegmentStatus,
    SummaryStatus,
)
from models.knowledge_task import KnowledgeTaskOutbox
from repositories.knowledge.document_repository import SQLAlchemyDocumentRepository
from repositories.knowledge.summary_checkpoints import summary_content_fingerprint
from services.knowledge.documents.contracts import (
    DocumentIndexingExecutionClaimLostError,
    DocumentPersistenceArchivedError,
    DocumentPersistenceInvalidStateError,
)
from services.knowledge.indexing.contracts import DocumentIndexingExecution
from services.knowledge.indexing.errors import (
    DocumentIndexingGenerationChangedError,
    DocumentIsDeletedPausedError,
    DocumentIsPausedError,
)
from services.knowledge.resource_scope import DatasetRef
from services.knowledge.task_outbox.contracts import KnowledgeTaskExecutionLeaseLostError


def _dataset(dataset_id: str, workspace_id: str) -> Dataset:
    return Dataset(
        id=dataset_id,
        tenant_id=workspace_id,
        name=f"Dataset {dataset_id}",
        description="",
        provider="vendor",
        created_by="account-1",
        maintainer="account-1",
        data_source_type="notion_import",
        indexing_technique="economy",
    )


def _document(
    document_id: str,
    *,
    workspace_id: str = "workspace-1",
    dataset_id: str = "dataset-1",
    source_type: str = DataSourceType.NOTION_IMPORT,
    enabled: bool = True,
    archived: bool = False,
    status: str = IndexingStatus.COMPLETED,
    batch: str = "batch-1",
) -> Document:
    source_info = (
        {"notion_page_id": f"page-{document_id}"}
        if source_type == DataSourceType.NOTION_IMPORT
        else {"upload_file_id": f"file-{document_id}"}
    )
    return Document(
        id=document_id,
        tenant_id=workspace_id,
        dataset_id=dataset_id,
        position=1,
        data_source_type=source_type,
        data_source_info=json.dumps(source_info),
        batch=batch,
        name=f"Document {document_id}",
        created_from=DocumentCreatedFrom.API,
        created_by="account-1",
        created_at=datetime(2026, 1, 1),
        updated_at=datetime(2026, 1, 1),
        indexing_status=status,
        doc_form=IndexStructureType.PARAGRAPH_INDEX,
        word_count=1,
        enabled=enabled,
        archived=archived,
        is_paused=False,
    )


def test_document_queries_enforce_the_complete_owner_chain(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    with sqlite_session_factory.begin() as session:
        session.add_all(
            [
                _dataset("dataset-1", "workspace-1"),
                _dataset("dataset-2", "workspace-2"),
                _document("document-1"),
                _document("document-2", workspace_id="workspace-2", dataset_id="dataset-2"),
            ]
        )

    repository = SQLAlchemyDocumentRepository(session_factory=sqlite_session_factory)
    document_ref = DatasetRef("workspace-1", "dataset-1").document("document-1")

    record = repository.get_estimate_document(document_ref)

    assert record is not None
    assert record.workspace_id == "workspace-1"
    assert record.data_source_info == {"notion_page_id": "page-document-1"}
    assert repository.get_estimate_document(DatasetRef("workspace-2", "dataset-1").document("document-1")) is None


def test_pipeline_document_store_owns_sessions_and_scopes_reads(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    with sqlite_session_factory.begin() as session:
        session.add(_dataset("dataset-1", "workspace-1"))
        session.add(_document("document-1"))

    repository = SQLAlchemyDocumentRepository(session_factory=sqlite_session_factory)
    assert repository.exists(workspace_id="workspace-1", dataset_id="dataset-1", document_id="document-1")
    assert not repository.exists(workspace_id="workspace-2", dataset_id="dataset-1", document_id="document-1")


def test_sync_notion_rotates_generation_and_enqueues_versioned_source_intent_atomically(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    document = _document("document-1", status=IndexingStatus.COMPLETED)
    document.indexing_generation = "old-generation"
    document.error = "old failure"
    with sqlite_session_factory.begin() as session:
        session.add_all([_dataset("dataset-1", "workspace-1"), document])
    wakes: list[str] = []
    repository = SQLAlchemyDocumentRepository(
        session_factory=sqlite_session_factory,
        wake_after_commit=lambda _session: wakes.append("wake"),
    )

    repository.sync_notion(
        DatasetRef("workspace-1", "dataset-1").document(document.id),
        generation="new-generation",
    )

    with sqlite_session_factory() as session:
        persisted = session.get(Document, document.id)
        intent = session.scalar(select(KnowledgeTaskOutbox))
        assert persisted is not None
        assert persisted.indexing_status == IndexingStatus.WAITING
        assert persisted.indexing_generation == "new-generation"
        assert persisted.error is None
        assert intent is not None
        assert intent.task_kind == "document_index_sync"
        assert intent.payload == {
            "dataset_id": "dataset-1",
            "document_id": document.id,
            "generation": "new-generation",
            "source": "notion",
        }
    assert wakes == ["wake"]


@pytest.mark.parametrize(
    ("source_type", "archived", "expected_error"),
    [
        (DataSourceType.NOTION_IMPORT, True, DocumentPersistenceArchivedError),
        (DataSourceType.WEBSITE_CRAWL, False, DocumentPersistenceInvalidStateError),
    ],
)
def test_sync_notion_rechecks_locked_archive_and_source_before_rotating(
    sqlite_session_factory: sessionmaker[Session],
    source_type: DataSourceType,
    archived: bool,
    expected_error: type[Exception],
) -> None:
    document = _document("document-1", source_type=source_type, archived=archived)
    document.indexing_generation = "old-generation"
    with sqlite_session_factory.begin() as session:
        session.add_all([_dataset("dataset-1", "workspace-1"), document])
    repository = SQLAlchemyDocumentRepository(session_factory=sqlite_session_factory)

    with pytest.raises(expected_error):
        repository.sync_notion(
            DatasetRef("workspace-1", "dataset-1").document(document.id),
            generation="new-generation",
        )

    with sqlite_session_factory() as session:
        persisted = session.get(Document, document.id)
        assert persisted is not None
        assert persisted.indexing_generation == "old-generation"
        assert persisted.indexing_status == IndexingStatus.COMPLETED
        assert session.scalar(select(KnowledgeTaskOutbox)) is None


@pytest.mark.parametrize(
    ("task_kind", "payload"),
    [
        (
            "document_index_update",
            {"document_id": "document-1", "generation": "current-generation"},
        ),
        (
            "document_index_retry",
            {
                "document_ids": ["document-1"],
                "generations": {"document-1": "current-generation"},
                "repair": False,
            },
        ),
    ],
)
def test_legacy_notion_sync_preserves_newer_active_indexing_intent(
    sqlite_session_factory: sessionmaker[Session],
    task_kind: str,
    payload: dict[str, object],
) -> None:
    document = _document("document-1", status=IndexingStatus.WAITING)
    document.indexing_generation = "current-generation"
    with sqlite_session_factory.begin() as session:
        session.add_all(
            [
                _dataset("dataset-1", "workspace-1"),
                document,
                KnowledgeTaskOutbox(
                    tenant_id="workspace-1",
                    dataset_id="dataset-1",
                    document_id=document.id if task_kind == "document_index_update" else None,
                    resource_id=document.id,
                    task_kind=task_kind,
                    payload=payload,
                    status="pending",
                ),
            ]
        )
    repository = SQLAlchemyDocumentRepository(session_factory=sqlite_session_factory)

    assert not repository.convert_legacy_notion_sync_delivery("dataset-1", document.id)

    with sqlite_session_factory() as session:
        persisted = session.get(Document, document.id)
        intents = session.scalars(select(KnowledgeTaskOutbox)).all()
        assert persisted is not None
        assert persisted.indexing_generation == "current-generation"
        assert persisted.indexing_status == IndexingStatus.WAITING
        assert [(intent.task_kind, intent.payload) for intent in intents] == [(task_kind, payload)]


def test_retry_documents_revalidates_locked_raw_error_state_before_enqueuing(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    retryable = _document("retryable", status=IndexingStatus.ERROR)
    archived = _document("archived", status=IndexingStatus.ERROR, archived=True)
    disabled = _document("disabled", status=IndexingStatus.ERROR, enabled=False)
    recovered = _document("recovered", status=IndexingStatus.COMPLETED)
    for document in (retryable, archived, disabled, recovered):
        document.indexing_generation = f"old-{document.id}"
    with sqlite_session_factory.begin() as session:
        session.add_all([_dataset("dataset-1", "workspace-1"), retryable, archived, disabled, recovered])
        session.add(
            KnowledgeTaskOutbox(
                tenant_id="workspace-1",
                dataset_id="dataset-1",
                document_id=recovered.id,
                resource_id=recovered.id,
                task_kind="document_index_update",
                payload={"document_id": recovered.id, "generation": recovered.indexing_generation},
                status="failed",
            )
        )
    wakes: list[str] = []
    repository = SQLAlchemyDocumentRepository(
        session_factory=sqlite_session_factory,
        wake_after_commit=lambda _session: wakes.append("wake"),
    )
    requested_ids = [retryable.id, archived.id, disabled.id, recovered.id]

    enqueued_ids = repository.retry_documents(
        DatasetRef("workspace-1", "dataset-1"),
        requested_ids,
        actor_id="account-1",
        generation="retry-generation",
        lock_tokens={document_id: f"token-{document_id}" for document_id in requested_ids},
    )

    assert enqueued_ids == (retryable.id,)
    with sqlite_session_factory() as session:
        persisted = {document.id: document for document in session.scalars(select(Document)).all()}
        retry_intent = session.scalar(
            select(KnowledgeTaskOutbox).where(KnowledgeTaskOutbox.task_kind == "document_index_retry")
        )
        assert persisted[retryable.id].indexing_status == IndexingStatus.WAITING
        assert persisted[retryable.id].indexing_generation == "retry-generation"
        assert persisted[archived.id].indexing_generation == "old-archived"
        assert persisted[disabled.id].indexing_generation == "old-disabled"
        assert persisted[recovered.id].indexing_generation == "old-recovered"
        assert retry_intent is not None
        assert retry_intent.payload["document_ids"] == [retryable.id]
        assert retry_intent.payload["lock_tokens"] == {retryable.id: f"token-{retryable.id}"}
        assert retry_intent.payload["generations"] == {retryable.id: "retry-generation"}
    assert wakes == ["wake"]


def test_change_status_retries_failed_current_index_state_intent(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    document = _document("document-1")
    document.indexing_generation = "failed-generation"
    with sqlite_session_factory.begin() as session:
        session.add_all(
            [
                _dataset("dataset-1", "workspace-1"),
                document,
                KnowledgeTaskOutbox(
                    tenant_id="workspace-1",
                    dataset_id="dataset-1",
                    document_id=document.id,
                    resource_id=document.id,
                    task_kind="document_index_state",
                    payload={"document_id": document.id, "generation": "failed-generation", "action": "add"},
                    status="failed",
                ),
            ]
        )
    repository = SQLAlchemyDocumentRepository(session_factory=sqlite_session_factory)

    mutation = repository.change_status(
        DatasetRef("workspace-1", "dataset-1"),
        [document.id],
        action="enable",
        actor_id="account-1",
        generations={document.id: "replacement-generation"},
    )

    assert mutation.indexing_document_ids == (document.id,)
    with sqlite_session_factory() as session:
        persisted = session.get(Document, document.id)
        intents = session.scalars(select(KnowledgeTaskOutbox).order_by(KnowledgeTaskOutbox.created_at)).all()
        assert persisted is not None
        assert persisted.indexing_generation == "replacement-generation"
        assert [intent.status for intent in intents] == ["failed", "pending"]
        assert intents[-1].payload == {
            "document_id": document.id,
            "generation": "replacement-generation",
            "action": "add",
        }


@pytest.mark.parametrize(
    ("status", "generation", "action"),
    [
        ("completed", "current-generation", "add"),
        ("failed", "stale-generation", "add"),
        ("failed", "current-generation", "remove"),
    ],
)
def test_change_status_does_not_retry_nonmatching_index_state_intent(
    sqlite_session_factory: sessionmaker[Session],
    status: str,
    generation: str,
    action: str,
) -> None:
    document = _document("document-1")
    document.indexing_generation = "current-generation"
    with sqlite_session_factory.begin() as session:
        session.add_all(
            [
                _dataset("dataset-1", "workspace-1"),
                document,
                KnowledgeTaskOutbox(
                    tenant_id="workspace-1",
                    dataset_id="dataset-1",
                    document_id=document.id,
                    resource_id=document.id,
                    task_kind="document_index_state",
                    payload={"document_id": document.id, "generation": generation, "action": action},
                    status=status,
                ),
            ]
        )
    repository = SQLAlchemyDocumentRepository(session_factory=sqlite_session_factory)

    mutation = repository.change_status(
        DatasetRef("workspace-1", "dataset-1"),
        [document.id],
        action="enable",
        actor_id="account-1",
        generations={document.id: "unused-generation"},
    )

    assert mutation.indexing_document_ids == ()
    with sqlite_session_factory() as session:
        persisted = session.get(Document, document.id)
        assert persisted is not None
        assert persisted.indexing_generation == "current-generation"
        assert len(session.scalars(select(KnowledgeTaskOutbox)).all()) == 1


def test_source_preserving_generation_rotations_carry_exact_pipeline_input_binding(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    dataset = _dataset("dataset-1", "workspace-1")
    dataset.pipeline_id = "pipeline-1"
    pipeline = Pipeline(tenant_id="workspace-1", name="Pipeline", description="")
    pipeline.id = "pipeline-1"
    retry = _document("retry", status=IndexingStatus.ERROR)
    recover = _document("recover", status=IndexingStatus.PARSING)
    recover.is_paused = True
    status = _document("status", status=IndexingStatus.COMPLETED)
    status.completed_at = datetime(2026, 1, 1)
    current_repair = _document("current-repair", status=IndexingStatus.COMPLETED)
    legacy_state = _document("legacy-state", status=IndexingStatus.COMPLETED)
    documents = (retry, recover, status, current_repair, legacy_state)
    for document in documents:
        document.indexing_generation = f"old-{document.id}"
    with sqlite_session_factory.begin() as session:
        session.add_all([dataset, pipeline, *documents])
        session.add_all(
            [
                DocumentPipelineExecutionLog(
                    pipeline_id=pipeline.id,
                    document_id=document.id,
                    indexing_generation=document.indexing_generation,
                    datasource_type="local_file",
                    datasource_info=json.dumps({"document_id": document.id}),
                    datasource_node_id="start",
                    input_data={"document_id": document.id},
                    created_by="account-1",
                )
                for document in documents
            ]
        )
    repository = SQLAlchemyDocumentRepository(session_factory=sqlite_session_factory)
    ref = DatasetRef("workspace-1", "dataset-1")

    assert repository.retry_documents(
        ref,
        [retry.id],
        actor_id="account-1",
        generation="retry-generation",
        lock_tokens={retry.id: "retry-token"},
    ) == (retry.id,)
    repository.recover_document(ref.document(recover.id), generation="recover-generation")
    assert repository.change_status(
        ref,
        [status.id],
        action="disable",
        actor_id="account-1",
        generations={status.id: "status-generation"},
    ).indexing_document_ids == (status.id,)
    assert repository.enqueue_current_indexing_repairs(ref, [current_repair.id])
    assert repository.convert_legacy_index_state_delivery(legacy_state.id)

    with sqlite_session_factory() as session:
        document_ids = [document.id for document in documents]
        persisted = {
            document.id: document
            for document in session.scalars(select(Document).where(Document.id.in_(document_ids))).all()
        }
        logs = session.scalars(select(DocumentPipelineExecutionLog)).all()
        generations_by_document: dict[str, set[str | None]] = {}
        for log in logs:
            generations_by_document.setdefault(log.document_id, set()).add(log.indexing_generation)
        expected_successors = {
            retry.id: "retry-generation",
            recover.id: "recover-generation",
            status.id: "status-generation",
            current_repair.id: persisted[current_repair.id].indexing_generation,
            legacy_state.id: persisted[legacy_state.id].indexing_generation,
        }
        for document in documents:
            assert generations_by_document[document.id] == {
                f"old-{document.id}",
                expected_successors[document.id],
            }
            successor = next(
                log
                for log in logs
                if log.document_id == document.id and log.indexing_generation == expected_successors[document.id]
            )
            assert successor.input_data == {"document_id": document.id}


def test_prepare_pipeline_reindexing_rotates_generation_under_the_document_owner(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    document = _document("document-1", status=IndexingStatus.ERROR)
    document.indexing_generation = "failed-generation"
    document.error = "provider unavailable"
    with sqlite_session_factory.begin() as session:
        session.add_all([_dataset("dataset-1", "workspace-1"), document])

    repository = SQLAlchemyDocumentRepository(session_factory=sqlite_session_factory)
    ref = DatasetRef("workspace-1", "dataset-1").document(document.id)
    with sqlite_session_factory.begin() as session:
        generation = repository.prepare_pipeline_reindexing(session, ref)

    with sqlite_session_factory() as session:
        persisted = session.get(Document, document.id)
        assert persisted is not None
        assert persisted.indexing_generation == generation
        assert persisted.indexing_generation != "failed-generation"
        assert persisted.indexing_status == IndexingStatus.WAITING
        assert persisted.error is None


def test_load_pipeline_indexing_context_scopes_replacement_segment_ids(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    document = _document("document-1", status=IndexingStatus.INDEXING)
    document.indexing_generation = "generation-1"
    matching_segment = DocumentSegment(
        tenant_id="workspace-1",
        dataset_id="dataset-1",
        document_id=document.id,
        position=1,
        content="matching",
        index_node_id="node-1",
        word_count=1,
        tokens=1,
        created_by="account-1",
        status=SegmentStatus.INDEXING,
    )
    with sqlite_session_factory.begin() as session:
        session.add_all([_dataset("dataset-1", "workspace-1"), document, matching_segment])

    repository = SQLAlchemyDocumentRepository(session_factory=sqlite_session_factory)
    execution_id = "22222222-2222-2222-2222-222222222222"
    repository = SQLAlchemyDocumentRepository(session_factory=sqlite_session_factory)
    assert repository.claim_pipeline_indexing_execution(
        DatasetRef("workspace-1", "dataset-1").document(document.id),
        execution_id=execution_id,
        expected_generation="generation-1",
    )
    execution = DocumentIndexingExecution("generation-1", lambda: None, execution_id)
    with sqlite_session_factory() as session:
        dataset, loaded_document, node_ids = repository.load_pipeline_indexing_context(
            session,
            dataset_id="dataset-1",
            document_id=document.id,
            original_document_id=document.id,
            execution=execution,
        )

    assert dataset.id == "dataset-1"
    assert loaded_document.id == document.id
    assert node_ids == ("node-1",)


def test_legacy_document_delivery_keeps_completed_current_add(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    generation = "11111111-1111-1111-1111-111111111111"
    document = _document("document-1")
    document.indexing_generation = generation
    with sqlite_session_factory.begin() as session:
        session.add_all(
            [
                _dataset("dataset-1", "workspace-1"),
                document,
                KnowledgeTaskOutbox(
                    tenant_id="workspace-1",
                    dataset_id="dataset-1",
                    document_id="document-1",
                    resource_id="document-1",
                    task_kind="document_index_state",
                    payload={"document_id": "document-1", "generation": generation, "action": "add"},
                    status="completed",
                ),
            ]
        )

    wakes: list[Session] = []
    repository = SQLAlchemyDocumentRepository(
        session_factory=sqlite_session_factory,
        wake_after_commit=wakes.append,
    )

    assert repository.convert_legacy_index_state_delivery("document-1") is False

    with sqlite_session_factory() as session:
        persisted = session.get(Document, "document-1")
        intents = session.scalars(select(KnowledgeTaskOutbox)).all()
        assert persisted is not None
        assert persisted.indexing_generation == generation
        assert len(intents) == 1
        assert intents[0].payload["action"] == "add"
        assert intents[0].status == "completed"
    assert wakes == []


@pytest.mark.parametrize(
    ("enabled", "archived", "expected_action"),
    [(True, False, "add"), (False, False, "remove"), (True, True, "remove")],
)
def test_legacy_document_delivery_creates_one_current_state_repair(
    sqlite_session_factory: sessionmaker[Session],
    enabled: bool,
    archived: bool,
    expected_action: str,
) -> None:
    document = _document("document-1", enabled=enabled, archived=archived)
    document.indexing_generation = "11111111-1111-1111-1111-111111111111"
    with sqlite_session_factory.begin() as session:
        session.add_all([_dataset("dataset-1", "workspace-1"), document])

    wakes: list[Session] = []
    repository = SQLAlchemyDocumentRepository(
        session_factory=sqlite_session_factory,
        wake_after_commit=wakes.append,
    )

    assert repository.convert_legacy_index_state_delivery("document-1") is True
    assert repository.convert_legacy_index_state_delivery("document-1") is False

    with sqlite_session_factory() as session:
        persisted = session.get(Document, "document-1")
        intent = session.scalar(select(KnowledgeTaskOutbox))
        assert persisted is not None
        assert intent is not None
        assert intent.payload == {
            "document_id": "document-1",
            "generation": persisted.indexing_generation,
            "action": expected_action,
        }
        assert intent.status == "pending"
    assert len(wakes) == 1


def test_legacy_document_delivery_replaces_failed_current_intent(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    previous_generation = "11111111-1111-1111-1111-111111111111"
    document = _document("document-1")
    document.indexing_generation = previous_generation
    with sqlite_session_factory.begin() as session:
        session.add_all(
            [
                _dataset("dataset-1", "workspace-1"),
                document,
                KnowledgeTaskOutbox(
                    tenant_id="workspace-1",
                    dataset_id="dataset-1",
                    document_id="document-1",
                    resource_id="document-1",
                    task_kind="document_index_state",
                    payload={
                        "document_id": "document-1",
                        "generation": previous_generation,
                        "action": "add",
                    },
                    status="failed",
                    last_error="provider unavailable",
                ),
            ]
        )

    repository = SQLAlchemyDocumentRepository(
        session_factory=sqlite_session_factory,
        wake_after_commit=lambda _session: None,
    )

    assert repository.convert_legacy_index_state_delivery("document-1") is True

    with sqlite_session_factory() as session:
        persisted = session.get(Document, "document-1")
        intents = session.scalars(
            select(KnowledgeTaskOutbox).order_by(KnowledgeTaskOutbox.created_at, KnowledgeTaskOutbox.id)
        ).all()
        assert persisted is not None
        assert persisted.indexing_generation != previous_generation
        assert len(intents) == 2
        assert intents[0].status == "failed"
        assert intents[1].status == "pending"
        assert intents[1].payload == {
            "document_id": "document-1",
            "generation": persisted.indexing_generation,
            "action": "add",
        }


def test_active_notion_sync_excludes_archived_while_binding_includes_it(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    with sqlite_session_factory.begin() as session:
        session.add(_dataset("dataset-1", "workspace-1"))
        session.add_all(
            [
                _document("notion"),
                _document("upload", source_type=DataSourceType.UPLOAD_FILE),
                _document("disabled", enabled=False),
                _document("archived", archived=True),
            ]
        )

    repository = SQLAlchemyDocumentRepository(session_factory=sqlite_session_factory)
    dataset_ref = DatasetRef("workspace-1", "dataset-1")

    assert repository.list_active_notion_refs(dataset_ref) == (dataset_ref.document("notion"),)
    assert repository.list_bound_notion_page_ids(dataset_ref) == frozenset({"page-notion", "page-archived"})


def test_document_records_normalize_invalid_mapping_data_and_ignore_invalid_notion_page_ids(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    invalid_json = _document("invalid-json")
    invalid_json.data_source_info = "{invalid"
    missing_info = _document("missing-info")
    missing_info.data_source_info = None
    invalid_page_id = _document("invalid-page-id")
    invalid_page_id.data_source_info = json.dumps({"notion_page_id": 42})
    with sqlite_session_factory.begin() as session:
        session.add(_dataset("dataset-1", "workspace-1"))
        session.add_all([invalid_json, missing_info, invalid_page_id])

    repository = SQLAlchemyDocumentRepository(session_factory=sqlite_session_factory)
    dataset_ref = DatasetRef("workspace-1", "dataset-1")

    invalid_record = repository.get_estimate_document(dataset_ref.document("invalid-json"))
    missing_record = repository.get_estimate_document(dataset_ref.document("missing-info"))
    assert invalid_record is not None
    assert invalid_record.data_source_info == {}
    assert missing_record is not None
    assert missing_record.data_source_info is None
    assert repository.list_bound_notion_page_ids(dataset_ref) == frozenset()


def test_batch_query_is_scoped_and_keeps_explicit_state_semantics(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    with sqlite_session_factory.begin() as session:
        session.add_all(
            [
                _dataset("dataset-1", "workspace-1"),
                _dataset("dataset-2", "workspace-1"),
                _dataset("dataset-3", "workspace-2"),
            ]
        )
        session.add_all(
            [
                _document("available"),
                _document("waiting", status=IndexingStatus.WAITING),
                _document("disabled", enabled=False),
                _document("archived", archived=True),
                _document("other-batch", batch="batch-2"),
                _document("other-dataset", dataset_id="dataset-2"),
                _document("other-workspace", workspace_id="workspace-2", dataset_id="dataset-3"),
            ]
        )

    repository = SQLAlchemyDocumentRepository(session_factory=sqlite_session_factory)
    dataset_ref = DatasetRef("workspace-1", "dataset-1")

    assert {record.id for record in repository.list_estimate_documents_by_batch(dataset_ref, "batch-1")} == {
        "available",
        "waiting",
        "disabled",
        "archived",
    }


@pytest.mark.parametrize(
    ("tenant", "dataset", "document"),
    [
        ("wrong", "dataset-1", "document-1"),
        ("workspace-1", "wrong", "document-1"),
        ("workspace-1", "dataset-1", "wrong"),
    ],
)
def test_indexing_state_writes_reject_wrong_owner_chain(
    sqlite_session_factory: sessionmaker[Session], tenant: str, dataset: str, document: str
) -> None:
    with sqlite_session_factory.begin() as session:
        session.add_all([_dataset("dataset-1", "workspace-1"), _document("document-1")])
    repository = SQLAlchemyDocumentRepository(session_factory=sqlite_session_factory)
    ref = DatasetRef(tenant, dataset).document(document)
    for operation in [
        lambda: repository.get_indexing_document(ref),
        lambda: repository.mark_splitting(ref),
        lambda: repository.complete_indexing(ref, tokens=9, latency=1),
    ]:
        with pytest.raises(DocumentIsDeletedPausedError):
            operation()
    repository.fail_indexing(ref, "wrong owner")
    with sqlite_session_factory() as session:
        persisted_document = session.get(Document, "document-1")
        assert persisted_document is not None
        assert persisted_document.error is None


def test_indexing_load_validates_dataset_owner_and_process_rule(sqlite_session_factory: sessionmaker[Session]) -> None:
    with sqlite_session_factory.begin() as session:
        document = _document("document-1")
        document.dataset_process_rule_id = "other-rule"
        rule = DatasetProcessRule(
            dataset_id="dataset-2", mode=ProcessRuleMode.AUTOMATIC, rules="{}", created_by="account-1"
        )
        rule.id = "other-rule"
        session.add_all(
            [
                _dataset("dataset-1", "workspace-1"),
                _dataset("dataset-2", "workspace-2"),
                document,
                rule,
            ]
        )
    repository = SQLAlchemyDocumentRepository(session_factory=sqlite_session_factory)
    ref = DatasetRef("workspace-1", "dataset-1").document("document-1")
    assert repository.get_indexing_document(ref).processing_rule == {}
    with sqlite_session_factory.begin() as session:
        persisted_dataset = session.get(Dataset, "dataset-1")
        assert persisted_dataset is not None
        persisted_dataset.tenant_id = "workspace-2"
    with pytest.raises(DocumentIsDeletedPausedError):
        repository.get_indexing_document(ref)


def test_indexing_transitions_commit_and_preserve_pause(sqlite_session_factory: sessionmaker[Session]) -> None:
    with sqlite_session_factory.begin() as session:
        session.add_all([_dataset("dataset-1", "workspace-1"), _document("document-1", status=IndexingStatus.PARSING)])
    repository = SQLAlchemyDocumentRepository(session_factory=sqlite_session_factory)
    ref = DatasetRef("workspace-1", "dataset-1").document("document-1")
    repository.mark_splitting(ref)
    with sqlite_session_factory() as session:
        persisted_document = session.get(Document, "document-1")
        assert persisted_document is not None
        assert persisted_document.parsing_completed_at is not None
    repository.complete_indexing(ref, tokens=37, latency=2)
    with sqlite_session_factory.begin() as session:
        row = session.get(Document, "document-1")
        assert row is not None
        assert (row.indexing_status, row.tokens, row.indexing_latency) == (IndexingStatus.COMPLETED, 37, 2)
        row.is_paused = True
    with pytest.raises(DocumentIsPausedError):
        repository.fail_indexing(ref, "late worker error")
    with sqlite_session_factory() as session:
        persisted_document = session.get(Document, "document-1")
        assert persisted_document is not None
        assert persisted_document.error is None


def test_regular_completion_persists_summary_before_worker_ack(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    dataset = _dataset("dataset-1", "workspace-1")
    dataset.indexing_technique = "high_quality"
    dataset.summary_index_setting = {"enable": True}
    document = _document("document-1", status=IndexingStatus.INDEXING)
    document.indexing_generation = "generation-1"
    document.need_summary = True
    claim_id = "22222222-2222-2222-2222-222222222222"
    with sqlite_session_factory.begin() as session:
        session.add_all([dataset, document])
        delivery = KnowledgeTaskOutbox(
            tenant_id=dataset.tenant_id,
            dataset_id=dataset.id,
            document_id=document.id,
            resource_id=dataset.id,
            task_kind="document_index_create",
            payload={"generations": {document.id: document.indexing_generation}},
            status="executing",
            claim_id=claim_id,
            claimed_at=naive_utc_now(),
            available_at=naive_utc_now() + timedelta(minutes=5),
        )
        session.add(delivery)

    repository = SQLAlchemyDocumentRepository(session_factory=sqlite_session_factory)
    ref = DatasetRef(dataset.tenant_id, dataset.id).document(document.id)
    ownership_checks = 0

    def lose_after_completion_commit() -> None:
        nonlocal ownership_checks
        ownership_checks += 1
        if ownership_checks == 3:
            raise KnowledgeTaskExecutionLeaseLostError("worker exited before delivery acknowledgement")

    execution = DocumentIndexingExecution(
        document.indexing_generation,
        lose_after_completion_commit,
        task_intent_id=delivery.id,
        task_execution_id=claim_id,
    )

    repository.complete_indexing(ref, tokens=37, latency=2, execution=execution)
    with pytest.raises(KnowledgeTaskExecutionLeaseLostError):
        execution.assert_owned()

    with sqlite_session_factory() as session:
        persisted = session.get(Document, document.id)
        summaries = session.scalars(
            select(KnowledgeTaskOutbox).where(
                KnowledgeTaskOutbox.task_kind == "document_summary_index",
                KnowledgeTaskOutbox.document_id == document.id,
            )
        ).all()
        assert persisted is not None
        assert persisted.indexing_status == IndexingStatus.COMPLETED
        assert len(summaries) == 1
        assert summaries[0].payload["expected_generation"] == "generation-1"

    assert repository.enqueue_summary_indexes(ref.dataset, {document.id: "generation-1"}) == 0


def test_regular_completion_rolls_back_after_outbox_claim_loss_before_commit(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    dataset = _dataset("dataset-1", "workspace-1")
    dataset.indexing_technique = "high_quality"
    dataset.summary_index_setting = {"enable": True}
    document = _document("document-1", status=IndexingStatus.INDEXING)
    document.indexing_generation = "generation-1"
    document.need_summary = True
    claim_id = "22222222-2222-2222-2222-222222222222"
    successor_claim_id = "33333333-3333-3333-3333-333333333333"
    with sqlite_session_factory.begin() as session:
        session.add_all([dataset, document])
        delivery = KnowledgeTaskOutbox(
            tenant_id=dataset.tenant_id,
            dataset_id=dataset.id,
            document_id=document.id,
            resource_id=dataset.id,
            task_kind="document_index_create",
            payload={"generations": {document.id: document.indexing_generation}},
            status="executing",
            claim_id=claim_id,
            claimed_at=naive_utc_now(),
            available_at=naive_utc_now() + timedelta(minutes=5),
        )
        session.add(delivery)

    checks = 0

    def lose_claim_after_initial_check() -> None:
        nonlocal checks
        checks += 1
        if checks == 2:
            with sqlite_session_factory.begin() as session:
                row = session.get(KnowledgeTaskOutbox, delivery.id)
                assert row is not None
                row.claim_id = successor_claim_id

    execution = DocumentIndexingExecution(
        document.indexing_generation,
        lose_claim_after_initial_check,
        task_intent_id=delivery.id,
        task_execution_id=claim_id,
    )
    repository = SQLAlchemyDocumentRepository(session_factory=sqlite_session_factory)
    ref = DatasetRef(dataset.tenant_id, dataset.id).document(document.id)

    with pytest.raises(KnowledgeTaskExecutionLeaseLostError):
        repository.complete_indexing(ref, tokens=37, latency=2, execution=execution)

    with sqlite_session_factory() as session:
        persisted = session.get(Document, document.id)
        assert persisted is not None
        assert persisted.indexing_status == IndexingStatus.INDEXING
        assert (
            session.scalar(
                select(KnowledgeTaskOutbox.id).where(KnowledgeTaskOutbox.task_kind == "document_summary_index")
            )
            is None
        )


def test_indexing_generation_fence_preserves_successor_state(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    with sqlite_session_factory.begin() as session:
        document = _document("document-1", status=IndexingStatus.PARSING)
        document.indexing_generation = "current-generation"
        document.tokens = 11
        session.add_all([_dataset("dataset-1", "workspace-1"), document])
    repository = SQLAlchemyDocumentRepository(session_factory=sqlite_session_factory)
    ref = DatasetRef("workspace-1", "dataset-1").document("document-1")
    ownership_checks: list[str] = []
    stale_execution = DocumentIndexingExecution(
        expected_generation="stale-generation",
        assert_owned=lambda: ownership_checks.append("checked"),
    )

    with pytest.raises(DocumentIndexingGenerationChangedError):
        repository.complete_indexing(ref, tokens=99, latency=3, execution=stale_execution)
    repository.fail_indexing(ref, "late worker failure", execution=stale_execution)

    with sqlite_session_factory() as session:
        persisted = session.get(Document, "document-1")
        assert persisted is not None
        assert persisted.indexing_generation == "current-generation"
        assert persisted.indexing_status == IndexingStatus.PARSING
        assert persisted.tokens == 11
        assert persisted.error is None
    assert ownership_checks == ["checked", "checked"]


def test_pipeline_completion_updates_document_and_segments_under_generation_fence(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    document = _document("document-1", status=IndexingStatus.INDEXING)
    document.indexing_generation = "generation-1"
    segment = DocumentSegment(
        tenant_id="workspace-1",
        dataset_id="dataset-1",
        document_id=document.id,
        position=1,
        content="indexed content",
        word_count=7,
        tokens=3,
        created_by="account-1",
        status=SegmentStatus.INDEXING,
    )
    ownership_checks: list[str] = []
    execution_id = "22222222-2222-2222-2222-222222222222"
    dataset = _dataset("dataset-1", "workspace-1")
    dataset.indexing_technique = "high_quality"
    dataset.summary_index_setting = {"enable": True}
    with sqlite_session_factory.begin() as session:
        session.add_all([dataset, document, segment])

    ref = DatasetRef("workspace-1", "dataset-1").document(document.id)
    wakes: list[str] = []
    repository = SQLAlchemyDocumentRepository(
        session_factory=sqlite_session_factory,
        wake_after_commit=lambda _session: wakes.append("wake"),
    )
    assert repository.claim_pipeline_indexing_execution(
        ref,
        execution_id=execution_id,
        expected_generation="generation-1",
    )
    execution = DocumentIndexingExecution("generation-1", lambda: ownership_checks.append("owned"), execution_id)
    with sqlite_session_factory.begin() as session:
        word_count = repository.complete_pipeline_indexing(
            session,
            ref,
            latency=1.25,
            need_summary=True,
            execution=execution,
        )

    with sqlite_session_factory() as session:
        persisted_document = session.get(Document, document.id)
        persisted_segment = session.get(DocumentSegment, segment.id)
        summary_intent = session.scalar(
            select(KnowledgeTaskOutbox).where(
                KnowledgeTaskOutbox.task_kind == "document_summary_index",
                KnowledgeTaskOutbox.document_id == document.id,
            )
        )
        assert persisted_document is not None
        assert persisted_segment is not None
        assert persisted_document.indexing_status == IndexingStatus.COMPLETED
        assert persisted_document.word_count == 7
        assert persisted_document.need_summary is True
        assert persisted_document.indexing_latency == 1.25
        assert persisted_segment.status == SegmentStatus.COMPLETED
        assert persisted_segment.enabled is True
        assert summary_intent is not None
        assert summary_intent.payload["expected_generation"] == "generation-1"
    assert word_count == 7
    assert ownership_checks == ["owned", "owned", "owned"]
    assert wakes == ["wake"]


def test_pipeline_completion_rejects_a_stale_generation_before_writing(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    document = _document("document-1", status=IndexingStatus.INDEXING)
    document.indexing_generation = "successor-generation"
    with sqlite_session_factory.begin() as session:
        session.add_all([_dataset("dataset-1", "workspace-1"), document])

    ref = DatasetRef("workspace-1", "dataset-1").document(document.id)
    stale_execution = DocumentIndexingExecution("stale-generation", lambda: None)
    repository = SQLAlchemyDocumentRepository(session_factory=sqlite_session_factory)
    with sqlite_session_factory() as session:
        with pytest.raises(DocumentIndexingGenerationChangedError):
            repository.complete_pipeline_indexing(
                session,
                ref,
                latency=1,
                need_summary=True,
                execution=stale_execution,
            )
        session.rollback()

    with sqlite_session_factory() as session:
        persisted = session.get(Document, document.id)
        assert persisted is not None
        assert persisted.indexing_status == IndexingStatus.INDEXING
        assert persisted.need_summary is False


def test_pipeline_completion_rolls_back_when_execution_is_lost_before_commit(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    document = _document("document-1", status=IndexingStatus.INDEXING)
    document.indexing_generation = "generation-1"
    dataset = _dataset("dataset-1", "workspace-1")
    dataset.indexing_technique = "high_quality"
    segment = DocumentSegment(
        tenant_id="workspace-1",
        dataset_id="dataset-1",
        document_id=document.id,
        position=1,
        content="indexed content",
        word_count=7,
        tokens=3,
        created_by="account-1",
        status=SegmentStatus.INDEXING,
    )
    with sqlite_session_factory.begin() as session:
        session.add_all([dataset, document, segment])

    ref = DatasetRef("workspace-1", "dataset-1").document(document.id)
    execution_id = "22222222-2222-2222-2222-222222222222"
    repository = SQLAlchemyDocumentRepository(session_factory=sqlite_session_factory)
    assert repository.claim_pipeline_indexing_execution(
        ref,
        execution_id=execution_id,
        expected_generation="generation-1",
    )
    checks = 0

    def lose_before_commit() -> None:
        nonlocal checks
        checks += 1
        if checks == 3:
            raise RuntimeError("queue receipt lost before commit")

    execution = DocumentIndexingExecution("generation-1", lose_before_commit, execution_id)
    with sqlite_session_factory() as session:
        with pytest.raises(RuntimeError, match="receipt lost"):
            repository.complete_pipeline_indexing(
                session,
                ref,
                latency=1,
                need_summary=True,
                execution=execution,
            )

    with sqlite_session_factory() as session:
        persisted = session.get(Document, document.id)
        persisted_segment = session.get(DocumentSegment, segment.id)
        assert persisted is not None
        assert persisted_segment is not None
        assert persisted.indexing_status == IndexingStatus.INDEXING
        assert persisted.indexing_execution_id == execution_id
        assert persisted_segment.status == SegmentStatus.INDEXING
        assert session.scalar(select(KnowledgeTaskOutbox)) is None


def test_pipeline_execution_takeover_fences_the_previous_receipt(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    document = _document("document-1", status=IndexingStatus.INDEXING)
    document.indexing_generation = "generation-1"
    with sqlite_session_factory.begin() as session:
        session.add_all([_dataset("dataset-1", "workspace-1"), document])

    repository = SQLAlchemyDocumentRepository(session_factory=sqlite_session_factory)
    ref = DatasetRef("workspace-1", "dataset-1").document(document.id)
    previous = "22222222-2222-2222-2222-222222222222"
    successor = "33333333-3333-3333-3333-333333333333"
    assert repository.claim_pipeline_indexing_execution(
        ref,
        execution_id=previous,
        expected_generation="generation-1",
    )
    assert repository.claim_pipeline_indexing_execution(
        ref,
        execution_id=successor,
        expected_generation="generation-1",
    )

    with pytest.raises(DocumentIndexingExecutionClaimLostError):
        repository.assert_pipeline_indexing_execution(
            ref,
            execution_id=previous,
            expected_generation="generation-1",
        )
    repository.assert_pipeline_indexing_execution(
        ref,
        execution_id=successor,
        expected_generation="generation-1",
    )


def test_pipeline_execution_claim_stops_authorizing_work_after_pause(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    document = _document("document-1", status=IndexingStatus.INDEXING)
    document.indexing_generation = "generation-1"
    with sqlite_session_factory.begin() as session:
        session.add_all([_dataset("dataset-1", "workspace-1"), document])

    repository = SQLAlchemyDocumentRepository(session_factory=sqlite_session_factory)
    ref = DatasetRef("workspace-1", "dataset-1").document(document.id)
    execution_id = "22222222-2222-2222-2222-222222222222"
    assert repository.claim_pipeline_indexing_execution(
        ref,
        execution_id=execution_id,
        expected_generation="generation-1",
    )
    with sqlite_session_factory.begin() as session:
        persisted = session.get(Document, document.id)
        assert persisted is not None
        persisted.is_paused = True

    with pytest.raises(DocumentIndexingExecutionClaimLostError):
        repository.assert_pipeline_indexing_execution(
            ref,
            execution_id=execution_id,
            expected_generation="generation-1",
        )


def test_repair_completed_summary_intent_does_not_rotate_or_reindex_document(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    dataset = _dataset("dataset-1", "workspace-1")
    dataset.indexing_technique = "high_quality"
    dataset.summary_index_setting = {"enable": True}
    document = _document("document-1")
    document.indexing_generation = "generation-1"
    document.need_summary = True
    with sqlite_session_factory.begin() as session:
        session.add_all([dataset, document])
    wakes: list[str] = []
    repository = SQLAlchemyDocumentRepository(
        session_factory=sqlite_session_factory,
        wake_after_commit=lambda _session: wakes.append("wake"),
    )

    assert repository.repair_completed_summary_intents(DatasetRef("workspace-1", "dataset-1"), [document.id]) == 1
    assert repository.repair_completed_summary_intents(DatasetRef("workspace-1", "dataset-1"), [document.id]) == 0
    with sqlite_session_factory.begin() as session:
        first_intent = session.scalar(select(KnowledgeTaskOutbox))
        assert first_intent is not None
        first_intent.status = "failed"
    assert repository.repair_completed_summary_intents(DatasetRef("workspace-1", "dataset-1"), [document.id]) == 1
    assert (
        repository.repair_completed_summary_intents(
            DatasetRef("workspace-1", "dataset-1"),
            [document.id],
            force_successor=True,
        )
        == 1
    )

    with sqlite_session_factory() as session:
        persisted = session.get(Document, document.id)
        intents = session.scalars(select(KnowledgeTaskOutbox)).all()
        assert persisted is not None
        assert persisted.indexing_generation == "generation-1"
        assert persisted.indexing_status == IndexingStatus.COMPLETED
        assert len(intents) == 3
        assert intents[0].task_kind == "document_summary_index"
    assert wakes == ["wake", "wake", "wake"]


def test_repair_completed_summary_intent_supports_legacy_null_generation(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    dataset = _dataset("dataset-1", "workspace-1")
    dataset.indexing_technique = "high_quality"
    dataset.summary_index_setting = {"enable": True}
    document = _document("document-1")
    document.indexing_generation = None
    document.need_summary = True
    with sqlite_session_factory.begin() as session:
        session.add_all([dataset, document])
    repository = SQLAlchemyDocumentRepository(session_factory=sqlite_session_factory)

    assert repository.repair_completed_summary_intents(DatasetRef("workspace-1", "dataset-1"), [document.id]) == 1
    assert repository.repair_completed_summary_intents(DatasetRef("workspace-1", "dataset-1"), [document.id]) == 0

    with sqlite_session_factory() as session:
        intent = session.scalar(select(KnowledgeTaskOutbox))
        assert intent is not None
        assert intent.payload["expected_generation"] is None


def test_recovered_summary_source_creates_only_one_successor(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    dataset = _dataset("dataset-1", "workspace-1")
    dataset.indexing_technique = "high_quality"
    dataset.summary_index_setting = {"enable": True}
    document = _document("document-1")
    document.indexing_generation = "generation-1"
    document.need_summary = True
    source = KnowledgeTaskOutbox(
        tenant_id=dataset.tenant_id,
        dataset_id=dataset.id,
        document_id=document.id,
        resource_id=document.id,
        task_kind="document_summary_index",
        payload={
            "tenant_id": dataset.tenant_id,
            "dataset_id": dataset.id,
            "document_id": document.id,
            "expected_generation": "generation-1",
            "segment_ids": None,
            "expected_indexing_technique": "high_quality",
            "expected_embedding_model_provider": None,
            "expected_embedding_model": None,
            "expected_summary_index_setting": {"enable": True},
        },
        status="executing",
    )
    with sqlite_session_factory.begin() as session:
        session.add_all([dataset, document, source])
    repository = SQLAlchemyDocumentRepository(session_factory=sqlite_session_factory)

    assert (
        repository.repair_completed_summary_intents(
            DatasetRef("workspace-1", "dataset-1"),
            [document.id],
            force_successor=True,
            checkpoint_source_intent_id=source.id,
        )
        == 1
    )
    assert (
        repository.repair_completed_summary_intents(
            DatasetRef("workspace-1", "dataset-1"),
            [document.id],
            force_successor=True,
            checkpoint_source_intent_id=source.id,
        )
        == 0
    )

    with sqlite_session_factory() as session:
        intents = session.scalars(select(KnowledgeTaskOutbox)).all()
        assert len(intents) == 2
        successor = next(intent for intent in intents if intent.id != source.id)
        assert successor.payload["recovery_source_intent_id"] == source.id


def test_current_generation_repair_intent_uses_latest_document_state(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    dataset = _dataset("dataset-1", "workspace-1")
    dataset.indexing_technique = "high_quality"
    dataset.embedding_model_provider = "provider-1"
    dataset.embedding_model = "embedding-1"
    dataset.summary_index_setting = {"enable": True, "model": "summary-1"}
    document = _document("document-1", status=IndexingStatus.COMPLETED)
    document.indexing_generation = "successor-generation"
    document.need_summary = True
    checkpoint_identity = {
        "document_id": document.id,
        "document_generation": "successor-generation",
        "segment_generation": "segment-generation",
        "indexing_technique": "high_quality",
        "embedding_model_provider": "provider-1",
        "embedding_model": "embedding-1",
        "summary_index_setting": {"enable": True, "model": "summary-1"},
        "summary_id": "summary-1",
        "summary_content_fingerprint": summary_content_fingerprint("summary content"),
        "vector_node_id": "summary-node-1",
        "vector_content_hash": "summary-hash-1",
    }
    segment = DocumentSegment(
        tenant_id=dataset.tenant_id,
        dataset_id=dataset.id,
        document_id=document.id,
        position=1,
        content="indexed content",
        word_count=2,
        tokens=2,
        created_by="account-1",
        status=SegmentStatus.COMPLETED,
        indexing_generation="segment-generation",
    )
    segment.id = "segment-1"
    summary = DocumentSegmentSummary(
        dataset_id=dataset.id,
        document_id=document.id,
        chunk_id=segment.id,
        summary_content="summary content",
        summary_index_node_id="summary-node-1",
        summary_index_node_hash="summary-hash-1",
        status=SummaryStatus.COMPLETED,
        enabled=True,
    )
    summary.id = "summary-1"
    with sqlite_session_factory.begin() as session:
        session.add_all(
            [
                dataset,
                document,
                segment,
                summary,
                KnowledgeTaskOutbox(
                    tenant_id=dataset.tenant_id,
                    dataset_id=dataset.id,
                    document_id=document.id,
                    resource_id=document.id,
                    task_kind="document_summary_index",
                    payload={
                        "tenant_id": dataset.tenant_id,
                        "dataset_id": dataset.id,
                        "document_id": document.id,
                        "expected_generation": "successor-generation",
                        "segment_ids": None,
                        "expected_indexing_technique": "high_quality",
                        "expected_embedding_model_provider": "provider-1",
                        "expected_embedding_model": "embedding-1",
                        "expected_summary_index_setting": {"enable": True, "model": "summary-1"},
                        "summary_generated_segments": {
                            "segment-1": checkpoint_identity,
                            "missing-segment": checkpoint_identity,
                        },
                        "summary_completed_segments": {
                            "segment-1": checkpoint_identity,
                            "missing-segment": checkpoint_identity,
                        },
                    },
                    status="executing",
                ),
            ]
        )
    woken: list[str] = []
    repository = SQLAlchemyDocumentRepository(
        session_factory=sqlite_session_factory,
        wake_after_commit=lambda _session: woken.append("wake"),
    )

    assert repository.enqueue_current_indexing_repairs(
        DatasetRef("workspace-1", "dataset-1"), ["document-1"], actor_id="repair-actor"
    )

    with sqlite_session_factory() as session:
        persisted = session.get(Document, "document-1")
        intents = session.scalars(select(KnowledgeTaskOutbox)).all()
        assert persisted is not None
        assert persisted.indexing_generation != "successor-generation"
        state_intent = next(intent for intent in intents if intent.task_kind == "document_index_state")
        assert state_intent.payload == {
            "document_id": "document-1",
            "generation": persisted.indexing_generation,
            "action": "add",
        }
        summary_intents = [intent for intent in intents if intent.task_kind == "document_summary_index"]
        assert len(summary_intents) == 2
        successor = next(
            intent
            for intent in summary_intents
            if intent.payload["expected_generation"] == persisted.indexing_generation
        )
        expected_successor_identity = dict(checkpoint_identity)
        expected_successor_identity["document_generation"] = persisted.indexing_generation
        assert successor.payload == {
            "tenant_id": dataset.tenant_id,
            "dataset_id": dataset.id,
            "document_id": document.id,
            "expected_generation": persisted.indexing_generation,
            "segment_ids": None,
            "expected_indexing_technique": "high_quality",
            "expected_embedding_model_provider": "provider-1",
            "expected_embedding_model": "embedding-1",
            "expected_summary_index_setting": {"enable": True, "model": "summary-1"},
            "summary_generated_segments": {"segment-1": expected_successor_identity},
            "summary_completed_segments": {"segment-1": expected_successor_identity},
        }
    assert woken == ["wake"]


def test_current_generation_repair_restores_incomplete_and_disabled_documents(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    with sqlite_session_factory.begin() as session:
        incomplete = _document("document-1", status=IndexingStatus.PARSING)
        incomplete.indexing_generation = "incomplete-generation"
        disabled = _document("document-2", status=IndexingStatus.PARSING)
        disabled.indexing_generation = "disabled-generation"
        disabled.enabled = False
        session.add_all([_dataset("dataset-1", "workspace-1"), incomplete, disabled])
    woken: list[str] = []
    repository = SQLAlchemyDocumentRepository(
        session_factory=sqlite_session_factory,
        wake_after_commit=lambda _session: woken.append("wake"),
    )

    assert repository.enqueue_current_indexing_repairs(
        DatasetRef("workspace-1", "dataset-1"),
        ["document-1", "document-2"],
        actor_id="repair-actor",
    )

    with sqlite_session_factory() as session:
        persisted_incomplete = session.get(Document, "document-1")
        persisted_disabled = session.get(Document, "document-2")
        intents = session.scalars(select(KnowledgeTaskOutbox).order_by(KnowledgeTaskOutbox.task_kind)).all()
        assert persisted_incomplete is not None
        assert persisted_disabled is not None
        assert persisted_incomplete.indexing_generation == "incomplete-generation"
        assert persisted_disabled.indexing_generation != "disabled-generation"
        assert [(intent.task_kind, intent.payload) for intent in intents] == [
            (
                "document_index_retry",
                {
                    "tenant_id": "workspace-1",
                    "dataset_id": "dataset-1",
                    "document_ids": ["document-1"],
                    "actor_id": "repair-actor",
                    "lock_tokens": {},
                    "generations": {"document-1": persisted_incomplete.indexing_generation},
                    "repair": True,
                },
            ),
            (
                "document_index_state",
                {
                    "document_id": "document-2",
                    "generation": persisted_disabled.indexing_generation,
                    "action": "remove",
                },
            ),
        ]
    assert woken == ["wake"]


def test_current_generation_repair_assigns_generation_to_legacy_document(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    with sqlite_session_factory.begin() as session:
        document = _document("document-1", status=IndexingStatus.PARSING)
        document.indexing_generation = None
        session.add_all([_dataset("dataset-1", "workspace-1"), document])
    repository = SQLAlchemyDocumentRepository(session_factory=sqlite_session_factory)

    assert repository.enqueue_current_indexing_repairs(
        DatasetRef("workspace-1", "dataset-1"), ["document-1"], actor_id="repair-actor"
    )

    with sqlite_session_factory() as session:
        persisted = session.get(Document, "document-1")
        intent = session.scalar(select(KnowledgeTaskOutbox))
        assert persisted is not None
        assert persisted.indexing_generation is not None
        assert intent is not None
        assert intent.task_kind == "document_index_retry"
        assert intent.payload["generations"] == {"document-1": persisted.indexing_generation}
        assert intent.payload["repair"] is True


def test_pipeline_payload_recovery_persists_one_exact_generation_repair(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    document = _document("document-1", status=IndexingStatus.PARSING)
    document.indexing_generation = "current-generation"
    with sqlite_session_factory.begin() as session:
        session.add_all([_dataset("dataset-1", "workspace-1"), document])
    wakes: list[str] = []
    repository = SQLAlchemyDocumentRepository(
        session_factory=sqlite_session_factory,
        wake_after_commit=lambda _session: wakes.append("wake"),
    )
    ref = DatasetRef("workspace-1", "dataset-1").document(document.id)

    assert repository.enqueue_pipeline_payload_recovery(
        ref,
        expected_generation="current-generation",
        actor_id="repair-actor",
    )
    assert not repository.enqueue_pipeline_payload_recovery(
        ref,
        expected_generation="current-generation",
        actor_id="repair-actor",
    )

    with sqlite_session_factory() as session:
        intents = session.scalars(select(KnowledgeTaskOutbox)).all()
        assert len(intents) == 1
        assert intents[0].task_kind == "document_index_retry"
        assert intents[0].payload == {
            "tenant_id": "workspace-1",
            "dataset_id": "dataset-1",
            "document_ids": [document.id],
            "actor_id": "repair-actor",
            "lock_tokens": {},
            "generations": {document.id: "current-generation"},
            "repair": True,
        }
    assert wakes == ["wake"]


@pytest.mark.parametrize(
    ("status", "enabled", "archived", "paused", "expected_generation"),
    [
        (IndexingStatus.PARSING, True, False, False, "stale-generation"),
        (IndexingStatus.COMPLETED, True, False, False, "current-generation"),
        (IndexingStatus.PARSING, False, False, False, "current-generation"),
        (IndexingStatus.PARSING, True, True, False, "current-generation"),
        (IndexingStatus.PARSING, True, False, True, "current-generation"),
    ],
)
def test_pipeline_payload_recovery_skips_noncurrent_or_inactive_target(
    sqlite_session_factory: sessionmaker[Session],
    status: str,
    enabled: bool,
    archived: bool,
    paused: bool,
    expected_generation: str,
) -> None:
    document = _document("document-1", status=status, enabled=enabled, archived=archived)
    document.indexing_generation = "current-generation"
    document.is_paused = paused
    with sqlite_session_factory.begin() as session:
        session.add_all([_dataset("dataset-1", "workspace-1"), document])
    repository = SQLAlchemyDocumentRepository(session_factory=sqlite_session_factory)

    assert not repository.enqueue_pipeline_payload_recovery(
        DatasetRef("workspace-1", "dataset-1").document(document.id),
        expected_generation=expected_generation,
    )

    with sqlite_session_factory() as session:
        assert session.scalar(select(KnowledgeTaskOutbox)) is None


@pytest.mark.parametrize("active_status", ["pending", "processing", "dispatched", "executing", "completed"])
def test_legacy_indexing_conversion_dedupes_an_exact_active_or_completed_intent(
    sqlite_session_factory: sessionmaker[Session],
    active_status: str,
) -> None:
    document = _document("document-1", status=IndexingStatus.PARSING)
    document.indexing_generation = "generation-1"
    with sqlite_session_factory.begin() as session:
        session.add_all([_dataset("dataset-1", "workspace-1"), document])
        session.add(
            KnowledgeTaskOutbox(
                tenant_id="workspace-1",
                dataset_id="dataset-1",
                resource_id="dataset-1",
                task_kind="document_index_create",
                payload={"document_ids": [document.id], "generations": {document.id: "generation-1"}},
                status=active_status,
            )
        )
    repository = SQLAlchemyDocumentRepository(session_factory=sqlite_session_factory)

    assert not repository.convert_legacy_indexing_deliveries("dataset-1", [document.id])

    with sqlite_session_factory() as session:
        assert len(session.scalars(select(KnowledgeTaskOutbox)).all()) == 1


@pytest.mark.parametrize("terminal_status", ["failed", "cancelled", "superseded"])
def test_legacy_indexing_conversion_repairs_terminal_generation_without_rotating_it(
    sqlite_session_factory: sessionmaker[Session],
    terminal_status: str,
) -> None:
    document = _document("document-1", status=IndexingStatus.ERROR)
    document.indexing_generation = "generation-1"
    document.error = "provider unavailable"
    with sqlite_session_factory.begin() as session:
        session.add_all([_dataset("dataset-1", "workspace-1"), document])
        session.add(
            KnowledgeTaskOutbox(
                tenant_id="workspace-1",
                dataset_id="dataset-1",
                document_id=document.id,
                resource_id=document.id,
                task_kind="document_index_update",
                payload={"document_id": document.id, "generation": "generation-1"},
                status=terminal_status,
            )
        )
    repository = SQLAlchemyDocumentRepository(session_factory=sqlite_session_factory)

    assert repository.convert_legacy_indexing_deliveries("dataset-1", [document.id], actor_id="repair-actor")

    with sqlite_session_factory() as session:
        persisted = session.get(Document, document.id)
        intents = session.scalars(select(KnowledgeTaskOutbox).order_by(KnowledgeTaskOutbox.created_at)).all()
        assert persisted is not None
        assert persisted.indexing_generation == "generation-1"
        assert persisted.error == "provider unavailable"
        assert [intent.task_kind for intent in intents] == ["document_index_update", "document_index_retry"]
        assert intents[-1].payload["generations"] == {document.id: "generation-1"}
        assert intents[-1].payload["repair"] is True
