from collections.abc import Iterator, Mapping, Sequence
from contextlib import nullcontext
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Literal, Protocol, cast
from unittest.mock import create_autospec, patch

import pytest
from sqlalchemy import event, select
from sqlalchemy.dialects import mysql, postgresql
from sqlalchemy.engine import Connection
from sqlalchemy.orm import Session, sessionmaker

from core.credit_usage import CreditUsageCreatedBy
from core.errors.error import LLMBadRequestError, ProviderTokenNotInitError
from core.model_context import get_credit_usage_metadata
from core.model_manager import ModelManager
from core.rag.index_processor.constant.index_type import IndexStructureType, IndexTechniqueType
from core.rag.index_processor.index_processor_base import SummaryIndexSettingDict
from core.rag.index_processor.processor.paragraph_index_processor import ParagraphIndexProcessor
from core.rag.models.document import ChildDocument
from core.rag.models.document import Document as IndexDocument
from extensions.storage.storage_type import StorageType
from graphon.model_runtime.entities.llm_entities import LLMResult, LLMUsage
from graphon.model_runtime.entities.message_entities import AssistantPromptMessage
from libs.helper import generate_text_hash
from libs.pagination import PaginatedResult
from machinery.context import RequestContext
from models.dataset import (
    ChildChunk,
    Dataset,
    Document,
    DocumentSegment,
    DocumentSegmentSummary,
    SegmentAttachmentBinding,
)
from models.enums import CreatorUserRole, DocumentCreatedFrom, IndexingStatus, SegmentStatus, SummaryStatus
from models.knowledge_task import KnowledgeTaskOutbox
from models.model import KnowledgeUploadFileReference, UploadFile
from repositories.knowledge.dataset_repository import SQLAlchemyDatasetRepository
from repositories.knowledge.segment_repository import (
    SQLAlchemySegmentRepository,
    _segment_status_candidates_query,
    _segment_status_update_statement,
)
from repositories.knowledge.upload_file_repository import SQLAlchemyKnowledgeUploadRepository
from repositories.workspace.workspace_repository import WorkspaceRepository
from services.knowledge.dataset_access import DatasetAccessService
from services.knowledge.entities.segments import ChildChunkUpdateArgs, SegmentUpdateArgs
from services.knowledge.resource_scope import DatasetRef, DocumentRef, SegmentRef
from services.knowledge.segments.adapters import (
    CelerySegmentBatchImportDispatcher,
    ModelManagerSegmentGuard,
    RedisSegmentIndexingState,
    SegmentPresentationAdapter,
)
from services.knowledge.segments.application import (
    ChildChunkIndexingApplicationError,
    DatasetSegmentApplicationService,
    SegmentBatchImportDispatcher,
    SegmentDocumentIndexingError,
    SegmentDocumentNotCompletedError,
    SegmentIndex,
    SegmentIndexingState,
    SegmentMixedStatusUpdateError,
    SegmentModelGuard,
    SegmentModelProviderError,
)
from services.knowledge.segments.contracts import (
    SegmentChildIndexCompletion,
    SegmentDatasetRecord,
    SegmentDetail,
    SegmentDocumentCreationState,
    SegmentDocumentRecord,
    SegmentIndexReconcileOutcome,
    SegmentListFilter,
    SegmentMutationScope,
)


def _noop_wake_after_commit(_session: Session) -> None:
    pass


@dataclass
class SegmentLimitsStub:
    SINGLE_CHUNK_ATTACHMENT_LIMIT: int = 10
    DATASET_MAX_SEGMENTS_PER_REQUEST: int = 100


def test_celery_dispatcher_preserves_task_argument_order() -> None:
    calls: list[tuple[str, ...]] = []

    def delay(*args: str) -> None:
        calls.append(args)

    dispatcher = CelerySegmentBatchImportDispatcher(delay=delay)
    dispatcher.dispatch(
        job_id="job-1",
        upload_file_id="file-1",
        dataset_id="dataset-1",
        document_id="document-1",
        workspace_id="workspace-1",
        actor_id="account-1",
    )

    assert calls == [("job-1", "file-1", "dataset-1", "document-1", "workspace-1", "account-1")]


def _dataset(dataset_id: str, workspace_id: str, *, permission: str = "partial_members") -> Dataset:
    return Dataset(
        id=dataset_id,
        tenant_id=workspace_id,
        name="Dataset",
        description="",
        provider="vendor",
        permission=permission,
        indexing_technique="economy",
        created_by="account-1",
        maintainer="maintainer-1",
    )


def _document(document_id: str, workspace_id: str, dataset_id: str) -> Document:
    return Document(
        id=document_id,
        tenant_id=workspace_id,
        dataset_id=dataset_id,
        position=1,
        data_source_type="upload_file",
        batch="batch-1",
        name="Document",
        created_from=DocumentCreatedFrom.API,
        created_by="account-1",
        doc_form="text_model",
        word_count=0,
        indexing_status=IndexingStatus.COMPLETED,
    )


def _segment(segment_id: str, workspace_id: str, dataset_id: str, document_id: str) -> DocumentSegment:
    segment = DocumentSegment(
        tenant_id=workspace_id,
        dataset_id=dataset_id,
        document_id=document_id,
        position=1,
        content="content",
        word_count=7,
        tokens=2,
        created_by="account-1",
        status=SegmentStatus.COMPLETED,
    )
    segment.id = segment_id
    return segment


def _upload(file_id: str, workspace_id: str, name: str) -> UploadFile:
    upload = UploadFile(
        tenant_id=workspace_id,
        storage_type=StorageType.OPENDAL,
        key=f"key-{file_id}",
        name=name,
        size=1,
        extension="csv",
        mime_type="text/csv",
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by="account-1",
        created_at=datetime(2026, 1, 1),
        used=False,
    )
    upload.id = file_id
    return upload


def test_scope_lookup_enforces_owner_chain(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    with sqlite_session_factory.begin() as session:
        session.add(_dataset("dataset-1", "workspace-1"))
        session.add(_document("document-1", "workspace-1", "dataset-1"))

    store = SQLAlchemyDatasetRepository(
        revoke_keys_after_commit=lambda _session, _tokens: None,
        session_factory=sqlite_session_factory,
        wake_after_commit=lambda _session: None,
    )
    scope = store.get_segment_scope(
        dataset_ref=DatasetRef("workspace-1", "dataset-1"),
        document_id="document-1",
        actor_id="account-1",
    )

    assert scope.dataset is not None
    assert scope.document is not None
    assert (
        store.get_segment_scope(
            dataset_ref=DatasetRef("workspace-2", "dataset-1"),
            document_id="document-1",
            actor_id="account-1",
        ).dataset
        is None
    )


def test_upload_lookup_is_tenant_scoped(sqlite_session_factory: sessionmaker[Session]) -> None:
    with sqlite_session_factory.begin() as session:
        session.add_all(
            [
                _upload("file-1", "workspace-1", "one.csv"),
                _upload("file-2", "workspace-2", "two.csv"),
            ]
        )

    store = SQLAlchemyKnowledgeUploadRepository(session_factory=sqlite_session_factory)

    assert store.get_file_name(workspace_id="workspace-1", upload_file_id="file-1") == "one.csv"
    assert store.get_file_name(workspace_id="workspace-1", upload_file_id="file-2") is None


def test_segment_lookup_rejects_segment_from_another_owner_chain(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    with sqlite_session_factory.begin() as session:
        session.add_all(
            [
                _dataset("dataset-1", "workspace-1"),
                _dataset("dataset-2", "workspace-2"),
                _document("document-1", "workspace-1", "dataset-1"),
                _document("document-2", "workspace-2", "dataset-2"),
                _segment("segment-1", "workspace-2", "dataset-2", "document-2"),
            ]
        )

    store = SQLAlchemySegmentRepository(
        session_factory=sqlite_session_factory, wake_after_commit=_noop_wake_after_commit
    )
    assert store.get_segment(DatasetRef("workspace-1", "dataset-1").document("document-1").segment("segment-2")) is None


@pytest.mark.parametrize("owner_field", ["tenant_id", "dataset_id", "document_id"])
def test_segment_update_state_enforces_complete_owner_chain(
    sqlite_session_factory: sessionmaker[Session], owner_field: str
) -> None:
    with sqlite_session_factory.begin() as session:
        segment = _segment("segment-1", "workspace-1", "dataset-1", "document-1")
        setattr(segment, owner_field, "foreign-owner")
        session.add(segment)
    store = SQLAlchemySegmentRepository(
        session_factory=sqlite_session_factory, wake_after_commit=_noop_wake_after_commit
    )
    ref = DatasetRef("workspace-1", "dataset-1").document("document-1").segment("segment-1")

    assert store.get_segment_update_state(ref) is None


def test_empty_segment_list_returns_materialized_page(sqlite_session_factory: sessionmaker[Session]) -> None:
    with sqlite_session_factory.begin() as session:
        session.add(_dataset("dataset-1", "workspace-1"))
        session.add(_document("document-1", "workspace-1", "dataset-1"))

    store = SQLAlchemySegmentRepository(
        session_factory=sqlite_session_factory, wake_after_commit=_noop_wake_after_commit
    )
    with patch("repositories.knowledge.segment_repository.dify_config") as config:
        config.SQLALCHEMY_DATABASE_URI_SCHEME = "mysql"
        result = store.list_segments(
            DatasetRef("workspace-1", "dataset-1").document("document-1"),
            SegmentListFilter(page=1, limit=20, keyword="missing"),
        )

    assert result.items == ()
    assert result.total == 0
    assert result.limit == 20


def test_segment_pagination_uses_id_to_break_duplicate_position_ties(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    with sqlite_session_factory.begin() as session:
        session.add(_dataset("dataset-1", "workspace-1"))
        session.add(_document("document-1", "workspace-1", "dataset-1"))
        session.add_all(
            [
                _segment("segment-c", "workspace-1", "dataset-1", "document-1"),
                _segment("segment-a", "workspace-1", "dataset-1", "document-1"),
                _segment("segment-b", "workspace-1", "dataset-1", "document-1"),
            ]
        )

    store = SQLAlchemySegmentRepository(
        session_factory=sqlite_session_factory, wake_after_commit=_noop_wake_after_commit
    )
    document_ref = DatasetRef("workspace-1", "dataset-1").document("document-1")

    ids = [
        store.list_segments(document_ref, SegmentListFilter(page=page, limit=1)).items[0].values["id"]
        for page in (1, 2, 3)
    ]

    assert ids == ["segment-a", "segment-b", "segment-c"]


def test_segment_status_statements_compile_for_regular_mysql_without_update_returning() -> None:
    document_ref = DatasetRef("workspace-1", "dataset-1").document("document-1")
    candidates_sql = str(
        _segment_status_candidates_query(document_ref, ("segment-1",), enabled=True).compile(dialect=mysql.dialect())
    ).upper()
    update_sql = str(
        _segment_status_update_statement(
            document_ref,
            ("segment-1",),
            enabled=True,
            actor_id="account-1",
            now=datetime(2026, 1, 1),
            generation="11111111-1111-1111-1111-111111111111",
        ).compile(dialect=mysql.dialect())
    ).upper()

    assert "FOR UPDATE" in candidates_sql
    assert "RETURNING" not in update_sql


def test_create_segments_persists_ordered_batch_and_updates_document_word_count(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    with sqlite_session_factory.begin() as session:
        session.add(_dataset("dataset-1", "workspace-1"))
        session.add(_document("document-1", "workspace-1", "dataset-1"))
    store = SQLAlchemySegmentRepository(
        session_factory=sqlite_session_factory, wake_after_commit=_noop_wake_after_commit
    )
    document_ref = DatasetRef("workspace-1", "dataset-1").document("document-1")

    store.create_segments(
        document_ref,
        (
            {
                "id": "segment-1",
                "content": "first",
                "word_count": 5,
                "tokens": 1,
                "created_by": "account-1",
                "status": SegmentStatus.COMPLETED,
            },
            {
                "id": "segment-2",
                "content": "second",
                "word_count": 6,
                "tokens": 1,
                "created_by": "account-1",
                "status": SegmentStatus.COMPLETED,
            },
        ),
        attachment_ids_list=((), ()),
        generation="11111111-1111-1111-1111-111111111111",
        batch_job_id=None,
    )

    with sqlite_session_factory() as session:
        segments = list(session.scalars(select(DocumentSegment).order_by(DocumentSegment.position.asc())))
        document = session.get(Document, "document-1")
    assert [(segment.id, segment.position) for segment in segments] == [("segment-1", 1), ("segment-2", 2)]
    assert document is not None
    assert document.word_count == 11


@pytest.mark.parametrize(
    ("status", "enabled", "archived"),
    [("indexing", True, False), ("completed", False, False), ("completed", True, True)],
)
def test_create_segments_rechecks_document_ready_inside_write_transaction(
    sqlite_session_factory: sessionmaker[Session], status: str, enabled: bool, archived: bool
) -> None:
    with sqlite_session_factory.begin() as session:
        session.add(_dataset("dataset-1", "workspace-1"))
        document = _document("document-1", "workspace-1", "dataset-1")
        document.indexing_status = status
        document.enabled = enabled
        document.archived = archived
        session.add(document)
    store = SQLAlchemySegmentRepository(
        session_factory=sqlite_session_factory, wake_after_commit=_noop_wake_after_commit
    )

    state = store.create_segments(
        DatasetRef("workspace-1", "dataset-1").document("document-1"),
        ({"id": "segment-1", "content": "content", "word_count": 7, "tokens": 1, "created_by": "actor"},),
        attachment_ids_list=((),),
        generation="11111111-1111-1111-1111-111111111111",
        batch_job_id=None,
    )

    assert state is not None
    assert (state.indexing_status, state.enabled, state.archived) == (status, enabled, archived)
    with sqlite_session_factory() as session:
        assert session.get(DocumentSegment, "segment-1") is None


def test_created_segment_completion_is_idempotent_and_generation_scoped(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    first_generation = "11111111-1111-1111-1111-111111111111"
    second_generation = "22222222-2222-2222-2222-222222222222"
    with sqlite_session_factory.begin() as session:
        session.add(_dataset("dataset-1", "workspace-1"))
        session.add(_document("document-1", "workspace-1", "dataset-1"))
        first = _segment("segment-1", "workspace-1", "dataset-1", "document-1")
        first.status = SegmentStatus.INDEXING
        first.indexing_generation = first_generation
        second = _segment("segment-2", "workspace-1", "dataset-1", "document-1")
        second.status = SegmentStatus.INDEXING
        second.indexing_generation = second_generation
        session.add_all([first, second])

    store = SQLAlchemySegmentRepository(
        session_factory=sqlite_session_factory,
        wake_after_commit=_noop_wake_after_commit,
    )
    document_ref = DatasetRef("workspace-1", "dataset-1").document("document-1")

    assert (
        store.complete_created_segments(
            document_ref,
            ("segment-1", "segment-2"),
            generation=first_generation,
        )
        == 1
    )
    assert (
        store.complete_created_segments(
            document_ref,
            ("segment-1",),
            generation=first_generation,
        )
        == 0
    )
    assert (
        store.fail_created_segments(
            document_ref,
            ("segment-1", "segment-2"),
            generation=second_generation,
            error="provider unavailable",
        )
        == 1
    )

    with sqlite_session_factory() as session:
        first = session.get(DocumentSegment, "segment-1")
        second = session.get(DocumentSegment, "segment-2")
        assert first is not None
        assert first.status == SegmentStatus.COMPLETED
        assert first.enabled
        assert second is not None
        assert second.status == SegmentStatus.ERROR
        assert not second.enabled
        assert second.error == "provider unavailable"


def test_child_reconcile_owns_parent_and_batch_terminal_state(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    generation = "11111111-1111-1111-1111-111111111111"
    with sqlite_session_factory.begin() as session:
        session.add(_dataset("dataset-1", "workspace-1"))
        session.add(_document("document-1", "workspace-1", "dataset-1"))
        rows = [
            _segment("segment-1", "workspace-1", "dataset-1", "document-1"),
            _segment("segment-2", "workspace-1", "dataset-1", "document-1"),
            _segment("segment-3", "workspace-1", "dataset-1", "document-1"),
        ]
        for row in rows:
            row.status = SegmentStatus.INDEXING
            row.indexing_generation = generation
        session.add_all(rows)
    store = SQLAlchemySegmentRepository(
        session_factory=sqlite_session_factory,
        wake_after_commit=_noop_wake_after_commit,
    )
    document_ref = DatasetRef("workspace-1", "dataset-1").document("document-1")
    completion = SegmentChildIndexCompletion(generation, ("segment-1", "segment-2"), "job-1")

    assert (
        store.complete_child_reconcile(document_ref.segment("segment-1"), completion)
        == SegmentIndexReconcileOutcome.WAITING
    )
    assert (
        store.complete_child_reconcile(document_ref.segment("segment-2"), completion)
        == SegmentIndexReconcileOutcome.COMPLETED
    )
    assert not store.fail_child_reconcile(
        document_ref.segment("segment-1"),
        SegmentChildIndexCompletion("22222222-2222-2222-2222-222222222222", ("segment-1",)),
        error="stale failure",
    )
    assert store.fail_child_reconcile(
        document_ref.segment("segment-3"),
        SegmentChildIndexCompletion(generation, ("segment-3",), "job-2"),
        error="child vector unavailable",
    )

    with sqlite_session_factory() as session:
        rows = session.scalars(select(DocumentSegment).order_by(DocumentSegment.id)).all()
        assert [row.status for row in rows] == [
            SegmentStatus.COMPLETED,
            SegmentStatus.COMPLETED,
            SegmentStatus.ERROR,
        ]
        assert rows[0].enabled
        assert rows[1].enabled
        assert not rows[2].enabled
        assert rows[2].error == "child vector unavailable"


def test_postgresql_keyword_filter_keeps_json_array_guard(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    with sqlite_session_factory.begin() as session:
        session.add(_dataset("dataset-1", "workspace-1"))
        session.add(_document("document-1", "workspace-1", "dataset-1"))

    page = PaginatedResult[DocumentSegment](items=[], total=0, page=1, per_page=20)
    store = SQLAlchemySegmentRepository(
        session_factory=sqlite_session_factory, wake_after_commit=_noop_wake_after_commit
    )
    with (
        patch("repositories.knowledge.segment_repository.dify_config") as config,
        patch("repositories.knowledge.segment_repository.paginate_query", return_value=page) as paginate,
    ):
        config.SQLALCHEMY_DATABASE_URI_SCHEME = "postgresql"
        store.list_segments(
            DatasetRef("workspace-1", "dataset-1").document("document-1"),
            SegmentListFilter(keyword="知识"),
        )

    statement = paginate.call_args.args[0]
    sql = str(statement.compile(dialect=postgresql.dialect()))
    assert "jsonb_typeof" in sql
    assert "jsonb_array_elements_text" in sql
    assert "CASE WHEN" in sql


def _application(
    factory: sessionmaker[Session], *, indexing: SegmentIndex | None = None
) -> DatasetSegmentApplicationService:
    datasets = SQLAlchemyDatasetRepository(
        revoke_keys_after_commit=lambda _session, _tokens: None,
        session_factory=factory,
        wake_after_commit=lambda _session: None,
    )
    index = create_autospec(SegmentIndex, instance=True, spec_set=True)
    index.count_tokens.return_value = 0
    index.count_tokens_many.side_effect = lambda _dataset, texts: [0] * len(texts)
    state = create_autospec(SegmentIndexingState, instance=True, spec_set=True)
    state.is_segment_indexing.return_value = False
    state.is_document_indexing.return_value = False
    state.lock.return_value = nullcontext()
    return DatasetSegmentApplicationService(
        dataset_access=DatasetAccessService(
            datasets=datasets,
            workspace_roles=WorkspaceRepository(session_factory=factory),
            legacy_permissions_enabled=False,
        ),
        scopes=datasets,
        store=SQLAlchemySegmentRepository(session_factory=factory, wake_after_commit=lambda _session: None),
        presenter=SegmentPresentationAdapter(),
        limits=SegmentLimitsStub(),
        text_hash=generate_text_hash,
        index=indexing or index,
        uploads=SQLAlchemyKnowledgeUploadRepository(session_factory=factory),
        model_guard=create_autospec(SegmentModelGuard, instance=True, spec_set=True),
        indexing_state=state,
        batch_dispatcher=create_autospec(SegmentBatchImportDispatcher, instance=True, spec_set=True),
        job_id_factory=lambda: "job-1",
    )


def _complete_pending_child_reconcile(
    app: DatasetSegmentApplicationService,
    factory: sessionmaker[Session],
    segment_ref: SegmentRef,
) -> None:
    with factory() as session:
        segment = session.get(DocumentSegment, segment_ref.segment_id)
        assert segment is not None
        assert segment.indexing_generation is not None
        intent = next(
            row
            for row in session.scalars(
                select(KnowledgeTaskOutbox).where(
                    KnowledgeTaskOutbox.task_kind == "segment_index_reconcile",
                    KnowledgeTaskOutbox.resource_id == segment_ref.segment_id,
                )
            )
            if row.payload["parent_generation"] == segment.indexing_generation
        )
        completion = SegmentChildIndexCompletion(
            segment.indexing_generation,
            tuple(cast(list[str], intent.payload["batch_segment_ids"])),
        )
        delete_node_ids = tuple(cast(list[str], intent.payload["delete_node_ids"]))

    assert (
        app.mutations.reconcile_children_index(
            segment_ref,
            delete_node_ids=delete_node_ids,
            completion=completion,
        )
        == SegmentIndexReconcileOutcome.COMPLETED
    )


def test_mutations_use_request_actor_without_a_flask_request(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    with sqlite_session_factory.begin() as session:
        session.add(_dataset("dataset-1", "workspace-1"))
        session.add(_document("document-1", "workspace-1", "dataset-1"))
    app = _application(sqlite_session_factory)
    context = RequestContext("request-1", None, "author-1", "workspace-1")
    created = app.create_segment(
        context, dataset_id="dataset-1", document_id="document-1", values={"content": "original"}
    )
    assert created.data.created_by == "author-1"
    with sqlite_session_factory.begin() as session:
        segment = session.get(DocumentSegment, created.data.id)
        assert segment is not None
        segment.status = SegmentStatus.COMPLETED
    updated = app.update_segment(
        RequestContext("request-2", None, "editor-2", "workspace-1"),
        dataset_id="dataset-1",
        document_id="document-1",
        segment_id=created.data.id,
        values={"content": "updated content"},
    )
    assert updated.data.updated_by == "editor-2"
    assert updated.data.content == "updated content"
    assert isinstance(updated.data.created_at, datetime)
    with sqlite_session_factory() as session:
        segment = session.get(DocumentSegment, created.data.id)
        assert segment is not None
        assert segment.created_by == "author-1"
        assert segment.updated_by == "editor-2"
        assert segment.status == SegmentStatus.COMPLETED


def test_list_reads_dataset_and_document_once(sqlite_session_factory: sessionmaker[Session]) -> None:
    with sqlite_session_factory.begin() as session:
        session.add(_dataset("dataset-1", "workspace-1"))
        session.add(_document("document-1", "workspace-1", "dataset-1"))
    statements: list[str] = []
    engine = sqlite_session_factory.kw["bind"]

    def record(_conn, _cursor, statement: str, _parameters, _context, _executemany) -> None:
        statements.append(statement)

    event.listen(engine, "before_cursor_execute", record)
    try:
        page = _application(sqlite_session_factory).list_segments(
            RequestContext("request-1", None, "account-1", "workspace-1"),
            dataset_id="dataset-1",
            document_id="document-1",
            query=SegmentListFilter(),
        )
    finally:
        event.remove(engine, "before_cursor_execute", record)
    assert page.items == ()
    assert sum("FROM datasets" in statement for statement in statements) == 1
    # Admission loads the scope once; the repository independently revalidates
    # the complete owner chain while detaching the response snapshot.
    assert sum("JOIN documents" in statement or "FROM documents" in statement for statement in statements) == 3


@pytest.mark.parametrize(
    ("error", "kind"),
    [
        (LLMBadRequestError(), "bad_request"),
        (ProviderTokenNotInitError("token missing"), "token"),
    ],
)
def test_model_guard_translates_provider_errors(error: Exception, kind: str) -> None:
    from core.model_manager import ModelManager

    model = create_autospec(ModelManager, instance=True, spec_set=True)
    model.get_model_instance.side_effect = error
    dataset = SegmentDatasetRecord(
        id="dataset-1",
        workspace_id="workspace-1",
        indexing_technique="high_quality",
        embedding_model_provider="provider",
        embedding_model="model",
    )

    with patch("services.knowledge.segments.adapters.ModelManager.for_tenant", return_value=model):
        with pytest.raises(SegmentModelProviderError) as raised:
            ModelManagerSegmentGuard().check(dataset)

    assert raised.value.kind == kind


def test_redis_state_uses_existing_keys_and_decodes_status() -> None:
    from services.knowledge.indexing.locks import KnowledgeIndexingLock

    redis = RedisStateProbe(
        values={"document_document-1_indexing": b"running", "segment_batch_import_job-1": b"completed"}
    )
    locks = create_autospec(KnowledgeIndexingLock, instance=True, spec_set=True)
    state = RedisSegmentIndexingState(redis, locks=locks)

    assert state.is_document_indexing("document-1") is True
    state.set_batch_waiting("job-1")
    assert state.get_batch_status("job-1") == "completed"
    state.set_batch_waiting("job-2")
    assert state.get_batch_status("job-2") == "waiting"
    assert redis.expirations["segment_batch_import_job-2"] > 900


def test_child_chunk_mutations_preserve_explicit_actors(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    with sqlite_session_factory.begin() as session:
        session.add(_dataset("dataset-1", "workspace-1"))
        document = _document("document-1", "workspace-1", "dataset-1")
        document.doc_form = IndexStructureType.PARENT_CHILD_INDEX
        session.add(document)
        session.add(_segment("segment-1", "workspace-1", "dataset-1", "document-1"))
    app = _application(sqlite_session_factory)
    created = app.create_child_chunk(
        RequestContext("create", None, "creator", "workspace-1"),
        dataset_id="dataset-1",
        document_id="document-1",
        segment_id="segment-1",
        content="first",
    )
    segment_ref = DatasetRef("workspace-1", "dataset-1").document("document-1").segment("segment-1")
    _complete_pending_child_reconcile(app, sqlite_session_factory, segment_ref)
    app.update_child_chunk(
        RequestContext("update", None, "editor", "workspace-1"),
        dataset_id="dataset-1",
        document_id="document-1",
        segment_id="segment-1",
        child_chunk_id=created.id,
        content="second",
    )
    _complete_pending_child_reconcile(app, sqlite_session_factory, segment_ref)
    with sqlite_session_factory() as session:
        chunk = session.get(ChildChunk, created.id)
        assert chunk is not None
        assert chunk.created_by == "creator"
        assert chunk.updated_by == "editor"
    results = app.update_child_chunks(
        RequestContext("batch", None, "batch-editor", "workspace-1"),
        dataset_id="dataset-1",
        document_id="document-1",
        segment_id="segment-1",
        chunks=[ChildChunkUpdateArgs(id=created.id, content="third"), ChildChunkUpdateArgs(content="new child")],
    )
    with sqlite_session_factory() as session:
        chunks = [session.get(ChildChunk, result.id) for result in results]
        assert len(chunks) == 2
        existing, added = chunks
        assert existing is not None
        assert added is not None
        assert existing.updated_by == "batch-editor"
        assert added.created_by == "batch-editor"


@dataclass
class IndexRedisStub:
    def get(self, name: str | bytes) -> None:
        del name

    def set(self, name: str | bytes, value: object, *, nx: bool = False, ex: int | None = None) -> bool:
        del name, value, nx, ex
        return True

    def setex(self, name: str, time: int, value: object) -> bool:
        del name, time, value
        return True

    def lock(self, name: str, timeout: int) -> nullcontext[None]:
        del name, timeout
        return nullcontext()


@dataclass
class RedisStateProbe:
    values: dict[str, object] = field(default_factory=dict)
    expirations: dict[str, int] = field(default_factory=dict)

    def get(self, name: str | bytes) -> object | None:
        assert isinstance(name, str)
        return self.values.get(name)

    def set(self, name: str | bytes, value: object, *, nx: bool = False, ex: int | None = None) -> bool:
        assert isinstance(name, str)
        if nx and name in self.values:
            return False
        self.values[name] = value
        if ex is not None:
            self.expirations[name] = ex
        return True

    def setex(self, name: str, time: int, value: object) -> bool:
        self.values[name] = value
        self.expirations[name] = time
        return True

    def lock(self, name: str, timeout: int) -> nullcontext[None]:
        del name, timeout
        return nullcontext()


@dataclass
class VectorProbe:
    active_transactions: set[Connection]
    fail: bool = False
    writes: int = 0
    deleted_ids: list[str] = field(default_factory=list)
    tasks: list[tuple[str, tuple[object, ...]]] = field(default_factory=list)
    batches: list[tuple[str, ...]] = field(default_factory=list)

    def add_texts(self, documents: Sequence[IndexDocument], **_kwargs: object) -> None:
        assert not self.active_transactions, "Index I/O must not hold a DB transaction"
        self.writes += len(documents)
        if self.fail:
            raise RuntimeError("index unavailable")

    def create(self, documents: Sequence[IndexDocument], **kwargs: object) -> None:
        self.batches.append(tuple(document.page_content for document in documents))
        self.add_texts(documents, **kwargs)

    def delete_by_ids(self, ids: Sequence[str]) -> None:
        assert ids
        assert not self.active_transactions
        if self.fail:
            raise RuntimeError("index unavailable")
        self.deleted_ids.extend(ids)

    def create_multimodal(self, documents: Sequence[IndexDocument], **kwargs: object) -> None:
        assert not self.active_transactions
        assert kwargs["upload_files"]
        self.add_texts(documents)


type IndexingProbe = tuple[DatasetSegmentApplicationService, SQLAlchemySegmentRepository, VectorProbe]


@pytest.fixture
def indexing_probe(
    sqlite_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch
) -> Iterator[IndexingProbe]:
    from services.knowledge.segments import indexing as indexing_module

    with sqlite_session_factory.begin() as session:
        dataset = _dataset("dataset-1", "workspace-1")
        dataset.indexing_technique = IndexTechniqueType.HIGH_QUALITY
        dataset.index_struct = '{"type": "qdrant"}'
        session.add(dataset)
        session.add(_document("document-1", "workspace-1", "dataset-1"))
    engine = sqlite_session_factory.kw["bind"]
    active: set[Connection] = set()
    begin = active.add
    finish = active.discard
    event.listen(engine, "begin", begin)
    event.listen(engine, "commit", finish)
    event.listen(engine, "rollback", finish)
    probe = VectorProbe(active)

    def vector(dataset: Dataset, *, session: Session | None, vector_type: str) -> VectorProbe:
        assert dataset.tenant_id == "workspace-1"
        assert session is None
        assert vector_type == "qdrant"
        assert not active
        return probe

    class TokenModel:
        def get_text_embedding_num_tokens(self, texts: Sequence[str]) -> list[int]:
            assert not active
            return [len(text) for text in texts]

    class ModelLookup:
        def get_model_instance(self, **kwargs: object) -> TokenModel:
            assert kwargs["tenant_id"] == "workspace-1"
            assert not active
            return TokenModel()

    monkeypatch.setattr(indexing_module, "Vector", vector)
    monkeypatch.setattr(indexing_module.ModelManager, "for_tenant", lambda **_kwargs: ModelLookup())
    repository = SQLAlchemySegmentRepository(
        session_factory=sqlite_session_factory, wake_after_commit=_noop_wake_after_commit
    )

    gateway = indexing_module.SegmentIndexingGateway(
        segments=repository,
        uploads=SQLAlchemyKnowledgeUploadRepository(session_factory=sqlite_session_factory),
        redis=IndexRedisStub(),
        new_session=sqlite_session_factory,
    )
    app = _application(sqlite_session_factory, indexing=gateway)
    yield app, repository, probe
    event.remove(engine, "begin", begin)
    event.remove(engine, "commit", finish)
    event.remove(engine, "rollback", finish)


def _create_completed_segment(
    app: DatasetSegmentApplicationService,
    factory: sessionmaker[Session],
    context: RequestContext,
    *,
    dataset_id: str,
    document_id: str,
    values: Mapping[str, object],
) -> SegmentDetail:
    """Create through the public async boundary, then explicitly run its production reconciliation."""

    created = app.create_segment(
        context,
        dataset_id=dataset_id,
        document_id=document_id,
        values=values,
    )
    assert created.data.status == SegmentStatus.INDEXING
    with factory() as session:
        segment = session.get(DocumentSegment, created.data.id)
        assert segment is not None
        generation = segment.indexing_generation
        assert generation is not None
    document_ref = DatasetRef(context.active_workspace_id, dataset_id).document(document_id)
    outcome = app.mutations.reconcile_created_segments(
        document_ref,
        segment_ids=(created.data.id,),
        generation=generation,
    )
    if outcome == SegmentIndexReconcileOutcome.WAITING:
        outcome = app.mutations.reconcile_children_index(
            document_ref.segment(created.data.id),
            delete_node_ids=(),
            completion=SegmentChildIndexCompletion(
                generation=generation,
                batch_segment_ids=(created.data.id,),
            ),
        )
    assert outcome == SegmentIndexReconcileOutcome.COMPLETED
    completed = app.get_segment(
        context,
        dataset_id=dataset_id,
        document_id=document_id,
        segment_id=created.data.id,
    )
    assert completed.data.status == SegmentStatus.COMPLETED
    return completed


@pytest.mark.parametrize("entry", ["single", "batch", "csv"])
def test_all_create_entries_recheck_document_state_inside_the_locked_write(
    entry: str,
    indexing_probe: IndexingProbe,
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    app, _, probe = indexing_probe
    original_get_state = SQLAlchemySegmentRepository.get_document_creation_state
    changed_after_preflight = False

    def get_state_then_change_document(
        repository: SQLAlchemySegmentRepository,
        document_ref: DocumentRef,
    ) -> SegmentDocumentCreationState | None:
        nonlocal changed_after_preflight
        state = original_get_state(repository, document_ref)
        if not changed_after_preflight:
            changed_after_preflight = True
            with sqlite_session_factory.begin() as session:
                document = session.get(Document, document_ref.document_id)
                assert document is not None
                document.indexing_status = IndexingStatus.INDEXING
        return state

    monkeypatch.setattr(SQLAlchemySegmentRepository, "get_document_creation_state", get_state_then_change_document)
    context = RequestContext("create", None, "author", "workspace-1")

    def create() -> object:
        if entry == "single":
            return app.create_segment(
                context,
                dataset_id="dataset-1",
                document_id="document-1",
                values={"content": "first"},
            )
        if entry == "batch":
            return app.create_segments(
                context,
                dataset_id="dataset-1",
                document_id="document-1",
                values=({"content": "first"}, {"content": "second"}),
            )
        return app.create_imported_segments(
            context,
            dataset_id="dataset-1",
            document_id="document-1",
            values=({"content": "first"}, {"content": "second"}),
            job_id="job-1",
        )

    with pytest.raises(SegmentDocumentNotCompletedError):
        create()

    assert changed_after_preflight
    assert probe.writes == 0
    assert probe.batches == []
    with sqlite_session_factory() as session:
        assert session.scalars(select(DocumentSegment)).all() == []
        assert (
            session.scalar(select(KnowledgeTaskOutbox).where(KnowledgeTaskOutbox.task_kind == "segment_index_create"))
            is None
        )


class SegmentUpdateEntry(Protocol):
    def __call__(
        self,
        context: RequestContext,
        *,
        dataset_id: str,
        document_id: str,
        segment_id: str,
        values: Mapping[str, object],
    ) -> SegmentDetail: ...


@pytest.fixture
def segment_update(indexing_probe: IndexingProbe) -> SegmentUpdateEntry:
    app, _, _ = indexing_probe
    return app.update_segment


@pytest.mark.parametrize("doc_form", list(IndexStructureType))
def test_enable_only_patch_queues_reindexing_without_replacing_content(
    segment_update: SegmentUpdateEntry,
    indexing_probe: IndexingProbe,
    sqlite_session_factory: sessionmaker[Session],
    doc_form: IndexStructureType,
) -> None:
    _, _, probe = indexing_probe
    answer = "answer" if doc_form == IndexStructureType.QA_INDEX else None
    word_count = 13 if answer else 7
    with sqlite_session_factory.begin() as session:
        segment = _segment("segment-1", "workspace-1", "dataset-1", "document-1")
        segment.enabled = False
        segment.disabled_at = datetime(2026, 1, 1)
        segment.disabled_by = "previous-editor"
        segment.answer = answer
        segment.word_count = word_count
        segment.keywords = ["original"]
        segment.index_node_id = "index-1"
        session.add(segment)
        document = session.get(Document, "document-1")
        assert document is not None
        document.doc_form = doc_form
        document.word_count = word_count

    # A disabled segment has no vector to update. Only the asynchronous load path is valid.
    probe.fail = True
    result = segment_update(
        RequestContext("request", None, "editor", "workspace-1"),
        dataset_id="dataset-1",
        document_id="document-1",
        segment_id="segment-1",
        values={"enabled": True},
    )

    assert result.data.enabled is True
    assert result.data.status == "indexing"
    assert result.data.disabled_at is None
    assert result.data.disabled_by is None
    assert result.data.content == "content"
    assert result.data.answer == answer
    assert result.data.keywords == ("original",)
    assert result.data.word_count == word_count
    assert probe.tasks == []
    with sqlite_session_factory() as session:
        intent = session.scalar(
            select(KnowledgeTaskOutbox).where(KnowledgeTaskOutbox.task_kind == "segment_index_enable")
        )
        assert intent is not None
        assert intent.payload["segment_ids"] == ["segment-1"]
        assert intent.payload["expected_enabled"] is True
        assert isinstance(intent.payload["generation"], str)
    assert probe.deleted_ids == []
    assert probe.writes == 0
    with sqlite_session_factory() as session:
        document = session.get(Document, "document-1")
        assert document is not None
        assert document.word_count == word_count


@pytest.mark.parametrize(
    "values",
    [
        {"content": "changed"},
        {"keywords": ["replacement"]},
        {"content": "changed", "keywords": ["replacement"]},
    ],
)
def test_reenable_patch_with_edits_is_rejected_without_side_effects(
    segment_update: SegmentUpdateEntry,
    indexing_probe: IndexingProbe,
    sqlite_session_factory: sessionmaker[Session],
    values: dict[str, object],
) -> None:
    _, _, probe = indexing_probe
    with sqlite_session_factory.begin() as session:
        segment = _segment("segment-1", "workspace-1", "dataset-1", "document-1")
        segment.enabled = False
        segment.index_node_id = "index-1"
        session.add(segment)

    with pytest.raises(SegmentMixedStatusUpdateError):
        segment_update(
            RequestContext("request", None, "editor", "workspace-1"),
            dataset_id="dataset-1",
            document_id="document-1",
            segment_id="segment-1",
            values={"enabled": True, **values},
        )

    assert probe.tasks == []
    assert probe.deleted_ids == []
    assert probe.writes == 0
    with sqlite_session_factory() as session:
        persisted = session.get(DocumentSegment, "segment-1")
        assert persisted is not None
        assert persisted.enabled is False
        assert persisted.content == "content"


@pytest.mark.parametrize("enabled", [True, False])
def test_delete_segment_with_legacy_scalar_keywords(
    indexing_probe: IndexingProbe,
    sqlite_session_factory: sessionmaker[Session],
    enabled: bool,
) -> None:
    app, _, probe = indexing_probe
    with sqlite_session_factory.begin() as session:
        segment = _segment("segment-1", "workspace-1", "dataset-1", "document-1")
        segment.keywords = "legacy-scalar"
        segment.enabled = enabled
        segment.index_node_id = "index-1"
        session.add(segment)
        document = session.get(Document, "document-1")
        assert document is not None
        document.word_count = segment.word_count

    app.delete_segment(
        RequestContext("request", None, "author", "workspace-1"),
        dataset_id="dataset-1",
        document_id="document-1",
        segment_id="segment-1",
    )

    with sqlite_session_factory() as session:
        assert session.get(DocumentSegment, "segment-1") is None
        document = session.get(Document, "document-1")
        assert document is not None
        assert document.word_count == 0
        intent = session.scalar(
            select(KnowledgeTaskOutbox).where(KnowledgeTaskOutbox.task_kind == "segment_delete_cleanup")
        )
        assert intent is not None
        assert intent.payload["segment_ids"] == ["segment-1"]
        assert intent.payload["index_node_ids"] == ["index-1"]
        assert intent.payload["child_node_ids"] == []
    assert probe.tasks == []


def test_delete_segments_removes_complete_scoped_graph_and_preserves_other_owners(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    with sqlite_session_factory.begin() as session:
        session.add_all(
            [
                _dataset("dataset-1", "workspace-1"),
                _dataset("dataset-2", "workspace-2"),
                _document("document-1", "workspace-1", "dataset-1"),
                _document("document-2", "workspace-1", "dataset-1"),
                _document("document-3", "workspace-2", "dataset-2"),
            ]
        )
        target = _segment("segment-1", "workspace-1", "dataset-1", "document-1")
        target.index_node_id = "target-parent-node"
        sibling = _segment("segment-2", "workspace-1", "dataset-1", "document-1")
        other_document = _segment("segment-3", "workspace-1", "dataset-1", "document-2")
        other_tenant = _segment("segment-4", "workspace-2", "dataset-2", "document-3")
        session.add_all([target, sibling, other_document, other_tenant])
        document = session.get(Document, "document-1")
        assert document is not None
        document.word_count = target.word_count + sibling.word_count
        session.add_all(
            [
                ChildChunk(
                    tenant_id="workspace-1",
                    dataset_id="dataset-1",
                    document_id="document-1",
                    segment_id="segment-1",
                    position=1,
                    content="target child",
                    word_count=2,
                    created_by="account-1",
                    index_node_id="target-child-node",
                ),
                ChildChunk(
                    tenant_id="workspace-1",
                    dataset_id="dataset-1",
                    document_id="document-1",
                    segment_id="segment-2",
                    position=1,
                    content="sibling child",
                    word_count=2,
                    created_by="account-1",
                    index_node_id="sibling-child-node",
                ),
                ChildChunk(
                    tenant_id="workspace-1",
                    dataset_id="dataset-1",
                    document_id="document-2",
                    segment_id="segment-1",
                    position=1,
                    content="other document child",
                    word_count=3,
                    created_by="account-1",
                    index_node_id="other-document-child-node",
                ),
                ChildChunk(
                    tenant_id="workspace-2",
                    dataset_id="dataset-2",
                    document_id="document-3",
                    segment_id="segment-1",
                    position=1,
                    content="other tenant child",
                    word_count=3,
                    created_by="account-1",
                    index_node_id="other-tenant-child-node",
                ),
                DocumentSegmentSummary(
                    dataset_id="dataset-1",
                    document_id="document-1",
                    chunk_id="segment-1",
                    summary_content="target summary",
                    summary_index_node_id="target-summary-node",
                ),
                DocumentSegmentSummary(
                    dataset_id="dataset-1",
                    document_id="document-1",
                    chunk_id="segment-2",
                    summary_content="sibling summary",
                    summary_index_node_id="sibling-summary-node",
                ),
                DocumentSegmentSummary(
                    dataset_id="dataset-1",
                    document_id="document-2",
                    chunk_id="segment-1",
                    summary_content="other document summary",
                    summary_index_node_id="other-document-summary-node",
                ),
                DocumentSegmentSummary(
                    dataset_id="dataset-2",
                    document_id="document-3",
                    chunk_id="segment-1",
                    summary_content="other tenant summary",
                    summary_index_node_id="other-tenant-summary-node",
                ),
            ]
        )

    repository = SQLAlchemySegmentRepository(
        session_factory=sqlite_session_factory,
        wake_after_commit=_noop_wake_after_commit,
    )
    repository.delete_segments(
        DatasetRef("workspace-1", "dataset-1").document("document-1"),
        ("segment-1", "segment-4"),
    )

    with sqlite_session_factory() as session:
        assert session.get(DocumentSegment, "segment-1") is None
        assert set(session.scalars(select(DocumentSegment.id)).all()) == {"segment-2", "segment-3", "segment-4"}
        assert (
            session.scalars(
                select(ChildChunk.id).where(
                    ChildChunk.tenant_id == "workspace-1",
                    ChildChunk.dataset_id == "dataset-1",
                    ChildChunk.document_id == "document-1",
                    ChildChunk.segment_id == "segment-1",
                )
            ).all()
            == []
        )
        assert set(session.scalars(select(ChildChunk.content)).all()) == {
            "sibling child",
            "other document child",
            "other tenant child",
        }
        assert (
            session.scalars(
                select(DocumentSegmentSummary.id).where(
                    DocumentSegmentSummary.dataset_id == "dataset-1",
                    DocumentSegmentSummary.document_id == "document-1",
                    DocumentSegmentSummary.chunk_id == "segment-1",
                )
            ).all()
            == []
        )
        assert set(session.scalars(select(DocumentSegmentSummary.summary_content)).all()) == {
            "sibling summary",
            "other document summary",
            "other tenant summary",
        }
        document = session.get(Document, "document-1")
        assert document is not None
        assert document.word_count == sibling.word_count
        intent = session.scalar(
            select(KnowledgeTaskOutbox).where(KnowledgeTaskOutbox.task_kind == "segment_delete_cleanup")
        )
        assert intent is not None
        assert intent.payload["segment_ids"] == ["segment-1"]
        assert intent.payload["child_node_ids"] == ["target-child-node"]
        assert intent.payload["summary_node_ids"] == ["target-summary-node"]


def test_delete_segment_rolls_back_row_file_edges_and_cleanup_intent_together(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    with sqlite_session_factory.begin() as session:
        session.add(_dataset("dataset-1", "workspace-1"))
        document = _document("document-1", "workspace-1", "dataset-1")
        document.word_count = 7
        session.add(document)
        segment = _segment("segment-1", "workspace-1", "dataset-1", "document-1")
        segment.index_node_id = "parent-node"
        session.add(segment)
        session.add(
            ChildChunk(
                tenant_id="workspace-1",
                dataset_id="dataset-1",
                document_id="document-1",
                segment_id="segment-1",
                position=1,
                content="child",
                word_count=1,
                created_by="account-1",
                index_node_id="child-node",
            )
        )
        session.add(
            DocumentSegmentSummary(
                dataset_id="dataset-1",
                document_id="document-1",
                chunk_id="segment-1",
                summary_content="summary",
                summary_index_node_id="summary-node",
            )
        )
        inline = _upload("inline-image", "workspace-1", "inline.png")
        attachment = _upload("attachment", "workspace-1", "attachment.png")
        session.add_all([inline, attachment])
        session.add(
            KnowledgeUploadFileReference(
                tenant_id="workspace-1",
                upload_file_id=inline.id,
                dataset_id="dataset-1",
                document_id="document-1",
                kind="segment_image",
                resource_id="segment-1",
            )
        )
        session.add(
            SegmentAttachmentBinding(
                tenant_id="workspace-1",
                dataset_id="dataset-1",
                document_id="document-1",
                segment_id="segment-1",
                attachment_id=attachment.id,
            )
        )

    repository = SQLAlchemySegmentRepository(
        session_factory=sqlite_session_factory,
        wake_after_commit=_noop_wake_after_commit,
    )

    def fail_commit(_session: Session) -> None:
        raise RuntimeError("commit unavailable")

    event.listen(sqlite_session_factory.class_, "before_commit", fail_commit)
    try:
        with pytest.raises(RuntimeError, match="commit unavailable"):
            repository.delete_segments(
                DatasetRef("workspace-1", "dataset-1").document("document-1"),
                ("segment-1",),
            )
    finally:
        event.remove(sqlite_session_factory.class_, "before_commit", fail_commit)

    with sqlite_session_factory() as session:
        assert session.get(DocumentSegment, "segment-1") is not None
        assert session.scalar(select(ChildChunk.id)) is not None
        assert session.scalar(select(DocumentSegmentSummary.id)) is not None
        assert session.scalar(select(KnowledgeUploadFileReference.id)) is not None
        assert session.scalar(select(SegmentAttachmentBinding.id)) is not None
        assert (
            session.scalar(
                select(KnowledgeTaskOutbox.id).where(KnowledgeTaskOutbox.task_kind == "segment_delete_cleanup")
            )
            is None
        )

    repository.delete_segments(
        DatasetRef("workspace-1", "dataset-1").document("document-1"),
        ("segment-1",),
    )

    with sqlite_session_factory() as session:
        assert session.get(DocumentSegment, "segment-1") is None
        assert session.scalar(select(ChildChunk.id)) is None
        assert session.scalar(select(DocumentSegmentSummary.id)) is None
        assert session.scalar(select(KnowledgeUploadFileReference.id)) is None
        assert session.scalar(select(SegmentAttachmentBinding.id)) is None
        intent = session.scalar(
            select(KnowledgeTaskOutbox).where(KnowledgeTaskOutbox.task_kind == "segment_delete_cleanup")
        )
        assert intent is not None
        manifest = intent.payload["cleanup_manifest"]
        assert isinstance(manifest, dict)
        assert manifest["image_files"] == [{"id": "inline-image", "key": "key-inline-image"}]
        attachments = manifest["segment_attachments"]
        assert isinstance(attachments, list)
        assert len(attachments) == 1
        assert attachments[0]["attachment_id"] == "attachment"
        assert intent.payload["child_node_ids"] == ["child-node"]
        assert intent.payload["summary_node_ids"] == ["summary-node"]


@pytest.mark.parametrize("keywords", ["legacy-scalar", 42, {"invalid": "object"}, [{"invalid": "item"}]])
def test_update_repairs_legacy_keywords_without_validating_presentation_first(
    segment_update: SegmentUpdateEntry,
    sqlite_session_factory: sessionmaker[Session],
    keywords: object,
) -> None:
    with sqlite_session_factory.begin() as session:
        segment = _segment("segment-1", "workspace-1", "dataset-1", "document-1")
        segment.keywords = keywords
        segment.index_node_id = "index-1"
        segment.index_node_hash = generate_text_hash(segment.content)
        session.add(segment)

    result = segment_update(
        RequestContext("request", None, "editor", "workspace-1"),
        dataset_id="dataset-1",
        document_id="document-1",
        segment_id="segment-1",
        values={"content": "content", "keywords": ["replacement"]},
    )

    assert result.data.status == "completed"
    assert result.data.keywords == ("replacement",)
    with sqlite_session_factory() as session:
        segment = session.get(DocumentSegment, "segment-1")
        assert segment is not None
        assert segment.keywords == ["replacement"]


@pytest.mark.parametrize("content", ["original", "changed text"])
@pytest.mark.parametrize(
    ("attachment_values", "expected_ids", "removed_original"),
    [
        ({}, ["image-1"], False),
        ({"attachment_ids": None}, ["image-1"], False),
        ({"attachment_ids": []}, [], True),
        ({"attachment_ids": ["image-2"]}, ["image-2"], True),
    ],
    ids=["omitted", "null", "clear", "replace"],
)
def test_segment_update_preserves_or_replaces_attachments(
    segment_update: SegmentUpdateEntry,
    indexing_probe: IndexingProbe,
    sqlite_session_factory: sessionmaker[Session],
    content: str,
    attachment_values: dict[str, object],
    expected_ids: list[str],
    removed_original: bool,
) -> None:
    app, _, probe = indexing_probe
    context = RequestContext("request", None, "author", "workspace-1")
    with sqlite_session_factory.begin() as session:
        session.add_all(
            [_upload("image-1", "workspace-1", "chart.png"), _upload("image-2", "workspace-1", "replacement.png")]
        )
        dataset = session.get(Dataset, "dataset-1")
        assert dataset is not None
        dataset.is_multimodal = True
    created = _create_completed_segment(
        app,
        sqlite_session_factory,
        context,
        dataset_id="dataset-1",
        document_id="document-1",
        values={"content": "original", "attachment_ids": ["image-1"]},
    )
    assert [attachment.id for attachment in created.data.attachments] == ["image-1"]

    updated = segment_update(
        context,
        dataset_id="dataset-1",
        document_id="document-1",
        segment_id=created.data.id,
        values={"content": content, **attachment_values},
    )

    assert updated.data.status == "completed"
    assert [attachment.id for attachment in updated.data.attachments] == expected_ids
    with sqlite_session_factory() as session:
        attachment_ids = list(
            session.scalars(
                select(SegmentAttachmentBinding.attachment_id).where(
                    SegmentAttachmentBinding.segment_id == created.data.id
                )
            )
        )
        cleanup_intents = session.scalars(
            select(KnowledgeTaskOutbox).where(KnowledgeTaskOutbox.task_kind == "file_cleanup")
        ).all()
    assert attachment_ids == expected_ids
    assert ("image-1" in probe.deleted_ids) is removed_original
    assert [intent.payload for intent in cleanup_intents] == ([{"file_ids": ["image-1"]}] if removed_original else [])


def test_segment_indexing_and_summary_use_closed_read_sessions(
    segment_update: SegmentUpdateEntry, indexing_probe: IndexingProbe, sqlite_session_factory: sessionmaker[Session]
) -> None:
    app, repository, probe = indexing_probe
    context = RequestContext("request", None, "author", "workspace-1")
    created = _create_completed_segment(
        app,
        sqlite_session_factory,
        context,
        dataset_id="dataset-1",
        document_id="document-1",
        values={"content": "first"},
    )
    updated = segment_update(
        context,
        dataset_id="dataset-1",
        document_id="document-1",
        segment_id=created.data.id,
        values={"content": "second", "summary": "manual summary"},
    )
    assert updated.data.status == "completed"
    assert updated.data.summary == "manual summary"
    with sqlite_session_factory() as session:
        summary = session.scalar(select(DocumentSegmentSummary))
        assert summary is not None
        assert summary.status == "completed"
        document = session.get(Document, "document-1")
        assert document is not None
        assert document.word_count == len("second")
    assert probe.writes >= 3
    probe.fail = True
    failed = segment_update(
        context,
        dataset_id="dataset-1",
        document_id="document-1",
        segment_id=created.data.id,
        values={"content": "failed change"},
    )
    assert failed.data.status == "error"
    assert failed.data.enabled is False
    assert failed.data.error == "index unavailable"


def test_segment_content_update_replaces_normalized_inline_image_reference(
    segment_update: SegmentUpdateEntry,
    indexing_probe: IndexingProbe,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    app, _, _ = indexing_probe
    with sqlite_session_factory.begin() as session:
        session.add(_upload("inline-image", "workspace-1", "inline.png"))
    context = RequestContext("request", None, "author", "workspace-1")
    created = _create_completed_segment(
        app,
        sqlite_session_factory,
        context,
        dataset_id="dataset-1",
        document_id="document-1",
        values={"content": "![image](https://example.test/files/inline-image/image-preview)"},
    )

    with sqlite_session_factory() as session:
        reference = session.scalar(
            select(KnowledgeUploadFileReference).where(
                KnowledgeUploadFileReference.kind == "segment_image",
                KnowledgeUploadFileReference.resource_id == created.data.id,
            )
        )
        assert reference is not None
        assert reference.upload_file_id == "inline-image"

    segment_update(
        context,
        dataset_id="dataset-1",
        document_id="document-1",
        segment_id=created.data.id,
        values={"content": "plain text"},
    )

    with sqlite_session_factory() as session:
        reference = session.scalar(
            select(KnowledgeUploadFileReference).where(
                KnowledgeUploadFileReference.kind == "segment_image",
                KnowledgeUploadFileReference.resource_id == created.data.id,
            )
        )
        cleanup_intent = session.scalar(
            select(KnowledgeTaskOutbox).where(KnowledgeTaskOutbox.task_kind == "file_cleanup")
        )
    assert reference is None
    assert cleanup_intent is not None
    assert cleanup_intent.payload == {"file_ids": ["inline-image"]}


def test_content_reference_and_cleanup_intent_roll_back_together(
    indexing_probe: IndexingProbe,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    app, repository, _ = indexing_probe
    with sqlite_session_factory.begin() as session:
        session.add(_upload("inline-image", "workspace-1", "inline.png"))
    context = RequestContext("request", None, "author", "workspace-1")
    created = _create_completed_segment(
        app,
        sqlite_session_factory,
        context,
        dataset_id="dataset-1",
        document_id="document-1",
        values={"content": "![image](/files/inline-image/image-preview)"},
    )
    ref = DatasetRef("workspace-1", "dataset-1").document("document-1").segment(created.data.id)

    def fail_commit(_session: Session) -> None:
        raise RuntimeError("commit unavailable")

    event.listen(sqlite_session_factory.class_, "before_commit", fail_commit)
    try:
        with pytest.raises(RuntimeError, match="commit unavailable"):
            repository.save_segment(ref, {"content": "plain text"})
    finally:
        event.remove(sqlite_session_factory.class_, "before_commit", fail_commit)

    with sqlite_session_factory() as session:
        row = session.get(DocumentSegment, created.data.id)
        reference = session.scalar(
            select(KnowledgeUploadFileReference).where(
                KnowledgeUploadFileReference.resource_id == created.data.id,
                KnowledgeUploadFileReference.upload_file_id == "inline-image",
            )
        )
        cleanup_intent = session.scalar(
            select(KnowledgeTaskOutbox).where(KnowledgeTaskOutbox.task_kind == "file_cleanup")
        )
        assert row is not None
        assert row.content == "![image](/files/inline-image/image-preview)"
        assert reference is not None
        assert cleanup_intent is None


def test_attachment_replacement_and_cleanup_intent_roll_back_together(
    indexing_probe: IndexingProbe,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    app, repository, _ = indexing_probe
    with sqlite_session_factory.begin() as session:
        session.add_all([_upload("image-1", "workspace-1", "old.png"), _upload("image-2", "workspace-1", "new.png")])
    context = RequestContext("request", None, "author", "workspace-1")
    created = _create_completed_segment(
        app,
        sqlite_session_factory,
        context,
        dataset_id="dataset-1",
        document_id="document-1",
        values={"content": "segment", "attachment_ids": ["image-1"]},
    )
    ref = DatasetRef("workspace-1", "dataset-1").document("document-1").segment(created.data.id)

    def fail_commit(_session: Session) -> None:
        raise RuntimeError("commit unavailable")

    event.listen(sqlite_session_factory.class_, "before_commit", fail_commit)
    try:
        with pytest.raises(RuntimeError, match="commit unavailable"):
            repository.replace_attachments(ref, ("image-2",))
    finally:
        event.remove(sqlite_session_factory.class_, "before_commit", fail_commit)

    with sqlite_session_factory() as session:
        attachment_ids = session.scalars(
            select(SegmentAttachmentBinding.attachment_id).where(SegmentAttachmentBinding.segment_id == created.data.id)
        ).all()
        cleanup_intent = session.scalar(
            select(KnowledgeTaskOutbox).where(KnowledgeTaskOutbox.task_kind == "file_cleanup")
        )
        assert attachment_ids == ["image-1"]
        assert cleanup_intent is None


def test_removing_shared_attachment_keeps_vector_for_other_active_segment(
    segment_update: SegmentUpdateEntry,
    indexing_probe: IndexingProbe,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    app, _, probe = indexing_probe
    with sqlite_session_factory.begin() as session:
        dataset = session.get(Dataset, "dataset-1")
        assert dataset is not None
        dataset.is_multimodal = True
        session.add(_upload("shared-image", "workspace-1", "shared.png"))
    context = RequestContext("request", None, "author", "workspace-1")
    first = _create_completed_segment(
        app,
        sqlite_session_factory,
        context,
        dataset_id="dataset-1",
        document_id="document-1",
        values={"content": "first", "attachment_ids": ["shared-image"]},
    )
    _create_completed_segment(
        app,
        sqlite_session_factory,
        context,
        dataset_id="dataset-1",
        document_id="document-1",
        values={"content": "second", "attachment_ids": ["shared-image"]},
    )
    deleted_before = tuple(probe.deleted_ids)

    segment_update(
        context,
        dataset_id="dataset-1",
        document_id="document-1",
        segment_id=first.data.id,
        values={"attachment_ids": []},
    )

    assert tuple(probe.deleted_ids) == deleted_before


def test_child_mutation_persists_reconcile_intent_before_vector_io(
    indexing_probe: IndexingProbe,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    app, repository, probe = indexing_probe
    context = RequestContext("request", None, "author", "workspace-1")
    parent = _create_completed_segment(
        app,
        sqlite_session_factory,
        context,
        dataset_id="dataset-1",
        document_id="document-1",
        values={"content": "parent"},
    )
    writes_before = probe.writes

    child = app.create_child_chunk(
        context,
        dataset_id="dataset-1",
        document_id="document-1",
        segment_id=parent.data.id,
        content="original",
    )
    ref = DatasetRef("workspace-1", "dataset-1").document("document-1").segment(parent.data.id)
    assert [state.data.id for state in repository.get_children(ref) or ()] == [child.id]
    assert probe.writes == writes_before
    with sqlite_session_factory() as session:
        intent = session.scalar(
            select(KnowledgeTaskOutbox).where(
                KnowledgeTaskOutbox.task_kind == "segment_index_reconcile",
                KnowledgeTaskOutbox.resource_id == parent.data.id,
            )
        )
        segment = session.get(DocumentSegment, parent.data.id)
        assert intent is not None
        assert segment is not None
        assert segment.status == SegmentStatus.INDEXING
        assert segment.indexing_generation is not None
        assert intent.payload["parent_generation"] == segment.indexing_generation
        assert intent.payload["batch_segment_ids"] == [parent.data.id]
        assert intent.payload["delete_node_ids"] == []
        completion = SegmentChildIndexCompletion(segment.indexing_generation, (parent.data.id,))

    assert (
        app.mutations.reconcile_children_index(ref, delete_node_ids=(), completion=completion)
        == SegmentIndexReconcileOutcome.COMPLETED
    )

    assert probe.writes == writes_before + 1
    with sqlite_session_factory() as session:
        segment = session.get(DocumentSegment, parent.data.id)
        assert segment is not None
        assert segment.status == SegmentStatus.COMPLETED


def test_exhausted_child_delete_can_be_repeated_to_reconcile_the_same_vector_removal(
    indexing_probe: IndexingProbe,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    app, repository, probe = indexing_probe
    context = RequestContext("request", None, "author", "workspace-1")
    parent = _create_completed_segment(
        app,
        sqlite_session_factory,
        context,
        dataset_id="dataset-1",
        document_id="document-1",
        values={"content": "parent"},
    )
    child = app.create_child_chunk(
        context,
        dataset_id="dataset-1",
        document_id="document-1",
        segment_id=parent.data.id,
        content="child",
    )
    ref = DatasetRef("workspace-1", "dataset-1").document("document-1").segment(parent.data.id)
    child_state = (repository.get_children(ref) or ())[0]
    assert child_state.index_node_id is not None

    with sqlite_session_factory() as session:
        segment = session.get(DocumentSegment, parent.data.id)
        assert segment is not None
        assert segment.indexing_generation is not None
        create_completion = SegmentChildIndexCompletion(segment.indexing_generation, (parent.data.id,))
    assert (
        app.mutations.reconcile_children_index(ref, delete_node_ids=(), completion=create_completion)
        == SegmentIndexReconcileOutcome.COMPLETED
    )

    app.delete_child_chunk(
        context,
        dataset_id="dataset-1",
        document_id="document-1",
        segment_id=parent.data.id,
        child_chunk_id=child.id,
    )
    with sqlite_session_factory.begin() as session:
        segment = session.get(DocumentSegment, parent.data.id)
        assert segment is not None
        assert segment.indexing_generation is not None
        failed_generation = segment.indexing_generation
        failed_intent = next(
            row
            for row in session.scalars(
                select(KnowledgeTaskOutbox).where(
                    KnowledgeTaskOutbox.task_kind == "segment_index_reconcile",
                    KnowledgeTaskOutbox.resource_id == parent.data.id,
                )
            )
            if row.payload["parent_generation"] == failed_generation
        )
        assert failed_intent.payload["delete_node_ids"] == [child_state.index_node_id]
        failed_intent.status = "failed"
        failed_completion = SegmentChildIndexCompletion(failed_generation, (parent.data.id,))

    assert app.mutations.fail_child_reconcile(
        ref,
        completion=failed_completion,
        error="vector provider unavailable",
    )
    with sqlite_session_factory() as session:
        segment = session.get(DocumentSegment, parent.data.id)
        assert segment is not None
        assert segment.status == SegmentStatus.ERROR
        assert segment.enabled is False

    app.delete_child_chunk(
        context,
        dataset_id="dataset-1",
        document_id="document-1",
        segment_id=parent.data.id,
        child_chunk_id=child.id,
    )
    with sqlite_session_factory() as session:
        segment = session.get(DocumentSegment, parent.data.id)
        assert segment is not None
        assert segment.status == SegmentStatus.INDEXING
        assert segment.enabled is True
        assert segment.indexing_generation is not None
        assert segment.indexing_generation != failed_generation
        recovered_generation = segment.indexing_generation
        recovered_intent = next(
            row
            for row in session.scalars(
                select(KnowledgeTaskOutbox).where(
                    KnowledgeTaskOutbox.task_kind == "segment_index_reconcile",
                    KnowledgeTaskOutbox.resource_id == parent.data.id,
                )
            )
            if row.payload["parent_generation"] == recovered_generation
        )
        assert recovered_intent.payload["delete_node_ids"] == [child_state.index_node_id]
        recovered_completion = SegmentChildIndexCompletion(recovered_generation, (parent.data.id,))

    assert (
        app.mutations.reconcile_children_index(
            ref,
            delete_node_ids=(child_state.index_node_id,),
            completion=recovered_completion,
        )
        == SegmentIndexReconcileOutcome.COMPLETED
    )
    with sqlite_session_factory() as session:
        segment = session.get(DocumentSegment, parent.data.id)
        assert segment is not None
        assert segment.status == SegmentStatus.COMPLETED
        assert segment.error is None
    assert child_state.index_node_id in probe.deleted_ids


def test_disabled_parent_child_updates_cleanup_vectors_and_failed_delete_recovers_disabled(
    indexing_probe: IndexingProbe,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    app, repository, probe = indexing_probe
    context = RequestContext("request", None, "author", "workspace-1")
    parent = _create_completed_segment(
        app,
        sqlite_session_factory,
        context,
        dataset_id="dataset-1",
        document_id="document-1",
        values={"content": "parent"},
    )
    child = app.create_child_chunk(
        context,
        dataset_id="dataset-1",
        document_id="document-1",
        segment_id=parent.data.id,
        content="child",
    )
    ref = DatasetRef("workspace-1", "dataset-1").document("document-1").segment(parent.data.id)
    child_state = (repository.get_children(ref) or ())[0]
    assert child_state.index_node_id is not None
    with sqlite_session_factory() as session:
        segment = session.get(DocumentSegment, parent.data.id)
        assert segment is not None
        assert segment.indexing_generation is not None
        create_completion = SegmentChildIndexCompletion(segment.indexing_generation, (parent.data.id,))
    assert (
        app.mutations.reconcile_children_index(ref, delete_node_ids=(), completion=create_completion)
        == SegmentIndexReconcileOutcome.COMPLETED
    )
    writes_before_disable = probe.writes
    with sqlite_session_factory.begin() as session:
        segment = session.get(DocumentSegment, parent.data.id)
        assert segment is not None
        segment.enabled = False
        segment.disabled_at = datetime(2026, 1, 1)

    app.update_child_chunk(
        context,
        dataset_id="dataset-1",
        document_id="document-1",
        segment_id=parent.data.id,
        child_chunk_id=child.id,
        content="updated child",
    )
    with sqlite_session_factory() as session:
        segment = session.get(DocumentSegment, parent.data.id)
        assert segment is not None
        assert segment.enabled is False
        assert segment.status == SegmentStatus.INDEXING
        assert segment.indexing_generation is not None
        update_generation = segment.indexing_generation
        update_intent = next(
            row
            for row in session.scalars(
                select(KnowledgeTaskOutbox).where(
                    KnowledgeTaskOutbox.task_kind == "segment_index_reconcile",
                    KnowledgeTaskOutbox.resource_id == parent.data.id,
                )
            )
            if row.payload["parent_generation"] == update_generation
        )
        assert update_intent.payload["expected_enabled"] is False
        assert update_intent.payload["delete_node_ids"] == [child_state.index_node_id]
    assert (
        app.mutations.reconcile_children_index(
            ref,
            delete_node_ids=(child_state.index_node_id,),
            completion=SegmentChildIndexCompletion(
                update_generation,
                (parent.data.id,),
                expected_enabled=False,
            ),
        )
        == SegmentIndexReconcileOutcome.COMPLETED
    )
    assert probe.writes == writes_before_disable
    assert child_state.index_node_id in probe.deleted_ids
    with sqlite_session_factory() as session:
        segment = session.get(DocumentSegment, parent.data.id)
        assert segment is not None
        assert segment.enabled is False
        assert segment.status == SegmentStatus.COMPLETED

    app.delete_child_chunk(
        context,
        dataset_id="dataset-1",
        document_id="document-1",
        segment_id=parent.data.id,
        child_chunk_id=child.id,
    )
    with sqlite_session_factory.begin() as session:
        segment = session.get(DocumentSegment, parent.data.id)
        assert segment is not None
        assert segment.enabled is False
        assert segment.indexing_generation is not None
        failed_generation = segment.indexing_generation
        failed_intent = next(
            row
            for row in session.scalars(
                select(KnowledgeTaskOutbox).where(
                    KnowledgeTaskOutbox.task_kind == "segment_index_reconcile",
                    KnowledgeTaskOutbox.resource_id == parent.data.id,
                )
            )
            if row.payload["parent_generation"] == failed_generation
        )
        assert failed_intent.payload["expected_enabled"] is False
        failed_intent.status = "failed"
        failed_completion = SegmentChildIndexCompletion(
            failed_generation,
            (parent.data.id,),
            expected_enabled=False,
        )

    assert app.mutations.fail_child_reconcile(
        ref,
        completion=failed_completion,
        error="vector provider unavailable",
    )
    app.delete_child_chunk(
        context,
        dataset_id="dataset-1",
        document_id="document-1",
        segment_id=parent.data.id,
        child_chunk_id=child.id,
    )
    with sqlite_session_factory() as session:
        segment = session.get(DocumentSegment, parent.data.id)
        assert segment is not None
        assert segment.enabled is False
        assert segment.status == SegmentStatus.INDEXING
        assert segment.indexing_generation is not None
        recovered_generation = segment.indexing_generation
        recovered_intent = next(
            row
            for row in session.scalars(
                select(KnowledgeTaskOutbox).where(
                    KnowledgeTaskOutbox.task_kind == "segment_index_reconcile",
                    KnowledgeTaskOutbox.resource_id == parent.data.id,
                )
            )
            if row.payload["parent_generation"] == recovered_generation
        )
        assert recovered_intent.payload["expected_enabled"] is False
        assert recovered_intent.payload["delete_node_ids"] == [child_state.index_node_id]

    assert (
        app.mutations.reconcile_children_index(
            ref,
            delete_node_ids=(child_state.index_node_id,),
            completion=SegmentChildIndexCompletion(
                recovered_generation,
                (parent.data.id,),
                expected_enabled=False,
            ),
        )
        == SegmentIndexReconcileOutcome.COMPLETED
    )
    with sqlite_session_factory() as session:
        segment = session.get(DocumentSegment, parent.data.id)
        assert segment is not None
        assert segment.enabled is False
        assert segment.status == SegmentStatus.COMPLETED
        assert segment.error is None


def test_child_reconcile_removes_old_nodes_after_parent_segment_is_deleted(
    indexing_probe: IndexingProbe,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    app, repository, probe = indexing_probe
    context = RequestContext("request", None, "author", "workspace-1")
    parent = _create_completed_segment(
        app,
        sqlite_session_factory,
        context,
        dataset_id="dataset-1",
        document_id="document-1",
        values={"content": "parent"},
    )
    app.create_child_chunk(
        context,
        dataset_id="dataset-1",
        document_id="document-1",
        segment_id=parent.data.id,
        content="child",
    )
    ref = DatasetRef("workspace-1", "dataset-1").document("document-1").segment(parent.data.id)
    child = (repository.get_children(ref) or ())[0]
    assert child.index_node_id is not None
    repository.delete_segments(ref.document, (ref.segment_id,))

    app.mutations.reconcile_children_index(ref, delete_node_ids=(child.index_node_id,))

    assert child.index_node_id in probe.deleted_ids


def test_child_commit_failure_rolls_back_sql_and_reconcile_intent_before_vector_io(
    indexing_probe: IndexingProbe,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    from services.knowledge.segments.application import ChildChunkIndexingApplicationError

    app, repository, probe = indexing_probe
    context = RequestContext("request", None, "author", "workspace-1")
    parent = _create_completed_segment(
        app,
        sqlite_session_factory,
        context,
        dataset_id="dataset-1",
        document_id="document-1",
        values={"content": "parent"},
    )
    ref = DatasetRef("workspace-1", "dataset-1").document("document-1").segment(parent.data.id)
    writes_before = probe.writes
    with sqlite_session_factory() as session:
        intent_count_before = len(
            session.scalars(
                select(KnowledgeTaskOutbox).where(KnowledgeTaskOutbox.task_kind == "segment_index_reconcile")
            ).all()
        )

    def fail_commit(_session: Session) -> None:
        raise RuntimeError("commit unavailable")

    event.listen(sqlite_session_factory.class_, "before_commit", fail_commit)
    try:
        with pytest.raises(ChildChunkIndexingApplicationError, match="commit unavailable"):
            app.create_child_chunk(
                context,
                dataset_id="dataset-1",
                document_id="document-1",
                segment_id=parent.data.id,
                content="new child",
            )
    finally:
        event.remove(sqlite_session_factory.class_, "before_commit", fail_commit)

    assert repository.get_children(ref) == ()
    assert probe.writes == writes_before
    with sqlite_session_factory() as session:
        intent_count_after = len(
            session.scalars(
                select(KnowledgeTaskOutbox).where(KnowledgeTaskOutbox.task_kind == "segment_index_reconcile")
            ).all()
        )
    assert intent_count_after == intent_count_before


@pytest.mark.parametrize("invalid_case", ["unknown", "duplicate", "blank"])
def test_child_batch_validation_has_no_sql_or_vector_side_effects(
    indexing_probe: IndexingProbe,
    sqlite_session_factory: sessionmaker[Session],
    invalid_case: str,
) -> None:
    from services.knowledge.segments.application import ChildChunkNotFoundError, ChildChunkValidationError

    app, repository, probe = indexing_probe
    context = RequestContext("request", None, "author", "workspace-1")
    parent = _create_completed_segment(
        app,
        sqlite_session_factory,
        context,
        dataset_id="dataset-1",
        document_id="document-1",
        values={"content": "parent"},
    )
    child = app.create_child_chunk(
        context,
        dataset_id="dataset-1",
        document_id="document-1",
        segment_id=parent.data.id,
        content="original",
    )
    ref = DatasetRef("workspace-1", "dataset-1").document("document-1").segment(parent.data.id)
    _complete_pending_child_reconcile(app, sqlite_session_factory, ref)
    before = repository.get_children(ref)
    writes_before = probe.writes
    deleted_before = tuple(probe.deleted_ids)
    match invalid_case:
        case "unknown":
            chunks = [ChildChunkUpdateArgs(id="unknown", content="changed")]
            expected = ChildChunkNotFoundError
        case "duplicate":
            chunks = [
                ChildChunkUpdateArgs(id=child.id, content="first"),
                ChildChunkUpdateArgs(id=child.id, content="second"),
            ]
            expected = ChildChunkValidationError
        case "blank":
            chunks = [ChildChunkUpdateArgs(id=child.id, content="   ")]
            expected = ChildChunkValidationError
        case _:
            raise AssertionError(invalid_case)

    with pytest.raises(expected):
        app.update_child_chunks(
            context,
            dataset_id="dataset-1",
            document_id="document-1",
            segment_id=parent.data.id,
            chunks=chunks,
        )

    assert repository.get_children(ref) == before
    assert probe.writes == writes_before
    assert tuple(probe.deleted_ids) == deleted_before


def test_upload_batch_uses_one_scoped_query(sqlite_session_factory: sessionmaker[Session]) -> None:
    with sqlite_session_factory.begin() as session:
        session.add_all(
            [
                _upload("file-1", "workspace-1", "one.csv"),
                _upload("file-2", "workspace-1", "two.csv"),
                _upload("foreign", "workspace-2", "foreign.csv"),
            ]
        )
    engine = sqlite_session_factory.kw["bind"]
    statements = []

    def record_sql(_conn, _cursor, statement: str, _parameters, _context, _executemany) -> None:
        statements.append(statement)

    event.listen(engine, "before_cursor_execute", record_sql)
    try:
        uploads = SQLAlchemyKnowledgeUploadRepository(session_factory=sqlite_session_factory).get_by_ids(
            workspace_id="workspace-1", file_ids=("file-2", "file-1", "foreign", "missing")
        )
    finally:
        event.remove(engine, "before_cursor_execute", record_sql)
    assert set(uploads) == {"file-1", "file-2"}
    assert len(statements) == 1


def test_child_query_escapes_wildcards_and_enforces_complete_scope(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    from services.knowledge.segments.contracts import ChildChunkListFilter

    with sqlite_session_factory.begin() as session:
        session.add(_dataset("dataset-1", "workspace-1"))
        session.add(_document("document-1", "workspace-1", "dataset-1"))
        session.add(_segment("segment-1", "workspace-1", "dataset-1", "document-1"))
        for position, (workspace, text) in enumerate(
            [("workspace-1", "50%_literal"), ("workspace-1", "5000literal"), ("workspace-2", "50%_literal")], start=1
        ):
            session.add(
                ChildChunk(
                    tenant_id=workspace,
                    dataset_id="dataset-1",
                    document_id="document-1",
                    segment_id="segment-1",
                    position=position,
                    content=text,
                    word_count=len(text),
                    created_by="author",
                )
            )
    repo = SQLAlchemySegmentRepository(
        session_factory=sqlite_session_factory, wake_after_commit=_noop_wake_after_commit
    )
    page = repo.list_child_chunks(
        DatasetRef("workspace-1", "dataset-1").document("document-1").segment("segment-1"),
        ChildChunkListFilter(keyword="%_", limit=1),
    )
    assert page is not None
    assert page.total == 1
    assert [child.content for child in page.items] == ["50%_literal"]


def test_batch_status_and_delete_only_modify_scoped_segments(
    indexing_probe: IndexingProbe, sqlite_session_factory: sessionmaker[Session]
) -> None:
    app, repository, probe = indexing_probe
    context = RequestContext("request", None, "author", "workspace-1")
    first = _create_completed_segment(
        app,
        sqlite_session_factory,
        context,
        dataset_id="dataset-1",
        document_id="document-1",
        values={"content": "first"},
    )
    second = _create_completed_segment(
        app,
        sqlite_session_factory,
        context,
        dataset_id="dataset-1",
        document_id="document-1",
        values={"content": "second"},
    )
    with sqlite_session_factory.begin() as session:
        session.add(_segment("foreign", "workspace-2", "dataset-1", "document-1"))
    segment_ids = [first.data.id, second.data.id, "foreign"]
    app.change_segment_status(
        context, dataset_id="dataset-1", document_id="document-1", segment_ids=segment_ids, action="disable"
    )
    with sqlite_session_factory() as session:
        intent = session.scalar(
            select(KnowledgeTaskOutbox).where(KnowledgeTaskOutbox.task_kind == "segment_index_disable")
        )
        assert intent is not None
        outbox_segment_ids = intent.payload["segment_ids"]
        assert isinstance(outbox_segment_ids, list)
        assert set(outbox_segment_ids) == {first.data.id, second.data.id}
        assert intent.payload["dataset_id"] == "dataset-1"
        assert intent.payload["document_id"] == "document-1"
        assert intent.payload["expected_enabled"] is False
        assert isinstance(intent.payload["generation"], str)
        first_row = session.get(DocumentSegment, first.data.id)
        assert first_row is not None
        assert first_row.enabled is False
        assert first_row.status == SegmentStatus.INDEXING
        assert first_row.indexing_at is not None
        foreign_row = session.get(DocumentSegment, "foreign")
        assert foreign_row is not None
        assert foreign_row.enabled is True
    app.delete_segments(context, dataset_id="dataset-1", document_id="document-1", segment_ids=segment_ids)
    with sqlite_session_factory() as session:
        assert session.get(DocumentSegment, first.data.id) is None
        assert session.get(DocumentSegment, second.data.id) is None
        assert session.get(DocumentSegment, "foreign") is not None
        document = session.get(Document, "document-1")
        assert document is not None
        assert document.word_count == 0


def test_failed_status_intent_can_be_retriggered_without_flipping_desired_state(
    indexing_probe: IndexingProbe,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    app, _, _ = indexing_probe
    context = RequestContext("request", None, "author", "workspace-1")
    segment = _create_completed_segment(
        app,
        sqlite_session_factory,
        context,
        dataset_id="dataset-1",
        document_id="document-1",
        values={"content": "content"},
    )
    app.change_segment_status(
        context,
        dataset_id="dataset-1",
        document_id="document-1",
        segment_ids=[segment.data.id],
        action="disable",
    )
    with sqlite_session_factory.begin() as session:
        row = session.get(DocumentSegment, segment.data.id)
        assert row is not None
        first_generation = row.indexing_generation
        assert first_generation is not None
        row.status = SegmentStatus.ERROR
        row.error = "worker retries exhausted"

    app.change_segment_status(
        context,
        dataset_id="dataset-1",
        document_id="document-1",
        segment_ids=[segment.data.id],
        action="disable",
    )

    with sqlite_session_factory() as session:
        row = session.get(DocumentSegment, segment.data.id)
        assert row is not None
        assert row.enabled is False
        assert row.status == SegmentStatus.INDEXING
        assert row.error is None
        assert row.indexing_generation is not None
        assert row.indexing_generation != first_generation
        intents = session.scalars(
            select(KnowledgeTaskOutbox)
            .where(KnowledgeTaskOutbox.task_kind == "segment_index_disable")
            .order_by(KnowledgeTaskOutbox.created_at, KnowledgeTaskOutbox.id)
        ).all()
        assert len(intents) == 2
        assert intents[-1].payload["generation"] == row.indexing_generation


def test_patch_rejects_hierarchical_segment_while_durable_create_is_still_pending(
    indexing_probe: IndexingProbe,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    app, repository, probe = indexing_probe
    with sqlite_session_factory.begin() as session:
        document = session.get(Document, "document-1")
        assert document is not None
        document.doc_form = IndexStructureType.PARENT_CHILD_INDEX
    context = RequestContext("create", None, "author", "workspace-1")
    created = app.create_segment(
        context,
        dataset_id="dataset-1",
        document_id="document-1",
        values={"content": "first"},
    )
    assert created.data.status == SegmentStatus.INDEXING
    segment_ref = DatasetRef("workspace-1", "dataset-1").document("document-1").segment(created.data.id)
    with sqlite_session_factory() as session:
        segment = session.get(DocumentSegment, segment_ref.segment_id)
        assert segment is not None
        generation = segment.indexing_generation
        assert generation is not None

    with pytest.raises(SegmentDocumentIndexingError, match="Segment is indexing"):
        app.update_segment(
            RequestContext("patch", None, "editor", "workspace-1"),
            dataset_id="dataset-1",
            document_id="document-1",
            segment_id=segment_ref.segment_id,
            values={"content": "second", "regenerate_child_chunks": True},
        )

    with sqlite_session_factory() as session:
        segment = session.get(DocumentSegment, segment_ref.segment_id)
        assert segment is not None
        assert segment.content == "first"
        assert segment.status == SegmentStatus.INDEXING
        assert segment.indexing_generation == generation
        assert session.scalars(select(ChildChunk).where(ChildChunk.segment_id == segment_ref.segment_id)).all() == []
        intent = session.scalar(
            select(KnowledgeTaskOutbox).where(
                KnowledgeTaskOutbox.task_kind == "segment_index_create",
            )
        )
        assert intent is not None
        assert segment_ref.segment_id in cast(list[str], intent.payload["segment_ids"])
    assert repository.get_children(segment_ref) == ()
    assert probe.writes == 0


@pytest.mark.parametrize("operation", ["create", "update", "batch", "delete"])
def test_child_mutations_reject_parent_while_durable_create_is_still_pending(
    operation: str,
    indexing_probe: IndexingProbe,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    app, repository, probe = indexing_probe
    with sqlite_session_factory.begin() as session:
        document = session.get(Document, "document-1")
        assert document is not None
        document.doc_form = IndexStructureType.PARENT_CHILD_INDEX
    created = app.create_segment(
        RequestContext("create", None, "author", "workspace-1"),
        dataset_id="dataset-1",
        document_id="document-1",
        values={"content": "parent"},
    )
    assert created.data.status == SegmentStatus.INDEXING
    segment_ref = DatasetRef("workspace-1", "dataset-1").document("document-1").segment(created.data.id)
    context = RequestContext("child-mutation", None, "editor", "workspace-1")
    with sqlite_session_factory() as session:
        segment = session.get(DocumentSegment, segment_ref.segment_id)
        assert segment is not None
        generation = segment.indexing_generation
        assert generation is not None

    def mutate_child() -> None:
        if operation == "create":
            app.create_child_chunk(
                context,
                dataset_id="dataset-1",
                document_id="document-1",
                segment_id=segment_ref.segment_id,
                content="child",
            )
        elif operation == "update":
            app.update_child_chunk(
                context,
                dataset_id="dataset-1",
                document_id="document-1",
                segment_id=segment_ref.segment_id,
                child_chunk_id="unknown-child",
                content="updated",
            )
        elif operation == "batch":
            app.update_child_chunks(
                context,
                dataset_id="dataset-1",
                document_id="document-1",
                segment_id=segment_ref.segment_id,
                chunks=[ChildChunkUpdateArgs(content="child")],
            )
        else:
            app.delete_child_chunk(
                context,
                dataset_id="dataset-1",
                document_id="document-1",
                segment_id=segment_ref.segment_id,
                child_chunk_id="unknown-child",
            )

    with pytest.raises(ChildChunkIndexingApplicationError, match="Segment is indexing"):
        mutate_child()

    with sqlite_session_factory() as session:
        segment = session.get(DocumentSegment, segment_ref.segment_id)
        assert segment is not None
        assert segment.status == SegmentStatus.INDEXING
        assert segment.indexing_generation == generation
        assert segment.content == "parent"
        assert session.scalars(select(ChildChunk).where(ChildChunk.segment_id == segment_ref.segment_id)).all() == []
        intents = session.scalars(
            select(KnowledgeTaskOutbox).where(
                KnowledgeTaskOutbox.task_kind.in_(("segment_index_create", "segment_index_reconcile"))
            )
        ).all()
        assert [intent.task_kind for intent in intents] == ["segment_index_create"]
        assert segment_ref.segment_id in cast(list[str], intents[0].payload["segment_ids"])
    assert repository.get_children(segment_ref) == ()
    assert probe.writes == 0


def test_child_regeneration_reuses_splitter_outside_transaction(
    segment_update: SegmentUpdateEntry,
    indexing_probe: IndexingProbe,
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import json

    from core.rag.index_processor.processor.parent_child_index_processor import ParentChildIndexProcessor
    from models.dataset import DatasetProcessRule
    from models.enums import ProcessRuleMode

    app, repository, probe = indexing_probe
    with sqlite_session_factory.begin() as session:
        dataset = session.get(Dataset, "dataset-1")
        assert dataset is not None
        dataset.embedding_model_provider = "provider"
        rule = DatasetProcessRule(
            dataset_id="dataset-1",
            mode=ProcessRuleMode.HIERARCHICAL,
            rules=json.dumps({"parent_mode": "full-doc", "subchunk_segmentation": {"max_tokens": 100}}),
            created_by="author",
        )
        session.add(rule)
        document = session.get(Document, "document-1")
        assert document is not None
        document.doc_form = IndexStructureType.PARENT_CHILD_INDEX
        document.dataset_process_rule_id = rule.id

    def split(_self, document: IndexDocument, _rule, _mode, _model) -> list[ChildDocument]:
        assert not probe.active_transactions
        return [
            ChildDocument(
                page_content=document.page_content, metadata={"doc_id": document.page_content, "doc_hash": "hash"}
            )
        ]

    monkeypatch.setattr(ParentChildIndexProcessor, "split_child_nodes", split)
    context = RequestContext("request", None, "author", "workspace-1")
    created = _create_completed_segment(
        app,
        sqlite_session_factory,
        context,
        dataset_id="dataset-1",
        document_id="document-1",
        values={"content": "first"},
    )
    assert created.data.status == "completed"
    with sqlite_session_factory() as session:
        create_intent = session.scalar(
            select(KnowledgeTaskOutbox).where(
                KnowledgeTaskOutbox.task_kind == "segment_index_reconcile",
                KnowledgeTaskOutbox.resource_id == created.data.id,
            )
        )
        segment = session.get(DocumentSegment, created.data.id)
        assert create_intent is not None
        assert segment is not None
        assert create_intent.payload["parent_generation"] == segment.indexing_generation
        assert create_intent.payload["batch_segment_ids"] == [created.data.id]
    updated = segment_update(
        context,
        dataset_id="dataset-1",
        document_id="document-1",
        segment_id=created.data.id,
        values={"content": "second", "regenerate_child_chunks": True},
    )
    assert updated.data.status == "indexing"
    ref = DatasetRef("workspace-1", "dataset-1").document("document-1").segment(created.data.id)
    children = repository.get_children(ref)
    assert children is not None
    assert [child.data.content for child in children] == ["second"]
    with sqlite_session_factory() as session:
        segment = session.get(DocumentSegment, created.data.id)
        assert segment is not None
        assert segment.indexing_generation is not None
        intent = next(
            row
            for row in session.scalars(
                select(KnowledgeTaskOutbox).where(
                    KnowledgeTaskOutbox.task_kind == "segment_index_reconcile",
                    KnowledgeTaskOutbox.resource_id == created.data.id,
                )
            )
            if row.payload["parent_generation"] == segment.indexing_generation
        )
        completion = SegmentChildIndexCompletion(
            segment.indexing_generation,
            tuple(cast(list[str], intent.payload["batch_segment_ids"])),
        )
        delete_node_ids = tuple(cast(list[str], intent.payload["delete_node_ids"]))

    assert (
        app.mutations.reconcile_children_index(
            ref,
            delete_node_ids=delete_node_ids,
            completion=completion,
        )
        == SegmentIndexReconcileOutcome.COMPLETED
    )
    completed = app.get_segment(
        context,
        dataset_id="dataset-1",
        document_id="document-1",
        segment_id=created.data.id,
    )
    assert completed.data.status == "completed"


def test_hierarchical_parent_retries_real_child_index_before_completion(
    indexing_probe: IndexingProbe,
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import json

    from core.rag.index_processor.processor.parent_child_index_processor import ParentChildIndexProcessor
    from models.dataset import DatasetProcessRule
    from models.enums import ProcessRuleMode

    app, repository, probe = indexing_probe
    with sqlite_session_factory.begin() as session:
        dataset = session.get(Dataset, "dataset-1")
        document = session.get(Document, "document-1")
        assert dataset is not None
        assert document is not None
        dataset.embedding_model_provider = "provider"
        rule = DatasetProcessRule(
            dataset_id=dataset.id,
            mode=ProcessRuleMode.HIERARCHICAL,
            rules=json.dumps({"parent_mode": "full-doc", "subchunk_segmentation": {"max_tokens": 100}}),
            created_by="author",
        )
        session.add(rule)
        session.flush()
        document.doc_form = IndexStructureType.PARENT_CHILD_INDEX
        document.dataset_process_rule_id = rule.id

    def split(_self, document: IndexDocument, _rule, _mode, _model) -> list[ChildDocument]:
        return [
            ChildDocument(
                page_content=document.page_content,
                metadata={"doc_id": "child-node", "doc_hash": "hash"},
            )
        ]

    monkeypatch.setattr(ParentChildIndexProcessor, "split_child_nodes", split)
    scope = SegmentMutationScope(
        dataset=SegmentDatasetRecord("dataset-1", "workspace-1", "high_quality", "provider", "model"),
        document=SegmentDocumentRecord(
            "document-1",
            "dataset-1",
            "workspace-1",
            IndexStructureType.PARENT_CHILD_INDEX,
        ),
    )
    segment_ref = app.mutations.create_segment(
        scope,
        actor_id="author",
        args=SegmentUpdateArgs(content="parent"),
    )
    target = repository.get_segments(scope.document.ref, (segment_ref.segment_id,))[0]
    assert target.generation is not None
    assert (
        app.mutations.reconcile_created_segments(
            scope.document.ref,
            segment_ids=(segment_ref.segment_id,),
            generation=target.generation,
            job_id="job-1",
        )
        == SegmentIndexReconcileOutcome.WAITING
    )
    completion = SegmentChildIndexCompletion(target.generation, (segment_ref.segment_id,), "job-1")

    probe.fail = True
    with pytest.raises(RuntimeError, match="index unavailable"):
        app.mutations.reconcile_children_index(
            segment_ref,
            delete_node_ids=(),
            completion=completion,
        )
    with sqlite_session_factory() as session:
        row = session.get(DocumentSegment, segment_ref.segment_id)
        assert row is not None
        assert row.status == SegmentStatus.INDEXING

    probe.fail = False
    assert (
        app.mutations.reconcile_children_index(
            segment_ref,
            delete_node_ids=(),
            completion=completion,
        )
        == SegmentIndexReconcileOutcome.COMPLETED
    )
    with sqlite_session_factory() as session:
        row = session.get(DocumentSegment, segment_ref.segment_id)
        assert row is not None
        assert row.status == SegmentStatus.COMPLETED


@pytest.mark.parametrize(
    ("content", "submitted_summary", "summary_enabled", "expected_summary", "generated"),
    [
        ("new text", "old summary", True, "new summary", True),
        ("new text", None, True, "new summary", True),
        ("old text", "old summary", True, "old summary", False),
        ("new text", "manual summary", True, "manual summary", False),
        ("new text", "", True, None, False),
        ("new text", " \n\t ", True, None, False),
        ("new text", "old summary", False, "old summary", False),
        ("new text", None, False, "old summary", False),
    ],
)
def test_summary_updates_preserve_generation_and_manual_edit_rules(
    segment_update: SegmentUpdateEntry,
    indexing_probe: IndexingProbe,
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
    content: str,
    submitted_summary: str | None,
    summary_enabled: bool,
    expected_summary: str | None,
    generated: bool,
) -> None:
    app, _, _ = indexing_probe
    context = RequestContext("request", None, "author", "workspace-1")
    created = _create_completed_segment(
        app,
        sqlite_session_factory,
        context,
        dataset_id="dataset-1",
        document_id="document-1",
        values={"content": "old text"},
    )
    with sqlite_session_factory.begin() as session:
        dataset = session.get(Dataset, "dataset-1")
        assert dataset is not None
        session.add(
            DocumentSegmentSummary(
                dataset_id=dataset.id,
                document_id="document-1",
                chunk_id=created.data.id,
                summary_content="old summary",
            )
        )
        dataset.summary_index_setting = {
            "enable": summary_enabled,
            "model_name": "llm-model",
            "model_provider_name": "provider",
        }
    calls: list[str] = []

    def generate(*, text: str, **_kwargs: object) -> tuple[str, LLMUsage]:
        calls.append(text)
        return "new summary", LLMUsage.empty_usage()

    monkeypatch.setattr(ParagraphIndexProcessor, "generate_summary_from_inputs", staticmethod(generate))
    updated = segment_update(
        context,
        dataset_id="dataset-1",
        document_id="document-1",
        segment_id=created.data.id,
        values={"content": content, "summary": submitted_summary},
    )
    assert calls == ([content] if generated else [])
    assert updated.data.summary == expected_summary


def test_automatic_summary_keeps_knowledge_credit_attribution(
    indexing_probe: IndexingProbe,
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    app, _, _ = indexing_probe
    context = RequestContext("request", None, "author", "workspace-1")
    created = _create_completed_segment(
        app,
        sqlite_session_factory,
        context,
        dataset_id="dataset-1",
        document_id="document-1",
        values={"content": "old text"},
    )
    setting: SummaryIndexSettingDict = {"enable": True, "model_name": "llm-model", "model_provider_name": "provider"}
    with sqlite_session_factory.begin() as session:
        dataset = session.get(Dataset, "dataset-1")
        assert dataset is not None
        session.add(
            DocumentSegmentSummary(
                dataset_id=dataset.id,
                document_id="document-1",
                chunk_id=created.data.id,
                summary_content="old summary",
            )
        )
        dataset.summary_index_setting = setting
    metadata: list[Mapping[str, object] | None] = []

    class ModelProbe:
        credentials: dict[str, str] = {}

        @property
        def model_type_instance(self) -> "ModelProbe":
            return self

        def get_model_schema(self, _name: str, _credentials: object) -> None:
            return None

        def get_text_embedding_num_tokens(self, texts: Sequence[str]) -> list[int]:
            return [len(text) for text in texts]

        def invoke_llm(self, **_kwargs: object) -> LLMResult:
            metadata.append(get_credit_usage_metadata())
            return LLMResult(
                model="llm-model", message=AssistantPromptMessage(content="new summary"), usage=LLMUsage.empty_usage()
            )

        def get_model_instance(self, **_kwargs: object) -> "ModelProbe":
            return self

    monkeypatch.setattr(ModelManager, "for_tenant", lambda **_kwargs: ModelProbe())
    # Both public summary entry points must preserve the credit-usage context.
    with sqlite_session_factory() as session:
        ParagraphIndexProcessor.generate_summary("workspace-1", "old text", setting, session=session)
    assert metadata.pop() == {"created_by": CreditUsageCreatedBy.KNOWLEDGE_INDEXING}
    updated = app.update_segment(
        context,
        dataset_id="dataset-1",
        document_id="document-1",
        segment_id=created.data.id,
        values={"content": "new text"},
    )
    assert updated.data.summary == "new summary"
    assert metadata == [{"created_by": CreditUsageCreatedBy.KNOWLEDGE_INDEXING}]
    assert get_credit_usage_metadata() is None


@pytest.mark.parametrize("storage_type", ["database", "file"])
def test_economy_index_shares_persistence_with_existing_keyword_calls(
    indexing_probe: IndexingProbe,
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    storage_type: str,
) -> None:
    from core.rag.datasource.keyword.jieba import jieba as jieba_module
    from core.rag.datasource.keyword.keyword_factory import Keyword
    from repositories.knowledge import keyword_table_repository as table_module
    from tests.unit_tests.config_override import apply_config_overrides

    app, repository, probe = indexing_probe
    reads: list[str] = []
    writes: list[str] = []

    class FileStorageProbe:
        def load_once(self, key: str) -> bytes:
            assert not probe.active_transactions
            reads.append(key)
            return (tmp_path / key).read_bytes()

        def exists(self, key: str) -> bool:
            assert not probe.active_transactions
            return (tmp_path / key).exists()

        def save(self, key: str, data: bytes) -> None:
            assert not probe.active_transactions
            writes.append(key)
            path = tmp_path / key
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)

        def delete(self, key: str) -> None:
            assert not probe.active_transactions
            (tmp_path / key).unlink()

    class KeywordExtractor:
        def extract_keywords(self, text: str, _keyword_number: int = 10) -> set[str]:
            assert not probe.active_transactions
            return set(text.split())

    storage = FileStorageProbe()
    monkeypatch.setattr(jieba_module, "storage", storage)
    monkeypatch.setattr(jieba_module, "JiebaKeywordTableHandler", KeywordExtractor)
    apply_config_overrides(monkeypatch, KEYWORD_DATA_SOURCE_TYPE=storage_type)
    with sqlite_session_factory.begin() as session:
        dataset = session.get(Dataset, "dataset-1")
        assert dataset is not None
        dataset.indexing_technique = IndexTechniqueType.ECONOMY
    context = RequestContext("request", None, "author", "workspace-1")
    first = _create_completed_segment(
        app,
        sqlite_session_factory,
        context,
        dataset_id="dataset-1",
        document_id="document-1",
        values={"content": "initial 中文"},
    )
    second = _create_completed_segment(
        app,
        sqlite_session_factory,
        context,
        dataset_id="dataset-1",
        document_id="document-1",
        values={"content": "other", "keywords": ["manual"]},
    )
    updated = app.update_segment(
        context,
        dataset_id="dataset-1",
        document_id="document-1",
        segment_id=first.data.id,
        values={"content": "replacement"},
    )
    assert first.data.status == second.data.status == updated.data.status == "completed"
    assert first.data.index_node_id is not None
    assert second.data.index_node_id is not None
    assert set(first.data.keywords or ()) == {"initial", "中文"}
    assert second.data.keywords == ("manual",)
    assert updated.data.keywords == ("replacement",)
    dataset_ref = DatasetRef("workspace-1", "dataset-1")
    source_type, data = repository.get_keyword_table(dataset_ref)
    payload = table_module.load_keyword_table(
        storage=storage, tenant_id="workspace-1", dataset_id="dataset-1", storage_type=source_type, data=data
    )
    assert payload is not None
    assert payload["__data__"]["table"] == {
        "replacement": {first.data.index_node_id},
        "manual": {second.data.index_node_id},
    }
    if storage_type == "database":
        assert reads == writes == []
    else:
        assert writes == ["keyword_files/workspace-1/dataset-1.txt"] * 3

    # The existing session-taking API must consume the exact payload written by
    # the repository-backed path. Only that existing API retains caller sessions.
    class SessionFileStorage:
        def load_once(self, key: str) -> bytes:
            return (tmp_path / key).read_bytes()

        def exists(self, key: str) -> bool:
            return (tmp_path / key).exists()

        def save(self, key: str, data: bytes) -> None:
            (tmp_path / key).write_bytes(data)

        def delete(self, key: str) -> None:
            (tmp_path / key).unlink()

    session_storage = SessionFileStorage()
    monkeypatch.setattr(jieba_module, "storage", session_storage)
    monkeypatch.setattr(jieba_module, "redis_client", IndexRedisStub())
    with sqlite_session_factory() as session:
        dataset = session.get(Dataset, "dataset-1")
        assert dataset is not None
        keyword = Keyword(dataset)
        assert keyword.text_exists(first.data.index_node_id, session=session)
        assert keyword.text_exists(second.data.index_node_id, session=session)
        keyword.delete_by_ids([first.data.index_node_id], session)
        session.commit()
    source_type, data = repository.get_keyword_table(dataset_ref)
    payload = table_module.load_keyword_table(
        storage=session_storage, tenant_id="workspace-1", dataset_id="dataset-1", storage_type=source_type, data=data
    )
    assert payload is not None
    assert payload["__data__"]["table"] == {"manual": {second.data.index_node_id}}


@pytest.mark.parametrize("generated_summary", [None, "", " \n\t "], ids=["exception", "empty", "whitespace"])
def test_summary_generation_failure_preserves_the_completed_segment(
    segment_update: SegmentUpdateEntry,
    indexing_probe: IndexingProbe,
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
    generated_summary: str | None,
) -> None:
    app, _, probe = indexing_probe
    context = RequestContext("request", None, "author", "workspace-1")
    created = _create_completed_segment(
        app,
        sqlite_session_factory,
        context,
        dataset_id="dataset-1",
        document_id="document-1",
        values={"content": "original"},
    )
    with sqlite_session_factory.begin() as session:
        dataset = session.get(Dataset, "dataset-1")
        assert dataset is not None
        dataset.summary_index_setting = {"enable": True, "model_name": "model", "model_provider_name": "provider"}
        session.add(
            DocumentSegmentSummary(
                dataset_id=dataset.id,
                document_id="document-1",
                chunk_id=created.data.id,
                summary_content="original summary",
                summary_index_node_id="original-summary-node",
            )
        )

    def generate(*_args: object, **_kwargs: object) -> tuple[str, LLMUsage]:
        assert not probe.active_transactions
        if generated_summary is not None:
            return generated_summary, LLMUsage.empty_usage()
        raise RuntimeError("LLM unavailable")

    monkeypatch.setattr(ParagraphIndexProcessor, "generate_summary_from_inputs", staticmethod(generate))
    updated = segment_update(
        context,
        dataset_id="dataset-1",
        document_id="document-1",
        segment_id=created.data.id,
        values={"content": "replacement", "summary": "original summary"},
    )
    assert updated.data.content == "replacement"
    assert updated.data.enabled is True
    assert updated.data.status == "completed"
    assert updated.data.summary == "original summary"
    assert "original-summary-node" not in probe.deleted_ids
    with sqlite_session_factory() as session:
        summary = session.scalar(select(DocumentSegmentSummary))
        assert summary is not None
        assert summary.status == "error"
        assert summary.summary_index_node_id == "original-summary-node"
        assert summary.error == ("Generated summary is empty" if generated_summary is not None else "LLM unavailable")


@pytest.mark.parametrize("failed_commits", [1, 2, 3])
def test_summary_commit_retries_use_fresh_sessions_and_persist_outcome(
    indexing_probe: IndexingProbe,
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
    failed_commits: int,
) -> None:
    from services.knowledge.summaries import adapters as summary_module

    app, _, probe = indexing_probe
    context = RequestContext("request", None, "author", "workspace-1")
    created = _create_completed_segment(
        app,
        sqlite_session_factory,
        context,
        dataset_id="dataset-1",
        document_id="document-1",
        values={"content": "original"},
    )
    attempts: list[Session] = []
    delays: list[float] = []

    def fail_summary_commit(session: Session) -> None:
        if any(
            isinstance(record, DocumentSegmentSummary) and record.status == SummaryStatus.COMPLETED
            for record in session.new | session.dirty
        ):
            attempts.append(session)
            if len(attempts) <= failed_commits:
                raise ConnectionError("connection lost before commit")

    def wait(seconds: float) -> None:
        assert not probe.active_transactions
        delays.append(seconds)

    monkeypatch.setattr(summary_module.time, "sleep", wait)
    event.listen(sqlite_session_factory.class_, "before_commit", fail_summary_commit)
    try:
        updated = app.update_segment(
            context,
            dataset_id="dataset-1",
            document_id="document-1",
            segment_id=created.data.id,
            values={"content": "original", "summary": "manual summary"},
        )
        assert updated.data.status == "completed"
        assert updated.data.enabled is True
        assert not probe.active_transactions
    finally:
        event.remove(sqlite_session_factory.class_, "before_commit", fail_summary_commit)
        for session in attempts:
            session.close()

    assert len(attempts) == min(failed_commits + 1, 3)
    assert len({id(session) for session in attempts}) == len(attempts)
    assert delays == [2.0, 4.0][: min(failed_commits, 2)]
    with sqlite_session_factory() as session:
        summary = session.scalar(select(DocumentSegmentSummary))
        assert summary is not None
        assert summary.summary_content == "manual summary"
        if failed_commits < 3:
            assert summary.status == SummaryStatus.COMPLETED
            assert summary.summary_index_node_id is not None
            assert summary.summary_index_node_hash is not None
            assert summary.error is None
        else:
            assert summary.status == SummaryStatus.GENERATING
            assert summary.error is None


def test_summary_noop_does_not_open_a_database_transaction(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    from services.knowledge.segments.indexing import SegmentIndexingGateway

    repository = SQLAlchemySegmentRepository(
        session_factory=sqlite_session_factory, wake_after_commit=_noop_wake_after_commit
    )
    gateway = SegmentIndexingGateway(
        segments=repository,
        uploads=SQLAlchemyKnowledgeUploadRepository(session_factory=sqlite_session_factory),
        redis=IndexRedisStub(),
        new_session=sqlite_session_factory,
    )
    engine = sqlite_session_factory.kw["bind"]
    connections: list[Connection] = []
    record_connection = connections.append
    event.listen(engine, "begin", record_connection)
    try:
        gateway.update_summary(
            DatasetRef("workspace-1", "dataset-1").document("document-1").segment("segment-1"),
            summary=None,
            content_changed=False,
        )
    finally:
        event.remove(engine, "begin", record_connection)
    assert connections == []


@pytest.mark.parametrize(
    ("values", "expects_index_write"),
    [
        ({"answer": "new answer"}, False),
        ({"content": "question", "answer": "new answer", "regenerate_child_chunks": False}, False),
        ({"content": "new question", "answer": "new answer"}, True),
    ],
)
def test_partial_qa_update_uses_application_word_count_and_indexing(
    indexing_probe: IndexingProbe,
    sqlite_session_factory: sessionmaker[Session],
    values: dict[str, object],
    expects_index_write: bool,
) -> None:
    app, _, probe = indexing_probe
    with sqlite_session_factory.begin() as session:
        document = session.get(Document, "document-1")
        assert document is not None
        document.doc_form = IndexStructureType.QA_INDEX
    created = _create_completed_segment(
        app,
        sqlite_session_factory,
        RequestContext("request", None, "author", "workspace-1"),
        dataset_id="dataset-1",
        document_id="document-1",
        values={"content": "question", "answer": "answer"},
    )
    initial_batches = list(probe.batches)
    initial_writes = probe.writes
    if not expects_index_write:
        # An answer-only update must remain a database-only operation even if
        # the vector provider is currently unavailable.
        probe.fail = True
    updated = app.update_segment(
        RequestContext("update", None, "editor", "workspace-1"),
        dataset_id="dataset-1",
        document_id="document-1",
        segment_id=created.data.id,
        values=values,
    )

    assert updated.data.content == values.get("content", "question")
    assert updated.data.answer == "new answer"
    assert updated.data.word_count == len(updated.data.content) + len(updated.data.answer)
    assert updated.data.enabled is True
    assert updated.data.status == "completed"
    with sqlite_session_factory() as session:
        document = session.get(Document, "document-1")
        segment = session.get(DocumentSegment, created.data.id)
        assert document is not None
        assert segment is not None
        assert document.word_count == updated.data.word_count
        assert segment.tokens == len(updated.data.content)
    if expects_index_write:
        assert probe.writes == initial_writes + 1
    else:
        assert probe.batches == initial_batches
        assert probe.writes == initial_writes


def _persist_index_batch(
    session_factory: sessionmaker[Session], *, doc_form: IndexStructureType = IndexStructureType.PARAGRAPH_INDEX
) -> None:
    with session_factory.begin() as session:
        document = session.get(Document, "document-1")
        assert document is not None
        document.doc_form = doc_form
        for position, content in enumerate(("first", "second"), start=1):
            segment = _segment(content, "workspace-1", "dataset-1", "document-1")
            segment.position = position
            segment.content = content
            segment.index_node_id = f"node-{content}"
            segment.index_node_hash = f"hash-{content}"
            session.add(segment)


@pytest.mark.parametrize("doc_form", [IndexStructureType.PARAGRAPH_INDEX, IndexStructureType.QA_INDEX])
def test_batch_index_materializes_ordered_documents_before_one_vector_write(
    indexing_probe: IndexingProbe, sqlite_session_factory: sessionmaker[Session], doc_form: IndexStructureType
) -> None:
    app, _, probe = indexing_probe
    _persist_index_batch(sqlite_session_factory, doc_form=doc_form)

    app.mutations.index_segments(
        DatasetRef("workspace-1", "dataset-1").document("document-1"), segment_ids=["second", "first"]
    )

    assert probe.batches == [("second", "first")]
    assert probe.writes == 2
    assert not probe.active_transactions


def test_batch_index_failure_persists_errors_on_every_committed_segment(
    indexing_probe: IndexingProbe, sqlite_session_factory: sessionmaker[Session]
) -> None:
    app, _, probe = indexing_probe
    _persist_index_batch(sqlite_session_factory)
    probe.fail = True

    with pytest.raises(RuntimeError, match="index unavailable"):
        app.mutations.index_segments(
            DatasetRef("workspace-1", "dataset-1").document("document-1"), segment_ids=["first", "second"]
        )

    with sqlite_session_factory() as session:
        segments = session.scalars(select(DocumentSegment)).all()
        assert len(segments) == 2
        assert all(segment.status == "error" and not segment.enabled for segment in segments)
        assert all(segment.error == "index unavailable" and segment.disabled_at is not None for segment in segments)


@pytest.mark.parametrize("owner_field", ["tenant_id", "dataset_id", "document_id"])
def test_batch_index_validates_every_segment_owner_before_external_io(
    indexing_probe: IndexingProbe, sqlite_session_factory: sessionmaker[Session], owner_field: str
) -> None:
    app, _, probe = indexing_probe
    _persist_index_batch(sqlite_session_factory)
    with sqlite_session_factory.begin() as session:
        foreign = session.get(DocumentSegment, "second")
        assert foreign is not None
        setattr(foreign, owner_field, "foreign-owner")

    with pytest.raises(LookupError, match="Segment no longer exists"):
        app.mutations.index_segments(
            DatasetRef("workspace-1", "dataset-1").document("document-1"), segment_ids=["first", "second"]
        )

    assert not probe.batches
    with sqlite_session_factory() as session:
        foreign = session.get(DocumentSegment, "second")
        assert foreign is not None
        assert foreign.status == "completed"


def test_batch_index_preserves_owned_attachments(
    indexing_probe: IndexingProbe, sqlite_session_factory: sessionmaker[Session]
) -> None:
    app, _, probe = indexing_probe
    _persist_index_batch(sqlite_session_factory)
    with sqlite_session_factory.begin() as session:
        dataset = session.get(Dataset, "dataset-1")
        assert dataset is not None
        dataset.is_multimodal = True
        session.add_all([_upload("owned", "workspace-1", "image.png"), _upload("foreign", "workspace-2", "other.png")])
        for file_id in ("owned", "foreign"):
            session.add(
                SegmentAttachmentBinding(
                    tenant_id="workspace-1",
                    dataset_id="dataset-1",
                    document_id="document-1",
                    segment_id="first",
                    attachment_id=file_id,
                )
            )

    app.mutations.index_segments(
        DatasetRef("workspace-1", "dataset-1").document("document-1"), segment_ids=["first", "second"]
    )

    assert probe.writes == 3
    with sqlite_session_factory() as session:
        assert len(session.scalars(select(SegmentAttachmentBinding)).all()) == 2


def test_batch_create_persists_and_indexes_only_owned_attachments(
    indexing_probe: IndexingProbe, sqlite_session_factory: sessionmaker[Session]
) -> None:
    app, repository, probe = indexing_probe
    with sqlite_session_factory.begin() as session:
        dataset = session.get(Dataset, "dataset-1")
        assert dataset is not None
        dataset.is_multimodal = True
        session.add_all(
            [
                _upload("owned", "workspace-1", "image.png"),
                _upload("foreign", "workspace-2", "other.png"),
            ]
        )
    scope = SegmentMutationScope(
        dataset=SegmentDatasetRecord(
            id="dataset-1",
            workspace_id="workspace-1",
            indexing_technique="high_quality",
            embedding_model_provider="provider",
            embedding_model="model",
        ),
        document=SegmentDocumentRecord(
            id="document-1",
            dataset_id="dataset-1",
            workspace_id="workspace-1",
            doc_form="text_model",
        ),
    )

    refs = app.mutations.create_segments(
        scope,
        actor_id="account-1",
        args=(
            SegmentUpdateArgs(content="first", attachment_ids=["owned"]),
            SegmentUpdateArgs(content="second"),
        ),
    )
    targets = repository.get_segments(scope.document.ref, [ref.segment_id for ref in refs])
    assert targets[0].generation is not None
    app.mutations.reconcile_created_segments(
        scope.document.ref,
        segment_ids=[ref.segment_id for ref in refs],
        generation=targets[0].generation,
    )

    with sqlite_session_factory() as session:
        bindings = session.scalars(select(SegmentAttachmentBinding)).all()
    assert [(binding.segment_id, binding.attachment_id) for binding in bindings] == [(refs[0].segment_id, "owned")]
    assert probe.writes == 3


def test_partially_deleted_created_batch_cancels_job_and_terminalizes_surviving_generation(
    indexing_probe: IndexingProbe,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    app, repository, probe = indexing_probe
    scope = SegmentMutationScope(
        dataset=SegmentDatasetRecord(
            id="dataset-1",
            workspace_id="workspace-1",
            indexing_technique="high_quality",
            embedding_model_provider="provider",
            embedding_model="model",
        ),
        document=SegmentDocumentRecord(
            id="document-1",
            dataset_id="dataset-1",
            workspace_id="workspace-1",
            doc_form="text_model",
        ),
    )
    refs = app.mutations.create_imported_segments(
        scope,
        actor_id="account-1",
        args=(SegmentUpdateArgs(content="first"), SegmentUpdateArgs(content="second")),
        job_id="job-1",
    )
    targets = repository.get_segments(scope.document.ref, [ref.segment_id for ref in refs])
    assert targets[0].generation is not None
    generation = targets[0].generation
    repository.delete_segments(scope.document.ref, (refs[1].segment_id,))

    assert (
        app.mutations.reconcile_created_segments(
            scope.document.ref,
            segment_ids=tuple(ref.segment_id for ref in refs),
            generation=generation,
            job_id="job-1",
        )
        == SegmentIndexReconcileOutcome.CANCELLED
    )
    assert probe.writes == 0
    with sqlite_session_factory() as session:
        surviving = session.get(DocumentSegment, refs[0].segment_id)
        assert surviving is not None
        assert surviving.status == SegmentStatus.ERROR
        assert surviving.enabled is False
        assert surviving.error == "Segment indexing was cancelled because the batch state changed"


def test_batch_index_keeps_manual_keywords_aligned_with_segments(
    indexing_probe: IndexingProbe,
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from core.rag.datasource.keyword.jieba import jieba as jieba_module
    from tests.unit_tests.config_override import apply_config_overrides

    app, _, probe = indexing_probe
    _persist_index_batch(sqlite_session_factory)
    with sqlite_session_factory.begin() as session:
        dataset = session.get(Dataset, "dataset-1")
        assert dataset is not None
        dataset.indexing_technique = IndexTechniqueType.ECONOMY

    class Extractor:
        def extract_keywords(self, text: str, _keyword_number: int = 10) -> set[str]:
            assert not probe.active_transactions
            return {text}

    monkeypatch.setattr(jieba_module, "JiebaKeywordTableHandler", Extractor)
    apply_config_overrides(monkeypatch, KEYWORD_DATA_SOURCE_TYPE="database")
    app.mutations.index_segments(
        DatasetRef("workspace-1", "dataset-1").document("document-1"),
        segment_ids=["second", "first"],
        keywords_list=[["manual"], None],
    )

    with sqlite_session_factory() as session:
        assert {s.id: s.keywords for s in session.scalars(select(DocumentSegment))} == {
            "first": ["first"],
            "second": ["manual"],
        }
    assert not probe.batches


def test_batch_parent_child_index_persists_children_before_reconcile_without_open_transactions(
    indexing_probe: IndexingProbe,
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from core.rag.index_processor.processor.parent_child_index_processor import ParentChildIndexProcessor
    from models.dataset import DatasetProcessRule
    from models.enums import ProcessRuleMode

    app, repository, probe = indexing_probe
    _persist_index_batch(sqlite_session_factory, doc_form=IndexStructureType.PARENT_CHILD_INDEX)
    with sqlite_session_factory.begin() as session:
        rule = DatasetProcessRule(
            dataset_id="dataset-1",
            mode=ProcessRuleMode.HIERARCHICAL,
            rules='{"parent_mode":"full-doc","subchunk_segmentation":{"max_tokens":100}}',
            created_by="author",
        )
        session.add(rule)
        document = session.get(Document, "document-1")
        dataset = session.get(Dataset, "dataset-1")
        assert document is not None
        assert dataset is not None
        dataset.embedding_model_provider = "provider"
        document.dataset_process_rule_id = rule.id

    def split(_self, document: IndexDocument, _rule, _mode, _model) -> list[ChildDocument]:
        assert not probe.active_transactions
        return [
            ChildDocument(
                page_content=document.page_content, metadata={"doc_id": document.page_content, "doc_hash": "hash"}
            )
        ]

    monkeypatch.setattr(ParentChildIndexProcessor, "split_child_nodes", split)
    document_ref = DatasetRef("workspace-1", "dataset-1").document("document-1")
    app.mutations.index_segments(document_ref, segment_ids=["first", "second"])

    assert probe.writes == 0
    for segment_id in ("first", "second"):
        segment_ref = document_ref.segment(segment_id)
        children = repository.get_children(segment_ref)
        assert children is not None
        assert len(children) == 1
        assert children[0].data.content == segment_id
        app.mutations.reconcile_children_index(segment_ref, delete_node_ids=())
    assert probe.writes == 2
    with sqlite_session_factory() as session:
        intents = session.scalars(
            select(KnowledgeTaskOutbox).where(KnowledgeTaskOutbox.task_kind == "segment_index_reconcile")
        ).all()
    assert {intent.resource_id for intent in intents} == {"first", "second"}


@pytest.mark.parametrize("entry", ["detail", "list"])
@pytest.mark.parametrize("delete_after_read", [False, True])
def test_segment_presentation_signs_after_repository_connections_are_released(
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
    entry: str,
    delete_after_read: bool,
) -> None:
    from uuid import uuid4

    from repositories.knowledge import segment_read_adapter

    file_id = str(uuid4())
    with sqlite_session_factory.begin() as session:
        segment = _segment("segment-1", "workspace-1", "dataset-1", "document-1")
        segment.content = f"![image](/files/{file_id}/image-preview?sign=old)"
        session.add_all(
            [
                _dataset("dataset-1", "workspace-1"),
                _document("document-1", "workspace-1", "dataset-1"),
                segment,
                _upload(file_id, "workspace-1", "image.png"),
                SegmentAttachmentBinding(
                    tenant_id="workspace-1",
                    dataset_id="dataset-1",
                    document_id="document-1",
                    segment_id="segment-1",
                    attachment_id=file_id,
                ),
            ]
        )
    engine = sqlite_session_factory.kw["bind"]
    active: set[object] = set()
    signed: list[str] = []
    statements: list[str] = []
    original_sign = segment_read_adapter._sign_upload_file_uri

    def checkout(_connection: object, record: object, _proxy: object) -> None:
        active.add(record)

    def checkin(_connection: object, record: object) -> None:
        active.discard(record)

    def sign(upload_file_id: str, *, preview_kind: Literal["image", "file"] = "file") -> str:
        assert not active
        signed.append(upload_file_id)
        return original_sign(upload_file_id, preview_kind=preview_kind)

    def executed(_connection: object, _cursor: object, statement: str, *_args: object) -> None:
        statements.append(statement)

    monkeypatch.setattr(segment_read_adapter, "_sign_upload_file_uri", sign)
    event.listen(engine, "checkout", checkout)
    event.listen(engine, "checkin", checkin)
    repository = SQLAlchemySegmentRepository(
        session_factory=sqlite_session_factory, wake_after_commit=lambda _session: None
    )
    ref = DatasetRef("workspace-1", "dataset-1").document("document-1")
    try:
        if entry == "detail":
            detail = repository.get_segment(ref.segment("segment-1"))
            assert detail is not None
            snapshots = (detail.data,)
        else:
            snapshots = repository.list_segments(ref, SegmentListFilter()).items
        assert not signed
        assert not active
        assert "sign_content" not in snapshots[0].values
        assert not hasattr(snapshots[0].attachments[0], "source_url")
        if delete_after_read:
            with sqlite_session_factory.begin() as session:
                session.delete(session.get_one(DocumentSegment, "segment-1"))
        event.listen(engine, "before_cursor_execute", executed)
        records = SegmentPresentationAdapter().present(snapshots)
        assert not active
        assert not statements
    finally:
        if event.contains(engine, "before_cursor_execute", executed):
            event.remove(engine, "before_cursor_execute", executed)
        event.remove(engine, "checkout", checkout)
        event.remove(engine, "checkin", checkin)
    assert signed == [file_id, file_id]
    assert "sign=old" not in records[0].sign_content
    assert "?timestamp=" in records[0].sign_content
    assert "?timestamp=" in records[0].attachments[0].source_url


def test_segment_list_batches_content_file_authorization(sqlite_session_factory: sessionmaker[Session]) -> None:
    from uuid import uuid4

    file_ids = [str(uuid4()) for _ in range(100)]
    with sqlite_session_factory.begin() as session:
        session.add_all([_dataset("dataset-1", "workspace-1"), _document("document-1", "workspace-1", "dataset-1")])
        for index, file_id in enumerate(file_ids):
            segment = _segment(f"segment-{index}", "workspace-1", "dataset-1", "document-1")
            segment.position = index
            session.add_all([segment, _upload(file_id, "workspace-1", "image.png")])

    engine = sqlite_session_factory.kw["bind"]
    statements: list[str] = []

    def executed(_connection: object, _cursor: object, statement: str, *_args: object) -> None:
        if statement.lstrip().upper().startswith("SELECT"):
            statements.append(statement)

    repository = SQLAlchemySegmentRepository(
        session_factory=sqlite_session_factory, wake_after_commit=lambda _session: None
    )
    ref = DatasetRef("workspace-1", "dataset-1").document("document-1")
    event.listen(engine, "before_cursor_execute", executed)
    try:
        repository.list_segments(ref, SegmentListFilter(limit=100))
        without_links = len(statements)
        with sqlite_session_factory.begin() as session:
            for index, file_id in enumerate(file_ids):
                session.get_one(
                    DocumentSegment, f"segment-{index}"
                ).content = f"![image](/files/{file_id}/image-preview?sign=old)"
        statements.clear()
        page = repository.list_segments(ref, SegmentListFilter(limit=100))
        with_links = len(statements)
        records = SegmentPresentationAdapter().present(page.items)
        assert len(statements) == with_links
    finally:
        event.remove(engine, "before_cursor_execute", executed)

    assert with_links == without_links + 1
    assert len(records) == 100
    assert all("?timestamp=" in record.sign_content for record in records)
    assert all(
        snapshot.file_access.uploads == frozenset([file_ids[index]]) for index, snapshot in enumerate(page.items)
    )


@pytest.mark.parametrize("owner_change", ["dataset_tenant", "document_tenant", "document_dataset", "deleted_document"])
def test_segment_list_does_not_authorize_rows_with_changed_owners(
    sqlite_session_factory: sessionmaker[Session], owner_change: str
) -> None:
    with sqlite_session_factory.begin() as session:
        dataset = _dataset("dataset-1", "workspace-1")
        document = _document("document-1", "workspace-1", "dataset-1")
        session.add_all([dataset, document, _segment("segment-1", "workspace-1", "dataset-1", "document-1")])
        session.flush()
        if owner_change == "dataset_tenant":
            dataset.tenant_id = "other-workspace"
        elif owner_change == "document_tenant":
            document.tenant_id = "other-workspace"
        elif owner_change == "document_dataset":
            document.dataset_id = "other-dataset"
        else:
            session.delete(document)

    repository = SQLAlchemySegmentRepository(
        session_factory=sqlite_session_factory, wake_after_commit=lambda _session: None
    )
    ref = DatasetRef("workspace-1", "dataset-1").document("document-1")
    page = repository.list_segments(ref, SegmentListFilter())

    assert page.items == ()
    assert page.total == 0
