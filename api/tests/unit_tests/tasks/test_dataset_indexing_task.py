"""SQLite-backed tests for document indexing tasks.

The indexing task deliberately uses separate transactions for validation,
status persistence, indexing, and summary dispatch. These tests persist real
ORM rows so each phase observes only committed database state.
"""

import uuid
from collections.abc import Generator
from contextlib import contextmanager, nullcontext
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from core.rag.index_processor.constant.index_type import IndexStructureType, IndexTechniqueType
from enums import CloudPlan, DeploymentEdition
from extensions.ext_redis import redis_client
from models.dataset import Dataset, Document, DocumentSegment
from models.enums import DataSourceType, DocumentCreatedFrom, IndexingStatus
from models.knowledge_task import KnowledgeTaskOutbox
from services.knowledge.indexing.contracts import DocumentIndexingExecution
from services.knowledge.indexing.errors import DocumentIsPausedError
from services.knowledge.resource_scope import DocumentRef
from services.knowledge.task_outbox.contracts import (
    KnowledgeTaskDeliveryHandledError,
    KnowledgeTaskKind,
    KnowledgeTaskRetriesExhaustedError,
)
from tasks.document_indexing_task import (
    _document_indexing,
    _document_indexing_with_tenant_queue,
    _mark_documents_retry_exhausted,
    document_indexing_task,
    normal_document_indexing_task,
    priority_document_indexing_task,
)
from tasks.duplicate_document_indexing_task import (
    _duplicate_document_indexing_task,
    normal_duplicate_document_indexing_task,
)
from tasks.recover_document_indexing_task import recover_document_indexing_task
from tests.unit_tests.config_override import apply_config_overrides, config_overrides_context


@pytest.mark.parametrize(
    ("status", "entry"),
    [
        ("waiting", "run"),
        ("parsing", "run"),
        ("cleaning", "run"),
        ("splitting", "run_in_splitting_status"),
        ("indexing", "run_in_indexing_status"),
        ("completed", None),
    ],
)
def test_recovery_dispatches_detached_owner_reference(
    sqlite_session, tenant_id, dataset_id, document_ids, status, entry
):
    _persist_indexing_rows(sqlite_session, tenant_id=tenant_id, dataset_id=dataset_id, document_ids=document_ids[:1])
    row = sqlite_session.get(Document, document_ids[0])
    row.indexing_status = status
    generation = str(uuid.uuid4())
    row.indexing_generation = generation
    sqlite_session.commit()
    with patch("tasks.recover_document_indexing_task.build_document_indexing_service") as factory:
        recover_document_indexing_task.run(dataset_id, document_ids[0], generation)
    service = factory.return_value
    if entry is None:
        assert service.mock_calls == []
    else:
        method = {
            "run": service.run,
            "run_in_splitting_status": service.run_in_splitting_status,
            "run_in_indexing_status": service.run_in_indexing_status,
        }[entry]
        method.assert_called_once()
        (argument,) = method.call_args.args
        ref = argument[0] if entry == "run" else argument
        execution = (
            method.call_args.kwargs["executions"][document_ids[0]]
            if entry == "run"
            else method.call_args.kwargs["execution"]
        )
        assert isinstance(execution, DocumentIndexingExecution)
        assert execution.expected_generation == generation
        assert isinstance(ref, DocumentRef)
        assert (ref.dataset.tenant_id, ref.dataset.dataset_id, ref.document_id) == (
            tenant_id,
            dataset_id,
            document_ids[0],
        )


@pytest.fixture
def tenant_id() -> str:
    return str(uuid.uuid4())


@pytest.fixture
def dataset_id() -> str:
    return str(uuid.uuid4())


@pytest.fixture
def document_ids() -> list[str]:
    return [str(uuid.uuid4()) for _ in range(3)]


@pytest.fixture
def mock_redis() -> MagicMock:
    """Reset the external Redis boundary used by tenant-isolated queues."""
    redis_client.reset_mock()
    redis_client.get.return_value = None
    redis_client.setex.return_value = True
    redis_client.delete.return_value = True
    redis_client.lpush.return_value = 1
    redis_client.rpop.return_value = None
    return redis_client


@pytest.fixture
def indexing_runner(monkeypatch: pytest.MonkeyPatch) -> MagicMock:
    runner = MagicMock()
    runner_class = MagicMock(return_value=runner)
    monkeypatch.setattr("tasks.document_indexing_task.build_document_indexing_service", runner_class)
    runner._constructor_mock = runner_class
    return runner


def _features(
    *,
    plan: CloudPlan = CloudPlan.PROFESSIONAL,
    vector_limit: int = 1000,
    vector_size: int = 0,
) -> SimpleNamespace:
    return SimpleNamespace(
        billing=SimpleNamespace(subscription=SimpleNamespace(plan=plan)),
        vector_space=SimpleNamespace(limit=vector_limit, size=vector_size),
    )


def _patch_features(monkeypatch: pytest.MonkeyPatch, features: SimpleNamespace) -> MagicMock:
    get_features = MagicMock(return_value=features)
    monkeypatch.setattr("tasks.document_indexing_task.FeatureService.get_features", get_features)
    return get_features


def _persist_indexing_rows(
    session: Session,
    *,
    tenant_id: str,
    dataset_id: str,
    document_ids: list[str],
    indexing_technique: IndexTechniqueType = IndexTechniqueType.HIGH_QUALITY,
    summary_index_setting: dict[str, bool] | None = None,
    document_forms: list[IndexStructureType] | None = None,
    need_summary: list[bool] | None = None,
) -> tuple[Dataset, list[Document]]:
    """Persist one tenant-owned dataset and the requested document rows."""
    created_by = str(uuid.uuid4())
    dataset = Dataset(
        id=dataset_id,
        tenant_id=tenant_id,
        name="Indexing dataset",
        data_source_type=DataSourceType.UPLOAD_FILE,
        indexing_technique=indexing_technique,
        embedding_model_provider="openai",
        embedding_model="text-embedding-3-small",
        summary_index_setting=summary_index_setting,
        created_by=created_by,
    )
    documents = [
        Document(
            id=document_id,
            tenant_id=tenant_id,
            dataset_id=dataset_id,
            position=position,
            data_source_type=DataSourceType.UPLOAD_FILE,
            batch="batch-1",
            name=f"document-{position}.txt",
            created_from=DocumentCreatedFrom.WEB,
            created_by=created_by,
            indexing_status=IndexingStatus.WAITING,
            doc_form=(document_forms or [IndexStructureType.PARAGRAPH_INDEX] * len(document_ids))[position - 1],
            need_summary=(need_summary or [False] * len(document_ids))[position - 1],
        )
        for position, document_id in enumerate(document_ids, start=1)
    ]
    session.add_all([dataset, *documents])
    session.commit()
    return dataset, documents


def _persisted_documents(session: Session, document_ids: list[str]) -> list[Document]:
    session.expire_all()
    return [document for document_id in document_ids if (document := session.get(Document, document_id)) is not None]


class TestDocumentIndexing:
    def test_duplicate_keeps_old_segments_until_replacement_is_ready(
        self,
        sqlite_session: Session,
        tenant_id: str,
        dataset_id: str,
        document_ids: list[str],
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        document_id = document_ids[0]
        _, documents = _persist_indexing_rows(
            sqlite_session,
            tenant_id=tenant_id,
            dataset_id=dataset_id,
            document_ids=[document_id],
        )
        document = documents[0]
        document.indexing_generation = str(uuid.uuid4())
        segment = DocumentSegment(
            tenant_id=tenant_id,
            dataset_id=dataset_id,
            document_id=document_id,
            position=1,
            content="![still referenced](/files/existing.png)",
            word_count=2,
            tokens=2,
            created_by=document.created_by,
            index_node_id="old-node",
        )
        sqlite_session.add(segment)
        sqlite_session.commit()
        observed_segment_ids: list[str] = []

        class Recorder:
            def run(self, refs: list[DocumentRef], **_kwargs: object) -> None:
                with Session(sqlite_session.get_bind()) as observer:
                    observed_document = observer.get(Document, refs[0].document_id)
                    assert observed_document is not None
                    assert observed_document.indexing_status == IndexingStatus.PARSING
                    if observer.get(DocumentSegment, segment.id) is not None:
                        observed_segment_ids.append(segment.id)

        monkeypatch.setattr("tasks.document_indexing_task.clean_deletion_index", lambda *_args, **_kwargs: None)
        monkeypatch.setattr(
            "tasks.document_indexing_task.build_document_indexing_service",
            lambda **_kwargs: Recorder(),
        )

        _duplicate_document_indexing_task(dataset_id, [document_id], {document_id: document.indexing_generation})

        assert observed_segment_ids == [segment.id]

    def test_retry_budget_exhausted_before_execution_fails_only_matching_generation(
        self,
        sqlite_session: Session,
        tenant_id: str,
        dataset_id: str,
        document_ids: list[str],
    ) -> None:
        _, documents = _persist_indexing_rows(
            sqlite_session,
            tenant_id=tenant_id,
            dataset_id=dataset_id,
            document_ids=document_ids[:2],
        )
        matching_generation = str(uuid.uuid4())
        stale_generation = str(uuid.uuid4())
        successor_generation = str(uuid.uuid4())
        documents[0].indexing_generation = matching_generation
        documents[1].indexing_generation = successor_generation
        intent = KnowledgeTaskOutbox(
            tenant_id=tenant_id,
            dataset_id=dataset_id,
            task_kind=KnowledgeTaskKind.DOCUMENT_INDEX_CREATE.value,
            payload={},
            status="dispatched",
            execution_attempts=10,
        )
        sqlite_session.add(intent)
        sqlite_session.commit()

        with pytest.raises(KnowledgeTaskRetriesExhaustedError):
            normal_document_indexing_task.run(
                tenant_id,
                dataset_id,
                document_ids[:2],
                {
                    document_ids[0]: matching_generation,
                    document_ids[1]: stale_generation,
                },
                intent.id,
            )

        sqlite_session.expire_all()
        matching = sqlite_session.get(Document, document_ids[0])
        successor = sqlite_session.get(Document, document_ids[1])
        persisted_intent = sqlite_session.get(KnowledgeTaskOutbox, intent.id)
        assert matching is not None
        assert matching.indexing_status == IndexingStatus.ERROR
        assert successor is not None
        assert successor.indexing_status == IndexingStatus.WAITING
        assert successor.indexing_generation == successor_generation
        assert persisted_intent is not None
        assert persisted_intent.status == "failed"

    def test_terminal_update_failure_keeps_tenant_receipt_retryable(
        self,
        sqlite_session: Session,
        tenant_id: str,
        dataset_id: str,
        document_ids: list[str],
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        document_id = document_ids[0]
        generation = str(uuid.uuid4())
        _, documents = _persist_indexing_rows(
            sqlite_session,
            tenant_id=tenant_id,
            dataset_id=dataset_id,
            document_ids=[document_id],
        )
        documents[0].indexing_generation = generation
        intent = KnowledgeTaskOutbox(
            tenant_id=tenant_id,
            dataset_id=dataset_id,
            task_kind=KnowledgeTaskKind.DOCUMENT_INDEX_CREATE.value,
            payload={},
            status="dispatched",
            execution_attempts=10,
        )
        sqlite_session.add(intent)
        sqlite_session.commit()
        receipt = "tenant-receipt"
        admission_events: list[tuple[str, str]] = []

        class AdmissionLease:
            def assert_owned(self) -> None:
                return

        @contextmanager
        def admission(_tenant_id: str, observed_receipt: str | None) -> Generator[AdmissionLease]:
            assert observed_receipt == receipt
            admission_events.append(("start", receipt))
            try:
                yield AdmissionLease()
            except KnowledgeTaskDeliveryHandledError:
                admission_events.append(("complete", receipt))
                raise
            except Exception:
                admission_events.append(("reset", receipt))
                raise

        terminal_update_attempts = 0

        def update_terminal_state(
            *,
            tenant_id: str,
            dataset_id: str,
            generations: dict[str, str] | None,
            error: KnowledgeTaskRetriesExhaustedError,
        ) -> None:
            nonlocal terminal_update_attempts
            terminal_update_attempts += 1
            if terminal_update_attempts == 1:
                raise RuntimeError("database unavailable")
            _mark_documents_retry_exhausted(
                tenant_id=tenant_id,
                dataset_id=dataset_id,
                generations=generations,
                error=error,
            )

        monkeypatch.setattr("tasks.document_indexing_task.knowledge_tenant_task_admission", admission)
        monkeypatch.setattr("tasks.document_indexing_task._mark_documents_retry_exhausted", update_terminal_state)

        with pytest.raises(RuntimeError, match="database unavailable"):
            normal_document_indexing_task.run(
                tenant_id,
                dataset_id,
                [document_id],
                {document_id: generation},
                intent.id,
                receipt,
            )

        sqlite_session.expire_all()
        after_failed_update = sqlite_session.get(Document, document_id)
        assert after_failed_update is not None
        assert after_failed_update.indexing_status == IndexingStatus.WAITING

        with pytest.raises(KnowledgeTaskRetriesExhaustedError):
            normal_document_indexing_task.run(
                tenant_id,
                dataset_id,
                [document_id],
                {document_id: generation},
                intent.id,
                receipt,
            )

        sqlite_session.expire_all()
        recovered = sqlite_session.get(Document, document_id)
        assert recovered is not None
        assert recovered.indexing_status == IndexingStatus.ERROR
        assert terminal_update_attempts == 2
        assert admission_events == [
            ("start", receipt),
            ("reset", receipt),
            ("start", receipt),
            ("complete", receipt),
        ]

    def test_tenth_duplicate_failure_marks_matching_generation_error(
        self,
        sqlite_session: Session,
        tenant_id: str,
        dataset_id: str,
        document_ids: list[str],
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        document_id = document_ids[0]
        generation = str(uuid.uuid4())
        _, documents = _persist_indexing_rows(
            sqlite_session,
            tenant_id=tenant_id,
            dataset_id=dataset_id,
            document_ids=[document_id],
        )
        documents[0].indexing_generation = generation
        intent = KnowledgeTaskOutbox(
            tenant_id=tenant_id,
            dataset_id=dataset_id,
            task_kind=KnowledgeTaskKind.DOCUMENT_INDEX_DUPLICATE.value,
            payload={},
            status="dispatched",
            execution_attempts=9,
        )
        sqlite_session.add(intent)
        sqlite_session.commit()

        def fail_indexing(*_args, **_kwargs) -> None:
            raise RuntimeError("provider unavailable")

        monkeypatch.setattr(
            "tasks.duplicate_document_indexing_task._duplicate_document_indexing_task_with_tenant_queue",
            fail_indexing,
        )

        with pytest.raises(KnowledgeTaskRetriesExhaustedError):
            normal_duplicate_document_indexing_task.run(
                tenant_id,
                dataset_id,
                [document_id],
                {document_id: generation},
                intent.id,
            )

        sqlite_session.expire_all()
        document = sqlite_session.get(Document, document_id)
        persisted_intent = sqlite_session.get(KnowledgeTaskOutbox, intent.id)
        assert document is not None
        assert document.indexing_status == IndexingStatus.ERROR
        assert document.error == "provider unavailable"
        assert persisted_intent is not None
        assert persisted_intent.status == "failed"
        assert persisted_intent.execution_attempts == 10

    @pytest.mark.parametrize("terminal_status", [IndexingStatus.COMPLETED, IndexingStatus.PAUSED])
    def test_same_generation_terminal_redelivery_preserves_segments(
        self,
        sqlite_session: Session,
        tenant_id: str,
        dataset_id: str,
        document_ids: list[str],
        monkeypatch: pytest.MonkeyPatch,
        terminal_status: IndexingStatus,
    ) -> None:
        document_id = document_ids[0]
        generation = str(uuid.uuid4())
        _, documents = _persist_indexing_rows(
            sqlite_session,
            tenant_id=tenant_id,
            dataset_id=dataset_id,
            document_ids=[document_id],
        )
        document = documents[0]
        document.indexing_generation = generation
        document.indexing_status = terminal_status
        segment = DocumentSegment(
            tenant_id=tenant_id,
            dataset_id=dataset_id,
            document_id=document_id,
            position=1,
            content="already indexed",
            word_count=2,
            tokens=2,
            created_by=document.created_by,
            index_node_id="stable-node",
        )
        sqlite_session.add(segment)
        intent = KnowledgeTaskOutbox(
            tenant_id=tenant_id,
            dataset_id=dataset_id,
            task_kind=KnowledgeTaskKind.DOCUMENT_INDEX_CREATE.value,
            payload={},
            status="dispatched",
        )
        sqlite_session.add(intent)
        sqlite_session.commit()
        calls: list[list[DocumentRef]] = []

        class Recorder:
            def run(self, refs: list[DocumentRef]) -> None:
                calls.append(refs)

        monkeypatch.setattr("tasks.document_indexing_task.build_document_indexing_service", lambda **_: Recorder())

        normal_document_indexing_task.run(
            tenant_id,
            dataset_id,
            [document_id],
            {document_id: generation},
            intent.id,
        )

        sqlite_session.expire_all()
        persisted = sqlite_session.get(Document, document_id)
        assert persisted is not None
        assert persisted.indexing_status == terminal_status
        assert sqlite_session.get(DocumentSegment, segment.id) is not None
        persisted_intent = sqlite_session.get(KnowledgeTaskOutbox, intent.id)
        assert persisted_intent is not None
        assert persisted_intent.status == "completed"
        assert calls == []

    def test_legacy_task_converts_to_durable_repair_without_running_provider(
        self,
        sqlite_session: Session,
        tenant_id: str,
        dataset_id: str,
        document_ids: list[str],
        indexing_runner: MagicMock,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        _persist_indexing_rows(
            sqlite_session,
            tenant_id=tenant_id,
            dataset_id=dataset_id,
            document_ids=document_ids,
        )
        _patch_features(monkeypatch, _features())

        def assert_committed_parsing(refs: list[DocumentRef], **_kwargs: object) -> None:
            with Session(sqlite_session.get_bind()) as observer:
                documents = [observer.get(Document, ref.document_id) for ref in refs]
                assert all(document.indexing_status == IndexingStatus.PARSING for document in documents)
                assert all(document.processing_started_at is not None for document in documents)

        indexing_runner.run.side_effect = assert_committed_parsing
        monkeypatch.setattr(
            "tasks.document_legacy_conversion.wake_knowledge_task_dispatcher_after_commit",
            lambda _session: None,
        )

        document_indexing_task.run(dataset_id, document_ids)

        persisted = _persisted_documents(sqlite_session, document_ids)
        assert [document.indexing_status for document in persisted] == [IndexingStatus.WAITING] * 3
        assert all(document.indexing_generation is not None for document in persisted)
        indexing_runner._constructor_mock.assert_not_called()
        intent = sqlite_session.scalar(
            select(KnowledgeTaskOutbox).where(
                KnowledgeTaskOutbox.task_kind == KnowledgeTaskKind.DOCUMENT_INDEX_RETRY.value
            )
        )
        assert intent is not None
        assert intent.payload["document_ids"] == sorted(document_ids)
        assert intent.payload["repair"] is True

    def test_only_existing_documents_are_processed(
        self,
        sqlite_session: Session,
        tenant_id: str,
        dataset_id: str,
        document_ids: list[str],
        indexing_runner: MagicMock,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        existing_ids = [document_ids[0], document_ids[2]]
        _persist_indexing_rows(
            sqlite_session,
            tenant_id=tenant_id,
            dataset_id=dataset_id,
            document_ids=existing_ids,
        )
        _patch_features(monkeypatch, _features())

        _document_indexing(dataset_id, document_ids)

        processed = [call.args[0][0] for call in indexing_runner.run.call_args_list]
        assert {ref.document_id for ref in processed} == set(existing_ids)
        assert sqlite_session.get(Document, document_ids[1]) is None

    def test_empty_batch_skips_runner(
        self,
        sqlite_session: Session,
        tenant_id: str,
        dataset_id: str,
        indexing_runner: MagicMock,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        _persist_indexing_rows(
            sqlite_session,
            tenant_id=tenant_id,
            dataset_id=dataset_id,
            document_ids=[],
        )
        _patch_features(monkeypatch, _features())

        _document_indexing(dataset_id, [])

        indexing_runner.run.assert_not_called()

    def test_missing_dataset_returns_before_feature_lookup(
        self, dataset_id: str, document_ids: list[str], monkeypatch: pytest.MonkeyPatch
    ) -> None:
        get_features = _patch_features(monkeypatch, _features())
        runner_class = MagicMock()
        monkeypatch.setattr("tasks.document_indexing_task.build_document_indexing_service", runner_class)

        _document_indexing(dataset_id, document_ids)

        get_features.assert_not_called()
        runner_class.assert_not_called()

    @config_overrides_context(DEPLOYMENT_EDITION=DeploymentEdition.CLOUD)
    @pytest.mark.parametrize(
        ("features", "batch_limit", "message"),
        [
            (_features(), 1, "batch upload limit"),
            (_features(plan=CloudPlan.SANDBOX), 100, "does not support batch upload"),
            (_features(vector_limit=100, vector_size=100), 100, "over the limit"),
        ],
    )
    def test_validation_failure_marks_every_scoped_document_error(
        self,
        sqlite_session: Session,
        tenant_id: str,
        dataset_id: str,
        document_ids: list[str],
        monkeypatch: pytest.MonkeyPatch,
        features: SimpleNamespace,
        batch_limit: int,
        message: str,
    ) -> None:
        _persist_indexing_rows(
            sqlite_session,
            tenant_id=tenant_id,
            dataset_id=dataset_id,
            document_ids=document_ids,
        )
        control_dataset_id = str(uuid.uuid4())
        control_document_id = str(uuid.uuid4())
        _persist_indexing_rows(
            sqlite_session,
            tenant_id=str(uuid.uuid4()),
            dataset_id=control_dataset_id,
            document_ids=[control_document_id],
        )
        _patch_features(monkeypatch, features)
        apply_config_overrides(monkeypatch, BATCH_UPLOAD_LIMIT=str(batch_limit))

        _document_indexing(dataset_id, document_ids)

        persisted = _persisted_documents(sqlite_session, document_ids)
        assert all(document.indexing_status == IndexingStatus.ERROR for document in persisted)
        assert all(document.error and message in document.error for document in persisted)
        assert all(document.stopped_at is not None for document in persisted)
        control = sqlite_session.get(Document, control_document_id)
        assert control is not None
        assert control.indexing_status == IndexingStatus.WAITING

    @pytest.mark.parametrize("error", [DocumentIsPausedError("paused"), RuntimeError("boom")])
    def test_runner_failure_stops_before_summary_dispatch(
        self,
        sqlite_session: Session,
        tenant_id: str,
        dataset_id: str,
        document_ids: list[str],
        indexing_runner: MagicMock,
        monkeypatch: pytest.MonkeyPatch,
        error: Exception,
    ) -> None:
        _persist_indexing_rows(
            sqlite_session,
            tenant_id=tenant_id,
            dataset_id=dataset_id,
            document_ids=document_ids,
            summary_index_setting={"enable": True},
            need_summary=[True] * len(document_ids),
        )
        _patch_features(monkeypatch, _features())
        indexing_runner.run.side_effect = error

        _document_indexing(dataset_id, document_ids)

        assert (
            sqlite_session.scalar(
                select(KnowledgeTaskOutbox.id).where(KnowledgeTaskOutbox.task_kind == "document_summary_index")
            )
            is None
        )
        persisted = _persisted_documents(sqlite_session, document_ids)
        assert all(document.indexing_status == IndexingStatus.PARSING for document in persisted)


class TestSummaryDispatch:
    def test_only_eligible_completed_documents_queue_summaries(
        self,
        sqlite_session: Session,
        tenant_id: str,
        dataset_id: str,
        document_ids: list[str],
        indexing_runner: MagicMock,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        _persist_indexing_rows(
            sqlite_session,
            tenant_id=tenant_id,
            dataset_id=dataset_id,
            document_ids=document_ids,
            summary_index_setting={"enable": True},
            document_forms=[
                IndexStructureType.PARAGRAPH_INDEX,
                IndexStructureType.QA_INDEX,
                IndexStructureType.PARAGRAPH_INDEX,
            ],
            need_summary=[True, True, True],
        )
        _patch_features(monkeypatch, _features())

        statuses = {
            document_ids[0]: IndexingStatus.COMPLETED,
            document_ids[1]: IndexingStatus.COMPLETED,
            document_ids[2]: IndexingStatus.INDEXING,
        }

        def finish_documents(refs: list[DocumentRef], **_kwargs: object) -> None:
            with Session(sqlite_session.get_bind()) as writer, writer.begin():
                ref = refs[0]
                writer.get(Document, ref.document_id).indexing_status = statuses[ref.document_id]

        indexing_runner.run.side_effect = finish_documents

        _document_indexing(dataset_id, document_ids)

        intents = sqlite_session.scalars(
            select(KnowledgeTaskOutbox).where(KnowledgeTaskOutbox.task_kind == "document_summary_index")
        ).all()
        assert len(intents) == 1
        assert intents[0].document_id == document_ids[0]
        assert intents[0].payload["expected_generation"] is None

    def test_economy_indexing_skips_summary_generation(
        self,
        sqlite_session: Session,
        tenant_id: str,
        dataset_id: str,
        indexing_runner: MagicMock,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        document_id = str(uuid.uuid4())
        _persist_indexing_rows(
            sqlite_session,
            tenant_id=tenant_id,
            dataset_id=dataset_id,
            document_ids=[document_id],
            indexing_technique=IndexTechniqueType.ECONOMY,
            summary_index_setting={"enable": True},
            need_summary=[True],
        )
        _patch_features(monkeypatch, _features())

        def complete_documents(refs: list[DocumentRef]) -> None:
            with Session(sqlite_session.get_bind()) as writer, writer.begin():
                writer.get(Document, refs[0].document_id).indexing_status = IndexingStatus.COMPLETED

        indexing_runner.run.side_effect = complete_documents

        _document_indexing(dataset_id, [document_id])

        assert (
            sqlite_session.scalar(
                select(KnowledgeTaskOutbox.id).where(KnowledgeTaskOutbox.task_kind == "document_summary_index")
            )
            is None
        )

    def test_dataset_removed_by_runner_is_absent_from_summary_phase(
        self,
        sqlite_session: Session,
        tenant_id: str,
        dataset_id: str,
        indexing_runner: MagicMock,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        document_id = str(uuid.uuid4())
        _persist_indexing_rows(
            sqlite_session,
            tenant_id=tenant_id,
            dataset_id=dataset_id,
            document_ids=[document_id],
            summary_index_setting={"enable": True},
            need_summary=[True],
        )
        _patch_features(monkeypatch, _features())

        def remove_dataset(_refs: list[DocumentRef], **_kwargs: object) -> None:
            with Session(sqlite_session.get_bind()) as writer, writer.begin():
                dataset = writer.get(Dataset, dataset_id)
                assert dataset is not None
                writer.delete(dataset)

        indexing_runner.run.side_effect = remove_dataset

        _document_indexing(dataset_id, [document_id])

        sqlite_session.expire_all()
        assert sqlite_session.get(Dataset, dataset_id) is None
        assert (
            sqlite_session.scalar(
                select(KnowledgeTaskOutbox.id).where(KnowledgeTaskOutbox.task_kind == "document_summary_index")
            )
            is None
        )


class TestTenantQueue:
    def test_followup_tasks_are_dispatched_with_one_shared_producer(
        self, tenant_id: str, dataset_id: str, document_ids: list[str], monkeypatch: pytest.MonkeyPatch
    ) -> None:
        next_documents = [str(uuid.uuid4())]
        queue = MagicMock()
        queue.pull_tasks.return_value = [
            {"tenant_id": tenant_id, "dataset_id": dataset_id, "document_ids": next_documents}
        ]
        monkeypatch.setattr("tasks.document_indexing_task.TenantIsolatedTaskQueue", MagicMock(return_value=queue))
        monkeypatch.setattr("tasks.document_indexing_task._document_indexing", MagicMock())
        producer = object()
        monkeypatch.setattr(
            "tasks.document_indexing_task.current_app.producer_or_acquire",
            MagicMock(return_value=nullcontext(producer)),
        )
        task = MagicMock()

        _document_indexing_with_tenant_queue(tenant_id, dataset_id, document_ids, task)

        task.apply_async.assert_called_once_with(
            kwargs={"tenant_id": tenant_id, "dataset_id": dataset_id, "document_ids": next_documents},
            producer=producer,
        )
        queue.set_task_waiting_time.assert_called_once()
        queue.delete_task_key.assert_not_called()

    def test_legacy_queue_is_not_advanced_when_conversion_fails(
        self, tenant_id: str, dataset_id: str, document_ids: list[str], monkeypatch: pytest.MonkeyPatch
    ) -> None:
        queue = MagicMock()
        queue.pull_tasks.return_value = []
        monkeypatch.setattr("tasks.document_indexing_task.TenantIsolatedTaskQueue", MagicMock(return_value=queue))

        def conversion(_dataset_id: str, _document_ids: list[str]) -> None:
            raise RuntimeError("database unavailable")

        monkeypatch.setattr("tasks.document_indexing_task.convert_legacy_document_indexing_delivery", conversion)

        with pytest.raises(RuntimeError, match="database unavailable"):
            _document_indexing_with_tenant_queue(tenant_id, dataset_id, document_ids, MagicMock())

        queue.delete_task_key.assert_not_called()

    @pytest.mark.parametrize("task", [normal_document_indexing_task, priority_document_indexing_task])
    def test_celery_entrypoints_delegate_to_tenant_queue(
        self,
        task: object,
        tenant_id: str,
        dataset_id: str,
        document_ids: list[str],
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        delegate = MagicMock()
        monkeypatch.setattr("tasks.document_indexing_task._document_indexing_with_tenant_queue", delegate)

        task.run(tenant_id, dataset_id, document_ids)  # type: ignore[attr-defined]

        delegate.assert_called_once()


def test_generation_change_after_index_write_enqueues_current_repair(
    sqlite_session: Session,
    tenant_id: str,
    dataset_id: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    document_id = str(uuid.uuid4())
    _, documents = _persist_indexing_rows(
        sqlite_session,
        tenant_id=tenant_id,
        dataset_id=dataset_id,
        document_ids=[document_id],
    )
    documents[0].indexing_generation = str(uuid.uuid4())
    sqlite_session.commit()
    successor_generation = str(uuid.uuid4())

    class GenerationChangingIndexer:
        def run(self, refs: list[DocumentRef], **_kwargs: object) -> None:
            with Session(sqlite_session.get_bind()) as writer, writer.begin():
                document = writer.get(Document, refs[0].document_id)
                assert document is not None
                document.indexing_generation = successor_generation
                document.indexing_status = IndexingStatus.COMPLETED

    monkeypatch.setattr(
        "tasks.document_indexing_task.build_document_indexing_service",
        lambda **_kwargs: GenerationChangingIndexer(),
    )

    _document_indexing(dataset_id, [document_id])

    sqlite_session.expire_all()
    repair = sqlite_session.scalar(
        select(KnowledgeTaskOutbox).where(KnowledgeTaskOutbox.task_kind == KnowledgeTaskKind.DOCUMENT_INDEX_STATE.value)
    )
    assert repair is not None
    repair_generation = repair.payload.get("generation")
    assert isinstance(repair_generation, str)
    assert repair_generation != successor_generation
    assert repair.payload == {
        "document_id": document_id,
        "generation": repair_generation,
        "action": "add",
    }
    persisted = sqlite_session.get(Document, document_id)
    assert persisted is not None
    assert persisted.indexing_generation == repair_generation
