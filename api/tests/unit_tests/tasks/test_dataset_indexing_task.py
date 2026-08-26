"""SQLite-backed tests for document indexing tasks.

The indexing task deliberately uses separate transactions for validation,
status persistence, indexing, and summary dispatch. These tests persist real
ORM rows so each phase observes only committed database state.
"""

import uuid
from contextlib import nullcontext
from types import SimpleNamespace
from unittest.mock import MagicMock, Mock, patch

import pytest
from sqlalchemy.orm import Session

from core.indexing_runner import DocumentIsPausedError
from core.rag.index_processor.constant.index_type import IndexStructureType, IndexTechniqueType
from enums import CloudPlan
from extensions.ext_redis import redis_client
from models.dataset import Dataset, Document
from models.enums import DataSourceType, DocumentCreatedFrom, IndexingStatus
from services.document_indexing_proxy.document_indexing_task_proxy import DocumentIndexingTaskProxy
from tasks.document_indexing_task import (
    _document_indexing,
    _document_indexing_with_tenant_queue,
    document_indexing_task,
    normal_document_indexing_task,
    priority_document_indexing_task,
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
    monkeypatch.setattr("tasks.document_indexing_task.IndexingRunner", runner_class)
    runner._constructor_mock = runner_class
    return runner


def _features(
    *,
    billing_enabled: bool = False,
    plan: CloudPlan = CloudPlan.PROFESSIONAL,
    vector_limit: int = 1000,
    vector_size: int = 0,
) -> SimpleNamespace:
    return SimpleNamespace(
        billing=SimpleNamespace(enabled=billing_enabled, subscription=SimpleNamespace(plan=plan)),
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


class TestTaskEnqueuing:
    def test_self_hosted_dispatches_directly_to_priority_task(
        self, tenant_id: str, dataset_id: str, document_ids: list[str], mock_redis: MagicMock
    ) -> None:
        with (
            patch.object(DocumentIndexingTaskProxy, "features") as features,
            patch.object(DocumentIndexingTaskProxy, "PRIORITY_TASK_FUNC", Mock()) as task,
        ):
            features.billing.enabled = False
            DocumentIndexingTaskProxy(tenant_id, dataset_id, document_ids).delay()

        task.delay.assert_called_once_with(
            tenant_id=tenant_id,
            dataset_id=dataset_id,
            document_ids=document_ids,
        )

    @pytest.mark.parametrize(
        ("plan", "task_attribute"),
        [
            (CloudPlan.SANDBOX, "NORMAL_TASK_FUNC"),
            (CloudPlan.PROFESSIONAL, "PRIORITY_TASK_FUNC"),
        ],
    )
    def test_cloud_dispatches_first_task_through_tenant_queue(
        self,
        tenant_id: str,
        dataset_id: str,
        document_ids: list[str],
        mock_redis: MagicMock,
        plan: CloudPlan,
        task_attribute: str,
    ) -> None:
        with (
            patch.object(DocumentIndexingTaskProxy, "features") as features,
            patch.object(DocumentIndexingTaskProxy, task_attribute, Mock()) as task,
        ):
            features.billing.enabled = True
            features.billing.subscription.plan = plan
            DocumentIndexingTaskProxy(tenant_id, dataset_id, document_ids).delay()

        mock_redis.setex.assert_called()
        task.delay.assert_called_once()

    def test_running_tenant_task_queues_followup_work(
        self, tenant_id: str, dataset_id: str, document_ids: list[str], mock_redis: MagicMock
    ) -> None:
        mock_redis.get.return_value = b"1"
        with (
            patch.object(DocumentIndexingTaskProxy, "features") as features,
            patch.object(DocumentIndexingTaskProxy, "PRIORITY_TASK_FUNC", Mock()) as task,
        ):
            features.billing.enabled = True
            features.billing.subscription.plan = CloudPlan.PROFESSIONAL
            DocumentIndexingTaskProxy(tenant_id, dataset_id, document_ids).delay()

        mock_redis.lpush.assert_called_once()
        task.delay.assert_not_called()


class TestDocumentIndexing:
    def test_legacy_task_persists_parsing_before_running(
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

        def assert_committed_parsing(documents: list[Document], session: Session) -> None:
            assert all(document.indexing_status == IndexingStatus.PARSING for document in documents)
            assert all(document.processing_started_at is not None for document in documents)
            assert all(session.get(Document, document.id) is document for document in documents)

        indexing_runner.run.side_effect = assert_committed_parsing
        document_indexing_task.run(dataset_id, document_ids)

        persisted = _persisted_documents(sqlite_session, document_ids)
        assert [document.indexing_status for document in persisted] == [IndexingStatus.PARSING] * 3
        indexing_runner._constructor_mock.assert_called_once_with(enforce_vector_space_admission=True)
        indexing_runner.run.assert_called_once()
        assert isinstance(indexing_runner.run.call_args.args[1], Session)

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

        processed = indexing_runner.run.call_args.args[0]
        assert {document.id for document in processed} == set(existing_ids)
        assert sqlite_session.get(Document, document_ids[1]) is None

    def test_empty_batch_still_reaches_runner(
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

        assert indexing_runner.run.call_args.args[0] == []
        assert isinstance(indexing_runner.run.call_args.args[1], Session)

    def test_missing_dataset_returns_before_feature_lookup(
        self, dataset_id: str, document_ids: list[str], monkeypatch: pytest.MonkeyPatch
    ) -> None:
        get_features = _patch_features(monkeypatch, _features())
        runner_class = MagicMock()
        monkeypatch.setattr("tasks.document_indexing_task.IndexingRunner", runner_class)

        _document_indexing(dataset_id, document_ids)

        get_features.assert_not_called()
        runner_class.assert_not_called()

    @pytest.mark.parametrize(
        ("features", "batch_limit", "message"),
        [
            (_features(billing_enabled=True), 1, "batch upload limit"),
            (_features(billing_enabled=True, plan=CloudPlan.SANDBOX), 100, "does not support batch upload"),
            (_features(billing_enabled=True, vector_limit=100, vector_size=100), 100, "over the limit"),
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
        monkeypatch.setattr("tasks.document_indexing_task.dify_config.BATCH_UPLOAD_LIMIT", str(batch_limit))

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
        summary_delay = MagicMock()
        monkeypatch.setattr("tasks.document_indexing_task.generate_summary_index_task.delay", summary_delay)

        _document_indexing(dataset_id, document_ids)

        summary_delay.assert_not_called()
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

        def finish_documents(documents: list[Document], _session: Session) -> None:
            documents[0].indexing_status = IndexingStatus.COMPLETED
            documents[1].indexing_status = IndexingStatus.COMPLETED
            documents[2].indexing_status = IndexingStatus.INDEXING

        indexing_runner.run.side_effect = finish_documents
        summary_delay = MagicMock()
        monkeypatch.setattr("tasks.document_indexing_task.generate_summary_index_task.delay", summary_delay)

        _document_indexing(dataset_id, document_ids)

        summary_delay.assert_called_once_with(dataset_id, document_ids[0], None)

    def test_summary_queue_failure_does_not_fail_indexing(
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
        indexing_runner.run.side_effect = lambda documents, _session: setattr(
            documents[0], "indexing_status", IndexingStatus.COMPLETED
        )
        summary_delay = MagicMock(side_effect=RuntimeError("queue unavailable"))
        monkeypatch.setattr("tasks.document_indexing_task.generate_summary_index_task.delay", summary_delay)

        _document_indexing(dataset_id, [document_id])

        summary_delay.assert_called_once_with(dataset_id, document_id, None)
        persisted = _persisted_documents(sqlite_session, [document_id])[0]
        assert persisted.indexing_status == IndexingStatus.COMPLETED

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
        indexing_runner.run.side_effect = lambda documents, _session: setattr(
            documents[0], "indexing_status", IndexingStatus.COMPLETED
        )
        summary_delay = MagicMock()
        monkeypatch.setattr("tasks.document_indexing_task.generate_summary_index_task.delay", summary_delay)

        _document_indexing(dataset_id, [document_id])

        summary_delay.assert_not_called()

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

        def remove_dataset(_documents: list[Document], session: Session) -> None:
            dataset = session.get(Dataset, dataset_id)
            assert dataset is not None
            session.delete(dataset)

        indexing_runner.run.side_effect = remove_dataset
        summary_delay = MagicMock()
        monkeypatch.setattr("tasks.document_indexing_task.generate_summary_index_task.delay", summary_delay)

        _document_indexing(dataset_id, [document_id])

        sqlite_session.expire_all()
        assert sqlite_session.get(Dataset, dataset_id) is None
        summary_delay.assert_not_called()


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

    def test_queue_cleanup_runs_when_indexing_fails(
        self, tenant_id: str, dataset_id: str, document_ids: list[str], monkeypatch: pytest.MonkeyPatch
    ) -> None:
        queue = MagicMock()
        queue.pull_tasks.return_value = []
        monkeypatch.setattr("tasks.document_indexing_task.TenantIsolatedTaskQueue", MagicMock(return_value=queue))
        indexing = MagicMock(side_effect=RuntimeError("indexing failed"))
        monkeypatch.setattr("tasks.document_indexing_task._document_indexing", indexing)

        _document_indexing_with_tenant_queue(tenant_id, dataset_id, document_ids, MagicMock())

        queue.delete_task_key.assert_called_once()

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
