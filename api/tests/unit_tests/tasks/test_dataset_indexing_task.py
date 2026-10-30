"""Document-indexing task tests for the current queue and execution contracts."""

from __future__ import annotations

from collections.abc import Callable
from contextlib import AbstractContextManager
from dataclasses import dataclass
from types import TracebackType
from unittest.mock import MagicMock
from uuid import uuid4

import pytest
from sqlalchemy.orm import Session

from core.rag.index_processor.constant.index_type import IndexStructureType, IndexTechniqueType
from enums import DeploymentEdition
from models.dataset import Dataset, Document
from models.enums import DataSourceType, DocumentCreatedFrom, IndexingStatus
from services.knowledge.entities.resource_scope import DatasetRef, DocumentRef
from services.knowledge.indexing.errors import DocumentIsPausedError
from tasks.document_indexing_task import (
    _document_indexing,
    _document_indexing_with_tenant_queue,
    document_indexing_task,
    normal_document_indexing_task,
    priority_document_indexing_task,
)
from tests.unit_tests.config_override import apply_config_overrides


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
