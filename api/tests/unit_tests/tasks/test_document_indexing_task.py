from collections.abc import Callable, Sequence
from contextlib import AbstractContextManager, nullcontext
from dataclasses import dataclass
from types import TracebackType
from unittest.mock import MagicMock, patch
from uuid import uuid4

import pytest
from redis.exceptions import RedisError
from sqlalchemy.orm import Session, sessionmaker

import tasks.document_indexing_task as task_module
import tasks.recover_document_indexing_task as recovery_module
import tasks.retry_document_indexing_task as retry_module
import tasks.sync_website_document_indexing_task as website_module
from core.rag.index_processor.constant.index_type import IndexStructureType, IndexTechniqueType
from enums import DeploymentEdition
from models.dataset import Dataset, Document
from models.enums import DataSourceType, DocumentCreatedFrom, IndexingStatus
from services.knowledge.entities.resource_scope import DatasetRef, DocumentRef
from services.knowledge.indexing.errors import DocumentIsPausedError
from services.knowledge.indexing.locks import KnowledgeIndexingLeaseLostError, KnowledgeIndexingLockBusyError
from tasks.document_indexing_task import (
    _document_indexing,
    _document_indexing_with_tenant_queue,
    document_indexing_task,
    normal_document_indexing_task,
    priority_document_indexing_task,
)
from tests.helpers.unit.config_override import apply_config_overrides, config_overrides_context
from tests.helpers.unit.model_factories import make_dataset, make_document


@pytest.mark.parametrize("kind", ["retry", "website"])
def test_redis_claim_failure_retries_before_starting_execution(
    sqlite_session_factory: sessionmaker[Session], kind: str
) -> None:
    with sqlite_session_factory.begin() as session:
        session.add(make_dataset(indexing_technique="economy"))
        session.add(make_document(data_source_type=DataSourceType.WEBSITE_CRAWL))

    def complete(*_args: object, **_kwargs: object) -> None:
        with sqlite_session_factory.begin() as session:
            document = session.get_one(Document, "document-1")
            assert document.indexing_status == IndexingStatus.WAITING
            document.indexing_status = IndexingStatus.COMPLETED

    if kind == "retry":
        with (
            patch.object(retry_module, "_claim_retry_leases") as claim,
            patch.object(retry_module, "_run_retry_document_indexing", side_effect=complete) as execute,
        ):
            claim.side_effect = [RedisError("unavailable"), nullcontext({"document-1": object()})]
            result = retry_module.retry_document_indexing_task.apply(
                args=("dataset-1", ["document-1"], "account-1"), throw=False
            )
    else:
        with (
            patch.object(website_module, "_hold_website_sync_lease") as claim,
            patch.object(website_module, "_hold_document_indexing_lease", return_value=nullcontext(object())),
            patch.object(website_module, "_run_website_document_sync", side_effect=complete) as execute,
        ):
            claim.side_effect = [RedisError("unavailable"), nullcontext(object())]
            result = website_module.sync_website_document_indexing_task.apply(
                args=("dataset-1", "document-1"), throw=False
            )

    assert result.state == "SUCCESS"
    assert claim.call_count == 2
    execute.assert_called_once()


@config_overrides_context(DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY)
@pytest.mark.parametrize("entrypoint", ["legacy", "normal", "priority"])
@pytest.mark.parametrize("failure", [KnowledgeIndexingLeaseLostError, KnowledgeIndexingLockBusyError, RedisError])
def test_batch_retries_only_unfinished_documents_at_their_persisted_phase(
    sqlite_session_factory: sessionmaker[Session], entrypoint: str, failure: type[Exception]
) -> None:
    document_ids = ["one", "two", "three", "already-completed"]
    with sqlite_session_factory.begin() as session:
        session.add(make_dataset(indexing_technique="economy"))
        for document_id in document_ids:
            document = make_document(document_id=document_id)
            document.indexing_status = (
                IndexingStatus.COMPLETED if document_id == "already-completed" else IndexingStatus.WAITING
            )
            session.add(document)

    def complete(ref: DocumentRef) -> None:
        with sqlite_session_factory.begin() as session:
            session.get_one(Document, ref.document_id).indexing_status = IndexingStatus.COMPLETED

    attempted: list[str] = []

    def index(refs: Sequence[DocumentRef]) -> None:
        for ref in refs:
            attempted.append(ref.document_id)
            if ref.document_id == "two":
                with sqlite_session_factory.begin() as session:
                    session.get_one(Document, ref.document_id).indexing_status = IndexingStatus.INDEXING
                raise failure("temporary indexing interruption")
            complete(ref)

    with (
        patch.object(task_module, "build_document_indexing_service", autospec=True) as builder,
        patch.object(task_module, "TenantIsolatedTaskQueue", autospec=True) as queue,
    ):
        builder.return_value.run.side_effect = index
        builder.return_value.run_in_indexing_status.side_effect = complete
        waiting_tasks: list[dict[str, object]] = []
        queue.return_value.pull_tasks.return_value = waiting_tasks
        if entrypoint == "legacy":
            result = task_module.document_indexing_task.apply(args=("dataset-1", document_ids), throw=False)
        else:
            task = (
                task_module.normal_document_indexing_task
                if entrypoint == "normal"
                else task_module.priority_document_indexing_task
            )
            result = task.apply(args=("tenant-1", "dataset-1", document_ids), throw=False)

    assert result.state == "SUCCESS"
    assert attempted == ["one", "two", "three"]
    resumed_ref = builder.return_value.run_in_indexing_status.call_args.args[0]
    assert resumed_ref.document_id == "two"
    builder.return_value.run_in_indexing_status.assert_called_once()
    if entrypoint == "legacy":
        queue.assert_not_called()
    else:
        queue.assert_called_once()
        queue.return_value.pull_tasks.assert_called_once()
    with sqlite_session_factory() as session:
        for document_id in document_ids:
            document = session.get_one(Document, document_id)
            assert document.indexing_status == IndexingStatus.COMPLETED
        assert session.get_one(Document, "already-completed").processing_started_at is None


def test_replay_after_completion_still_dispatches_requested_summaries(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    with sqlite_session_factory.begin() as session:
        dataset = make_dataset(indexing_technique="high_quality")
        dataset.summary_index_setting = {"enable": True}
        document = make_document(doc_form="text_model")
        document.indexing_status = IndexingStatus.COMPLETED
        document.need_summary = True
        session.add_all([dataset, document])

    with (
        patch.object(task_module, "build_document_indexing_service", autospec=True) as builder,
        patch.object(task_module.generate_summary_index_task, "delay") as dispatch,
    ):
        task_module.document_indexing_task.run("dataset-1", ["document-1"])

    builder.assert_not_called()
    dispatch.assert_called_once_with("dataset-1", "document-1", None)


@pytest.mark.parametrize(
    ("status", "runner"),
    [
        (IndexingStatus.WAITING, "run"),
        (IndexingStatus.PARSING, "run"),
        (IndexingStatus.CLEANING, "run"),
        (IndexingStatus.SPLITTING, "run_in_splitting_status"),
        (IndexingStatus.INDEXING, "run_in_indexing_status"),
    ],
)
def test_recovery_retries_lease_loss_without_discarding_its_phase(
    sqlite_session_factory: sessionmaker[Session], status: IndexingStatus, runner: str
) -> None:
    with sqlite_session_factory.begin() as session:
        session.add(make_dataset(indexing_technique="economy"))
        document = make_document()
        document.indexing_status = status
        session.add(document)

    attempts = 0

    def recover(*_args: object) -> None:
        nonlocal attempts
        attempts += 1
        with sqlite_session_factory.begin() as session:
            document = session.get_one(Document, "document-1")
            assert document.indexing_status == status
            if attempts == 2:
                document.indexing_status = IndexingStatus.COMPLETED
        if attempts == 1:
            raise KnowledgeIndexingLeaseLostError("temporary lease loss")

    with patch.object(recovery_module, "build_document_indexing_service", autospec=True) as builder:
        if runner == "run":
            resumed = builder.return_value.run
        elif runner == "run_in_indexing_status":
            resumed = builder.return_value.run_in_indexing_status
        else:
            resumed = builder.return_value.run_in_splitting_status
        resumed.side_effect = recover
        result = recovery_module.recover_document_indexing_task.apply(args=("dataset-1", "document-1"), throw=False)

    assert result.state == "SUCCESS"
    assert attempts == 2
    with sqlite_session_factory() as session:
        assert session.get_one(Document, "document-1").indexing_status == IndexingStatus.COMPLETED


@dataclass
class _ProducerContext(AbstractContextManager[object]):
    producer: object

    def __enter__(self) -> object:
        return self.producer

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc_value: BaseException | None,
        traceback: TracebackType | None,
    ) -> None:
        return None


@dataclass
class _CeleryAppStub:
    producer: object

    def producer_or_acquire(self) -> _ProducerContext:
        return _ProducerContext(self.producer)


@dataclass
class _DocumentIndexingRunner:
    execute: Callable[[list[DocumentRef]], None]

    def run(self, refs: list[DocumentRef]) -> None:
        self.execute(refs)


@pytest.fixture
def tenant_id() -> str:
    return str(uuid4())


@pytest.fixture
def dataset_id() -> str:
    return str(uuid4())


@pytest.fixture
def document_ids() -> list[str]:
    return [str(uuid4()), str(uuid4())]


def _persist_rows(
    session: Session,
    *,
    tenant_id: str,
    dataset_id: str,
    document_ids: list[str],
    summary_enabled: bool = False,
    need_summary: bool = False,
) -> None:
    creator_id = str(uuid4())
    session.add(
        Dataset(
            id=dataset_id,
            tenant_id=tenant_id,
            name="Indexing dataset",
            data_source_type=DataSourceType.UPLOAD_FILE,
            indexing_technique=IndexTechniqueType.HIGH_QUALITY,
            embedding_model_provider="openai",
            embedding_model="text-embedding-3-small",
            summary_index_setting={"enable": True} if summary_enabled else None,
            created_by=creator_id,
        )
    )
    session.add_all(
        Document(
            id=document_id,
            tenant_id=tenant_id,
            dataset_id=dataset_id,
            position=position,
            data_source_type=DataSourceType.UPLOAD_FILE,
            batch="batch-1",
            name=f"document-{position}.txt",
            created_from=DocumentCreatedFrom.WEB,
            created_by=creator_id,
            indexing_status=IndexingStatus.WAITING,
            doc_form=IndexStructureType.PARAGRAPH_INDEX,
            need_summary=need_summary,
        )
        for position, document_id in enumerate(document_ids, start=1)
    )
    session.commit()


def test_legacy_entrypoint_executes_current_core(
    monkeypatch: pytest.MonkeyPatch,
    dataset_id: str,
    document_ids: list[str],
) -> None:
    execute = MagicMock()
    monkeypatch.setattr("tasks.document_indexing_task._document_indexing", execute)

    document_indexing_task.run(dataset_id, document_ids)

    execute.assert_called_once_with(dataset_id, document_ids)


def test_queue_wrapper_runs_current_work_and_dispatches_waiting_work(
    monkeypatch: pytest.MonkeyPatch,
    tenant_id: str,
    dataset_id: str,
    document_ids: list[str],
) -> None:
    execute = MagicMock()
    task = MagicMock()
    next_document_ids = [str(uuid4())]
    queue = MagicMock()
    queue.pull_tasks.return_value = [
        {
            "tenant_id": tenant_id,
            "dataset_id": dataset_id,
            "document_ids": next_document_ids,
        }
    ]
    queue_factory = MagicMock(return_value=queue)
    producer = object()
    monkeypatch.setattr("tasks.document_indexing_task._document_indexing", execute)
    monkeypatch.setattr("tasks.document_indexing_task.TenantIsolatedTaskQueue", queue_factory)
    monkeypatch.setattr(
        "tasks.document_indexing_task.current_app",
        _CeleryAppStub(producer),
    )

    _document_indexing_with_tenant_queue(
        tenant_id,
        dataset_id,
        document_ids,
        task,
    )

    execute.assert_called_once_with(dataset_id, document_ids)
    queue_factory.assert_called_once_with(tenant_id, "document_indexing")
    queue.pull_tasks.assert_called_once()
    queue.set_task_waiting_time.assert_called_once_with()
    task.apply_async.assert_called_once_with(
        kwargs={
            "tenant_id": tenant_id,
            "dataset_id": dataset_id,
            "document_ids": next_document_ids,
        },
        producer=producer,
    )


@pytest.mark.parametrize("task", [normal_document_indexing_task, priority_document_indexing_task])
def test_celery_entrypoints_use_established_three_argument_message(
    monkeypatch: pytest.MonkeyPatch,
    tenant_id: str,
    dataset_id: str,
    document_ids: list[str],
    task: object,
) -> None:
    delegate = MagicMock()
    monkeypatch.setattr("tasks.document_indexing_task._document_indexing_with_tenant_queue", delegate)

    task.run(tenant_id, dataset_id, document_ids)  # type: ignore[attr-defined]

    delegate.assert_called_once_with(
        tenant_id,
        dataset_id,
        document_ids,
        task,
    )


def test_missing_dataset_returns_before_feature_or_runner_lookup(
    monkeypatch: pytest.MonkeyPatch,
    dataset_id: str,
    document_ids: list[str],
) -> None:
    features = MagicMock()
    runner = MagicMock()
    monkeypatch.setattr("tasks.document_indexing_task.FeatureService.get_features", features)
    monkeypatch.setattr("tasks.document_indexing_task.build_document_indexing_service", runner)

    _document_indexing(dataset_id, document_ids)

    features.assert_not_called()
    runner.assert_not_called()


def test_only_existing_dataset_documents_are_passed_as_owner_scoped_refs(
    sqlite_session: Session,
    monkeypatch: pytest.MonkeyPatch,
    tenant_id: str,
    dataset_id: str,
    document_ids: list[str],
) -> None:
    _persist_rows(
        sqlite_session,
        tenant_id=tenant_id,
        dataset_id=dataset_id,
        document_ids=document_ids[:1],
    )
    apply_config_overrides(monkeypatch, DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY)
    runner = MagicMock()
    monkeypatch.setattr(
        "tasks.document_indexing_task.build_document_indexing_service",
        MagicMock(return_value=runner),
    )

    _document_indexing(dataset_id, document_ids)

    runner.run.assert_called_once()
    assert runner.run.call_args.args == ([DocumentRef(DatasetRef(tenant_id, dataset_id), document_ids[0])],)
    sqlite_session.expire_all()
    document = sqlite_session.get(Document, document_ids[0])
    assert document is not None
    assert document.indexing_status == IndexingStatus.PARSING
    assert document.processing_started_at is not None


@pytest.mark.parametrize("error", [DocumentIsPausedError("paused"), RuntimeError("failed")])
def test_runner_failure_does_not_publish_summaries(
    sqlite_session: Session,
    monkeypatch: pytest.MonkeyPatch,
    tenant_id: str,
    dataset_id: str,
    document_ids: list[str],
    error: Exception,
) -> None:
    _persist_rows(
        sqlite_session,
        tenant_id=tenant_id,
        dataset_id=dataset_id,
        document_ids=document_ids[:1],
        summary_enabled=True,
        need_summary=True,
    )
    apply_config_overrides(monkeypatch, DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY)
    runner = MagicMock()
    runner.run.side_effect = error
    monkeypatch.setattr("tasks.document_indexing_task.build_document_indexing_service", lambda **_kwargs: runner)
    summary = MagicMock()
    monkeypatch.setattr("tasks.document_indexing_task.generate_summary_index_task.delay", summary)

    _document_indexing(dataset_id, document_ids[:1])

    summary.assert_not_called()


def test_completed_eligible_document_publishes_summary(
    sqlite_session: Session,
    monkeypatch: pytest.MonkeyPatch,
    tenant_id: str,
    dataset_id: str,
    document_ids: list[str],
) -> None:
    document_id = document_ids[0]
    _persist_rows(
        sqlite_session,
        tenant_id=tenant_id,
        dataset_id=dataset_id,
        document_ids=[document_id],
        summary_enabled=True,
        need_summary=True,
    )
    apply_config_overrides(monkeypatch, DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY)

    def complete(refs: list[DocumentRef]) -> None:
        with Session(sqlite_session.get_bind()) as writer, writer.begin():
            document = writer.get(Document, refs[0].document_id)
            assert document is not None
            document.indexing_status = IndexingStatus.COMPLETED

    runner = _DocumentIndexingRunner(complete)
    monkeypatch.setattr("tasks.document_indexing_task.build_document_indexing_service", lambda **_kwargs: runner)
    summary = MagicMock()
    monkeypatch.setattr("tasks.document_indexing_task.generate_summary_index_task.delay", summary)

    _document_indexing(dataset_id, [document_id])

    summary.assert_called_once_with(dataset_id, document_id, None)
