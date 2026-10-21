import uuid
from collections.abc import Generator
from contextlib import contextmanager
from dataclasses import dataclass, field
from importlib import import_module
from unittest.mock import MagicMock, patch

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from core.rag.index_processor.constant.index_type import IndexStructureType
from enums import DeploymentEdition
from models.dataset import Dataset, Document, DocumentSegment
from models.enums import DataSourceType
from services.knowledge.indexing.contracts import DocumentIndexingExecution
from services.knowledge.indexing.locks import (
    KnowledgeIndexingLockBusyError,
    dataset_index_lock_name,
    document_index_lock_name,
)
from services.knowledge.task_outbox.contracts import KnowledgeTaskRequeuedError, KnowledgeTaskRetriesExhaustedError
from tasks.sync_website_document_indexing_task import sync_website_document_indexing_task
from tests.unit_tests.config_override import config_overrides_context
from tests.unit_tests.model_factories import make_dataset, make_document

MODULE = import_module("tasks.sync_website_document_indexing_task")


@dataclass
class RecordingLease:
    name: str
    events: list[str]
    recovered_execution: bool = False

    def assert_owned(self) -> None:
        self.events.append(f"check:{self.name}")


@dataclass
class RecordingLock:
    events: list[str] = field(default_factory=list)

    @contextmanager
    def hold(self, name: str, **_kwargs: object) -> Generator[RecordingLease]:
        self.events.append(f"enter:{name}")
        try:
            yield RecordingLease(name, self.events)
        finally:
            self.events.append(f"exit:{name}")


class BusyLock:
    @contextmanager
    def hold(self, name: str, **_kwargs: object) -> Generator[RecordingLease]:
        raise KnowledgeIndexingLockBusyError(name)
        yield RecordingLease(name, [])  # pragma: no cover


@dataclass
class RecordingMarkerCache:
    releases: list[tuple[str, str]] = field(default_factory=list)

    def clear_syncing(self, document_id: str, *, token: str) -> None:
        self.releases.append((document_id, token))


@pytest.fixture(autouse=True)
def marker_cache(monkeypatch: pytest.MonkeyPatch) -> RecordingMarkerCache:
    cache = RecordingMarkerCache()
    monkeypatch.setattr(MODULE, "RedisDocumentLifecycleCache", lambda **_kwargs: cache)
    return cache


def _dataset(tenant_id: str) -> Dataset:
    return make_dataset(
        dataset_id=str(uuid.uuid4()),
        tenant_id=tenant_id,
        name="Website dataset",
        data_source_type=DataSourceType.WEBSITE_CRAWL,
        created_by=str(uuid.uuid4()),
    )


def _document(dataset: Dataset) -> Document:
    document = make_document(
        document_id=str(uuid.uuid4()),
        tenant_id=dataset.tenant_id,
        dataset_id=dataset.id,
        data_source_type=DataSourceType.WEBSITE_CRAWL,
        name="Website document",
        created_by=str(uuid.uuid4()),
        doc_form=IndexStructureType.PARAGRAPH_INDEX,
    )
    document.indexing_generation = "generation-1"
    return document


def _segment(*, tenant_id: str, dataset_id: str, document_id: str) -> DocumentSegment:
    return DocumentSegment(
        tenant_id=tenant_id,
        dataset_id=dataset_id,
        document_id=document_id,
        position=1,
        content="content",
        word_count=1,
        tokens=1,
        created_by=str(uuid.uuid4()),
    )


def test_rejects_document_outside_dataset_before_side_effects(
    sqlite_session: Session,
    monkeypatch: pytest.MonkeyPatch,
    marker_cache: RecordingMarkerCache,
) -> None:
    tenant_id = str(uuid.uuid4())
    requested_dataset = _dataset(tenant_id)
    foreign_dataset = _dataset(tenant_id)
    foreign_document = _document(foreign_dataset)
    sqlite_session.add_all([requested_dataset, foreign_dataset, foreign_document])
    sqlite_session.commit()
    locks = RecordingLock()
    monkeypatch.setattr(MODULE, "_indexing_lock", lambda: locks)

    with (
        patch("tasks.sync_website_document_indexing_task.FeatureService") as feature_service,
        patch("tasks.sync_website_document_indexing_task.IndexProcessorFactory") as processor_factory,
    ):
        sync_website_document_indexing_task(
            requested_dataset.id,
            foreign_document.id,
            expected_generation="generation-missing",
        )

    feature_service.get_features.assert_not_called()
    processor_factory.assert_not_called()
    assert marker_cache.releases == [(foreign_document.id, "generation-missing")]


@config_overrides_context(DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY)
def test_cleanup_is_owner_scoped_and_skips_empty_vector_ids(
    sqlite_session: Session,
    monkeypatch: pytest.MonkeyPatch,
    marker_cache: RecordingMarkerCache,
) -> None:
    tenant_id = str(uuid.uuid4())
    dataset = _dataset(tenant_id)
    document = _document(dataset)
    owned_segment = _segment(tenant_id=tenant_id, dataset_id=dataset.id, document_id=document.id)
    other_dataset = _dataset(tenant_id)
    decoy_segments = [
        _segment(tenant_id=tenant_id, dataset_id=dataset.id, document_id=str(uuid.uuid4())),
        _segment(tenant_id=tenant_id, dataset_id=other_dataset.id, document_id=document.id),
        _segment(tenant_id=str(uuid.uuid4()), dataset_id=dataset.id, document_id=document.id),
    ]
    for index, segment in enumerate(decoy_segments):
        segment.index_node_id = f"decoy-node-{index}"
    sqlite_session.add_all([dataset, document, owned_segment, other_dataset, *decoy_segments])
    sqlite_session.commit()
    locks = RecordingLock()
    monkeypatch.setattr(MODULE, "_indexing_lock", lambda: locks)

    features = MagicMock()
    with (
        patch("tasks.sync_website_document_indexing_task.FeatureService.get_features", return_value=features),
        patch("tasks.sync_website_document_indexing_task.IndexProcessorFactory") as processor_factory,
        patch("tasks.sync_website_document_indexing_task.build_document_indexing_service") as indexing_runner,
        patch("tasks.sync_website_document_indexing_task.redis_client"),
    ):
        sync_website_document_indexing_task(dataset.id, document.id, expected_generation="generation-1")

    processor_factory.return_value.init_index_processor.return_value.clean.assert_not_called()
    indexing_runner.return_value.run.assert_called_once()
    refs = indexing_runner.return_value.run.call_args.args[0]
    execution = indexing_runner.return_value.run.call_args.kwargs["executions"][document.id]
    assert refs[0].document_id == document.id
    assert isinstance(execution, DocumentIndexingExecution)
    assert execution.expected_generation == "generation-1"
    assert locks.events[0:2] == [
        f"enter:{dataset_index_lock_name(dataset.id)}",
        f"enter:{document_index_lock_name(document.id)}",
    ]
    sqlite_session.expire_all()
    assert set(sqlite_session.scalars(select(DocumentSegment.id))) == {segment.id for segment in decoy_segments}
    assert marker_cache.releases == [(document.id, "generation-1")]


def test_tracked_null_generation_does_not_bind_to_a_non_null_successor(
    sqlite_session: Session,
    monkeypatch: pytest.MonkeyPatch,
    marker_cache: RecordingMarkerCache,
) -> None:
    tenant_id = str(uuid.uuid4())
    dataset = _dataset(tenant_id)
    document = _document(dataset)
    sqlite_session.add_all([dataset, document])
    sqlite_session.commit()
    locks = RecordingLock()
    runner_builds: list[str] = []

    @contextmanager
    def task_execution(_outbox_id: str | None) -> Generator[RecordingLease]:
        yield RecordingLease("delivery", locks.events)

    monkeypatch.setattr(MODULE, "_indexing_lock", lambda: locks)
    monkeypatch.setattr(MODULE, "knowledge_task_execution", task_execution)
    monkeypatch.setattr(MODULE, "build_document_indexing_service", lambda **_kwargs: runner_builds.append("built"))

    sync_website_document_indexing_task(dataset.id, document.id, None, "intent-1")

    assert runner_builds == []
    assert marker_cache.releases == []


def test_stale_generation_releases_only_its_generation_marker(
    sqlite_session: Session,
    monkeypatch: pytest.MonkeyPatch,
    marker_cache: RecordingMarkerCache,
) -> None:
    dataset = _dataset(str(uuid.uuid4()))
    document = _document(dataset)
    sqlite_session.add_all([dataset, document])
    sqlite_session.commit()
    locks = RecordingLock()

    @contextmanager
    def task_execution(_outbox_id: str | None) -> Generator[RecordingLease]:
        yield RecordingLease("delivery", locks.events)

    monkeypatch.setattr(MODULE, "_indexing_lock", lambda: locks)
    monkeypatch.setattr(MODULE, "knowledge_task_execution", task_execution)

    sync_website_document_indexing_task(dataset.id, document.id, "stale-generation", "intent-1")

    assert marker_cache.releases == [(document.id, "stale-generation")]


def test_legacy_delivery_does_not_clear_an_unknown_marker_owner(
    sqlite_session: Session,
    monkeypatch: pytest.MonkeyPatch,
    marker_cache: RecordingMarkerCache,
) -> None:
    dataset = _dataset(str(uuid.uuid4()))
    sqlite_session.add(dataset)
    sqlite_session.commit()
    monkeypatch.setattr(MODULE, "_indexing_lock", lambda: RecordingLock())

    sync_website_document_indexing_task(dataset.id, "missing-document")

    assert marker_cache.releases == []


def test_durable_lock_deferral_keeps_the_generation_marker(
    monkeypatch: pytest.MonkeyPatch,
    marker_cache: RecordingMarkerCache,
) -> None:
    monkeypatch.setattr(MODULE, "_indexing_lock", BusyLock)
    monkeypatch.setattr(MODULE, "defer_knowledge_task_before_execution", lambda *_args, **_kwargs: True)

    with pytest.raises(KnowledgeTaskRequeuedError):
        sync_website_document_indexing_task("dataset-1", "document-1", "generation-1", "intent-1")

    assert marker_cache.releases == []


def test_delivery_owned_elsewhere_keeps_the_generation_marker(
    monkeypatch: pytest.MonkeyPatch,
    marker_cache: RecordingMarkerCache,
) -> None:
    @contextmanager
    def deferred_execution(_outbox_id: str | None) -> Generator[None]:
        yield None

    monkeypatch.setattr(MODULE, "_indexing_lock", lambda: RecordingLock())
    monkeypatch.setattr(MODULE, "knowledge_task_execution", deferred_execution)

    sync_website_document_indexing_task("dataset-1", "document-1", "generation-1", "intent-1")

    assert marker_cache.releases == []


def test_exhausted_delivery_releases_the_generation_marker(
    monkeypatch: pytest.MonkeyPatch,
    marker_cache: RecordingMarkerCache,
) -> None:
    def exhausted(*_args: object) -> bool:
        raise KnowledgeTaskRetriesExhaustedError("exhausted")

    monkeypatch.setattr(MODULE, "_run_sync_website_document_indexing", exhausted)

    with pytest.raises(KnowledgeTaskRetriesExhaustedError):
        sync_website_document_indexing_task("dataset-1", "document-1", "generation-1", "intent-1")

    assert marker_cache.releases == [("document-1", "generation-1")]
